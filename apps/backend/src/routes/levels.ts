import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type { MarketDataPoint } from '../lib/technicalCalculator.js';
import { computeChartLevels, LEVEL_WINDOW_BARS, type ChartLevelsResult } from '../lib/chartLevels.js';

/**
 * POST /api/levels — support/resistance for the chart before Atlas runs.
 *
 * No OpenAI call and no usage counted, so it is open to guests and signed-in
 * users alike. Uses the same level function as Atlas (lib/chartLevels.ts).
 * The client sends the same bars it would send to Atlas; we keep the last
 * LEVEL_WINDOW_BARS so the inputs match exactly.
 */
const levelsRoute = new Hono();

const VALID_INTERVALS = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y']);
const MAX_BARS_ACCEPTED = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, { at: number; value: ChartLevelsResult }>();

function isBar(b: unknown): b is MarketDataPoint {
  if (!b || typeof b !== 'object') return false;
  const r = b as Record<string, unknown>;
  return ['timestamp', 'open', 'high', 'low', 'close'].every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k] as number),
  );
}

function readCache(key: string): ChartLevelsResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key: string, value: ChartLevelsResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

levelsRoute.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const { symbol, interval, data } = (body ?? {}) as {
    symbol?: unknown;
    interval?: unknown;
    data?: unknown;
  };

  if (typeof symbol !== 'string' || symbol.length === 0 || symbol.length > 20) {
    return c.json({ success: false, error: 'Invalid symbol' }, 400);
  }
  if (typeof interval !== 'string' || !VALID_INTERVALS.has(interval)) {
    return c.json({ success: false, error: 'Invalid interval' }, 400);
  }
  if (!Array.isArray(data) || data.length === 0 || data.length > MAX_BARS_ACCEPTED) {
    return c.json({ success: false, error: 'Invalid data' }, 400);
  }

  const bars = data.slice(-LEVEL_WINDOW_BARS).map((b) => ({ volume: 0, date: '', ...(b as object) }));
  if (!bars.every(isBar)) {
    return c.json({ success: false, error: 'Invalid bar in data' }, 400);
  }

  const key = createHash('sha256')
    .update(JSON.stringify({ s: symbol.toUpperCase(), i: interval, b: bars }))
    .digest('hex');
  const cached = readCache(key);
  if (cached) return c.json({ success: true, levels: cached });

  try {
    const levels = computeChartLevels(symbol.toUpperCase(), interval, bars as MarketDataPoint[]);
    if (!levels) {
      return c.json({ success: false, error: 'Not enough price history to calculate levels' }, 422);
    }
    writeCache(key, levels);
    return c.json({ success: true, levels });
  } catch (error) {
    console.error('[Levels] Failed to compute levels:', { symbol, interval, error });
    return c.json({ success: false, error: 'Failed to calculate levels' }, 500);
  }
});

export default levelsRoute;
