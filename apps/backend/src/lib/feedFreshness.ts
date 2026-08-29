import {
  MARKET_DATA_DELAY_MINUTES,
  MARKET_DATA_SOURCE,
  type DataFreshness,
} from '@chartsignl/core';

const ET = 'America/New_York';

/** Mirror of `@chartsignl/core` formatAsOf — core's Node barrel is constants-only. */
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

const MASSIVE_BASE_URL = process.env.MASSIVE_BASE_URL?.trim() || 'https://api.massive.com';
const MARKET_STATUS_TTL_MS = 5 * 60 * 1000;
/** Weekend Friday close can be >48h old by Sunday night; year-range catches unit bugs. */
const AS_OF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AS_OF_MAX_FUTURE_MS = 48 * 60 * 60 * 1000;

function getApiKey(): string | null {
  return process.env.MASSIVE_API_KEY?.trim() || process.env.POLYGON_API_KEY?.trim() || null;
}

export function assertPlausibleTimestampMs(ms: number, context: string): void {
  if (process.env.NODE_ENV === 'production') return;
  const y = new Date(ms).getUTCFullYear();
  if (y < 2000 || y > 2100) {
    console.error(`[freshness] implausible timestamp ${ms} (${context}) — unit mismatch? year=${y}`);
  }
}

function asOfFromMs(ms: number, context: string): string | null {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return null;
  assertPlausibleTimestampMs(ms, context);
  const y = new Date(ms).getUTCFullYear();
  if (y < 2000 || y > 2100) return null;
  return new Date(ms).toISOString();
}

function buildFreshness(asOf: string, marketOpen?: boolean): DataFreshness {
  return {
    asOf,
    delayMinutes: MARKET_DATA_DELAY_MINUTES,
    isDelayed: MARKET_DATA_DELAY_MINUTES > 0,
    source: MARKET_DATA_SOURCE,
    ...(typeof marketOpen === 'boolean' ? { marketOpen } : {}),
  };
}

/**
 * Polygon snapshot → feed timestamp. lastTrade.t is NANOSECONDS.
 * min.t / day.t are milliseconds. Mixing them yields year 58000 and throws nothing.
 */
export function freshnessFromSnapshot(snap: {
  lastTrade?: { t?: number };
  min?: { t?: number };
  updated?: number;
}, marketOpen?: boolean): DataFreshness | null {
  const ns = snap?.lastTrade?.t ?? 0;
  const minT = snap?.min?.t ?? 0;
  const updated = snap?.updated ?? 0;

  let ms = 0;
  if (ns) {
    ms = ns > 1e15 ? ns / 1_000_000 : ns;
  } else if (minT) {
    ms = minT > 1e15 ? minT / 1_000_000 : minT;
  } else if (updated) {
    ms = updated > 1e15 ? updated / 1_000_000 : updated;
  }

  const asOf = asOfFromMs(ms, 'snapshot');
  if (!asOf) return null;
  return buildFreshness(asOf, marketOpen);
}

/** Aggregate bars → feed timestamp is the close of the LAST bar (milliseconds). */
export function freshnessFromBars(
  bars: Array<{ t?: number; timestamp?: number; date?: string }>,
  marketOpen?: boolean,
): DataFreshness | null {
  const last = bars[bars.length - 1];
  if (!last) return null;

  const raw = last.t ?? last.timestamp ?? 0;
  const ms = raw > 1e15 ? raw / 1_000_000 : raw;
  let asOf = asOfFromMs(ms, 'bars');

  if (!asOf && typeof last.date === 'string') {
    const parsed = Date.parse(last.date);
    asOf = asOfFromMs(parsed, 'bars.date');
  }

  if (!asOf) return null;
  return buildFreshness(asOf, marketOpen);
}

/**
 * Prefer snapshot/quote timestamp when one exists; fall back to last bar close.
 * Daily charts honestly read as closed with yesterday's 4 PM when no quote is present.
 */
export function resolveFeedFreshness(opts: {
  bars?: Array<{ t?: number; timestamp?: number; date?: string }>;
  snapshot?: { lastTrade?: { t?: number }; min?: { t?: number }; updated?: number } | null;
  marketOpen?: boolean;
}): DataFreshness | null {
  const fromSnap = opts.snapshot ? freshnessFromSnapshot(opts.snapshot, opts.marketOpen) : null;
  if (fromSnap) return fromSnap;
  if (opts.bars?.length) return freshnessFromBars(opts.bars, opts.marketOpen);
  return null;
}

export class FreshnessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FreshnessValidationError';
  }
}

/**
 * Client-supplied freshness. Reject garbage rather than persist it.
 * Past window is 7 days (weekend Friday close); future window is 48h.
 */
export function validateClientFreshness(raw: unknown, nowMs: number = Date.now()): DataFreshness {
  if (!raw || typeof raw !== 'object') {
    throw new FreshnessValidationError('freshness must be an object');
  }
  const f = raw as Record<string, unknown>;
  if (typeof f.asOf !== 'string') {
    throw new FreshnessValidationError('freshness.asOf must be an ISO timestamp');
  }
  const parsed = Date.parse(f.asOf);
  if (!Number.isFinite(parsed)) {
    throw new FreshnessValidationError('freshness.asOf is not a valid timestamp');
  }
  const y = new Date(parsed).getUTCFullYear();
  if (y < 2000 || y > 2100) {
    throw new FreshnessValidationError('freshness.asOf is implausible — unit mismatch?');
  }
  if (parsed - nowMs > AS_OF_MAX_FUTURE_MS) {
    throw new FreshnessValidationError('freshness.asOf is too far in the future');
  }
  if (nowMs - parsed > AS_OF_MAX_AGE_MS) {
    throw new FreshnessValidationError('freshness.asOf is too old');
  }

  const delayMinutes =
    typeof f.delayMinutes === 'number' && Number.isFinite(f.delayMinutes)
      ? f.delayMinutes
      : MARKET_DATA_DELAY_MINUTES;

  return {
    asOf: new Date(parsed).toISOString(),
    delayMinutes,
    isDelayed: delayMinutes > 0,
    source: typeof f.source === 'string' && f.source.trim() ? f.source : MARKET_DATA_SOURCE,
    ...(typeof f.marketOpen === 'boolean' ? { marketOpen: f.marketOpen } : {}),
  };
}

let marketStatusCache: { marketOpen: boolean; fetchedAt: number } | null = null;

export async function fetchMarketOpen(): Promise<boolean | undefined> {
  const now = Date.now();
  if (marketStatusCache && now - marketStatusCache.fetchedAt < MARKET_STATUS_TTL_MS) {
    return marketStatusCache.marketOpen;
  }

  const key = getApiKey();
  if (!key) return marketStatusCache?.marketOpen;

  try {
    const url = `${MASSIVE_BASE_URL}/v1/marketstatus/now?apiKey=${encodeURIComponent(key)}`;
    const response = await fetch(url);
    if (!response.ok) return marketStatusCache?.marketOpen;
    const json = (await response.json()) as { market?: string };
    const marketOpen = json.market === 'open';
    marketStatusCache = { marketOpen, fetchedAt: now };
    return marketOpen;
  } catch {
    return marketStatusCache?.marketOpen;
  }
}

export async function fetchSnapshotForFreshness(symbol: string): Promise<{
  lastTrade?: { t?: number };
  min?: { t?: number };
  updated?: number;
} | null> {
  const key = getApiKey();
  if (!key) return null;
  try {
    const url =
      `${MASSIVE_BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/` +
      `${encodeURIComponent(symbol.toUpperCase())}?apiKey=${encodeURIComponent(key)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const json = (await response.json()) as { ticker?: Record<string, unknown> };
    return (json.ticker as {
      lastTrade?: { t?: number };
      min?: { t?: number };
      updated?: number;
    }) ?? null;
  } catch {
    return null;
  }
}

export { MARKET_DATA_DELAY_MINUTES, MARKET_DATA_SOURCE };
