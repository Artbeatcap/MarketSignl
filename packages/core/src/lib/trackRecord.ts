/** Minimum resolved predictions before surfacing public homepage proof. */
export const MIN_PUBLIC_TRACK_RECORD = 20;

export interface TrackRecordRow {
  resolved_at?: string | null;
  direction_hit?: boolean | null;
}

export interface GlobalTrackRecord {
  resolvedCount: number;
  pendingCount: number;
  directionHitRate: number | null;
  minSampleSize: number;
  statsReady: boolean;
}

export function aggregateTrackRecord(rows: TrackRecordRow[]): GlobalTrackRecord {
  const resolved = rows.filter((r) => r.resolved_at != null && r.direction_hit != null);
  const pending = rows.filter((r) => !r.resolved_at);
  const hits = resolved.filter((r) => r.direction_hit === true).length;
  const directionHitRate =
    resolved.length > 0 ? Math.round((hits / resolved.length) * 1000) / 10 : null;

  return {
    resolvedCount: resolved.length,
    pendingCount: pending.length,
    directionHitRate,
    minSampleSize: MIN_PUBLIC_TRACK_RECORD,
    statsReady: resolved.length >= MIN_PUBLIC_TRACK_RECORD,
  };
}
