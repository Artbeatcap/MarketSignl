import type { AIPrediction, PredictionDirection } from '@chartsignl/core';
import { supabaseAdmin } from '../lib/supabase.js';
import { closeAtTimestamp, fetchAggregatesInRange, getBarDurationMs } from '../lib/marketDataFetcher.js';

/** Neutral calls "hit" when move stays within this % band. */
export const NEUTRAL_THRESHOLD_PCT = 0.25;

/** Minimum resolved predictions before surfacing public accuracy stats. */
export const MIN_STATS_SAMPLE = 10;

export interface PredictionRow {
  id: string;
  user_id: string;
  symbol: string;
  interval: string;
  headline: string | null;
  expected_change_pct: number | null;
  confidence: number | null;
  direction: PredictionDirection | null;
  prediction_json: AIPrediction;
  created_at: string;
  entry_close: number | null;
  horizon_end_at: string | null;
  resolved_price: number | null;
  actual_change_pct: number | null;
  direction_hit: boolean | null;
  band_contained: boolean | null;
  magnitude_error_pct: number | null;
  resolved_at: string | null;
  analysis_id?: string | null;
}

export interface ResolutionResult {
  resolvedPrice: number;
  actualChangePct: number;
  directionHit: boolean;
  bandContained: boolean;
  magnitudeErrorPct: number;
}

export function getHorizonEndMs(prediction: AIPrediction): number | null {
  const path = prediction.projectedPath;
  if (!path?.length) return null;
  return path[path.length - 1].timestamp;
}

export function isPastHorizon(horizonEndMs: number): boolean {
  return Date.now() >= horizonEndMs;
}

export function scoreDirectionHit(
  direction: PredictionDirection,
  actualChangePct: number
): boolean {
  if (direction === 'bullish') return actualChangePct > NEUTRAL_THRESHOLD_PCT;
  if (direction === 'bearish') return actualChangePct < -NEUTRAL_THRESHOLD_PCT;
  return Math.abs(actualChangePct) <= NEUTRAL_THRESHOLD_PCT;
}

export function scoreBandContained(
  resolvedPrice: number,
  terminalPoint: AIPrediction['projectedPath'][number]
): boolean {
  const lower = terminalPoint.lowerBand ?? terminalPoint.price;
  const upper = terminalPoint.upperBand ?? terminalPoint.price;
  return resolvedPrice >= lower && resolvedPrice <= upper;
}

export function computeResolution(
  prediction: AIPrediction,
  entryClose: number,
  resolvedPrice: number
): ResolutionResult {
  const actualChangePct = ((resolvedPrice / entryClose - 1) * 100);
  const terminal = prediction.projectedPath[prediction.projectedPath.length - 1];
  const directionHit = scoreDirectionHit(prediction.direction, actualChangePct);
  const bandContained = terminal ? scoreBandContained(resolvedPrice, terminal) : false;
  const magnitudeErrorPct = Math.abs(actualChangePct - prediction.expectedChangePct);

  return {
    resolvedPrice,
    actualChangePct: Math.round(actualChangePct * 100) / 100,
    directionHit,
    bandContained,
    magnitudeErrorPct: Math.round(magnitudeErrorPct * 100) / 100,
  };
}

async function resolveEntryClose(row: PredictionRow): Promise<number | null> {
  if (row.entry_close != null && row.entry_close > 0) return Number(row.entry_close);

  const createdMs = new Date(row.created_at).getTime();
  const barMs = getBarDurationMs(row.interval);
  const bars = await fetchAggregatesInRange(
    row.symbol,
    createdMs - barMs * 5,
    createdMs + barMs * 2,
    row.interval
  );
  return closeAtTimestamp(bars, createdMs);
}

/**
 * Lazy resolution: fetch actual price at horizon and persist scores.
 * Returns updated row fields or null if not yet resolvable.
 */
export async function resolvePredictionIfDue(row: PredictionRow): Promise<PredictionRow | null> {
  if (row.resolved_at) return row;

  const prediction = row.prediction_json;
  const horizonEndMs =
    row.horizon_end_at != null
      ? new Date(row.horizon_end_at).getTime()
      : getHorizonEndMs(prediction);

  if (horizonEndMs == null || !isPastHorizon(horizonEndMs)) return null;

  try {
    const entryClose = await resolveEntryClose(row);
    if (entryClose == null || entryClose <= 0) {
      console.warn('[Resolution] No entry close for prediction', row.id);
      return null;
    }

    const barMs = getBarDurationMs(row.interval);
    const bars = await fetchAggregatesInRange(
      row.symbol,
      horizonEndMs - barMs * 3,
      horizonEndMs + barMs * 5,
      row.interval
    );

    const resolvedPrice = closeAtTimestamp(bars, horizonEndMs);
    if (resolvedPrice == null) {
      console.warn('[Resolution] No bar at horizon for prediction', row.id);
      return null;
    }

    const scores = computeResolution(prediction, entryClose, resolvedPrice);
    const resolvedAt = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('predictions')
      .update({
        entry_close: entryClose,
        horizon_end_at: new Date(horizonEndMs).toISOString(),
        resolved_price: scores.resolvedPrice,
        actual_change_pct: scores.actualChangePct,
        direction_hit: scores.directionHit,
        band_contained: scores.bandContained,
        magnitude_error_pct: scores.magnitudeErrorPct,
        resolved_at: resolvedAt,
      })
      .eq('id', row.id);

    if (error) {
      console.error('[Resolution] Persist error:', error);
      return null;
    }

    return {
      ...row,
      entry_close: entryClose,
      horizon_end_at: new Date(horizonEndMs).toISOString(),
      resolved_price: scores.resolvedPrice,
      actual_change_pct: scores.actualChangePct,
      direction_hit: scores.directionHit,
      band_contained: scores.bandContained,
      magnitude_error_pct: scores.magnitudeErrorPct,
      resolved_at: resolvedAt,
    };
  } catch (err) {
    console.error('[Resolution] Failed for prediction', row.id, err);
    return null;
  }
}

export interface CalibrationBucket {
  label: string;
  minConfidence: number;
  maxConfidence: number;
  count: number;
  hitRate: number | null;
}

export interface PredictionStats {
  resolvedCount: number;
  pendingCount: number;
  directionHitRate: number | null;
  avgMagnitudeErrorPct: number | null;
  bandContainmentRate: number | null;
  calibration: CalibrationBucket[];
  minSampleSize: number;
  statsReady: boolean;
}

const CALIBRATION_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: '50–59%', min: 50, max: 59 },
  { label: '60–69%', min: 60, max: 69 },
  { label: '70–79%', min: 70, max: 79 },
  { label: '80–89%', min: 80, max: 89 },
  { label: '90–100%', min: 90, max: 100 },
];

export function buildPredictionStats(rows: PredictionRow[]): PredictionStats {
  const resolved = rows.filter((r) => r.resolved_at != null && r.direction_hit != null);
  const pending = rows.filter((r) => !r.resolved_at);

  const hits = resolved.filter((r) => r.direction_hit === true).length;
  const directionHitRate =
    resolved.length > 0 ? Math.round((hits / resolved.length) * 1000) / 10 : null;

  const avgMagnitudeErrorPct =
    resolved.length > 0
      ? Math.round(
          (resolved.reduce((s, r) => s + (r.magnitude_error_pct ?? 0), 0) / resolved.length) * 100
        ) / 100
      : null;

  const bandHits = resolved.filter((r) => r.band_contained === true).length;
  const bandContainmentRate =
    resolved.length > 0 ? Math.round((bandHits / resolved.length) * 1000) / 10 : null;

  const calibration: CalibrationBucket[] = CALIBRATION_BUCKETS.map((bucket) => {
    const inBucket = resolved.filter(
      (r) =>
        (r.confidence ?? 0) >= bucket.min && (r.confidence ?? 0) <= bucket.max
    );
    const bucketHits = inBucket.filter((r) => r.direction_hit === true).length;
    return {
      label: bucket.label,
      minConfidence: bucket.min,
      maxConfidence: bucket.max,
      count: inBucket.length,
      hitRate:
        inBucket.length > 0
          ? Math.round((bucketHits / inBucket.length) * 1000) / 10
          : null,
    };
  });

  return {
    resolvedCount: resolved.length,
    pendingCount: pending.length,
    directionHitRate,
    avgMagnitudeErrorPct,
    bandContainmentRate,
    calibration,
    minSampleSize: MIN_STATS_SAMPLE,
    statsReady: resolved.length >= MIN_STATS_SAMPLE,
  };
}

export function rowToHistoryItem(row: PredictionRow, analysisId?: string) {
  return {
    id: row.id,
    symbol: row.symbol,
    interval: row.interval,
    headline: row.headline ?? '',
    expectedChangePct: Number(row.expected_change_pct ?? 0),
    confidence: row.confidence ?? 0,
    direction: (row.direction ?? 'neutral') as PredictionDirection,
    createdAt: row.created_at,
    horizonEndAt: row.horizon_end_at ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    resolvedPrice: row.resolved_price != null ? Number(row.resolved_price) : undefined,
    actualChangePct: row.actual_change_pct != null ? Number(row.actual_change_pct) : undefined,
    directionHit: row.direction_hit ?? undefined,
    bandContained: row.band_contained ?? undefined,
    magnitudeErrorPct:
      row.magnitude_error_pct != null ? Number(row.magnitude_error_pct) : undefined,
    status: row.resolved_at ? ('resolved' as const) : ('pending' as const),
    ...(analysisId ? { analysisId } : {}),
  };
}

export interface ResolveDueSummary {
  scanned: number;
  resolved: number;
  voided: number;
  skipped: number;
  errors: number;
}

const RESOLVER_LIST_SELECT =
  'id, user_id, symbol, interval, headline, expected_change_pct, confidence, direction, prediction_json, created_at, entry_close, horizon_end_at, resolved_price, actual_change_pct, direction_hit, band_contained, magnitude_error_pct, resolved_at';

/**
 * Batch-resolve all predictions past their horizon. Called by cron / POST /resolve.
 * Logs each run to resolver_runs for observability.
 */
export async function resolveDuePredictions(): Promise<ResolveDueSummary> {
  const startedAt = Date.now();
  const summary: ResolveDueSummary = {
    scanned: 0,
    resolved: 0,
    voided: 0,
    skipped: 0,
    errors: 0,
  };

  const { data: rows, error } = await supabaseAdmin
    .from('predictions')
    .select(RESOLVER_LIST_SELECT)
    .is('resolved_at', null)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) {
    console.error('[resolver] failed to fetch pending predictions:', error);
    summary.errors += 1;
  } else {
    for (const row of (rows ?? []) as PredictionRow[]) {
      summary.scanned += 1;
      try {
        const before = row.resolved_at;
        const updated = await resolvePredictionIfDue(row);
        if (updated?.resolved_at && !before) {
          summary.resolved += 1;
        } else {
          summary.skipped += 1;
        }
      } catch (e) {
        console.error('[resolver] error resolving', row.id, e);
        summary.errors += 1;
      }
    }
  }

  try {
    await supabaseAdmin.from('resolver_runs').insert({
      scanned: summary.scanned,
      resolved: summary.resolved,
      voided: summary.voided,
      skipped: summary.skipped,
      errors: summary.errors,
      duration_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error('[resolver] failed to log run:', e);
  }

  return summary;
}
