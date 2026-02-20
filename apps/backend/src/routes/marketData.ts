import { Hono } from 'hono';
import type { MarketDataPoint } from '@chartsignl/core';

const marketDataRoute = new Hono();

// Massive.com configuration
const MASSIVE_BASE_URL = 'https://api.massive.com';

const DAY_MS = 24 * 60 * 60 * 1000;

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

// GET /api/market-data/:symbol
marketDataRoute.get('/:symbol', async (c) => {
  const symbol = c.req.param('symbol');
  
  try {
    const MASSIVE_API_KEY = 'RcnenBuGTzPs3aaunhpWW6FpaAzs60Ug';
    console.log('[ROUTE] Market data route hit for symbol:', symbol, 'API key available:', !!MASSIVE_API_KEY);
    
    const symbolUpper = c.req.param('symbol').toUpperCase();
    const chartInterval = c.req.query('interval') || '3mo';
    
    if (!MASSIVE_API_KEY || MASSIVE_API_KEY.trim() === '') {
      console.error('[ROUTE ERROR] MASSIVE_API_KEY is not set or empty');
      return c.json({ 
        error: 'Massive API key not configured. Please set MASSIVE_API_KEY in apps/backend/.env file.',
        details: 'Get your free API key at https://massive.com'
      }, 500);
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
    const url = `${MASSIVE_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(symbolUpper)}/range/${config.multiplier}/${config.timespan}/${fromParam}/${toParam}?adjusted=true&sort=asc&limit=5000&apiKey=${MASSIVE_API_KEY}`;

    let response: Response;
    try {
      response = await fetch(url);
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
      
      if (response.status === 403) {
        return c.json({ error: 'API rate limit exceeded. Please try again later.' }, 429);
      }
      if (response.status === 404) {
        return c.json({ error: 'Symbol not found' }, 404);
      }
      return c.json({ error: 'Failed to fetch market data' }, 500);
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

    const responseData = {
      symbol: symbolUpper,
      interval: chartInterval,
      resultsCount: json.resultsCount,
      data,
      visibleStartIndex,
      emaWarmupBars,
      totalBars: data.length,
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
    const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY || '';
    const symbol = c.req.param('symbol').toUpperCase();

    if (!MASSIVE_API_KEY) {
      return c.json({ error: 'Massive API key not configured' }, 500);
    }

    // Get previous day's close for reference
    const url = `${MASSIVE_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true&apiKey=${MASSIVE_API_KEY}`;

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

// GET /api/market-data/search - Search for symbols
marketDataRoute.get('/search/:query', async (c) => {
  try {
    // Use same API key as other endpoint (hardcoded fallback if env var not set)
    const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY || 'RcnenBuGTzPs3aaunhpWW6FpaAzs60Ug';
    const query = c.req.param('query');

    if (!MASSIVE_API_KEY) {
      return c.json({ error: 'Massive API key not configured' }, 500);
    }

    // Fetch up to 100 results (stocks and ETFs) for better filtering
    const url = `${MASSIVE_BASE_URL}/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&limit=100&apiKey=${MASSIVE_API_KEY}`;

    const response = await fetch(url);

    if (!response.ok) {
      return c.json({ error: 'Search failed' }, 500);
    }

    const json = await response.json() as any;

    // Filter results to prioritize major US exchanges (NASDAQ, NYSE, ARCA)
    // and exclude OTC, pink sheets, and other minor exchanges
    const majorExchanges = ['XNAS', 'XNYS', 'ARCX', 'BATS'];
    const excludeOTC = ['OTCM', 'PINK', 'OTCB', 'OTCQ', 'OTCX'];
    
    const rawResults = json.results || [];
    
    let results = rawResults
      .filter((ticker: any) => {
        // Exclude OTC and pink sheets
        if (excludeOTC.includes(ticker.primary_exchange)) {
          return false;
        }
        // Only include common stocks, ETFs, and ETVs (Exchange Traded Vehicles)
        return ticker.type === 'CS' || ticker.type === 'ETF' || ticker.type === 'ETV' || ticker.type === 'ADRC';
      })
      .map((ticker: any) => ({
        symbol: ticker.ticker,
        name: ticker.name,
        type: ticker.type,
        market: ticker.market,
        exchange: ticker.primary_exchange,
      }));

    // Sort: Exact match first, then closest match, then major exchanges, then alphabetically
    const queryUpper = query.toUpperCase();
    results.sort((a: any, b: any) => {
      // 1. Exact match comes first
      const aExact = a.symbol === queryUpper;
      const bExact = b.symbol === queryUpper;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      
      // 2. Starts with query comes next
      const aStarts = a.symbol.startsWith(queryUpper);
      const bStarts = b.symbol.startsWith(queryUpper);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      
      // 3. Major exchanges preferred
      const aIsMajor = majorExchanges.includes(a.exchange);
      const bIsMajor = majorExchanges.includes(b.exchange);
      if (aIsMajor && !bIsMajor) return -1;
      if (!aIsMajor && bIsMajor) return 1;
      
      // 4. Alphabetically
      return a.symbol.localeCompare(b.symbol);
    });

    // Limit to top 40 results
    results = results.slice(0, 40);

    return c.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      500
    );
  }
});

export default marketDataRoute;
