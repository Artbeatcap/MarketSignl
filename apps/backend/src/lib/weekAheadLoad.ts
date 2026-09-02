/**
 * Send-path calendar loader. Reads the cache and curated macro table.
 * Never calls a vendor.
 */
import { supabaseAdmin } from './supabase.js';
import { postDailyBriefAlert } from '../services/dailyBrief/alert.js';
import {
  buildWeekAhead,
  distinctAnalystsByTicker,
  emitWeekAheadLogs,
  etDateISO,
  isWeekend,
  macroHighImpactDry,
  macroSeedStale,
  MIN_CALENDAR_WEIGHT_PCT,
  MIN_DISTINCT_ANALYSTS,
  type MacroEvent,
  type WeekAheadLogger,
  type WeekAheadResult,
} from './weekAhead.js';
import type { EarningsCalendarRow, EarningsSession } from './fmpEarningsAdapter.js';
import { DEMAND_WINDOW_DAYS } from './weekAhead.js';

const MASSIVE_BASE_URL = process.env.MASSIVE_BASE_URL?.trim() || 'https://api.massive.com';

function apiKey(): string | null {
  return process.env.MASSIVE_API_KEY?.trim() || process.env.POLYGON_API_KEY?.trim() || null;
}

function asSession(value: string | null | undefined): EarningsSession {
  if (value === 'bmo' || value === 'amc') return value;
  return 'unknown';
}

async function loadMacros(): Promise<{ rows: MacroEvent[]; maxDate: string | null }> {
  const { data, error } = await supabaseAdmin
    .from('macro_calendar')
    .select('event_date, release_time, title, short_title, category, impact, source, consensus, notes')
    .order('event_date', { ascending: true });

  if (error) {
    console.error('[week-ahead] macro_calendar read failed:', error.message);
    return { rows: [], maxDate: null };
  }

  const rows: MacroEvent[] = (data || []).map((r) => ({
    eventDate: String(r.event_date).slice(0, 10),
    releaseTime: String(r.release_time).slice(0, 8),
    title: r.title,
    shortTitle: r.short_title,
    category: r.category,
    impact: Number(r.impact),
    source: r.source,
    consensus: r.consensus ?? null,
    notes: r.notes ?? null,
  }));

  const maxDate = rows.reduce<string | null>((max, r) => (!max || r.eventDate > max ? r.eventDate : max), null);
  return { rows, maxDate };
}

async function loadEarnings(): Promise<{
  rows: EarningsCalendarRow[];
  fetchedAt: string | null;
}> {
  const { data, error } = await supabaseAdmin
    .from('earnings_calendar')
    .select(
      'ticker, report_date, session, is_confirmed, eps_estimate, revenue_estimate, fiscal_period, updated_from_date, company_name, fetched_at'
    );

  if (error) {
    console.error('[week-ahead] earnings_calendar read failed:', error.message);
    return { rows: [], fetchedAt: null };
  }

  let fetchedAt: string | null = null;
  const rows: EarningsCalendarRow[] = (data || []).map((r) => {
    const at = r.fetched_at ? String(r.fetched_at) : null;
    if (at && (!fetchedAt || at > fetchedAt)) fetchedAt = at;
    return {
      ticker: String(r.ticker).toUpperCase(),
      reportDate: String(r.report_date).slice(0, 10),
      session: asSession(r.session),
      isConfirmed: !!r.is_confirmed,
      updatedFromDate: r.updated_from_date ? String(r.updated_from_date).slice(0, 10) : null,
      epsEstimate: r.eps_estimate == null ? null : Number(r.eps_estimate),
      revenueEstimate: r.revenue_estimate == null ? null : Number(r.revenue_estimate),
      fiscalPeriod: r.fiscal_period ?? null,
      companyName: r.company_name ?? null,
      fetchedAt: at || new Date(0).toISOString(),
    };
  });

  return { rows, fetchedAt };
}

async function loadWeights(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data, error } = await supabaseAdmin.from('index_weights').select('ticker, weight_pct');
  if (error) {
    console.error('[week-ahead] index_weights read failed:', error.message);
    return map;
  }
  for (const r of data || []) {
    const pct = Number(r.weight_pct);
    if (Number.isFinite(pct)) map.set(String(r.ticker).toUpperCase(), pct);
  }
  return map;
}

async function loadDemand(): Promise<Map<string, number>> {
  const cutoff = new Date(Date.now() - DEMAND_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('chart_analyses')
    .select('symbol, user_id')
    .gte('created_at', cutoff);

  if (error) {
    console.error('[week-ahead] chart_analyses demand query failed:', error.message);
    return new Map();
  }
  return distinctAnalystsByTicker((data || []) as Array<{ symbol: string | null; user_id: string }>);
}

/** Tickers that would clear the brief gate if they had a date in-horizon. */
export async function loadGateUniverse(): Promise<{ tickers: string[] }> {
  const [weights, demand] = await Promise.all([loadWeights(), loadDemand()]);
  const tickers = new Set<string>();
  for (const [ticker, pct] of weights) {
    if (pct >= MIN_CALENDAR_WEIGHT_PCT) tickers.add(ticker);
  }
  for (const [ticker, n] of demand) {
    if (n >= MIN_DISTINCT_ANALYSTS) tickers.add(ticker);
  }
  return { tickers: [...tickers] };
}

async function loadHolidayCache(): Promise<{ dates: string[]; fetchedAt: string | null }> {
  const { data, error } = await supabaseAdmin
    .from('market_holidays')
    .select('holiday_date, fetched_at');
  if (error) {
    console.warn('[week-ahead] market_holidays read failed:', error.message);
    return { dates: [], fetchedAt: null };
  }
  let fetchedAt: string | null = null;
  const dates: string[] = [];
  for (const r of data || []) {
    dates.push(String(r.holiday_date).slice(0, 10));
    const at = r.fetched_at ? String(r.fetched_at) : null;
    if (at && (!fetchedAt || at > fetchedAt)) fetchedAt = at;
  }
  return { dates, fetchedAt };
}

/**
 * Polygon/Massive upcoming market status. Called from the nightly job, not
 * from the 8:30 send unless the holiday cache is empty.
 */
export async function refreshMarketHolidays(): Promise<string[]> {
  const key = apiKey();
  if (!key) return [];
  const url = `${MASSIVE_BASE_URL}/v1/marketstatus/upcoming?apiKey=${encodeURIComponent(key)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    console.warn(`[week-ahead] marketstatus/upcoming HTTP ${resp.status}`);
    return [];
  }
  const json = (await resp.json()) as Array<{ date?: string; status?: string; name?: string }>;
  const now = new Date().toISOString();
  const rows: Array<{ holiday_date: string; name: string; fetched_at: string }> = [];
  const seen = new Set<string>();
  for (const item of json || []) {
    if (item.status && item.status !== 'closed') continue;
    const date = (item.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date)) continue;
    seen.add(date);
    rows.push({ holiday_date: date, name: item.name || '', fetched_at: now });
  }
  if (rows.length) {
    const { error } = await supabaseAdmin.from('market_holidays').upsert(rows, { onConflict: 'holiday_date' });
    if (error) console.warn('[week-ahead] market_holidays upsert failed:', error.message);
  }
  return [...seen];
}

export async function loadWeekAhead(opts?: {
  now?: Date;
  logger?: WeekAheadLogger;
}): Promise<WeekAheadResult> {
  const now = opts?.now ?? new Date();
  const todayISO = etDateISO(now);
  const logger = opts?.logger ?? console;

  try {
    const [macros, earnings, weights, demand, holidays] = await Promise.all([
      loadMacros(),
      loadEarnings(),
      loadWeights(),
      loadDemand(),
      loadHolidayCache(),
    ]);

    const result = buildWeekAhead({
      now,
      todayISO,
      holidays: holidays.dates,
      macros: macros.rows,
      earnings: earnings.rows,
      weights,
      demand,
      calendarFetchedAt: earnings.fetchedAt,
      macroMaxDate: macros.maxDate,
    });

    const weekday = !isWeekend(todayISO);
    emitWeekAheadLogs(result, { weekday, logger });

    if (macroSeedStale(macros.maxDate, todayISO)) {
      const msg = `macro_calendar is stale: max(event_date)=${macros.maxDate ?? 'none'} is inside 30 days. Seed from published BLS/BEA/FOMC schedules.`;
      logger.error(JSON.stringify({ event: 'week_ahead_error', reason: 'macro_seed_stale', macroMaxDate: macros.maxDate }));
      await postDailyBriefAlert(msg);
    } else if (macroHighImpactDry(macros.rows, todayISO)) {
      logger.warn(
        JSON.stringify({
          event: 'week_ahead_warn',
          reason: 'macro_high_dry',
          detail: 'no impact-3 macro events in the past week or next two — the macro table is running dry',
        })
      );
    }

    return result;
  } catch (err) {
    logger.error('[week-ahead] load failed; omitting section', err);
    return {
      rows: [],
      stale: true,
      log: {
        event: 'week_ahead',
        horizonEnd: todayISO,
        tradingDays: 0,
        macroCandidates: 0,
        macroHigh: 0,
        macroRendered: 0,
        earningsCandidates: 0,
        byWeight: 0,
        byDemand: 0,
        byBoth: 0,
        earningsRendered: 0,
        unconfirmedDropped: 0,
        unknownSession: 0,
        calendarFetchedAt: null,
        macroMaxDate: null,
        rendered: 0,
      },
    };
  }
}
