import { Hono } from 'hono';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { aggregateTrackRecord } from '@chartsignl/core/lib/trackRecord';
import { buildPredictionCardSVG } from '@chartsignl/core/lib/predictionCard';
import type {
  AIPrediction,
  GetDailyHighlightResponse,
  GetGlobalTrackRecordResponse,
  GetPredictionResponse,
  GetPredictionsResponse,
  GetPredictionStatsResponse,
} from '@chartsignl/core';
import { pickDailyHighlight } from '@chartsignl/core/lib/dailyHighlight';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import {
  buildPredictionStats,
  resolveDuePredictions,
  resolvePredictionIfDue,
  rowToHistoryItem,
  type PredictionRow,
} from '../services/predictionResolver.js';

const predictionsRoute = new Hono();

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(__dirname, '../../assets/Inter-SemiBold.ttf');

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

function verifyCronSecret(c: { req: { header: (name: string) => string | undefined } }) {
  const secret = c.req.header('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return false;
  }
  return true;
}

async function resolveRows(rows: PredictionRow[]): Promise<PredictionRow[]> {
  const resolved: PredictionRow[] = [];
  for (const row of rows) {
    const updated = await resolvePredictionIfDue(row);
    resolved.push(updated ?? row);
  }
  return resolved;
}

function rowToCardPrediction(data: Record<string, unknown>): AIPrediction {
  const j = (data.prediction_json ?? {}) as AIPrediction;
  return {
    symbol: String(data.symbol),
    interval: j.interval ?? (data.interval as AIPrediction['interval']),
    headline: j.headline ?? String(data.headline ?? ''),
    summary: j.summary ?? '',
    reasoning: j.reasoning ?? [],
    riskFactors: j.riskFactors ?? [],
    direction: (data.direction ?? j.direction ?? 'neutral') as AIPrediction['direction'],
    confidence: Number(data.confidence ?? j.confidence ?? 0),
    expectedChangePct: Number(data.expected_change_pct ?? j.expectedChangePct ?? 0),
    projectedPath: j.projectedPath ?? [],
    createdAt: String(data.created_at),
    horizonEndAt: data.horizon_end_at ? String(data.horizon_end_at) : undefined,
    resolvedAt: data.resolved_at ? String(data.resolved_at) : undefined,
    actualChangePct:
      data.actual_change_pct != null ? Number(data.actual_change_pct) : undefined,
    directionHit: data.direction_hit != null ? Boolean(data.direction_hit) : undefined,
    status: data.resolved_at ? 'resolved' : 'pending',
  };
}

async function loadResolvedCard(id: string): Promise<AIPrediction | null> {
  const { data, error } = await supabaseAdmin
    .from('predictions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data || !data.resolved_at) return null;
  return rowToCardPrediction(data as Record<string, unknown>);
}

function apiBaseFromRequest(c: { req: { url: string } }): string {
  const configured = process.env.API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  return new URL(c.req.url).origin;
}

predictionsRoute.get('/daily-highlight', async (c) => {
  if (!verifyCronSecret(c)) {
    return c.json<GetDailyHighlightResponse>({ success: false, error: 'unauthorized' }, 401);
  }

  try {
    const hours = Math.min(Math.max(Number(c.req.query('hours') ?? 24), 1), 168);
    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('predictions')
      .select(
        'id, symbol, interval, headline, expected_change_pct, confidence, direction, actual_change_pct, direction_hit, resolved_at, created_at'
      )
      .not('resolved_at', 'is', null)
      .gte('resolved_at', since)
      .order('resolved_at', { ascending: false })
      .limit(200);

    if (error) {
      return c.json<GetDailyHighlightResponse>(
        { success: false, error: 'Failed to fetch highlights' },
        500
      );
    }

    const rows = data ?? [];
    const highlight = pickDailyHighlight(rows, apiBaseFromRequest(c));

    return c.json<GetDailyHighlightResponse>({
      success: true,
      highlight,
      windowHours: hours,
      candidatesScanned: rows.length,
    });
  } catch (error) {
    console.error('[Predictions] Daily highlight error:', error);
    return c.json<GetDailyHighlightResponse>(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

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

predictionsRoute.get('/track-record/global', async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('predictions')
      .select('resolved_at, direction_hit');

    if (error) {
      return c.json<GetGlobalTrackRecordResponse>(
        { success: false, error: 'Failed to fetch track record' },
        500
      );
    }

    return c.json<GetGlobalTrackRecordResponse>({
      success: true,
      trackRecord: aggregateTrackRecord(data ?? []),
    });
  } catch (error) {
    console.error('[Predictions] Global track record error:', error);
    return c.json<GetGlobalTrackRecordResponse>(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

predictionsRoute.post('/resolve', async (c) => {
  if (!verifyCronSecret(c)) {
    return c.json({ success: false, error: 'unauthorized' }, 401);
  }
  const summary = await resolveDuePredictions();
  return c.json({ success: true, summary });
});

predictionsRoute.get('/resolver-health', async (c) => {
  if (!verifyCronSecret(c)) {
    return c.json({ success: false, error: 'unauthorized' }, 401);
  }

  const { data: last } = await supabaseAdmin
    .from('resolver_runs')
    .select('*')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: today } = await supabaseAdmin
    .from('resolver_runs')
    .select('resolved, errors')
    .gte('ran_at', since);

  const resolvedLast24h = (today ?? []).reduce((a, r) => a + (r.resolved ?? 0), 0);
  const errorsLast24h = (today ?? []).reduce((a, r) => a + (r.errors ?? 0), 0);
  const stale = !last || Date.now() - Date.parse(last.ran_at) > 90 * 60_000;

  return c.json({ success: true, lastRun: last, resolvedLast24h, errorsLast24h, stale });
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

predictionsRoute.get('/:id/card.svg', async (c) => {
  try {
    const p = await loadResolvedCard(c.req.param('id'));
    if (!p) return c.json({ success: false, error: 'not found or unresolved' }, 404);
    c.header('Content-Type', 'image/svg+xml');
    c.header('Cache-Control', 'public, max-age=86400, immutable');
    return c.body(buildPredictionCardSVG(p));
  } catch (error) {
    console.error('[Predictions] Card SVG error:', error);
    return c.json({ success: false, error: 'Failed to render card' }, 500);
  }
});

predictionsRoute.get('/:id/card.png', async (c) => {
  try {
    const p = await loadResolvedCard(c.req.param('id'));
    if (!p) return c.json({ success: false, error: 'not found or unresolved' }, 404);

    const svg = buildPredictionCardSVG(p);
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
      font: {
        fontFiles: [FONT_PATH],
        defaultFontFamily: 'Inter',
        loadSystemFonts: false,
      },
    })
      .render()
      .asPng();

    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'public, max-age=86400, immutable');
    return c.body(Buffer.from(png));
  } catch (error) {
    console.error('[Predictions] Card PNG error:', error);
    return c.json({ success: false, error: 'Failed to render card' }, 500);
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
