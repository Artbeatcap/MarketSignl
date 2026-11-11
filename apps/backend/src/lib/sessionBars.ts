/**
 * sessionBars.ts
 * ---------------------------------------------------------------------------
 * Intraday charts (1D, 5D) are built from trading sessions, not clock time.
 *
 * "The last 24 hours" is empty on a weekend and holds only premarket bars
 * before the open, so the chart used to show a handful of stray bars. Here the
 * chart always gets the last N regular-session bars, whatever day it is.
 *
 * Pure functions, no network, so they can be tested with fixed timestamps.
 */

const ET = 'America/New_York';

/** Regular US equity session: 09:30 up to (not including) 16:00 ET, Mon-Fri. */
const SESSION_OPEN_MINUTES = 9 * 60 + 30;
const SESSION_CLOSE_MINUTES = 16 * 60;

/** Fewer regular-session bars than this is a feed problem, not a quiet market. */
export const MIN_SESSION_BARS = 20;

// Intl handles daylight saving; never hard-code a UTC offset here.
const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET,
  hour12: false,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function etFields(timestampMs: number): { weekday: string; dayKey: string; minutes: number } {
  const parts = etFormatter.formatToParts(new Date(timestampMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    dayKey: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

/** True when a bar that STARTS at this time belongs to the regular session. */
export function isRegularSessionBar(timestampMs: number): boolean {
  const { weekday, minutes } = etFields(timestampMs);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return minutes >= SESSION_OPEN_MINUTES && minutes < SESSION_CLOSE_MINUTES;
}

/** Calendar day of a bar in New York, as YYYY-MM-DD. */
export function sessionDayKey(timestampMs: number): string {
  return etFields(timestampMs).dayKey;
}

export class InsufficientSessionBarsError extends Error {
  constructor(found: number) {
    super(`Only ${found} regular-session bars available (need ${MIN_SESSION_BARS})`);
    this.name = 'InsufficientSessionBarsError';
  }
}

/**
 * Keep regular-session bars, then return the last `visibleBars` of them with up
 * to `warmupBars` before them for indicator warmup.
 *
 * `bars` must be sorted oldest first. Throws when the feed has too few
 * regular-session bars; callers must not fall back to extended-hours bars.
 */
export function selectSessionBars<T extends { timestamp: number }>(
  bars: T[],
  opts: { visibleBars: number; warmupBars: number; regularHoursOnly?: boolean },
): { bars: T[]; visibleStartIndex: number } {
  const session =
    opts.regularHoursOnly === false ? bars : bars.filter((b) => isRegularSessionBar(b.timestamp));
  if (session.length < MIN_SESSION_BARS) {
    throw new InsufficientSessionBarsError(session.length);
  }
  const visible = Math.min(opts.visibleBars, session.length);
  const start = Math.max(0, session.length - visible - opts.warmupBars);
  const selected = session.slice(start);
  return { bars: selected, visibleStartIndex: selected.length - visible };
}
