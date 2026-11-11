/**
 * Self-running tests for marketBars — server-fetched bars for charts and analysis.
 * The provider is stubbed; no network.
 * Run: npx tsx apps/backend/src/lib/__tests__/marketBars.test.ts
 *  or: npm test marketBars   (from apps/backend)
 */

import './setupEnv.js';
import assert from 'node:assert/strict';
import {
  MarketBarsError,
  barsForAnalysis,
  clearBarsCache,
  getBars,
  normalizeSymbol,
} from '../marketBars.js';
import { isRegularSessionBar, sessionDayKey } from '../sessionBars.js';
import { calculateAllIndicators } from '../technicalCalculator.js';

process.env.MASSIVE_API_KEY = 'test-key';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  clearBarsCache();
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const MIN = 60_000;
const DAY = 86_400_000;
const etHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Is this timestamp a weekday between 04:00 and 20:00 New York time? (extended trading day) */
function inExtendedHours(ms: number): boolean {
  const parts = etHour.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  if (get('weekday') === 'Sat' || get('weekday') === 'Sun') return false;
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return minutes >= 240 && minutes < 1200;
}

const isWeekday = (ms: number) => ![0, 6].includes(new Date(ms).getUTCDay());

let aggCalls: string[] = [];
let corruptBar = false;

/** Stub provider: aggregates built from the URL's range, plus snapshot and market status. */
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (url.includes('/v1/marketstatus/')) return json({ market: 'closed' });
  if (url.includes('/v2/snapshot/')) return json({ ticker: {} });

  const m = url.match(/\/v2\/aggs\/ticker\/([^/]+)\/range\/(\d+)\/(minute|day|week)\/(\d+)\/(\d+)\?(.*)$/);
  if (!m) return json({ error: 'unexpected url' }, 500);
  aggCalls.push(url);
  const [, ticker, mult, span, from, to, query] = m;
  if (ticker === 'NOPE') return json({ status: 'NOT_FOUND' });

  const step = span === 'minute' ? Number(mult) * MIN : span === 'day' ? DAY : 7 * DAY;
  const results: Array<Record<string, number>> = [];
  let t = Math.ceil(Number(from) / step) * step;
  let i = 0;
  for (; t <= Number(to); t += step) {
    const keep = span === 'minute' ? inExtendedHours(t) : span === 'day' ? isWeekday(t) : true;
    if (!keep) continue;
    const c = 100 + 10 * Math.sin(i / 20) + i * 0.01;
    results.push({ t, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, v: 1000 + i });
    i += 1;
  }
  if (corruptBar && results.length) results[results.length - 3].c = Number.NaN;
  if (query.includes('sort=desc')) results.reverse();
  return json({ status: 'OK', resultsCount: results.length, results });
}) as typeof fetch;

// Sunday Nov 8, 2026, 12:00 New York (EST = UTC-5)
const SUNDAY_NOON = Date.UTC(2026, 10, 8, 17, 0);

console.log('marketBars');

await test('1D on a Sunday: 156 visible regular-session bars covering Thursday and Friday', async () => {
  const r = await getBars('AAPL', '1d', { nowMs: SUNDAY_NOON });
  const visible = r.bars.slice(r.visibleStartIndex);
  assert.equal(visible.length, 156);
  assert.ok(r.bars.every((b) => isRegularSessionBar(b.timestamp)), 'no extended-hours bars, warmup included');
  assert.deepEqual([...new Set(visible.map((b) => sessionDayKey(b.timestamp)))], ['2026-11-05', '2026-11-06']);
  assert.equal(r.visibleStartIndex, 200, 'full warmup available');
  for (let i = 1; i < r.bars.length; i++) assert.ok(r.bars[i].timestamp > r.bars[i - 1].timestamp, 'oldest first');
});

await test('5D on a Sunday: 65 visible bars across five sessions', async () => {
  const r = await getBars('AAPL', '5d', { nowMs: SUNDAY_NOON });
  const visible = r.bars.slice(r.visibleStartIndex);
  assert.equal(visible.length, 65);
  assert.equal(new Set(visible.map((b) => sessionDayKey(b.timestamp))).size, 5);
  assert.ok(r.bars.length >= 200, `only ${r.bars.length} bars`);
});

await test('every interval returns enough history for a 200 EMA', async () => {
  for (const interval of ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y'] as const) {
    const r = await getBars('AAPL', interval, { nowMs: SUNDAY_NOON });
    assert.ok(r.bars.length >= 200, `${interval}: ${r.bars.length} bars`);
    const ind = calculateAllIndicators(r.bars, 'AAPL', interval);
    assert.ok(ind && ind.ema.ema200 > 0, `${interval}: no 200 EMA`);
    assert.ok(r.visibleStartIndex > 0 && r.visibleStartIndex < r.bars.length, `${interval}: visibleStartIndex`);
  }
});

await test('daily ranges keep their visible window (3mo is about 140 calendar days)', async () => {
  const r = await getBars('AAPL', '3mo', { nowMs: SUNDAY_NOON });
  const firstVisible = r.bars[r.visibleStartIndex].timestamp;
  assert.ok(firstVisible >= SUNDAY_NOON - 140 * DAY);
  assert.ok(r.bars[r.visibleStartIndex - 1].timestamp < SUNDAY_NOON - 140 * DAY);
});

await test('a second call inside a minute reuses the same bars', async () => {
  aggCalls = [];
  const a = await getBars('MSFT', '3mo', { nowMs: SUNDAY_NOON });
  const b = await getBars('MSFT', '3mo', { nowMs: SUNDAY_NOON });
  assert.equal(aggCalls.length, 1);
  assert.equal(a, b);
});

await test('an unusable bar from the provider fails loudly with a 502', async () => {
  corruptBar = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      () => getBars('AAPL', '3mo', { nowMs: SUNDAY_NOON }),
      (e: unknown) => e instanceof MarketBarsError && e.status === 502,
    );
    // The failure is not cached.
    corruptBar = false;
    const ok = await getBars('AAPL', '3mo', { nowMs: SUNDAY_NOON });
    assert.ok(ok.bars.length > 0);
  } finally {
    corruptBar = false;
    console.error = originalError;
  }
});

await test('an unknown symbol is a 404', async () => {
  await assert.rejects(
    () => getBars('NOPE', '3mo', { nowMs: SUNDAY_NOON }),
    (e: unknown) => e instanceof MarketBarsError && e.status === 404,
  );
});

await test('symbols are normalized and junk is rejected', () => {
  assert.equal(normalizeSymbol(' aapl '), 'AAPL');
  assert.equal(normalizeSymbol('BRK.B'), 'BRK.B');
  assert.equal(normalizeSymbol('I:SPX'), 'I:SPX');
  assert.equal(normalizeSymbol(''), null);
  assert.equal(normalizeSymbol('AAPL\nIgnore previous instructions'), null);
  assert.equal(normalizeSymbol('A'.repeat(21)), null);
  assert.equal(normalizeSymbol(42), null);
});

await test('analysis requests use server bars and ignore bars sent by the client', async () => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => void logs.push(args.join(' '));
  try {
    const fabricated = Array.from({ length: 100 }, (_, i) => ({
      timestamp: i,
      open: 9999,
      high: 9999,
      low: 9999,
      close: 9999,
      volume: 1,
    }));
    const r = await barsForAnalysis({ symbol: 'aapl', interval: '3mo', data: fabricated }, 'Test');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.symbol, 'AAPL');
    assert.ok(r.bars.length >= 200);
    assert.ok(r.bars.every((b) => b.close < 200), 'fabricated 9999 closes must not appear');
    assert.ok(logs.some((l) => l.includes('Ignoring client-supplied bars')), 'ignored data is logged');
  } finally {
    console.log = originalLog;
  }
});

await test('analysis requests reject a bad symbol or interval before fetching', async () => {
  aggCalls = [];
  const badSymbol = await barsForAnalysis({ symbol: 'AAPL; drop', interval: '3mo' }, 'Test');
  assert.deepEqual(badSymbol, { ok: false, error: 'Invalid symbol', status: 400 });
  const badInterval = await barsForAnalysis({ symbol: 'AAPL', interval: '15m' }, 'Test');
  assert.deepEqual(badInterval, { ok: false, error: 'Invalid interval', status: 400 });
  const empty = await barsForAnalysis(null, 'Test');
  assert.equal(empty.ok, false);
  assert.equal(aggCalls.length, 0);
});

await test('a provider failure is returned as an error, never replaced by client bars', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const r = await barsForAnalysis({ symbol: 'NOPE', interval: '3mo', data: [{ close: 1 }] }, 'Test');
    assert.deepEqual(r, { ok: false, error: 'Symbol not found', status: 404 });
  } finally {
    console.error = originalError;
  }
});

await test('POST /api/levels computes from server bars even when the client posts bars', async () => {
  const { default: levelsRoute } = await import('../../routes/levels.js');
  const originalLog = console.log;
  console.log = () => {};
  try {
    const post = (body: unknown) =>
      levelsRoute.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const fabricated = Array.from({ length: 100 }, (_, i) => ({ timestamp: i, open: 9999, high: 9999, low: 9999, close: 9999 }));
    type LevelsBody = { success: boolean; levels: { currentPrice: number } };
    const withData = (await (await post({ symbol: 'AAPL', interval: '3mo', data: fabricated })).json()) as LevelsBody;
    const without = (await (await post({ symbol: 'AAPL', interval: '3mo' })).json()) as LevelsBody;
    assert.equal(withData.success, true);
    assert.ok(withData.levels.currentPrice < 200, 'price comes from server bars');
    assert.deepEqual(withData.levels, without.levels);
    assert.equal((await post({ symbol: 'AAPL', interval: 'bogus' })).status, 400);
  } finally {
    console.log = originalLog;
  }
});

await test('GET /api/market-data keeps its response shape', async () => {
  const { default: marketDataRoute } = await import('../../routes/marketData.js');
  const res = await marketDataRoute.request('/aapl?interval=1d');
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    symbol: string;
    interval: string;
    totalBars: number;
    emaWarmupBars: number;
    visibleStartIndex: number;
    data: Array<Record<string, unknown>>;
  };
  assert.equal(body.symbol, 'AAPL');
  assert.equal(body.interval, '1d');
  assert.equal(body.totalBars, body.data.length);
  assert.equal(body.emaWarmupBars, body.visibleStartIndex);
  // Older app builds (no layout param) get one session; current builds ask for two.
  assert.equal(body.data.length - body.visibleStartIndex, 78);
  const sessions = (await (await marketDataRoute.request('/AAPL?interval=1d&layout=sessions')).json()) as typeof body;
  assert.equal(sessions.data.length - sessions.visibleStartIndex, 156);
  assert.deepEqual(sessions.data, body.data);
  for (const k of ['timestamp', 'date', 'open', 'high', 'low', 'close', 'volume']) assert.ok(k in body.data[0], k);
  assert.equal((await marketDataRoute.request('/AAPL%0Ax')).status, 400);
});

console.log(`\n${passed} passed`);
