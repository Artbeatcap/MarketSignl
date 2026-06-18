import { useQuery } from '@tanstack/react-query';
import type { GetPredictionsResponse, PredictionHistoryItem } from '@marketsignl/core';
import { apiFetch } from '../lib/api';
import './PredictionHistory.css';

async function fetchPredictionHistory(): Promise<PredictionHistoryItem[]> {
  const res = await apiFetch<GetPredictionsResponse>('/api/predictions?page=1&limit=20');
  return res.predictions ?? [];
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface PredictionHistoryProps {
  enabled: boolean;
  onSelect: (id: string) => void;
  activeId?: string | null;
  loadingId?: string | null;
}

export default function PredictionHistory({
  enabled,
  onSelect,
  activeId,
  loadingId,
}: PredictionHistoryProps) {
  const { data: predictions = [], isLoading, isError } = useQuery({
    queryKey: ['predictionHistory'],
    queryFn: fetchPredictionHistory,
    enabled,
    retry: false,
    staleTime: 30_000,
  });

  if (!enabled) return null;

  return (
    <div className="prediction-history">
      <h3>History</h3>

      {isLoading && <p className="prediction-history__hint">Loading…</p>}
      {isError && <p className="prediction-history__hint">Could not load history.</p>}

      {!isLoading && !isError && predictions.length === 0 && (
        <p className="prediction-history__hint">
          Your forecasts appear here after your first prediction.
        </p>
      )}

      <ul className="prediction-history__list">
        {predictions.map((item) => {
          const isActive = activeId === item.id;
          const isLoadingRow = loadingId === item.id;
          const outcomeClass =
            item.status === 'resolved'
              ? item.directionHit
                ? 'prediction-history__badge--hit'
                : 'prediction-history__badge--miss'
              : 'prediction-history__badge--pending';

          return (
            <li key={item.id}>
              <button
                type="button"
                className={`prediction-history__row ${isActive ? 'prediction-history__row--active' : ''} ${isLoadingRow ? 'prediction-history__row--loading' : ''}`}
                onClick={() => onSelect(item.id)}
                disabled={isLoadingRow}
              >
                <div className="prediction-history__row-top">
                  <span className="prediction-history__symbol">{item.symbol}</span>
                  <span className="prediction-history__pct">
                    {item.expectedChangePct >= 0 ? '+' : ''}
                    {item.expectedChangePct.toFixed(2)}%
                  </span>
                </div>
                <div className="prediction-history__row-bottom">
                  <span>{fmtDate(item.createdAt)}</span>
                  <span className={`prediction-history__badge ${outcomeClass}`}>
                    {item.status === 'resolved'
                      ? item.directionHit
                        ? '✓'
                        : '✗'
                      : '…'}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
