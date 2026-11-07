// Internal-only routes for the Setup Sniper news-momentum module (same VPS).
// Auth: X-Internal-Key shared secret (INTERNAL_API_KEY env) — NOT user JWT.
// These bypass usage counters (machine traffic must never consume user quota).

import { Hono } from 'hono';
import OpenAI from 'openai';
import { supabaseAdmin } from '../lib/supabase.js';
import {
  calculateAllIndicators,
  type MarketDataPoint,
  type TechnicalIndicators,
} from '../lib/technicalCalculator.js';
import {
  scoreLevels,
  type ScoredAnalysis,
} from '../lib/confluenceScorer.js';

const route = new Hono();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const guard = (c: { req: { header: (name: string) => string | undefined } }) =>
  c.req.header('X-Internal-Key') === process.env.INTERNAL_API_KEY;

const SYSTEM_PROMPT = `You are a technical analysis expert for ChartSignl. You receive pre-calculated technical indicators and scored support/resistance levels for a ticker that JUST fired an automated news-momentum entry signal. Interpret the data: does the technical picture support or contradict the signal? Be concise. Use only provided numbers.
Return JSON: {"headline": "under 15 words", "verdict": "supports" | "neutral" | "contradicts", "confidence": 0-100, "invalidation": "one sentence", "keyLevel": number}`;

function buildSignalUserPrompt(
  symbol: string,
  interval: string,
  indicators: TechnicalIndicators,
  scoredAnalysis: ScoredAnalysis,
  signal: { side: string; entry: number; stop: number }
): string {
  const { currentPrice, priceChangePercent, trend, ema, atr, bollinger, overextension } =
    indicators;
  const { supportLevels, resistanceLevels, confidence } = scoredAnalysis;
  const topSupport = supportLevels.slice(0, 3);
  const topResistance = resistanceLevels.slice(0, 3);

  const ema9Diff = ema.ema9 > 0 ? ((ema.ema9 - currentPrice) / currentPrice) * 100 : 0;
  const ema21Diff = ema.ema21 > 0 ? ((ema.ema21 - currentPrice) / currentPrice) * 100 : 0;

  return `Signal: ${signal.side} ${symbol} E $${signal.entry} S $${signal.stop} (${interval}).

CURRENT STATE:
- Price: $${currentPrice.toFixed(2)} (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)
- Trend: ${trend.direction} (${(trend.strength * 100).toFixed(0)}% strength)
- Trading Bias: ${trend.tradingBias} - ${trend.biasReason}

MOVING AVERAGES:
- EMA 9: $${(ema.ema9 || 0).toFixed(2)} (${ema9Diff > 0 ? '+' : ''}${ema9Diff.toFixed(2)}%)
- EMA 21: $${(ema.ema21 || 0).toFixed(2)} (${ema21Diff > 0 ? '+' : ''}${ema21Diff.toFixed(2)}%)
- Alignment: ${trend.emaAlignment || 'mixed'}

VOLATILITY:
- ATR: $${atr.atr.toFixed(2)} (${atr.atrPercent.toFixed(2)}% of price)
- Bollinger Band Position: ${(bollinger.percentB * 100).toFixed(1)}%
- Overextension: ${overextension.status} (${overextension.direction} EMA21)

TOP SUPPORT (${supportLevels.length} total, top 3):
${topSupport.map((l: ScoredAnalysis['supportLevels'][number], i: number) => `${i + 1}. $${l.price.toFixed(2)} - ${l.strength} (${l.confluenceScore}% confluence)`).join('\n')}

TOP RESISTANCE (${resistanceLevels.length} total, top 3):
${topResistance.map((l: ScoredAnalysis['resistanceLevels'][number], i: number) => `${i + 1}. $${l.price.toFixed(2)} - ${l.strength} (${l.confluenceScore}% confluence)`).join('\n')}

ANALYSIS CONFIDENCE: ${confidence.overall}% (${confidence.label})

Does this technical picture support or contradict the fired ${signal.side} signal?`;
}

// POST /api/internal/signal-analysis
// body: { symbol, interval, data: MarketDataPoint[], signal: { side, entry, stop } }
route.post('/signal-analysis', async (c) => {
  if (!guard(c)) return c.json({ success: false, error: 'unauthorized' }, 401);
  try {
    const { symbol, interval, data, signal } = await c.req.json();
    if (!symbol || !interval || !Array.isArray(data) || data.length < 20 || !signal) {
      return c.json({ success: false, error: 'Missing required fields or insufficient bars' }, 400);
    }

    const indicators = calculateAllIndicators(data as MarketDataPoint[], symbol, interval);
    if (!indicators) {
      return c.json({ success: false, error: 'Failed to calculate technical indicators' }, 500);
    }

    const scored = scoreLevels(indicators);
    const user = buildSignalUserPrompt(symbol, interval, indicators, scored, signal);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      max_completion_tokens: 300,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const atlas = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
    return c.json({ success: true, atlas, scored });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/internal/sniper-alert — persist alert for the in-app Signals feed
// body: { ticker, tier, side, alert_type, entry, stop, levels, atlas, fired_at, slack_ts }
route.post('/sniper-alert', async (c) => {
  if (!guard(c)) return c.json({ success: false, error: 'unauthorized' }, 401);
  try {
    const body = await c.req.json();
    const { error } = await supabaseAdmin.from('sniper_alerts').insert({
      ticker: body.ticker,
      tier: body.tier,
      side: body.side,
      alert_type: body.alert_type,
      entry: body.entry ?? null,
      stop: body.stop ?? null,
      levels: body.levels ?? {},
      slack_ts: body.slack_ts ?? null,
      atlas: body.atlas ?? null,
      fired_at: body.fired_at ?? new Date().toISOString(),
    });
    if (error) {
      console.error('[internal/sniper-alert] insert failed:', error.message);
      throw error;
    }
    return c.json({ success: true });
  } catch (e: unknown) {
    const message =
      e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : e instanceof Error
          ? e.message
          : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export default route;
