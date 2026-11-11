/**
 * marketBars.ts
 * ---------------------------------------------------------------------------
 * The one place price bars are fetched for charts, levels, forecasts and Atlas.
 *
 * Analysis routes call getBars() themselves instead of trusting bars posted by
 * the client, so every analysis is computed from bars the server fetched.
 *
 * Each interval returns enough history for a 200 EMA (see WARMUP notes below);
 * `visibleStartIndex` marks where the part the chart displays begins.
 */

import type { DataFreshness } from '@chartsignl/core';
import type { MarketDataPoint } from './technicalCalculator.js';
import {
  fetchMarketOpen,
  fetchSnapshotForFreshness,
  resolveFeedFreshness,
} from './feedFreshness.js';
import { InsufficientSessionBarsError, selectSessionBars } from './sessionBars.js';

const MASSIVE_BASE_URL = 'https://api.massive.com';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Intraday charts show regular-session bars only. Set false to include pre/post market. */
export const INTRADAY_REGULAR_HOURS_ONLY = true;

interface SessionIntervalConfig {
  kind: 'session';
  timespan: 'minute';
  multiplier: number;
  /** Regular-session bars the chart displays. */
  visibleBars: number;
  /** Extra regular-session bars before the visible ones, for indicator warmup. */
  warmupBars: number;
  /** Calendar days fetched; must cover visibleBars + warmupBars across weekends and holidays. */
  lookbackDays: number;
}

interface CalendarIntervalConfig {
  kind: 'calendar';
  timespan: 'day' | 'week';
  multiplier: number;
  /** Calendar days the chart displays. */
  daysBack: number;
  /** Calendar days fetched before the visible window, for indicator warmup. */
  warmupDays: number;
}

type IntervalConfig = SessionIntervalConfig | CalendarIntervalConfig;

export const CHART_INTERVALS = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y'] as const;
export type ChartIntervalKey = (typeof CHART_INTERVALS)[number];

/**
 * WARMUP: every interval is sized to return at least 200 bars so the 200 EMA
 * exists (about 260 where the data plan's history allows it).
 *  - 1D: 156 five-minute bars = two regular sessions (78 bars each).
 *  - 5D: 65 thirty-minute bars = five regular sessions (13 bars each).
 *  - Daily charts: 340 calendar days of warmup is about 234 trading days.
 *  - 2Y weekly: 1100 days of warmup is about 157 weeks. Kept inside the reach
 *    the 5Y chart already uses, so it needs no more history than before.
 */
export const INTERVAL_CONFIG: Record<ChartIntervalKey, IntervalConfig> = {
  '1d': { kind: 'session', timespan: 'minute', multiplier: 5, visibleBars: 156, warmupBars: 200, lookbackDays: 12 },
  '5d': { kind: 'session', timespan: 'minute', multiplier: 30, visibleBars: 65, warmupBars: 200, lookbackDays: 35 },
  '1mo': { kind: 'calendar', timespan: 'day', multiplier: 1, daysBack: 45, warmupDays: 340 },
  '3mo': { kind: 'calendar', timespan: 'day', multiplier: 1, daysBack: 140, warmupDays: 340 },
  '6mo': { kind: 'calendar', timespan: 'day', multiplier: 1, daysBack: 180, warmupDays: 340 },
  '1y': { kind: 'calendar', timespan: 'day', multiplier: 1, daysBack: 365, warmupDays: 340 },
  '2y': { kind: 'calendar', timespan: 'week', multiplier: 1, daysBack: 730, warmupDays: 1100 },
  '5y': { kind: 'calendar', timespan: 'week', multiplier: 1, daysBack: 1825, warmupDays: 210 },
};

/**
 * App builds released before 2026-11-09 expect the 1D chart to be one day: they
 * label its axis with times only and compute the header change first bar to
 * last. Until a client asks for the two-session layout, give it one session.
 */
export const LEGACY_1D_VISIBLE_BARS = 78;

export function isChartInterval(value: unknown): value is ChartIntervalKey {
  return typeof value === 'string' && (CHART_INTERVALS as readonly string[]).includes(value);
}

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.:^-]{0,19}$/;

/** Upper-cased symbol, or null when it is not a plausible ticker. */
export function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const symbol = value.trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export type MarketBarsStatus = 404 | 429 | 500 | 502;

export class MarketBarsError extends Error {
  readonly status: MarketBarsStatus;
  constructor(message: string, status: MarketBarsStatus) {
    super(message);
    this.name = 'MarketBarsError';
    this.status = status;
  }
}

export interface MarketBars {
  symbol: string;
  interval: ChartIntervalKey;
  /** Warmup bars followed by the visible bars, oldest first. */
  bars: MarketDataPoint[];
  /** Index in `bars` where the chart's visible window starts. */
  visibleStartIndex: number;
  freshness: DataFreshness | null;
}

function getMassiveApiKey(): string | null {
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  return apiKey ? apiKey : null;
}

interface RawBar {
  t?: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
}

function isUsablePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function toBars(raw: RawBar[], symbol: string): MarketDataPoint[] {
  return raw.map((bar) => {
    if (
      typeof bar.t !== 'number' ||
      !Number.isFinite(bar.t) ||
      !isUsablePrice(bar.o) ||
      !isUsablePrice(bar.h) ||
      !isUsablePrice(bar.l) ||
      !isUsablePrice(bar.c)
    ) {
      console.error('[MarketBars] Provider returned an unusable bar', { symbol, bar });
      throw new MarketBarsError('Market data provider returned an invalid price bar', 502);
    }
    return {
      timestamp: bar.t, // milliseconds
      date: new Date(bar.t).toISOString(),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: typeof bar.v === 'number' && Number.isFinite(bar.v) ? bar.v : 0,
    };
  });
}

async function fetchAggregates(
  symbol: string,
  config: IntervalConfig,
  fromMs: number,
  toMs: number,
  apiKey: string,
): Promise<RawBar[]> {
  // `limit` counts BASE aggregates (one-minute bars for intraday), not result
  // bars. Intraday asks for the newest first so that, if the cap is ever hit,
  // the oldest warmup bars are what gets dropped rather than the latest bars.
  const order = config.kind === 'session' ? 'desc' : 'asc';
  const limit = config.kind === 'session' ? 50000 : 5000;
  const url =
    `${MASSIVE_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/` +
    `${config.multiplier}/${config.timespan}/${Math.floor(fromMs)}/${Math.floor(toMs)}` +
    `?adjusted=true&sort=${order}&limit=${limit}&apiKey=${apiKey}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as { error?: unknown } | null;
    console.error('Massive API error:', response.status, errorData);
    if (response.status === 401) {
      throw new MarketBarsError(
        'Market data provider rejected the API key. Update MASSIVE_API_KEY on the server.',
        502,
      );
    }
    if (response.status === 403) {
      throw new MarketBarsError('API rate limit exceeded. Please try again later.', 429);
    }
    if (response.status === 404) {
      throw new MarketBarsError('Symbol not found', 404);
    }
    const providerMessage =
      typeof errorData?.error === 'string' && errorData.error.trim() ? errorData.error.trim() : null;
    throw new MarketBarsError(providerMessage ?? 'Failed to fetch market data', 500);
  }

  let json: { status?: string; error?: string; results?: RawBar[] };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    throw new MarketBarsError('Failed to parse API response', 500);
  }

  if (json.status === 'ERROR' || json.status === 'NOT_FOUND') {
    throw new MarketBarsError(json.error || 'Symbol not found', 404);
  }
  if (!Array.isArray(json.results) || json.results.length === 0) {
    throw new MarketBarsError('No data available for this symbol', 404);
  }

  return order === 'desc' ? [...json.results].reverse() : json.results;
}

async function loadBars(symbol: string, interval: ChartIntervalKey, nowMs: number): Promise<MarketBars> {
  const apiKey = getMassiveApiKey();
  if (!apiKey) {
    console.error('[MarketBars] MASSIVE_API_KEY is not set or empty');
    throw new MarketBarsError('Massive API key not configured', 500);
  }

  const config = INTERVAL_CONFIG[interval];
  const visibleFromMs = config.kind === 'calendar' ? nowMs - config.daysBack * DAY_MS : 0;
  const fromMs =
    config.kind === 'calendar'
      ? visibleFromMs - config.warmupDays * DAY_MS
      : nowMs - config.lookbackDays * DAY_MS;

  const [raw, snapshot, marketOpen] = await Promise.all([
    fetchAggregates(symbol, config, fromMs, nowMs, apiKey),
    fetchSnapshotForFreshness(symbol),
    fetchMarketOpen(),
  ]);

  const all = toBars(raw, symbol);

  let bars: MarketDataPoint[];
  let visibleStartIndex: number;
  if (config.kind === 'session') {
    try {
      ({ bars, visibleStartIndex } = selectSessionBars(all, {
        visibleBars: config.visibleBars,
        warmupBars: config.warmupBars,
        regularHoursOnly: INTRADAY_REGULAR_HOURS_ONLY,
      }));
    } catch (error) {
      if (error instanceof InsufficientSessionBarsError) {
        console.error('[MarketBars] Too few regular-session bars', {
          symbol,
          interval,
          fetched: all.length,
          reason: error.message,
        });
        throw new MarketBarsError('Not enough intraday price data for this symbol', 502);
      }
      throw error;
    }
  } else {
    bars = all;
    const firstVisible = all.findIndex((bar) => bar.timestamp >= visibleFromMs);
    visibleStartIndex = firstVisible >= 0 ? firstVisible : 0;
  }

  const freshness = resolveFeedFreshness({
    bars: bars.map((bar) => ({ t: bar.timestamp })),
    snapshot,
    marketOpen,
  });

  return { symbol, interval, bars, visibleStartIndex, freshness };
}

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 300;
const cache = new Map<string, { at: number; promise: Promise<MarketBars> }>();

/**
 * Bars for a symbol and chart range, fetched by the server.
 *
 * Cached for 60 seconds per symbol and interval, so the chart, /api/levels and
 * Atlas see the same bars when called close together. Failures are not cached.
 * Throws MarketBarsError; there is no fallback to client-supplied bars.
 */
export function getBars(
  symbol: string,
  interval: ChartIntervalKey,
  opts: { nowMs?: number } = {},
): Promise<MarketBars> {
  const nowMs = opts.nowMs ?? Date.now();
  const key = `${symbol}|${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;

  const promise = loadBars(symbol, interval, nowMs);
  // Delete first so a refreshed key moves to the end; then the first key in the
  // map is always the least recently fetched one.
  cache.delete(key);
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, entry] of cache) {
      if (Date.now() - entry.at >= CACHE_TTL_MS) cache.delete(k);
    }
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

/** Test hook: forget cached bars. */
export function clearBarsCache(): void {
  cache.clear();
}

export type AnalysisBarsResult =
  | {
      ok: true;
      symbol: string;
      interval: ChartIntervalKey;
      bars: MarketDataPoint[];
      freshness: DataFreshness | null;
    }
  | { ok: false; error: string; status: 400 | MarketBarsStatus };

/**
 * Validate an analysis request body and fetch its bars on the server.
 *
 * Older app builds still post a `data` array of bars; it is ignored. Analysis
 * must never run on bars the client supplied.
 */
export async function barsForAnalysis(body: unknown, route: string): Promise<AnalysisBarsResult> {
  const { symbol: rawSymbol, interval: rawInterval, data } = (body ?? {}) as Record<string, unknown>;

  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) return { ok: false, error: 'Invalid symbol', status: 400 };
  if (!isChartInterval(rawInterval)) return { ok: false, error: 'Invalid interval', status: 400 };

  if (data !== undefined) {
    console.log(`[${route}] Ignoring client-supplied bars for ${symbol} ${rawInterval}; using server bars`);
  }

  try {
    const { bars, freshness } = await getBars(symbol, rawInterval);
    return { ok: true, symbol, interval: rawInterval, bars, freshness };
  } catch (error) {
    if (error instanceof MarketBarsError) {
      console.error(`[${route}] Could not load bars for ${symbol} ${rawInterval}: ${error.message}`);
      return { ok: false, error: error.message, status: error.status };
    }
    throw error;
  }
}
