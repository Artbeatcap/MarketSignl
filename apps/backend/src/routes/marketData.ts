import { Hono } from 'hono';
import type { MarketDataPoint } from '@chartsignl/core';

const marketDataRoute = new Hono();

// Massive.com configuration
const MASSIVE_BASE_URL = 'https://api.massive.com';

// Interval mapping for Massive.com
// Massive uses: minute, hour, day, week, month, quarter, year
// With multipliers like 1, 5, 15 for minutes
const intervalConfig: Record<string, { timespan: string; multiplier: number; daysBack: number }> = {
  '1d': { timespan: 'minute', multiplier: 5, daysBack: 1 },
  '5d': { timespan: 'minute', multiplier: 30, daysBack: 5 },
  '1mo': { timespan: 'hour', multiplier: 1, daysBack: 30 },
  '3mo': { timespan: 'day', multiplier: 1, daysBack: 90 },
  '6mo': { timespan: 'day', multiplier: 1, daysBack: 180 },
  '1y': { timespan: 'day', multiplier: 1, daysBack: 365 },
  '2y': { timespan: 'week', multiplier: 1, daysBack: 730 },
  '5y': { timespan: 'week', multiplier: 1, daysBack: 1825 },
};

// Format date as YYYY-MM-DD for Massive
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// GET /api/market-data/:symbol
marketDataRoute.get('/:symbol', async (c) => {
  const symbol = c.req.param('symbol');
  
  try {
    // Read API key from environment with fallback support
    const key = (process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || process.env.AICHARTS_POLYGON_KEY || '').trim();
    
    // Diagnostic logging (before error check)
    console.warn('[marketData] polygonKeyPresent=', Boolean(key), 'len=', key.length);
    console.log('[ROUTE] Market data route hit for symbol:', symbol, 'API key available:', !!key);
    
    const symbolUpper = c.req.param('symbol').toUpperCase();
    const chartInterval = c.req.query('interval') || '3mo';
    
    if (!key || key === '') {
      console.error('[ROUTE ERROR] API key is not set or empty');
      return c.json({ 
        error: 'Massive API key not configured. Please set MASSIVE_API_KEY in apps/backend/.env file.',
        details: 'Get your free API key at https://massive.com'
      }, 500);
    }

    const config = intervalConfig[chartInterval] || intervalConfig['3mo'];

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - config.daysBack);

    // Build Massive URL
    // Format: /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
    const url = `${MASSIVE_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(symbolUpper)}/range/${config.multiplier}/${config.timespan}/${formatDate(startDate)}/${formatDate(endDate)}?adjusted=true&sort=asc&limit=5000&apiKey=${key}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Massive API error:', response.status, errorData);
      
      if (response.status === 403) {
        return c.json({ error: 'API rate limit exceeded. Please try again later.' }, 429);
      }
      if (response.status === 404) {
        return c.json({ error: 'Symbol not found' }, 404);
      }
      return c.json({ error: 'Failed to fetch market data' }, 500);
    }

    const json = await response.json() as any;

    if (json.status === 'ERROR' || json.status === 'NOT_FOUND') {
      return c.json({ error: json.error || 'Symbol not found' }, 404);
    }

    if (!json.results || json.results.length === 0) {
      return c.json({ error: 'No data available for this symbol' }, 404);
    }

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
    const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY || '';
    const query = c.req.param('query');

    if (!MASSIVE_API_KEY) {
      return c.json({ error: 'Massive API key not configured' }, 500);
    }

    // Filter for stocks market only and limit to 50 results for better filtering
    const url = `${MASSIVE_BASE_URL}/v3/reference/tickers?search=${encodeURIComponent(query)}&market=stocks&active=true&limit=50&apiKey=${MASSIVE_API_KEY}`;

    const response = await fetch(url);

    if (!response.ok) {
      return c.json({ error: 'Search failed' }, 500);
    }

    const json = await response.json() as any;

    // Filter results to prioritize major US exchanges (NASDAQ, NYSE, ARCA)
    // and exclude OTC, pink sheets, and other minor exchanges
    const majorExchanges = ['XNAS', 'XNYS', 'ARCX', 'BATS'];
    const excludeOTC = ['OTCM', 'PINK', 'OTCB', 'OTCQ', 'OTCX'];
    
    let results = (json.results || [])
      .filter((ticker: any) => {
        // Exclude OTC and pink sheets
        if (excludeOTC.includes(ticker.primary_exchange)) {
          return false;
        }
        // Only include common stocks and ETFs
        return ticker.type === 'CS' || ticker.type === 'ETF' || ticker.type === 'ADRC';
      })
      .map((ticker: any) => ({
        symbol: ticker.ticker,
        name: ticker.name,
        type: ticker.type,
        market: ticker.market,
        exchange: ticker.primary_exchange,
      }));

    // Sort: Major exchanges first, then alphabetically
    results.sort((a: any, b: any) => {
      const aIsMajor = majorExchanges.includes(a.exchange);
      const bIsMajor = majorExchanges.includes(b.exchange);
      
      if (aIsMajor && !bIsMajor) return -1;
      if (!aIsMajor && bIsMajor) return 1;
      
      return a.symbol.localeCompare(b.symbol);
    });

    // Limit to top 20 results
    results = results.slice(0, 20);

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
