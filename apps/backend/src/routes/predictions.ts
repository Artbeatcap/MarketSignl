import { Hono } from 'hono';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import type { AIPrediction, GetPredictionResponse, GetPredictionsResponse } from '@marketsignl/core';

const predictionsRoute = new Hono();

predictionsRoute.get('/', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json<GetPredictionsResponse>({ success: false, error: 'Missing authorization token' }, 401);
    }

    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    if (!userId) {
      return c.json<GetPredictionsResponse>({ success: false, error: 'Invalid authorization token' }, 401);
    }

    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 50);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('predictions')
      .select('id, symbol, interval, headline, expected_change_pct, confidence, direction, created_at', {
        count: 'exact',
      })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return c.json<GetPredictionsResponse>({ success: false, error: 'Failed to fetch predictions' }, 500);
    }

    const predictions = (data ?? []).map((row) => ({
      id: row.id,
      symbol: row.symbol,
      interval: row.interval,
      headline: row.headline ?? '',
      expectedChangePct: Number(row.expected_change_pct ?? 0),
      confidence: row.confidence ?? 0,
      direction: row.direction as AIPrediction['direction'],
      createdAt: row.created_at,
    }));

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
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json<GetPredictionResponse>({ success: false, error: 'Missing authorization token' }, 401);
    }

    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    if (!userId) {
      return c.json<GetPredictionResponse>({ success: false, error: 'Invalid authorization token' }, 401);
    }

    const id = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('predictions')
      .select('prediction_json, created_at')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return c.json<GetPredictionResponse>({ success: false, error: 'Prediction not found' }, 404);
    }

    const prediction = data.prediction_json as AIPrediction;

    return c.json<GetPredictionResponse>({
      success: true,
      prediction: { ...prediction, id },
      createdAt: data.created_at,
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
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Missing authorization token' }, 401);
    }

    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    if (!userId) {
      return c.json({ success: false, error: 'Invalid authorization token' }, 401);
    }

    const id = c.req.param('id');

    const { error } = await supabaseAdmin
      .from('predictions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

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
