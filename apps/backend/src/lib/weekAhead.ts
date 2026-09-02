/**
 * Forward calendar for the morning brief.
 *
 * Selection machinery (score, weight, analyst counts) stays in this module
 * and in the logs. It never reaches the email or the Atlas prompt.
 */
import type { EarningsCalendarRow, EarningsSession } from './fmpEarningsAdapter.js';

export type { EarningsCalendarRow, EarningsSession } from './fmpEarningsAdapter.js';

/** A name clears on index weight alone at or above this. AVGO (~2%) clears. */
export const MIN_CALENDAR_WEIGHT_PCT = 0.35;

/** Distinct users who analyzed the ticker in the last 30 days. */
export const MIN_DISTINCT_ANALYSTS = 8;

/** How far back user-demand is measured. */
export const DEMAND_WINDOW_DAYS = 30;

/** Today plus the next 4 trading days. Holidays excluded. */
export const HORIZON_TRADING_DAYS = 5;

export const MAX_EARNINGS_ROWS = 4;
export const MAX_TOTAL_ROWS = 6;
export const UNCONFIRMED_RENDER_MAX_DAYS = 10;
export const STALE_CACHE_MS = 48 * 60 * 60 * 1000;

export type RelevanceReason = 'index_weight' | 'user_demand' | 'both';
export type CalendarTier = 'today' | 'ahead';
export type CalendarKind = 'macro' | 'earnings';

export interface CalendarCandidate {
  ticker: string;
  companyName: string;
  reportDate: string;
  session: EarningsSession;
  isConfirmed: boolean;
  weightPct: number | null;
  distinctAnalysts: number;
  reason: RelevanceReason;
  score: number;
}

/**
 * Structured row through to the template. Do not pre-bake into a single
 * string — a later pass will join these to ChartSignl levels.
 */
export interface CalendarRow {
  kind: CalendarKind;
  tier: CalendarTier;
  date: string;
  headline: string;
  body: string;
  estimated: boolean;
  ticker?: string;
  companyName?: string;
  session?: EarningsSession;
  weekday?: string;
  title?: string;
  shortTitle?: string;
  category?: string;
  impact?: number;
  releaseTime?: string;
  notes?: string | null;
}

export interface MacroEvent {
  eventDate: string;
  releaseTime: string;
  title: string;
  shortTitle: string;
  category: string;
  impact: number;
  source: string;
  consensus: string | null;
  notes: string | null;
}

export interface WeekAheadLog {
  event: 'week_ahead';
  horizonEnd: string;
  tradingDays: number;
  macroCandidates: number;
  macroHigh: number;
  macroRendered: number;
  earningsCandidates: number;
  byWeight: number;
  byDemand: number;
  byBoth: number;
  earningsRendered: number;
  unconfirmedDropped: number;
  unknownSession: number;
  calendarFetchedAt: string | null;
  macroMaxDate: string | null;
  rendered: number;
}

export interface WeekAheadResult {
  rows: CalendarRow[];
  log: WeekAheadLog;
  stale: boolean;
}

export interface WeekAheadInput {
  now: Date;
  todayISO: string;
  holidays: string[];
  macros: MacroEvent[];
  earnings: EarningsCalendarRow[];
  weights: Map<string, number>;
  demand: Map<string, number>;
  names?: Map<string, string>;
  calendarFetchedAt: string | null;
  macroMaxDate: string | null;
}

export type WeekAheadLogger = Pick<typeof console, 'log' | 'warn' | 'error'>;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function etDateISO(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatISODate(d);
}

export function diffDays(laterISO: string, earlierISO: string): number {
  return Math.round((parseISODate(laterISO).getTime() - parseISODate(earlierISO).getTime()) / 86_400_000);
}

export function weekdayName(iso: string): string {
  return WEEKDAYS[parseISODate(iso).getUTCDay()];
}

export function isWeekend(iso: string): boolean {
  const dow = parseISODate(iso).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Today plus the next 4 trading days. Holidays are skipped, not counted.
 * Generating on 2026-09-07 (Labor Day) therefore still reaches 2026-09-11.
 */
export function tradingHorizon(
  fromISO: string,
  holidays: Iterable<string> = [],
  count: number = HORIZON_TRADING_DAYS
): string[] {
  const holidaySet = new Set(holidays);
  const dates: string[] = [];
  let cursor = fromISO;
  for (let i = 0; i < 30 && dates.length < count; i += 1) {
    if (!isWeekend(cursor) && !holidaySet.has(cursor)) {
      dates.push(cursor);
    }
    cursor = addDaysISO(cursor, 1);
  }
  return dates;
}

export function nextSessionISO(iso: string, holidays: Iterable<string> = []): string {
  const holidaySet = new Set(holidays);
  let cursor = addDaysISO(iso, 1);
  for (let i = 0; i < 10; i += 1) {
    if (!isWeekend(cursor) && !holidaySet.has(cursor)) return cursor;
    cursor = addDaysISO(cursor, 1);
  }
  return cursor;
}

export function formatTimeEt(time: string): string {
  const [hStr, minStr] = String(time).split(':');
  const h = Number(hStr);
  const min = Number(minStr) || 0;
  if (!Number.isFinite(h)) return time;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm} ET`;
}

/**
 * A date inside 14 days that FMP has re-touched recently is almost always announced.
 */
export function isConfirmedHeuristic(
  reportDate: string,
  updatedFromDate: string | null,
  todayISO: string
): boolean {
  if (diffDays(reportDate, todayISO) > 14) return false;
  if (updatedFromDate == null) return false;
  return diffDays(todayISO, updatedFromDate) <= 30;
}

export function resolveConfirmed(row: EarningsCalendarRow, todayISO: string): boolean {
  if (row.isConfirmed) return true;
  return isConfirmedHeuristic(row.reportDate, row.updatedFromDate, todayISO);
}

/** Unconfirmed dates more than 10 days out do not render. */
export function shouldDropUnconfirmed(
  isConfirmed: boolean,
  reportDate: string,
  todayISO: string
): boolean {
  if (isConfirmed) return false;
  return diffDays(reportDate, todayISO) > UNCONFIRMED_RENDER_MAX_DAYS;
}

export function isCalendarCacheStale(fetchedAt: string | null, now: Date): boolean {
  if (!fetchedAt) return true;
  const ms = Date.parse(fetchedAt);
  if (!Number.isFinite(ms)) return true;
  return now.getTime() - ms > STALE_CACHE_MS;
}

export function scoreCandidate(c: CalendarCandidate): number {
  const weightTerm = (c.weightPct ?? 0) * 10;
  const demandTerm = Math.log10(Math.max(c.distinctAnalysts, 1)) * 8;
  const confirmedBonus = c.isConfirmed ? 3 : 0;
  return weightTerm + demandTerm + confirmedBonus;
}

export function distinctAnalystsByTicker(
  rows: Array<{ symbol: string | null; user_id: string }>
): Map<string, number> {
  const users = new Map<string, Set<string>>();
  for (const row of rows) {
    const ticker = (row.symbol || '').trim().toUpperCase();
    if (!ticker || !row.user_id) continue;
    let set = users.get(ticker);
    if (!set) {
      set = new Set();
      users.set(ticker, set);
    }
    set.add(row.user_id);
  }
  const out = new Map<string, number>();
  for (const [ticker, set] of users) out.set(ticker, set.size);
  return out;
}

export function qualifyCandidate(input: {
  ticker: string;
  companyName?: string;
  reportDate: string;
  session: EarningsSession;
  isConfirmed: boolean;
  weightPct: number | null;
  distinctAnalysts: number;
}): CalendarCandidate | null {
  const byWeight = (input.weightPct ?? 0) >= MIN_CALENDAR_WEIGHT_PCT;
  const byDemand = input.distinctAnalysts >= MIN_DISTINCT_ANALYSTS;
  if (!byWeight && !byDemand) return null;
  const reason: RelevanceReason = byWeight && byDemand ? 'both' : byWeight ? 'index_weight' : 'user_demand';
  const candidate: CalendarCandidate = {
    ticker: input.ticker.toUpperCase(),
    companyName: input.companyName || '',
    reportDate: input.reportDate,
    session: input.session,
    isConfirmed: input.isConfirmed,
    weightPct: input.weightPct,
    distinctAnalysts: input.distinctAnalysts,
    reason,
    score: 0,
  };
  candidate.score = scoreCandidate(candidate);
  return candidate;
}

export function formatEarningsBody(
  row: Pick<CalendarCandidate, 'session' | 'reportDate'>,
  tier: CalendarTier,
  holidays: Iterable<string> = []
): string {
  const weekday = weekdayName(row.reportDate);
  if (row.session === 'unknown') {
    return tier === 'today' ? 'Reports today.' : `Reports ${weekday}.`;
  }
  if (row.session === 'bmo') {
    return tier === 'today'
      ? 'Reports before today\'s open.'
      : `Reports ${weekday} before the open.`;
  }
  if (tier === 'today') {
    return 'Reports after today\'s close.';
  }
  const reaction = weekdayName(nextSessionISO(row.reportDate, holidays));
  return `Reports after ${weekday}'s close — reaction lands ${reaction} morning.`;
}

export function formatMacroHeadline(event: MacroEvent, tier: CalendarTier): string {
  const time = formatTimeEt(event.releaseTime);
  if (tier === 'today') return time;
  return `${weekdayName(event.eventDate)} ${time}`;
}

export function formatMacroBody(event: MacroEvent): string {
  if (event.notes && event.notes.trim()) return event.notes.trim();
  return `${event.title}.`;
}

function toEarningsRow(
  c: CalendarCandidate,
  todayISO: string,
  holidays: Iterable<string>
): CalendarRow {
  const tier: CalendarTier = c.reportDate === todayISO ? 'today' : 'ahead';
  const weekday = weekdayName(c.reportDate);
  return {
    kind: 'earnings',
    tier,
    date: c.reportDate,
    headline: `$${c.ticker}`,
    body: formatEarningsBody(c, tier, holidays),
    estimated: !c.isConfirmed,
    ticker: c.ticker,
    companyName: c.companyName || undefined,
    session: c.session,
    weekday,
    category: 'earnings',
  };
}

function toMacroRow(event: MacroEvent, todayISO: string): CalendarRow {
  const tier: CalendarTier = event.eventDate === todayISO ? 'today' : 'ahead';
  return {
    kind: 'macro',
    tier,
    date: event.eventDate,
    headline: formatMacroHeadline(event, tier),
    body: formatMacroBody(event),
    estimated: false,
    title: event.title,
    shortTitle: event.shortTitle,
    category: event.category,
    impact: event.impact,
    releaseTime: event.releaseTime,
    notes: event.notes,
  };
}

function sortRows(a: CalendarRow, b: CalendarRow): number {
  if (a.tier !== b.tier) return a.tier === 'today' ? -1 : 1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'macro' ? -1 : 1;
  const aTime = a.releaseTime || (a.session === 'bmo' ? '08:00:00' : a.session === 'amc' ? '16:00:00' : '12:00:00');
  const bTime = b.releaseTime || (b.session === 'bmo' ? '08:00:00' : b.session === 'amc' ? '16:00:00' : '12:00:00');
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  return (a.ticker || a.title || '').localeCompare(b.ticker || b.title || '');
}

/**
 * Slot allocation, never a global sort across event types.
 * All impact-3 macros in the horizon render. Earnings capped at 4 by score.
 * Impact-2 fills remaining slots. Max 6 rows total.
 */
export function slotCalendar(opts: {
  todayISO: string;
  horizon: string[];
  macros: MacroEvent[];
  earnings: CalendarCandidate[];
  holidays?: Iterable<string>;
}): CalendarRow[] {
  const horizonSet = new Set(opts.horizon);
  const holidays = opts.holidays ?? [];

  const macrosIn = opts.macros.filter((m) => horizonSet.has(m.eventDate));
  const high = macrosIn.filter((m) => m.impact === 3);
  const medium = macrosIn.filter((m) => m.impact === 2);

  const ranked = [...opts.earnings].sort((a, b) => b.score - a.score);
  const earningsCap = Math.min(MAX_EARNINGS_ROWS, Math.max(0, MAX_TOTAL_ROWS - high.length));
  const pickedEarnings = ranked.slice(0, earningsCap);

  const used = high.length + pickedEarnings.length;
  const room = Math.max(0, MAX_TOTAL_ROWS - used);
  const pickedMedium = medium.slice(0, room);

  const rows = [
    ...high.map((m) => toMacroRow(m, opts.todayISO)),
    ...pickedMedium.map((m) => toMacroRow(m, opts.todayISO)),
    ...pickedEarnings.map((c) => toEarningsRow(c, opts.todayISO, holidays)),
  ];
  rows.sort(sortRows);
  return rows.slice(0, MAX_TOTAL_ROWS);
}

export function buildWeekAhead(input: WeekAheadInput): WeekAheadResult {
  const horizon = tradingHorizon(input.todayISO, input.holidays);
  const horizonSet = new Set(horizon);
  const holidays = input.holidays;

  const macrosIn = input.macros.filter((m) => horizonSet.has(m.eventDate));
  const macroHigh = macrosIn.filter((m) => m.impact === 3).length;

  let unconfirmedDropped = 0;
  const qualified: CalendarCandidate[] = [];
  for (const row of input.earnings) {
    if (!horizonSet.has(row.reportDate)) continue;
    const confirmed = resolveConfirmed(row, input.todayISO);
    if (shouldDropUnconfirmed(confirmed, row.reportDate, input.todayISO)) {
      unconfirmedDropped += 1;
      continue;
    }
    const ticker = row.ticker.toUpperCase();
    const candidate = qualifyCandidate({
      ticker,
      companyName: row.companyName || input.names?.get(ticker) || '',
      reportDate: row.reportDate,
      session: row.session,
      isConfirmed: confirmed,
      weightPct: input.weights.get(ticker) ?? null,
      distinctAnalysts: input.demand.get(ticker) ?? 0,
    });
    if (candidate) qualified.push(candidate);
  }

  const rows = slotCalendar({
    todayISO: input.todayISO,
    horizon,
    macros: input.macros,
    earnings: qualified,
    holidays,
  });

  const byWeight = qualified.filter((c) => c.reason === 'index_weight').length;
  const byDemand = qualified.filter((c) => c.reason === 'user_demand').length;
  const byBoth = qualified.filter((c) => c.reason === 'both').length;
  const earningsRendered = rows.filter((r) => r.kind === 'earnings').length;
  const unknownSession = rows.filter((r) => r.kind === 'earnings' && r.session === 'unknown').length;

  const log: WeekAheadLog = {
    event: 'week_ahead',
    horizonEnd: horizon[horizon.length - 1] || input.todayISO,
    tradingDays: horizon.length,
    macroCandidates: macrosIn.length,
    macroHigh,
    macroRendered: rows.filter((r) => r.kind === 'macro').length,
    earningsCandidates: qualified.length,
    byWeight,
    byDemand,
    byBoth,
    earningsRendered,
    unconfirmedDropped,
    unknownSession,
    calendarFetchedAt: input.calendarFetchedAt,
    macroMaxDate: input.macroMaxDate,
    rendered: rows.length,
  };

  return {
    rows,
    log,
    stale: isCalendarCacheStale(input.calendarFetchedAt, input.now),
  };
}

const BANNED_PROMPT_LEAKS = ['distinctAnalysts', 'score', 'weightPct'] as const;

export const ATLAS_HARD_RULE =
  'Base everything only on the market context provided below — index drivers, market breadth, the calendar, and headlines. Do not invent tickers, prices, or events beyond what appears there.';

export const ATLAS_CALENDAR_OUTPUT_RULES = [
  'If THIS WEEK is non-empty, `the biggest risk` MUST name the nearest high-impact scheduled event and say plainly what it could do to positioning. A scheduled event the reader can prepare for outranks a speculative risk you inferred from the tape.',
  'Do not forecast an outcome, a direction, or a number for any scheduled event. Name what it is, when it lands, and what it bears on. "The August jobs report Friday morning is the week\'s binary" is correct. "Expect a soft print" is not, and never appears.',
  'Mention at most two calendar items in the prose. The section carries the full list; the prose carries the one that shapes the week.',
  'Each JSON field contains only its own content, no greetings or sign-offs.',
].join('\n');

function earningsSessionPhrase(session: EarningsSession, date: string): string {
  const weekday = weekdayName(date);
  if (session === 'amc') return `${weekday} after the close`;
  if (session === 'bmo') return `${weekday} before the open`;
  return weekday;
}

/**
 * Prompt-facing calendar. Grouped by day/session, never carries gate figures.
 */
export function buildThisWeekBlock(rows: CalendarRow[]): string {
  if (!rows.length) return '';

  const lines: string[] = [];

  const macros = rows.filter((r) => r.kind === 'macro');
  const earnings = rows.filter((r) => r.kind === 'earnings');

  const dates = [...new Set(rows.map((r) => r.date))].sort();
  for (const date of dates) {
    const dayMacros = macros.filter((r) => r.date === date);
    for (const m of dayMacros) {
      const impact = m.impact === 3 ? ' (high impact)' : '';
      const when = m.tier === 'today' ? formatTimeEt(m.releaseTime || '08:30:00') : m.headline;
      lines.push(`- ${when}: ${m.title}${impact}`);
    }

    const dayEarn = earnings.filter((r) => r.date === date);
    const groups = new Map<EarningsSession, CalendarRow[]>();
    for (const e of dayEarn) {
      const key = e.session || 'unknown';
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    }
    for (const session of ['bmo', 'amc', 'unknown'] as EarningsSession[]) {
      const group = groups.get(session);
      if (!group?.length) continue;
      const tickers = group.map((e) => e.ticker).filter(Boolean).join(', ');
      const when = earningsSessionPhrase(session, date);
      const verb = group.length === 1 ? 'reports' : 'report';
      lines.push(`- ${when}: ${tickers} ${verb}`);
    }
  }

  return ['THIS WEEK (scheduled, in order):', ...lines].join('\n');
}

export function promptContainsGateLeak(prompt: string): string | null {
  for (const token of BANNED_PROMPT_LEAKS) {
    if (prompt.includes(token)) return token;
  }
  if (/\bweightPct\b/.test(prompt)) return 'weightPct';
  return null;
}

export function emitWeekAheadLogs(
  result: WeekAheadResult,
  opts: { weekday?: boolean; logger?: WeekAheadLogger } = {}
): void {
  const logger = opts.logger ?? console;
  logger.log(JSON.stringify(result.log));

  const { log } = result;
  if (opts.weekday !== false && log.rendered === 0) {
    logger.warn(
      JSON.stringify({
        event: 'week_ahead_warn',
        reason: 'rendered_zero_weekday',
        detail: 'near-certainly a bug, not a quiet week',
      })
    );
  }
  if (result.stale) {
    logger.warn(
      JSON.stringify({
        event: 'week_ahead_warn',
        reason: 'stale_cache',
        calendarFetchedAt: log.calendarFetchedAt,
        detail: 'nightly job is dead; rendering stale cache rather than omitting the section',
      })
    );
  }
  if (log.earningsRendered > 0 && log.unknownSession / log.earningsRendered > 0.5) {
    logger.warn(
      JSON.stringify({
        event: 'week_ahead_warn',
        reason: 'unknown_session_ratio',
        unknownSession: log.unknownSession,
        earningsRendered: log.earningsRendered,
        detail: "FMP time field has degraded; half the section has lost its most useful detail",
      })
    );
  }
  if (log.byDemand === 0) {
    logger.warn(
      JSON.stringify({
        event: 'week_ahead_warn',
        reason: 'by_demand_zero',
        detail:
          'chart_analyses query is broken or MIN_DISTINCT_ANALYSTS is above the user base; section has reverted to index-weight-only',
      })
    );
  }
}

export function macroHighImpactDry(
  macros: MacroEvent[],
  todayISO: string
): boolean {
  const from = addDaysISO(todayISO, -7);
  const to = addDaysISO(todayISO, 14);
  return !macros.some((m) => m.impact === 3 && m.eventDate >= from && m.eventDate <= to);
}

export function macroSeedStale(macroMaxDate: string | null, todayISO: string): boolean {
  if (!macroMaxDate) return true;
  return macroMaxDate < addDaysISO(todayISO, 30);
}
