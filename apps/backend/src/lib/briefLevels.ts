/**
 * Grading for levels ChartSignl itself published. The prose is never parsed.
 */

export type LevelCondition = 'hold' | 'reclaim' | 'break' | 'close_above' | 'close_below';

export interface LevelCall {
  ticker: string;
  level: number;
  condition: LevelCondition;
  horizonSessions: number;
}

export interface SessionBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface PriorLevel {
  ticker: string;
  level: number;
  condition: LevelCondition;
  horizonSessions: number;
  briefAsOf: string;
  status: 'open' | 'met' | 'failed' | 'expired';
  resolvedAt?: string;
  evidence?: {
    open: number;
    high: number;
    low: number;
    close: number;
    date?: string;
  };
}

export interface LevelScorecard {
  met: number;
  failed: number;
  expired: number;
  calls: string[];
}

export function formatLevel(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function formatEvidencePx(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Resolve one open call against the sessions that followed the brief.
 * A horizon of 1 is the next session only. Missing bars leave the call open
 * unless a bar already settled it.
 */
export function gradeLevel(call: PriorLevel, sessions: SessionBar[]): PriorLevel {
  const upcoming = sessions
    .filter((bar) => bar.date > call.briefAsOf)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, call.horizonSessions);

  for (const bar of upcoming) {
    const early = earlyResult(call, bar);
    if (early) return settled(call, early, bar);
  }

  if (upcoming.length < call.horizonSessions) {
    return { ...call, status: 'open' };
  }

  const last = upcoming[upcoming.length - 1];
  if (call.condition === 'hold') return settled(call, 'met', last);
  return settled(call, 'failed', last);
}

function earlyResult(call: PriorLevel, bar: SessionBar): 'met' | 'failed' | null {
  if (call.condition === 'hold' && bar.low < call.level) return 'failed';
  if (call.condition === 'break' && bar.low < call.level) return 'met';
  if ((call.condition === 'close_above' || call.condition === 'reclaim') && bar.close > call.level) {
    return 'met';
  }
  if (call.condition === 'close_below' && bar.close < call.level) return 'met';
  return null;
}

function settled(call: PriorLevel, status: 'met' | 'failed', bar: SessionBar): PriorLevel {
  return {
    ...call,
    status,
    resolvedAt: bar.date,
    evidence: {
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      date: bar.date,
    },
  };
}

export function outcomeWord(level: PriorLevel): string {
  if (level.condition === 'hold' && level.status === 'met') return 'held';
  if (level.status === 'met') return 'met';
  if (level.status === 'failed') return 'failed';
  if (level.status === 'expired') return 'expired';
  return 'open';
}

/** `SPY: "hold 733" → held (low 734.58, close 735.29)` */
export function priorCallLine(level: PriorLevel): string {
  const phrase = `${level.condition.replace(/_/g, ' ')} ${formatLevel(level.level)}`;
  const evidence = level.evidence
    ? ` (low ${formatEvidencePx(level.evidence.low)}, close ${formatEvidencePx(level.evidence.close)})`
    : '';
  return `${level.ticker}: "${phrase}" → ${outcomeWord(level)}${evidence}`;
}

export function buildLevelScorecard(rows: PriorLevel[]): LevelScorecard {
  const met = rows.filter((row) => row.status === 'met').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  const expired = rows.filter((row) => row.status === 'expired').length;
  const ranked = [...rows].sort((a, b) => rank(a) - rank(b));
  return {
    met,
    failed,
    expired,
    calls: ranked.slice(0, 3).map(priorCallLine),
  };
}

function rank(row: PriorLevel): number {
  if (row.status === 'failed') return 0;
  if (row.status === 'expired') return 1;
  if (row.status === 'met') return 2;
  return 3;
}
