import { Hono } from 'hono';
import { computeChartLevels, type ChartLevelsResult } from '../lib/chartLevels.js';
import { barsForAnalysis } from '../lib/marketBars.js';

/**
 * POST /api/levels — support/resistance for the chart before Atlas runs.
 *
 * No OpenAI call and no usage counted, so it is open to guests and signed-in
 * users alike. Uses the same level function as Atlas (lib/chartLevels.ts) on
 * bars the server fetches itself (lib/marketBars.ts), the same bars Atlas
 * gets. The request needs only { symbol, interval }.
 */
const levelsRoute = new Hono();

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, { at: number; value: ChartLevelsResult }>();

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

  let loaded: Awaited<ReturnType<typeof barsForAnalysis>>;
  try {
    loaded = await barsForAnalysis(body, 'Levels');
  } catch (error) {
    console.error('[Levels] Failed to load bars:', error);
    return c.json({ success: false, error: 'Failed to load price data' }, 502);
  }
  if (!loaded.ok) {
    return c.json({ success: false, error: loaded.error }, loaded.status);
  }
  const { symbol, interval, bars } = loaded;

  // Same bars give the same levels, so key on what identifies the bar set.
  const last = bars[bars.length - 1];
  const key = `${symbol}|${interval}|${bars.length}|${last.timestamp}|${last.close}`;
  const cached = readCache(key);
  if (cached) return c.json({ success: true, levels: cached });

  try {
    const levels = computeChartLevels(symbol, interval, bars);
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
