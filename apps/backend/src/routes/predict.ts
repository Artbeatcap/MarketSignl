import { Hono } from 'hono';
import OpenAI from 'openai';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import { FREE_PREDICTION_LIMIT } from '@marketsignl/core';
import type { AIPrediction, PredictRequest } from '@marketsignl/core';
import { PREDICTION_SYSTEM_PROMPT } from '../prompts/prediction.js';
import {
  calculateAllIndicators,
  type MarketDataPoint,
  type TechnicalIndicators,
} from '../lib/technicalCalculator.js';
import { scoreLevels, type ScoredAnalysis } from '../lib/confluenceScorer.js';
import { buildVolatilityCone, deriveDriftBias } from '../lib/volatilityCone.js';

interface AINarrative {
  headline: string;
  summary: string;
  reasoning: string[];
  riskFactors: string[];
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const predictRoute = new Hono();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_HORIZON_BARS = 10;

function getEffectivePredictionsThisWeek(
  usage: { free_predictions_used: number; last_prediction_at: string | null } | null | undefined
): number {
  if (!usage) return 0;
  if (!usage.last_prediction_at) return 0;
  const elapsed = Date.now() - new Date(usage.last_prediction_at).getTime();
  return elapsed < WEEK_MS ? usage.free_predictions_used : 0;
}

function barDurationMs(interval: string): number {
  const map: Record<string, number> = {
    '1d': 5 * 60 * 1000,
    '5d': 30 * 60 * 1000,
    '1mo': 24 * 60 * 60 * 1000,
    '3mo': 24 * 60 * 60 * 1000,
    '6mo': 24 * 60 * 60 * 1000,
    '1y': 24 * 60 * 60 * 1000,
    '2y': 7 * 24 * 60 * 60 * 1000,
    '5y': 7 * 24 * 60 * 60 * 1000,
  };
  return map[interval] ?? 24 * 60 * 60 * 1000;
}

function buildPredictionPrompt(
  symbol: string,
  interval: string,
  horizonBars: number,
  indicators: TechnicalIndicators,
  scoredAnalysis: ScoredAnalysis
): string {
  const { currentPrice, priceChangePercent, trend, ema, atr, bollinger, overextension } = indicators;
  const { supportLevels, resistanceLevels, confidence } = scoredAnalysis;

  return `Generate an AI price projection for ${symbol} on the ${interval} timeframe.

CURRENT STATE:
- Price: $${currentPrice.toFixed(2)} (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)
- Trend: ${trend.direction} (${(trend.strength * 100).toFixed(0)}% strength)
- Trading Bias: ${trend.tradingBias}

MOVING AVERAGES:
- EMA 9: $${(ema.ema9 || 0).toFixed(2)}
- EMA 21: $${(ema.ema21 || 0).toFixed(2)}
- EMA 65: $${(ema.ema65 || 0).toFixed(2)}
- Alignment: ${trend.emaAlignment || 'mixed'}

VOLATILITY:
- ATR: $${atr.atr.toFixed(2)} (${atr.atrPercent.toFixed(2)}% of price)
- Bollinger %B: ${(bollinger.percentB * 100).toFixed(1)}%
- Overextension: ${overextension.status}

KEY SUPPORT (top 3):
${supportLevels.slice(0, 3).map((l, i) => `${i + 1}. $${l.price.toFixed(2)} (${l.confluenceScore}% confluence)`).join('\n')}

KEY RESISTANCE (top 3):
${resistanceLevels.slice(0, 3).map((l, i) => `${i + 1}. $${l.price.toFixed(2)} (${l.confluenceScore}% confluence)`).join('\n')}

SETUP CONFIDENCE: ${confidence.overall}% (${confidence.label})

Give your directional read for roughly the next ${horizonBars} bars: direction, confidence, the key drivers, and the main risks. Reference specific indicator values. Do not output any prices or bands.`;
}

predictRoute.post('/', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Missing authorization token' }, 401);
    }

    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    if (!userId) {
      return c.json({ success: false, error: 'Invalid authorization token' }, 401);
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_pro')
      .eq('id', userId)
      .single();

    const { data: usage } = await supabaseAdmin
      .from('usage_counters')
      .select('free_predictions_used, last_prediction_at')
      .eq('user_id', userId)
      .maybeSingle();

    const effectiveUsed = getEffectivePredictionsThisWeek(usage ?? undefined);

    if (!profile?.is_pro && effectiveUsed >= FREE_PREDICTION_LIMIT) {
      return c.json(
        {
          success: false,
          error: `Free tier limit reached (${FREE_PREDICTION_LIMIT} predictions/week). Please upgrade to Pro.`,
        },
        403
      );
    }

    const body = (await c.req.json()) as PredictRequest;
    const { symbol, interval, data, horizonBars = DEFAULT_HORIZON_BARS } = body;

    if (!symbol || !interval || !Array.isArray(data) || data.length === 0) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const indicators = calculateAllIndicators(data as MarketDataPoint[], symbol, interval);
    if (!indicators) {
      return c.json({ success: false, error: 'Failed to calculate technical indicators' }, 500);
    }

    const scoredAnalysis = scoreLevels(indicators);
    const userPrompt = buildPredictionPrompt(symbol, interval, horizonBars, indicators, scoredAnalysis);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PREDICTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: 1200,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const aiText = completion.choices[0]?.message?.content;
    if (!aiText) {
      throw new Error('No response from AI');
    }

    const aiResponse = JSON.parse(aiText) as AINarrative;
    const lastPoint = data[data.length - 1];
    const stepMs = barDurationMs(interval);

    const driftBias = deriveDriftBias(indicators);

    const { projectedPath, expectedChangePct } = buildVolatilityCone({
      lastClose: indicators.currentPrice,
      atr: indicators.atr.atr,
      driftBias,
      horizonBars,
      stepMs,
      lastTimestamp: lastPoint.timestamp,
    });

    const prediction: AIPrediction = {
      symbol: symbol.toUpperCase(),
      interval: interval as AIPrediction['interval'],
      headline: aiResponse.headline,
      summary: aiResponse.summary,
      reasoning: aiResponse.reasoning ?? [],
      riskFactors: aiResponse.riskFactors ?? [],
      direction: aiResponse.direction ?? 'neutral',
      confidence: clampN(aiResponse.confidence ?? 50, 0, 100),
      expectedChangePct,
      projectedPath,
    };

    const { data: saved, error: saveError } = await supabaseAdmin
      .from('predictions')
      .insert({
        user_id: userId,
        symbol: prediction.symbol,
        interval: prediction.interval,
        headline: prediction.headline,
        expected_change_pct: prediction.expectedChangePct,
        confidence: prediction.confidence,
        direction: prediction.direction,
        prediction_json: prediction,
      })
      .select('id, created_at')
      .single();

    if (saveError) {
      console.error('[Predict] Save error:', saveError);
      return c.json({ success: false, error: 'Failed to save prediction' }, 500);
    }

    // Update usage counter
    const newUsed = effectiveUsed + 1;
    await supabaseAdmin.from('usage_counters').upsert(
      {
        user_id: userId,
        free_predictions_used: newUsed,
        last_prediction_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    return c.json({
      success: true,
      predictionId: saved.id,
      prediction: { ...prediction, id: saved.id, createdAt: saved.created_at },
    });
  } catch (error) {
    console.error('[Predict] Error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      500
    );
  }
});

export default predictRoute;
