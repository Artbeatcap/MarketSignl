import { supabaseAdmin } from './supabase.js';
import { isRealOperatingCompany, type TickerMeta } from './moversFilter.js';

const MASSIVE_BASE_URL = process.env.MASSIVE_BASE_URL?.trim() || 'https://api.massive.com';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 5;

function apiKey(): string | null {
  return process.env.MASSIVE_API_KEY?.trim() || process.env.POLYGON_API_KEY?.trim() || null;
}

interface CachedRow {
  ticker: string;
  name: string;
  type: string;
  market: string;
  active: boolean;
  primary_exchange: string | null;
  market_cap: number | string | null;
  fetched_at: string;
}

function rowToMeta(row: CachedRow): TickerMeta {
  const cap = row.market_cap == null ? null : Number(row.market_cap);
  return {
    ticker: row.ticker,
    name: row.name,
    type: row.type,
    market: row.market,
    active: row.active,
    primaryExchange: row.primary_exchange || '',
    marketCap: Number.isFinite(cap as number) ? (cap as number) : null,
  };
}

async function fetchOne(ticker: string): Promise<TickerMeta | null> {
  const key = apiKey();
  if (!key) return null;
  const url = `${MASSIVE_BASE_URL}/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${encodeURIComponent(key)}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[ticker-meta] lookup HTTP ${resp.status} for ${ticker} — excluding`);
      return null;
    }
    const json = (await resp.json()) as {
      results?: {
        ticker?: string;
        name?: string;
        type?: string;
        market?: string;
        active?: boolean;
        primary_exchange?: string;
        market_cap?: number;
      };
    };
    const row = json.results;
    if (!row) {
      console.warn(`[ticker-meta] empty results for ${ticker} — excluding`);
      return null;
    }
    return {
      ticker: (row.ticker || ticker).toUpperCase(),
      name: row.name || '',
      type: row.type || '',
      market: row.market || '',
      active: row.active !== false,
      primaryExchange: row.primary_exchange || '',
      marketCap: typeof row.market_cap === 'number' ? row.market_cap : null,
    };
  } catch (err) {
    console.warn(`[ticker-meta] lookup error for ${ticker} — excluding`, err);
    return null;
  }
}

async function upsertMeta(meta: TickerMeta): Promise<void> {
  const { error } = await supabaseAdmin.from('ticker_metadata').upsert(
    {
      ticker: meta.ticker,
      name: meta.name,
      type: meta.type,
      market: meta.market,
      active: meta.active,
      primary_exchange: meta.primaryExchange || null,
      market_cap: meta.marketCap,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'ticker' }
  );
  if (error) {
    console.warn(`[ticker-meta] cache upsert failed for ${meta.ticker}: ${error.message}`);
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function getTickerMeta(tickers: string[]): Promise<Map<string, TickerMeta>> {
  const wanted = [...new Set(tickers.map((t) => t.toUpperCase().trim()).filter(Boolean))];
  const result = new Map<string, TickerMeta>();
  if (wanted.length === 0) return result;

  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const { data: cached, error } = await supabaseAdmin
    .from('ticker_metadata')
    .select('ticker, name, type, market, active, primary_exchange, market_cap, fetched_at')
    .in('ticker', wanted)
    .gt('fetched_at', cutoff);

  if (error) {
    console.warn(`[ticker-meta] cache read failed: ${error.message}`);
  }
  for (const row of cached || []) {
    result.set(row.ticker, rowToMeta(row as CachedRow));
  }

  const misses = wanted.filter((t) => !result.has(t));
  if (misses.length === 0) return result;

  if (!apiKey()) {
    return result;
  }

  const fetched = await mapPool(misses, CONCURRENCY, fetchOne);
  for (const meta of fetched) {
    if (!meta) continue;
    result.set(meta.ticker, meta);
    await upsertMeta(meta);
  }
  return result;
}

export async function filterMoversByType<T extends { ticker: string; companyName?: string }>(
  movers: T[]
): Promise<T[]> {
  if (!movers.length) return movers;
  const metaMap = await getTickerMeta(movers.map((m) => m.ticker));
  const kept: T[] = [];
  for (const mover of movers) {
    const ticker = mover.ticker.toUpperCase();
    const meta = metaMap.get(ticker);
    if (meta) {
      if (isRealOperatingCompany(meta)) kept.push(mover);
      continue;
    }
    if (apiKey()) {
      continue;
    }
    const name = mover.companyName || '';
    if (name && !isRealOperatingCompany({
      ticker,
      name,
      type: 'CS',
      market: 'stocks',
      active: true,
      primaryExchange: 'XNAS',
      marketCap: null,
    })) {
      continue;
    }
    kept.push(mover);
  }
  return kept;
}
