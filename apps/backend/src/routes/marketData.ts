import { Hono } from 'hono';
import {
  LEGACY_1D_VISIBLE_BARS,
  MarketBarsError,
  getBars,
  isChartInterval,
  normalizeSymbol,
} from '../lib/marketBars.js';

const marketDataRoute = new Hono();

// Massive.com configuration
const MASSIVE_BASE_URL = 'https://api.massive.com';

function getMassiveApiKey(): string | null {
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  return apiKey ? apiKey : null;
}

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
  try {
    const symbol = normalizeSymbol(c.req.param('symbol'));
    if (!symbol) {
      return c.json({ error: 'Invalid symbol' }, 400);
    }
    const requested = c.req.query('interval');
    const interval = isChartInterval(requested) ? requested : '3mo';

    // Bars come from lib/marketBars.ts, the same source the analysis routes use.
    const loaded = await getBars(symbol, interval);
    const { bars, freshness } = loaded;

    // Current app builds send layout=sessions and get the two-session 1D chart.
    // Older builds get the latest session's worth of bars (see LEGACY_1D_VISIBLE_BARS).
    const wantsSessions = c.req.query('layout') === 'sessions';
    const visibleStartIndex =
      interval === '1d' && !wantsSessions
        ? Math.max(loaded.visibleStartIndex, bars.length - LEGACY_1D_VISIBLE_BARS)
        : loaded.visibleStartIndex;

    return c.json({
      symbol,
      interval,
      resultsCount: bars.length,
      data: bars,
      visibleStartIndex,
      emaWarmupBars: visibleStartIndex,
      totalBars: bars.length,
      ...(freshness ? { freshness } : {}),
    });
  } catch (error) {
    if (error instanceof MarketBarsError) {
      return c.json({ error: error.message }, error.status);
    }
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
