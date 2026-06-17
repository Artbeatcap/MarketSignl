import { useQuery } from '@tanstack/react-query';
import type { GetPredictionStatsResponse, PredictionStats } from '@marketsignl/core';
import { apiFetch } from '../lib/api';
import './PredictionStatsPanel.css';

async function fetchPredictionStats(): Promise<PredictionStats | null> {
  const res = await apiFetch<GetPredictionStatsResponse>('/api/predictions/stats');
  return res.stats ?? null;
}

interface PredictionStatsPanelProps {
  enabled: boolean;
}

export default function PredictionStatsPanel({ enabled }: PredictionStatsPanelProps) {
  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['predictionStats'],
    queryFn: fetchPredictionStats,
    enabled,
    retry: false,
    staleTime: 60_000,
  });

  if (!enabled) {
    return (
      <div className="stats-panel stats-panel--muted">
        <h3>Track Record</h3>
        <p className="stats-hint">Sign in to see your prediction accuracy over time.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="stats-panel">
        <h3>Track Record</h3>
        <p className="stats-hint">Loading stats…</p>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="stats-panel">
        <h3>Track Record</h3>
        <p className="stats-hint">Could not load stats.</p>
      </div>
    );
  }

  return (
    <div className="stats-panel">
      <h3>Track Record</h3>

      <div className="stats-counts">
        <div>
          <span className="stats-count-value">{stats.resolvedCount}</span>
          <span className="stats-count-label">resolved</span>
        </div>
        <div>
          <span className="stats-count-value">{stats.pendingCount}</span>
          <span className="stats-count-label">pending</span>
        </div>
      </div>

      {stats.statsReady && stats.directionHitRate != null ? (
        <>
          <div className="stats-hero">
            <span className="stats-hero-value">{stats.directionHitRate}%</span>
            <span className="stats-hero-label">direction hit rate</span>
          </div>

          {stats.avgMagnitudeErrorPct != null && (
            <p className="stats-sub">
              Avg forecast error: {stats.avgMagnitudeErrorPct}%
            </p>
          )}

          <div className="stats-calibration">
            <h4>Calibration</h4>
            <p className="stats-calibration-note">
              When we said X% confidence, how often did direction hit?
            </p>
            <ul>
              {stats.calibration.map((bucket) => (
                <li key={bucket.label}>
                  <span className="cal-bucket-label">{bucket.label}</span>
                  <span className="cal-bucket-bar-wrap">
                    <span
                      className="cal-bucket-bar"
                      style={{
                        width:
                          bucket.hitRate != null && bucket.count > 0
                            ? `${Math.min(bucket.hitRate, 100)}%`
                            : '0%',
                      }}
                    />
                  </span>
                  <span className="cal-bucket-value">
                    {bucket.count === 0
                      ? '—'
                      : bucket.hitRate != null
                        ? `${bucket.hitRate}%`
                        : '—'}
                    {bucket.count > 0 && (
                      <span className="cal-bucket-n"> ({bucket.count})</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className="stats-hint">
          {stats.resolvedCount === 0
            ? 'Predictions resolve after their forecast horizon. Make a few calls and check back.'
            : `${stats.resolvedCount} of ${stats.minSampleSize} resolved needed before accuracy stats go live.`}
        </p>
      )}

      <p className="stats-footnote">Educational only — not financial advice.</p>
    </div>
  );
}
