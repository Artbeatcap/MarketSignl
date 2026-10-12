import OpenAI from 'openai';
import type { AIPrediction } from '@chartsignl/core';
import { PREDICTION_SYSTEM_PROMPT } from '../prompts/prediction.js';
import {
  calculateAllIndicators,
  type MarketDataPoint,
  type TechnicalIndicators,
} from './technicalCalculator.js';
import { scoreLevels, type ScoredAnalysis } from './confluenceScorer.js';
import { buildVolatilityCone, deriveDriftBias } from './volatilityCone.js';
import {
  atlasCacheKey,
  atlasUnavailable,
  isAtlasPaused,
  isInsufficientQuota,
  noteQuotaExhausted,
  readAtlasCache,
  writeAtlasCache,
} from './openaiGuard.js';

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

export const DEFAULT_HORIZON_BARS = 10;

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
- Trend: ${trend.direction} (${trend.strength.toFixed(0)}% strength)
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

export type RunPredictionResult =
  | { ok: true; prediction: AIPrediction; currentPrice: number; horizonEndMs?: number }
  | { ok: false; error: string; status: 400 | 500 | 503 };

export async function runPrediction(input: {
  symbol: string;
  interval: string;
  data: MarketDataPoint[];
  horizonBars?: number;
}): Promise<RunPredictionResult> {
  const { symbol, interval, data, horizonBars = DEFAULT_HORIZON_BARS } = input;

  const cacheKey = atlasCacheKey({ kind: 'prediction', symbol, interval });
  const cached = readAtlasCache<Extract<RunPredictionResult, { ok: true }>>(cacheKey);
  if (cached) {
    console.log(`[Atlas] Reusing recent prediction for ${symbol} ${interval}`);
    return cached;
  }
  if (isAtlasPaused()) {
    return atlasUnavailable();
  }

  const indicators = calculateAllIndicators(data, symbol, interval);
  if (!indicators) {
    return { ok: false, error: 'Failed to calculate technical indicators', status: 500 };
  }

  const scoredAnalysis = scoreLevels(indicators);
  const userPrompt = buildPredictionPrompt(symbol, interval, horizonBars, indicators, scoredAnalysis);

  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PREDICTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: 1200,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
  } catch (error) {
    if (isInsufficientQuota(error)) {
      noteQuotaExhausted();
      return atlasUnavailable();
    }
    throw error;
  }

  const aiText = completion.choices[0]?.message?.content;
  if (!aiText) {
    return { ok: false, error: 'No response from AI', status: 500 };
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

  const horizonEndMs = projectedPath[projectedPath.length - 1]?.timestamp;

  const result: Extract<RunPredictionResult, { ok: true }> = {
    ok: true,
    prediction,
    currentPrice: indicators.currentPrice,
    horizonEndMs,
  };
  writeAtlasCache(cacheKey, result);
  return result;
}
