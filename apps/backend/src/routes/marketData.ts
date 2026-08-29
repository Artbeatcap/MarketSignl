import { Hono } from 'hono';
import type { MarketDataPoint } from '@chartsignl/core';
import {
  fetchMarketOpen,
  fetchSnapshotForFreshness,
  resolveFeedFreshness,
} from '../lib/feedFreshness.js';

const marketDataRoute = new Hono();

// Massive.com configuration
const MASSIVE_BASE_URL = 'https://api.massive.com';

const DAY_MS = 24 * 60 * 60 * 1000;

function getMassiveApiKey(): string | null {
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  return apiKey ? apiKey : null;
}

type MassiveTimespan = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

function baseMsForTimespan(timespan: MassiveTimespan): number {
  switch (timespan) {
    case 'minute':
      return 60 * 1000;
    case 'hour':
      return 60 * 60 * 1000;
    case 'day':
      return DAY_MS;
    case 'week':
      return 7 * DAY_MS;
    case 'month':
      // Approximate; we don't use month/quarter/year in current intervalConfig.
      return 30 * DAY_MS;
    case 'quarter':
      return 91 * DAY_MS;
    case 'year':
      return 365 * DAY_MS;
    default: {
      // Exhaustiveness guard
      const _exhaustive: never = timespan;
      return _exhaustive;
    }
  }
}

// Interval mapping for Massive.com
// Massive uses: minute, hour, day, week, month, quarter, year
// With multipliers like 1, 5, 15 for minutes
const intervalConfig: Record<
  string,
  { timespan: MassiveTimespan; multiplier: number; daysBack: number; emaWarmupBars: number }
> = {
  // Intraday: use warmup to avoid EMA cutoff at chart start (market hours create gaps).
  '1d': { timespan: 'minute', multiplier: 5, daysBack: 1, emaWarmupBars: 200 },
  '5d': { timespan: 'minute', multiplier: 30, daysBack: 5, emaWarmupBars: 100 },
  // Daily bars (Polygon hourly is stale; daily is current). 30 warmup bars; 45 daysBack ≈ 32 trading days.
  '1mo': { timespan: 'day', multiplier: 1, daysBack: 45, emaWarmupBars: 30 },
  '3mo': { timespan: 'day', multiplier: 1, daysBack: 140, emaWarmupBars: 30 },
  '6mo': { timespan: 'day', multiplier: 1, daysBack: 180, emaWarmupBars: 30 },
  '1y': { timespan: 'day', multiplier: 1, daysBack: 365, emaWarmupBars: 30 },
  '2y': { timespan: 'week', multiplier: 1, daysBack: 730, emaWarmupBars: 30 },
  '5y': { timespan: 'week', multiplier: 1, daysBack: 1825, emaWarmupBars: 30 },
};

// GET /api/market-data/status - Verify Massive API connectivity (ops / debugging)
marketDataRoute.get('/status', async (c) => {
  const massiveApiKey = getMassiveApiKey();
  if (!massiveApiKey) {
    return c.json({ ok: false, error: 'MASSIVE_API_KEY is not configured' }, 503);
  }

  try {
    const url = `${MASSIVE_BASE_URL}/v2/aggs/ticker/AAPL/prev?adjusted=true&apiKey=${massiveApiKey}`;
    const response = await fetch(url);
    const json = (await response.json().catch(() => ({}))) as { status?: string; error?: string };

    if (!response.ok) {
      return c.json(
        {
          ok: false,
          httpStatus: response.status,
          error: json.error ?? `Massive API returned HTTP ${response.status}`,
        },
        response.status === 401 ? 502 : 503
      );
    }

    if (json.status === 'ERROR') {
      return c.json({ ok: false, error: json.error ?? 'Massive API error' }, 503);
    }

    return c.json({ ok: true, provider: 'massive', sample: 'AAPL' });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to reach Massive API',
      },
      503
    );
  }
});

// GET /api/market-data/:symbol
marketDataRoute.get('/:symbol', async (c) => {
  const symbol = c.req.param('symbol');
  
  try {
    const massiveApiKey = getMassiveApiKey();
    console.log('[ROUTE] Market data route hit for symbol:', symbol, 'API key configured:', !!massiveApiKey);
    
    const symbolUpper = c.req.param('symbol').toUpperCase();
    const chartInterval = c.req.query('interval') || '3mo';
    
    if (!massiveApiKey) {
      console.error('[ROUTE ERROR] MASSIVE_API_KEY is not set or empty');
      return c.json({ error: 'Massive API key not configured' }, 500);
    }

    const config = intervalConfig[chartInterval] || intervalConfig['3mo'];

    // Calculate date ranges:
    // - requestedStartMs is the beginning of the visible window
    // - fetchStartMs includes warmup bars so EMAs can be computed from the first visible bar
    const endDate = new Date();
    const nowMs = endDate.getTime();

    const requestedStartMs = nowMs - config.daysBack * DAY_MS;
    const warmupMs = config.emaWarmupBars * config.multiplier * baseMsForTimespan(config.timespan);
    const fetchStartMs = requestedStartMs - warmupMs;

    const fromParam = fetchStartMs;
    const toParam = nowMs;

    // Build Massive URL
    // Format: /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
    // Massive supports Unix ms timestamps for {from}/{to} path parameters.
    const url = `${MASSIVE_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(symbolUpper)}/range/${config.multiplier}/${config.timespan}/${fromParam}/${toParam}?adjusted=true&sort=asc&limit=5000&apiKey=${massiveApiKey}`;

    let response: Response;
    let snapshot: Awaited<ReturnType<typeof fetchSnapshotForFreshness>> = null;
    let marketOpen: boolean | undefined;
    try {
      [response, snapshot, marketOpen] = await Promise.all([
        fetch(url),
        fetchSnapshotForFreshness(symbolUpper),
        fetchMarketOpen(),
      ]);
    } catch (fetchError) {
      throw fetchError;
    }

    if (!response.ok) {
      let errorData: any;
      try {
        errorData = await response.json();
      } catch (parseError) {
        errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
      }
      console.error('Massive API error:', response.status, errorData);

      if (response.status === 401) {
        return c.json(
          { error: 'Market data provider rejected the API key. Update MASSIVE_API_KEY on the server.' },
          502
        );
      }
      if (response.status === 403) {
        return c.json({ error: 'API rate limit exceeded. Please try again later.' }, 429);
      }
      if (response.status === 404) {
        return c.json({ error: 'Symbol not found' }, 404);
      }
      const providerMessage =
        typeof errorData?.error === 'string' && errorData.error.trim()
          ? errorData.error.trim()
          : null;
      return c.json(
        { error: providerMessage ?? 'Failed to fetch market data' },
        500
      );
    }

    let json: any;
    try {
      json = await response.json();
    } catch (parseError) {
      return c.json({ error: 'Failed to parse API response' }, 500);
    }

    if (json.status === 'ERROR' || json.status === 'NOT_FOUND') {
      return c.json({ error: json.error || 'Symbol not found' }, 404);
    }

    if (!json.results || json.results.length === 0) {
      return c.json({ error: 'No data available for this symbol' }, 404);
    }

    // Determine where the "visible" data begins within the fetched dataset.
    // (We fetch warmup bars before requestedStartMs to allow EMA initialization.)
    const visibleStartIndexRaw = (json.results as any[]).findIndex(
      (bar: any) => typeof bar?.t === 'number' && bar.t >= requestedStartMs
    );
    const visibleStartIndex = visibleStartIndexRaw >= 0 ? visibleStartIndexRaw : 0;
    const emaWarmupBars = visibleStartIndex;

    // Transform Massive data to our format
    // Massive returns: t (timestamp), o (open), h (high), l (low), c (close), v (volume), vw (vwap), n (transactions)
    const data: MarketDataPoint[] = json.results.map((bar: any) => ({
      timestamp: bar.t, // Already in milliseconds
      date: new Date(bar.t).toISOString(),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v || 0,
    }));

    const freshness = resolveFeedFreshness({
      bars: json.results,
      snapshot,
      marketOpen,
    });

    const responseData = {
      symbol: symbolUpper,
      interval: chartInterval,
      resultsCount: json.resultsCount,
      data,
      visibleStartIndex,
      emaWarmupBars,
      totalBars: data.length,
      ...(freshness ? { freshness } : {}),
    };

    return c.json(responseData);
  } catch (error) {
    console.error('Market data error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch data' },
      500
    );
  }
});

// GET /api/market-data/:symbol/quote - Get current quote
marketDataRoute.get('/:symbol/quote', async (c) => {
  try {
    const massiveApiKey = getMassiveApiKey();
    const symbol = c.req.param('symbol').toUpperCase();

    if (!massiveApiKey) {
      console.error('[ROUTE ERROR] MASSIVE_API_KEY is not set or empty');
      return c.json({ error: 'Massive API key not configured' }, 500);
    }

    // Get previous day's close for reference
    const url = `${MASSIVE_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true&apiKey=${massiveApiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch quote' }, 500);
    }

    const json = await response.json() as any;

    if (!json.results || json.results.length === 0) {
      return c.json({ error: 'No quote data available' }, 404);
    }

    const bar = json.results[0];

    return c.json({
      symbol,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
      timestamp: bar.t,
    });
  } catch (error) {
    console.error('Quote error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch quote' },
      500
    );
  }
});

type MassiveTickerResult = {
  ticker?: string;
  name?: string;
  type?: string;
  market?: string;
  primary_exchange?: string;
};

type SymbolSearchResult = {
  symbol: string;
  name: string;
  type: string;
  market?: string;
  exchange?: string;
  marketCap: number;
};

const MAJOR_EXCHANGES = ['XNAS', 'XNYS', 'ARCX', 'BATS'];
const EXCLUDE_OTC_EXCHANGES = ['OTCM', 'PINK', 'OTCB', 'OTCQ', 'OTCX'];
const SEARCHABLE_TYPES = new Set(['CS', 'ETF', 'ETV', 'ADRC']);

/** True when the query looks like a ticker symbol (e.g. MU, BRK.B), not a company name. */
function isTickerLikeQuery(query: string): boolean {
  return /^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/.test(query);
}

/** Lexicographic upper bound for ticker prefix range queries (MU -> MV). */
function tickerPrefixUpperBound(prefix: string): string {
  const last = prefix.charCodeAt(prefix.length - 1);
  return prefix.slice(0, -1) + String.fromCharCode(last + 1);
}

async function fetchMassiveTickers(url: string): Promise<MassiveTickerResult[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const json = (await response.json()) as { results?: MassiveTickerResult[] };
    return Array.isArray(json.results) ? json.results : [];
  } catch {
    return [];
  }
}

function isAllowedSearchTicker(ticker: MassiveTickerResult): boolean {
  if (!ticker.ticker || !ticker.name || !ticker.type) return false;
  if (ticker.primary_exchange && EXCLUDE_OTC_EXCHANGES.includes(ticker.primary_exchange)) {
    return false;
  }
  return SEARCHABLE_TYPES.has(ticker.type);
}

function toSearchResult(ticker: MassiveTickerResult, marketCap = 0): SymbolSearchResult {
  return {
    symbol: ticker.ticker!,
    name: ticker.name!,
    type: ticker.type!,
    market: ticker.market,
    exchange: ticker.primary_exchange,
    marketCap,
  };
}

/** Fetch market caps for ranking; best-effort and capped to avoid rate limits. */
async function fetchMarketCaps(
  symbols: string[],
  apiKey: string,
  limit = 12
): Promise<Map<string, number>> {
  const caps = new Map<string, number>();
  const targets = symbols.slice(0, limit);

  await Promise.all(
    targets.map(async (symbol) => {
      try {
        const url = `${MASSIVE_BASE_URL}/v3/reference/tickers/${encodeURIComponent(symbol)}?apiKey=${apiKey}`;
        const response = await fetch(url);
        if (!response.ok) return;
        const json = (await response.json()) as { results?: { market_cap?: number } };
        const marketCap = json.results?.market_cap;
        if (typeof marketCap === 'number' && marketCap > 0) {
          caps.set(symbol, marketCap);
        }
      } catch {
        // Ignore individual failures; ranking falls back to exchange/length.
      }
    })
  );

  return caps;
}

function compareSearchResults(
  a: SymbolSearchResult,
  b: SymbolSearchResult,
  queryUpper: string
): number {
  const aExact = a.symbol === queryUpper;
  const bExact = b.symbol === queryUpper;
  if (aExact !== bExact) return aExact ? -1 : 1;

  const aStarts = a.symbol.startsWith(queryUpper);
  const bStarts = b.symbol.startsWith(queryUpper);
  if (aStarts !== bStarts) return aStarts ? -1 : 1;

  // Among ticker matches, prefer larger market caps when available.
  if (aStarts && bStarts && a.marketCap !== b.marketCap) {
    return b.marketCap - a.marketCap;
  }

  // Shorter tickers are usually the primary listing (MU before MUFG).
  if (aStarts && bStarts && a.symbol.length !== b.symbol.length) {
    return a.symbol.length - b.symbol.length;
  }

  const aIsMajor = !!a.exchange && MAJOR_EXCHANGES.includes(a.exchange);
  const bIsMajor = !!b.exchange && MAJOR_EXCHANGES.includes(b.exchange);
  if (aIsMajor !== bIsMajor) return aIsMajor ? -1 : 1;

  return a.symbol.localeCompare(b.symbol);
}

// GET /api/market-data/search - Search for symbols
marketDataRoute.get('/search/:query', async (c) => {
  try {
    const massiveApiKey = getMassiveApiKey();
    const query = c.req.param('query').trim();

    if (!massiveApiKey) {
      console.error('[ROUTE ERROR] MASSIVE_API_KEY is not set or empty');
      return c.json({ error: 'Massive API key not configured' }, 500);
    }

    if (!query) {
      return c.json({ results: [] });
    }

    const queryUpper = query.toUpperCase();
    const tickerLike = isTickerLikeQuery(queryUpper);

    // Name/relevance search alone often buries short tickers (e.g. search=MU never returns MU).
    // For ticker-like queries, also fetch exact + prefix ticker matches and merge.
    const nameSearchUrl =
      `${MASSIVE_BASE_URL}/v3/reference/tickers` +
      `?search=${encodeURIComponent(query)}&active=true&market=stocks&limit=100&apiKey=${massiveApiKey}`;

    const requests: Promise<MassiveTickerResult[]>[] = [fetchMassiveTickers(nameSearchUrl)];

    if (tickerLike) {
      const upperBound = tickerPrefixUpperBound(queryUpper);
      const prefixUrl =
        `${MASSIVE_BASE_URL}/v3/reference/tickers` +
        `?ticker.gte=${encodeURIComponent(queryUpper)}` +
        `&ticker.lt=${encodeURIComponent(upperBound)}` +
        `&active=true&market=stocks&limit=100&apiKey=${massiveApiKey}`;
      const exactUrl =
        `${MASSIVE_BASE_URL}/v3/reference/tickers` +
        `?ticker=${encodeURIComponent(queryUpper)}&active=true&limit=10&apiKey=${massiveApiKey}`;
      requests.push(fetchMassiveTickers(prefixUrl), fetchMassiveTickers(exactUrl));
    }

    const pages = await Promise.all(requests);
    const bySymbol = new Map<string, SymbolSearchResult>();

    // Insert name hits first, then overlay ticker hits so symbol matches win on conflicts.
    for (const page of pages) {
      for (const ticker of page) {
        if (!isAllowedSearchTicker(ticker)) continue;
        const symbol = ticker.ticker!;
        if (!bySymbol.has(symbol)) {
          bySymbol.set(symbol, toSearchResult(ticker));
        }
      }
    }

    let results = Array.from(bySymbol.values());

    // Best-effort market-cap enrichment for ticker-like queries (ranking only).
    // Cap detail lookups to keep search snappy and stay within provider rate limits.
    if (tickerLike && results.length > 0) {
      const prefixSymbols = results
        .filter((r) => r.symbol.startsWith(queryUpper))
        .sort((a, b) => a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol))
        .map((r) => r.symbol);

      const caps = await fetchMarketCaps(prefixSymbols, massiveApiKey, 8);
      if (caps.size > 0) {
        for (const result of results) {
          const marketCap = caps.get(result.symbol);
          if (marketCap != null) result.marketCap = marketCap;
        }
      }
    }

    results.sort((a, b) => compareSearchResults(a, b, queryUpper));

    return c.json({
      results: results.slice(0, 40).map(({ symbol, name, type, market, exchange }) => ({
        symbol,
        name,
        type,
        market,
        exchange,
      })),
    });
  } catch (error) {
    console.error('Search error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      500
    );
  }
});

export default marketDataRoute;
