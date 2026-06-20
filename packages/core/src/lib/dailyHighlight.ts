/** Row shape for picking the daily UGC highlight (cron / n8n). */
export interface DailyHighlightCandidate {
  id: string;
  symbol: string;
  interval: string;
  headline: string | null;
  expected_change_pct: number | null;
  confidence: number | null;
  direction: string | null;
  actual_change_pct: number | null;
  direction_hit: boolean | null;
  resolved_at: string;
  created_at: string;
}

export interface DailyHighlight {
  id: string;
  symbol: string;
  interval: string;
  headline: string;
  direction: string;
  confidence: number;
  expectedChangePct: number;
  actualChangePct: number;
  directionHit: boolean;
  createdAt: string;
  resolvedAt: string;
  cardPngUrl: string;
  cardSvgUrl: string;
}

/**
 * Pick the best resolved hit for social proof: highest confidence, then largest |actual| move.
 * Only considers direction_hit === true candidates.
 */
export function pickDailyHighlight(
  rows: DailyHighlightCandidate[],
  apiBase: string
): DailyHighlight | null {
  const hits = rows.filter((r) => r.direction_hit === true && r.resolved_at);
  if (hits.length === 0) return null;

  hits.sort((a, b) => {
    const confA = a.confidence ?? 0;
    const confB = b.confidence ?? 0;
    if (confB !== confA) return confB - confA;
    const magA = Math.abs(Number(a.actual_change_pct ?? 0));
    const magB = Math.abs(Number(b.actual_change_pct ?? 0));
    return magB - magA;
  });

  const best = hits[0];
  const base = apiBase.replace(/\/$/, '');
  return {
    id: best.id,
    symbol: best.symbol,
    interval: best.interval,
    headline: best.headline ?? '',
    direction: best.direction ?? 'neutral',
    confidence: best.confidence ?? 0,
    expectedChangePct: Number(best.expected_change_pct ?? 0),
    actualChangePct: Number(best.actual_change_pct ?? 0),
    directionHit: true,
    createdAt: best.created_at,
    resolvedAt: best.resolved_at,
    cardPngUrl: `${base}/api/predictions/${best.id}/card.png`,
    cardSvgUrl: `${base}/api/predictions/${best.id}/card.svg`,
  };
}
