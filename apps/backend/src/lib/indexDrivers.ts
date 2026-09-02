import { readWindowFields } from './premarketMovers.js';

/**
 * Heavyweight watchlist. Fetched BY TICKER — never via gainers/losers, which
 * ranks by raw percentage and structurally excludes every mega-cap.
 * Keep this list in sync with the top of index_weights.
 */
export const DRIVER_WATCHLIST = [
  'NVDA', 'MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', 'BRK.B', 'JPM',
  'LLY', 'V', 'XOM', 'UNH', 'MA', 'COST', 'WMT', 'PG', 'JNJ', 'HD',
  'NFLX', 'ORCL', 'ABBV', 'BAC', 'CRM', 'AMD', 'CVX', 'KO', 'MRK', 'PEP',
  'TMO', 'LIN', 'CSCO', 'ACN', 'MCD', 'WFC', 'ABT', 'PM', 'IBM', 'GE',
] as const;

/** Fetched in the same snapshot call, used only for breadth. Never rendered. */
export const BREADTH_PROXIES = ['SPY', 'RSP'] as const;

export interface DriverContribution {
  ticker: string;
  weightPct: number;
  premarketChangePct: number;
  priorSessionChangePct: number;
  premarketBps: number;
  priorSessionBps: number;
  /** INTERNAL ONLY — selection and ranking. Never rendered. See §8. */
  headlineBps: number;
  headlineWindow: 'premarket' | 'prior_session';
}

/**
 * Contribution in basis points.
 *
 * contribution% = changePct * (weightPct / 100)
 * bps           = contribution% * 100 = changePct * weightPct
 *
 * The /100 and *100 cancel — bps is simply the product. Do not "fix" this
 * into a division; it is correct and the tests pin it.
 * NVDA 8.74% at 7.5% weight → 65.5 bps.
 */
export function contributionBps(changePct: number, weightPct: number): number {
  return changePct * weightPct;
}

/** Session change computed from official bars — NOT todaysChangePerc. See §2. */
export function priorSessionChangePct(snap: any): number {
  const close = snap.day?.c || 0;
  const prev = snap.prevDay?.c || 0;
  if (!close || !prev) return 0;
  return (close / prev - 1) * 100;
}

/** Minimum |bps| for a row to earn a slot. See the tuning note at the end. */
export const MIN_DRIVER_BPS = 8;

/** Above this, a driver is a big enough story to render even with no catalyst. §7. */
export const NO_CATALYST_OVERRIDE_BPS = 30;

export function buildDriverContribution(
  snap: any,
  weightPct: number
): DriverContribution | null {
  const pm = readWindowFields(snap, 'premarket');
  const psChange = priorSessionChangePct(snap);

  const premarketBps = contributionBps(pm.changePct, weightPct);
  const priorSessionBps = contributionBps(psChange, weightPct);

  // Premarket is what's actionable at 8:30. Fall back to the prior session
  // when premarket is quiet but yesterday's contribution was large — a name
  // that ran 8% yesterday and is flat this morning still set the tape the
  // reader is waking up to.
  const usePremarket = Math.abs(premarketBps) >= MIN_DRIVER_BPS;
  const headlineBps = usePremarket ? premarketBps : priorSessionBps;

  if (Math.abs(headlineBps) < MIN_DRIVER_BPS) return null;

  return {
    ticker: snap.ticker,
    weightPct,
    premarketChangePct: pm.changePct,
    priorSessionChangePct: psChange,
    premarketBps,
    priorSessionBps,
    headlineBps,
    headlineWindow: usePremarket ? 'premarket' : 'prior_session',
  };
}

/**
 * Rank drivers by |bps|. All rows share one base (basis points of the same
 * index), so a plain sort is valid here — unlike the premarket/prior_session
 * comparison, which is not.
 */
export function rankDrivers(rows: DriverContribution[]): DriverContribution[] {
  return [...rows].sort((a, b) => Math.abs(b.headlineBps) - Math.abs(a.headlineBps));
}

export type MoverWindow = 'index_driver' | 'premarket' | 'prior_session';

export interface BriefMoverRow {
  ticker: string;
  pct: string;
  dir: 'up' | 'down';
  why: string;
  window: MoverWindow;
  companyName?: string;
  priorSessionPct?: string;
  premarketPct?: string;
  isEarnings?: boolean;
  hasCatalyst?: boolean;
}

const WINDOW_ORDER: Record<string, number> = {
  index_driver: 0,
  premarket: 1,
  prior_session: 2,
};

/**
 * Slot allocation, never a combined sort. Driver slot count is a hard cap —
 * backfill never promotes extra drivers into mover slots.
 */
export function mergeWindows(
  premarketRows: BriefMoverRow[],
  priorRows: BriefMoverRow[],
  driverRows: BriefMoverRow[] = [],
  opts: { limit?: number; driverSlots?: number; premarketSlots?: number; maxSame?: number } = {}
): BriefMoverRow[] {
  const limit = opts.limit ?? 6;
  const driverSlots = opts.driverSlots ?? 2;
  const premarketSlots = opts.premarketSlots ?? 2;
  const maxSame = opts.maxSame ?? 4;

  const priorByTicker = new Map(priorRows.map((r) => [r.ticker, r]));
  const premarketByTicker = new Map(premarketRows.map((r) => [r.ticker, r]));

  const merged: BriefMoverRow[] = [];
  const taken = new Set<string>();
  let up = 0;
  let down = 0;

  const tryAdd = (row: BriefMoverRow): boolean => {
    if (taken.has(row.ticker) || merged.length >= limit) return false;
    if (row.dir === 'up') {
      if (up >= maxSame) return false;
      up += 1;
    } else {
      if (down >= maxSame) return false;
      down += 1;
    }
    taken.add(row.ticker);
    merged.push(row);
    return true;
  };

  const absorb = (row: BriefMoverRow, ...others: Array<BriefMoverRow | undefined>): BriefMoverRow => {
    const out = { ...row };
    for (const other of others) {
      if (!other) continue;
      if (other.window === 'prior_session' && !out.priorSessionPct) {
        out.priorSessionPct = other.pct;
      } else if (other.window === 'premarket' && !out.premarketPct) {
        out.premarketPct = other.pct;
      }
    }
    return out;
  };

  for (const row of driverRows.slice(0, driverSlots)) {
    tryAdd(absorb(row, premarketByTicker.get(row.ticker), priorByTicker.get(row.ticker)));
  }
  for (const row of premarketRows.slice(0, premarketSlots)) {
    tryAdd(absorb(row, priorByTicker.get(row.ticker)));
  }
  let priorTaken = 0;
  const priorBudget = limit - driverSlots - premarketSlots;
  for (const row of priorRows) {
    if (priorTaken >= priorBudget) break;
    if (tryAdd(row)) priorTaken += 1;
  }
  // Backfill from movers only. Drivers cannot crowd out the section.
  for (const pool of [premarketRows.slice(premarketSlots), priorRows]) {
    for (const row of pool) {
      if (merged.length >= limit) break;
      const next = row.window === 'premarket' ? absorb(row, priorByTicker.get(row.ticker)) : row;
      tryAdd(next);
    }
  }

  merged.sort((a, b) => (WINDOW_ORDER[a.window] ?? 9) - (WINDOW_ORDER[b.window] ?? 9));
  return merged.slice(0, limit);
}

export interface CatalystLike {
  text: string;
  url: string;
  isEarnings: boolean;
}

/**
 * Resolve catalysts before finalising slots. A driver with no catalyst is
 * dropped and the next-ranked driver is promoted, unless |bps| clears the
 * override — a mega-cap moving that hard on nothing is itself the story.
 */
export function finalizeDriverSlots(
  ranked: DriverContribution[],
  catalysts: Map<string, CatalystLike | null>,
  limit = 2
): BriefMoverRow[] {
  const rows: BriefMoverRow[] = [];
  for (const d of ranked) {
    if (rows.length >= limit) break;
    const cat = catalysts.get(d.ticker) ?? null;
    if (!cat && Math.abs(d.headlineBps) < NO_CATALYST_OVERRIDE_BPS) continue;

    const headlinePct =
      d.headlineWindow === 'premarket' ? d.premarketChangePct : d.priorSessionChangePct;
    const row: BriefMoverRow = {
      ticker: d.ticker,
      pct: `${headlinePct >= 0 ? '+' : ''}${headlinePct.toFixed(2)}%`,
      dir: d.headlineBps < 0 ? 'down' : 'up',
      why: cat ? cat.text : 'No catalyst in the last 36 hours',
      window: 'index_driver',
      isEarnings: cat?.isEarnings ?? false,
      hasCatalyst: Boolean(cat),
    };
    if (d.headlineWindow === 'premarket' && Math.abs(d.priorSessionChangePct) >= 0.01) {
      row.priorSessionPct = `${d.priorSessionChangePct >= 0 ? '+' : ''}${d.priorSessionChangePct.toFixed(2)}%`;
    } else if (d.headlineWindow !== 'premarket' && Math.abs(d.premarketChangePct) >= 0.01) {
      row.premarketPct = `${d.premarketChangePct >= 0 ? '+' : ''}${d.premarketChangePct.toFixed(2)}%`;
    }
    rows.push(row);
  }
  return rows;
}
