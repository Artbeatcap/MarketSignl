// Data Freshness — single source of truth for "how old is this price?"
//
// RULE: `asOf` is ALWAYS derived from the data feed's own timestamp
// (lastTrade.t, or the close timestamp of the most recent bar).
// It is NEVER `new Date()`. If you find yourself writing `new Date()`
// to populate an asOf, the bug is upstream: the feed timestamp was
// dropped somewhere in the fetch layer. Go fix that instead.

export type FreshnessStatus =
  | 'live'      // real-time entitlement, market open
  | 'delayed'   // delayed entitlement, age within the expected delay window
  | 'stale'     // age exceeds the expected window — feed problem, not a plan problem
  | 'closed';   // outside regular trading hours; this is a settled price

export interface DataFreshness {
  /** ISO 8601. Feed-derived. Never `new Date()`. */
  asOf: string;
  /** Contractual delay of the current data plan, in minutes. 0 = real-time. */
  delayMinutes: number;
  /** Convenience mirror of `delayMinutes > 0`. */
  isDelayed: boolean;
  /** Attribution string for display, e.g. 'Polygon.io'. */
  source: string;
  /** Computed at render time, not stored. */
  status?: FreshnessStatus;
  /**
   * Optional override from the exchange calendar (Polygon `/v1/marketstatus/now`).
   * When present, `deriveStatus` prefers this over `isRegularHours`.
   */
  marketOpen?: boolean;
}

const ET = 'America/New_York';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Grace period above `delayMinutes` before we call the feed stale. */
export const STALE_GRACE_MINUTES = 6;

function etMinutesOfDay(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

function etWeekday(ms: number): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    weekday: 'short',
  }).format(new Date(ms));
  return DAYS.indexOf(label);
}

/**
 * Regular US equity session: Mon–Fri 09:30–16:00 ET.
 * Does NOT account for market holidays or half-days — a holiday will read as
 * "open" here. That is handled downstream: on a holiday the feed simply stops
 * advancing, so `deriveStatus` falls through to 'stale'. Wire `marketOpen`
 * from Polygon market status to close that gap.
 */
export function isRegularHours(ms: number): boolean {
  const day = etWeekday(ms);
  if (day === 0 || day === 6) return false;
  const t = etMinutesOfDay(ms);
  return t >= 9 * 60 + 30 && t < 16 * 60;
}

export type FreshnessInput = Pick<DataFreshness, 'asOf' | 'delayMinutes'> & {
  marketOpen?: boolean;
};

/**
 * Classify freshness. `nowMs` is injectable so this is unit-testable and so
 * callers can pass a feed-derived clock instead of the wall clock.
 */
export function deriveStatus(
  freshness: FreshnessInput,
  nowMs: number = Date.now(),
): FreshnessStatus {
  const asOfMs = Date.parse(freshness.asOf);
  if (!Number.isFinite(asOfMs)) return 'stale';

  const sessionOpen =
    typeof freshness.marketOpen === 'boolean'
      ? freshness.marketOpen
      : isRegularHours(nowMs);
  if (!sessionOpen) return 'closed';

  const ageMin = (nowMs - asOfMs) / 60_000;
  if (ageMin > freshness.delayMinutes + STALE_GRACE_MINUTES) return 'stale';
  return freshness.delayMinutes > 0 ? 'delayed' : 'live';
}

/** '10:42 AM ET' for today; 'Aug 27, 4:00 PM ET' otherwise. */
export function formatAsOf(asOf: string, nowMs: number = Date.now()): string {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) return 'unknown';

  const dayKey = (ms: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(new Date(ms));
  const sameDay = dayKey(asOfMs) === dayKey(nowMs);

  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(asOfMs));

  if (sameDay) return `${time} ET`;

  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    month: 'short',
    day: 'numeric',
  }).format(new Date(asOfMs));
  return `${date}, ${time} ET`;
}

export interface FreshnessLabel {
  /** Short pill text. */
  short: string;
  /** Full sentence for the explainer sheet. */
  long: string;
  /** Semantic tone for styling. Map to theme colors at the component. */
  tone: 'neutral' | 'info' | 'warning';
}

export interface FreshnessLabelOptions {
  /**
   * Frozen snapshot (history list / saved analysis). Shows the stored `asOf`
   * without re-deriving live | delayed | stale from today's clock.
   */
  historical?: boolean;
}

/**
 * The ONLY place a user-facing delay string is produced. Do not build these
 * strings in components.
 */
export function freshnessLabel(
  freshness: DataFreshness,
  nowMs: number = Date.now(),
  opts?: FreshnessLabelOptions,
): FreshnessLabel {
  const when = formatAsOf(freshness.asOf, nowMs);
  const src = freshness.source;

  if (opts?.historical) {
    return {
      short: `As of ${when}`,
      long: `This analysis used prices from ${when}. Source: ${src}.`,
      tone: 'neutral',
    };
  }

  const status = freshness.status ?? deriveStatus(freshness, nowMs);

  switch (status) {
    case 'live':
      return {
        short: `Live · ${when}`,
        long: `Real-time market data from ${src}, as of ${when}.`,
        tone: 'neutral',
      };
    case 'delayed':
      return {
        short: `${freshness.delayMinutes}-min delayed · ${when}`,
        long:
          `Prices are delayed by at least ${freshness.delayMinutes} minutes and reflect the market ` +
          `as of ${when}. Support and resistance levels are structural and are not ` +
          `affected by the delay. Source: ${src}.`,
        tone: 'info',
      };
    case 'closed':
      return {
        short: `Market closed · ${when}`,
        long:
          `US markets are closed. This is the last available price, from ${when}. ` +
          `Source: ${src}.`,
        tone: 'neutral',
      };
    case 'stale':
      return {
        short: `Data may be out of date · ${when}`,
        long:
          `We have not received a price update since ${when}, which is longer than expected. ` +
          `Treat these prices with caution and pull to refresh. Source: ${src}.`,
        tone: 'warning',
      };
  }
}
