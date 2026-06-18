import { Hono } from 'hono';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import type {
  AIPrediction,
  GetPredictionResponse,
  GetPredictionsResponse,
  GetPredictionStatsResponse,
} from '@marketsignl/core';
import {
  buildPredictionStats,
  resolvePredictionIfDue,
  rowToHistoryItem,
  type PredictionRow,
} from '../services/predictionResolver.js';

const predictionsRoute = new Hono();

const LIST_SELECT =
  'id, user_id, symbol, interval, headline, expected_change_pct, confidence, direction, prediction_json, created_at, entry_close, horizon_end_at, resolved_price, actual_change_pct, direction_hit, band_contained, magnitude_error_pct, resolved_at';

async function authenticate(c: { req: { header: (name: string) => string | undefined } }) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Missing authorization token' as const, status: 401 as const };
  }
  const token = authHeader.slice(7);
  const userId = await getUserFromToken(token);
  if (!userId) {
    return { error: 'Invalid authorization token' as const, status: 401 as const };
  }
  return { userId };
}

async function resolveRows(rows: PredictionRow[]): Promise<PredictionRow[]> {
  const resolved: PredictionRow[] = [];
  for (const row of rows) {
    const updated = await resolvePredictionIfDue(row);
    resolved.push(updated ?? row);
  }
  return resolved;
}

predictionsRoute.get('/stats', async (c) => {
  try {
    const auth = await authenticate(c);
    if ('error' in auth) {
      return c.json<GetPredictionStatsResponse>({ success: false, error: auth.error }, auth.status);
    }

    const { data, error } = await supabaseAdmin
      .from('predictions')
      .select(LIST_SELECT)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      return c.json<GetPredictionStatsResponse>({ success: false, error: 'Failed to fetch stats' }, 500);
    }

    const rows = await resolveRows((data ?? []) as PredictionRow[]);
    const stats = buildPredictionStats(rows);

    return c.json<GetPredictionStatsResponse>({ success: true, stats });
  } catch (error) {
    console.error('[Predictions] Stats error:', error);
    return c.json<GetPredictionStatsResponse>(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

predictionsRoute.get('/', async (c) => {
  try {
    const auth = await authenticate(c);
    if ('error' in auth) {
      return c.json<GetPredictionsResponse>({ success: false, error: auth.error }, auth.status);
    }

    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 50);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('predictions')
      .select(LIST_SELECT, { count: 'exact' })
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return c.json<GetPredictionsResponse>({ success: false, error: 'Failed to fetch predictions' }, 500);
    }

    const rows = await resolveRows((data ?? []) as PredictionRow[]);
    const predictions = rows.map(rowToHistoryItem);
    const total = count ?? 0;

    return c.json<GetPredictionsResponse>({
      success: true,
      predictions,
      total,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error('[Predictions] List error:', error);
    return c.json<GetPredictionsResponse>(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

predictionsRoute.get('/:id', async (c) => {
  try {
    const auth = await authenticate(c);
    if ('error' in auth) {
      return c.json<GetPredictionResponse>({ success: false, error: auth.error }, auth.status);
    }

    const id = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('predictions')
      .select(`${LIST_SELECT}`)
      .eq('id', id)
      .eq('user_id', auth.userId)
      .single();

    if (error || !data) {
      return c.json<GetPredictionResponse>({ success: false, error: 'Prediction not found' }, 404);
    }

    const [row] = await resolveRows([data as PredictionRow]);
    const prediction = row.prediction_json as AIPrediction;

    return c.json<GetPredictionResponse>({
      success: true,
      prediction: {
        ...prediction,
        id: row.id,
        createdAt: row.created_at,
        horizonEndAt: row.horizon_end_at ?? undefined,
        resolvedAt: row.resolved_at ?? undefined,
        resolvedPrice: row.resolved_price != null ? Number(row.resolved_price) : undefined,
        actualChangePct:
          row.actual_change_pct != null ? Number(row.actual_change_pct) : undefined,
        directionHit: row.direction_hit ?? undefined,
        bandContained: row.band_contained ?? undefined,
        magnitudeErrorPct:
          row.magnitude_error_pct != null ? Number(row.magnitude_error_pct) : undefined,
        status: row.resolved_at ? 'resolved' : 'pending',
      },
      createdAt: row.created_at,
    });
  } catch (error) {
    console.error('[Predictions] Get error:', error);
    return c.json<GetPredictionResponse>(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

predictionsRoute.delete('/:id', async (c) => {
  try {
    const auth = await authenticate(c);
    if ('error' in auth) {
      return c.json({ success: false, error: auth.error }, auth.status);
    }

    const id = c.req.param('id');

    const { error } = await supabaseAdmin
      .from('predictions')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.userId);

    if (error) {
      return c.json({ success: false, error: 'Failed to delete prediction' }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('[Predictions] Delete error:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

export default predictionsRoute;
