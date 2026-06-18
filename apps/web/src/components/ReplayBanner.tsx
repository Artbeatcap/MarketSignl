import { usePredictionReplay } from '../state/PredictionReplayContext';
import './ReplayBanner.css';

function pct(n: number | null | undefined): string {
  if (n == null) return '—';
  const v = Math.round(n * 100) / 100;
  return `${v > 0 ? '+' : ''}${v}%`;
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ReplayBanner() {
  const { active, clear } = usePredictionReplay();
  if (!active) return null;

  const p = active.prediction;
  const resolved = p.status === 'resolved';
  const outcomeClass =
    p.directionHit === true
      ? 'replay-banner__outcome--hit'
      : p.directionHit === false
        ? 'replay-banner__outcome--miss'
        : 'replay-banner__outcome--pending';

  return (
    <div className="replay-banner">
      <div className="replay-banner__info">
        <span className="replay-banner__label">Replaying</span>
        <span className="replay-banner__symbol">{p.symbol}</span>
        <span className="replay-banner__sep">·</span>
        <span>{fmtDate(p.createdAt)} forecast</span>
        {resolved && (
          <>
            <span className="replay-banner__sep">·</span>
            <span className={`replay-banner__outcome ${outcomeClass}`}>
              {p.directionHit ? '✓ Hit' : '✗ Miss'} {pct(p.actualChangePct)} vs{' '}
              {pct(p.expectedChangePct)} called
            </span>
          </>
        )}
        {p.status === 'pending' && (
          <>
            <span className="replay-banner__sep">·</span>
            <span className="replay-banner__pending">
              resolves {fmtDate(p.horizonEndAt)}
            </span>
          </>
        )}
      </div>
      <button type="button" className="replay-banner__clear" onClick={clear}>
        Back to live ✕
      </button>
    </div>
  );
}
