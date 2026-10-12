import { Hono } from 'hono';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import { FREE_PREDICTION_LIMIT } from '@chartsignl/core';
import type { PredictRequest } from '@chartsignl/core';
import type { MarketDataPoint } from '../lib/technicalCalculator.js';
import { DEFAULT_HORIZON_BARS, runPrediction } from '../lib/runPrediction.js';
import { clientMessageForError } from '../lib/openaiGuard.js';

const predictRoute = new Hono();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getEffectivePredictionsThisWeek(
  usage: { free_predictions_used: number; last_prediction_at: string | null } | null | undefined
): number {
  if (!usage) return 0;
  if (!usage.last_prediction_at) return 0;
  const elapsed = Date.now() - new Date(usage.last_prediction_at).getTime();
  return elapsed < WEEK_MS ? usage.free_predictions_used : 0;
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

    const result = await runPrediction({
      symbol,
      interval,
      data: data as MarketDataPoint[],
      horizonBars,
    });

    if (!result.ok) {
      return c.json({ success: false, error: result.error }, result.status);
    }

    const { prediction, currentPrice, horizonEndMs } = result;

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
        entry_close: currentPrice,
        horizon_end_at: horizonEndMs ? new Date(horizonEndMs).toISOString() : null,
      })
      .select('id, created_at')
      .single();

    if (saveError) {
      console.error('[Predict] Save error:', saveError);
      return c.json({ success: false, error: 'Failed to save prediction' }, 500);
    }

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
    const mapped = clientMessageForError(error);
    return c.json({ success: false, error: mapped.message }, mapped.status);
  }
});

export default predictRoute;
