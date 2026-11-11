/**
 * Self-running tests for the 2026-11-09 analysis-engine fixes:
 * trend on full history, missing EMAs, the stretched-decline guard, and
 * classifying chart ranges by bar size.
 * Run: npx tsx apps/backend/src/lib/__tests__/analysisEngine.test.ts
 *  or: npm test analysisEngine   (from apps/backend)
 */

import './setupEnv.js';
process.env.OPENAI_API_KEY ||= 'test-key'; // the OpenAI client is constructed on import; no call is made
import assert from 'node:assert/strict';
import {
  calculateAllIndicators,
  classifyTrendState,
  type EMAData,
  type MarketDataPoint,
} from '../technicalCalculator.js';
import {
  LEVEL_WINDOW_BARS,
  getSwingBars,
  getTimeframeCategory,
  isFibonacciTimeframe,
} from '../analysisConstants.js';
import { computeChartLevels, levelsFromIndicators } from '../chartLevels.js';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/** Deterministic daily bars: steady drift per bar plus a small wave. */
function drift(n: number, start: number, perBar: number): MarketDataPoint[] {
  const bars: MarketDataPoint[] = [];
  const t0 = Date.UTC(2025, 0, 1);
  let price = start;
  for (let i = 0; i < n; i++) {
    const open = price;
    price = price * (1 + perBar + 0.004 * Math.sin(i / 3));
    bars.push({
      timestamp: t0 + i * 86_400_000,
      date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
      open,
      high: Math.max(open, price) * 1.004,
      low: Math.min(open, price) * 0.996,
      close: price,
      volume: 1_000_000 + 200_000 * Math.sin(i / 5),
    });
  }
  return bars;
}

/** Append `count` bars that each close `pct` lower than the one before. */
function withCrash(bars: MarketDataPoint[], count: number, pct: number): MarketDataPoint[] {
  const out = [...bars];
  for (let i = 0; i < count; i++) {
    const prev = out[out.length - 1];
    const close = prev.close * (1 - pct);
    out.push({
      timestamp: prev.timestamp + 86_400_000,
      date: new Date(prev.timestamp + 86_400_000).toISOString().slice(0, 10),
      open: prev.close,
      high: prev.close * 1.002,
      low: close * 0.998,
      close,
      volume: 2_000_000,
    });
  }
  return out;
}

const emaData = (e: Partial<EMAData>): EMAData => ({
  ema9: 0,
  ema21: 0,
  ema65: 0,
  ema100: 0,
  ema200: 0,
  values: [],
  ...e,
});

console.log('analysisEngine');

await test('a steady decline on full history is a downtrend with a short bias', () => {
  const ind = calculateAllIndicators(drift(300, 200, -0.004), 'TEST', '1y')!;
  assert.ok(ind.ema.ema200 > 0, '200 EMA should exist with 300 bars');
  assert.equal(ind.trend.direction, 'strong_downtrend');
  assert.equal(ind.trend.tradingBias, 'short');
  assert.ok(ind.currentPrice < ind.ema.ema200);
  assert.ok(!/above/i.test(ind.trend.biasReason), ind.trend.biasReason);
});

await test('the same decline with under 200 bars is still a downtrend, and says the 200 EMA is missing', () => {
  const ind = calculateAllIndicators(drift(300, 200, -0.004).slice(-120), 'TEST', '3mo')!;
  assert.equal(ind.ema.ema200, 0, 'not computed');
  assert.ok(ind.trend.direction.includes('downtrend'), ind.trend.direction);
  assert.equal(ind.trend.tradingBias, 'short');
  assert.ok(ind.trend.biasReason.includes('200 EMA unavailable; using 100 EMA'), ind.trend.biasReason);
  assert.ok(!/above the 200 EMA/i.test(ind.trend.biasReason));
});

await test('a missing EMA is never compared as a price of 0', () => {
  // Price below every EMA that exists; 100 and 200 missing.
  const t = classifyTrendState(50, emaData({ ema9: 55, ema21: 60, ema65: 70 }));
  assert.equal(t.direction, 'strong_downtrend');
  assert.equal(t.emaAlignment, 'perfectly_bearish');
  // Mirror image.
  const u = classifyTrendState(80, emaData({ ema9: 75, ema21: 70, ema65: 60 }));
  assert.equal(u.direction, 'strong_uptrend');
});

await test('every downtrend state is reachable when the 200 EMA is missing', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20000; i++) {
    const r = (k: number) => 50 + ((i * k * 7919) % 1000) / 10;
    seen.add(classifyTrendState(r(1), emaData({ ema9: r(3), ema21: r(5), ema65: r(7), ema100: r(11) })).direction);
  }
  for (const d of ['strong_downtrend', 'downtrend', 'weak_downtrend', 'strong_uptrend', 'uptrend', 'weak_uptrend']) {
    assert.ok(seen.has(d), `${d} unreachable`);
  }
});

await test('with four EMAs, price above three of them and the longest is an uptrend, not ranging', () => {
  const up = classifyTrendState(100, emaData({ ema9: 101, ema21: 99, ema65: 95, ema100: 90 }));
  assert.equal(up.direction, 'uptrend');
  const down = classifyTrendState(100, emaData({ ema9: 99, ema21: 101, ema65: 105, ema100: 110 }));
  assert.equal(down.direction, 'downtrend');
  // Five EMAs keep the original cut-offs: 4 of 5 above is an uptrend, 3 of 5 is not.
  const five = (e9: number, e21: number) =>
    classifyTrendState(100, emaData({ ema9: e9, ema21: e21, ema65: 95, ema100: 90, ema200: 80 })).direction;
  assert.equal(five(101, 99), 'uptrend');
  assert.equal(five(101, 102), 'ranging');
});

await test('no EMAs at all reads as ranging, not as an uptrend', () => {
  const t = classifyTrendState(100, emaData({}));
  assert.equal(t.direction, 'ranging');
  assert.equal(t.tradingBias, 'neutral');
});

await test('a steady rise is an uptrend with a long bias', () => {
  const ind = calculateAllIndicators(drift(300, 100, 0.003), 'TEST', '1y')!;
  assert.equal(ind.trend.direction, 'strong_uptrend');
  assert.equal(ind.trend.tradingBias, 'long');
});

await test('a crash inside a downtrend triggers the guard, not a reversal signal', () => {
  const bars = withCrash(drift(300, 200, -0.003), 8, 0.04);
  const ind = calculateAllIndicators(bars, 'TEST', '1y')!;
  assert.ok(ind.trend.direction.includes('downtrend'), ind.trend.direction);
  assert.notEqual(ind.overextension.status, 'normal');
  assert.equal(ind.overextension.signalType, 'extended_in_downtrend');
  assert.equal(ind.overextension.meanReversionSignal, false);
});

await test('trend uses full history; levels use only the last LEVEL_WINDOW_BARS', () => {
  const bars = drift(400, 100, 0.001);
  const ind = calculateAllIndicators(bars, 'TEST', '1y')!;
  assert.equal(ind.historyBars, 400);
  assert.equal(ind.dataPoints, LEVEL_WINDOW_BARS);
  assert.ok(ind.swingPoints.every((s) => s.barIndex < LEVEL_WINDOW_BARS));
  // Levels depend only on the window plus full-history ATR/EMAs: an old price
  // spike outside the window must not create a level.
  const spiked = bars.map((b, i) => (i === 50 ? { ...b, high: b.high * 3 } : b));
  const spikePrice = spiked[50].high;
  const lv = computeChartLevels('TEST', '1y', spiked)!;
  for (const l of [...lv.allSupportLevels, ...lv.allResistanceLevels]) {
    assert.ok(Math.abs(l.price - spikePrice) / spikePrice > 0.05, `level at old spike ${l.price}`);
  }
});

await test('chart levels and the Atlas path agree on full history', () => {
  const bars = drift(400, 100, 0.001);
  const chart = computeChartLevels('TEST', '1y', bars)!;
  const atlas = levelsFromIndicators(calculateAllIndicators(bars, 'TEST', '1y', 'risk_on')!);
  const ids = (ls: Array<{ id: string; price: number }>) => ls.map((l) => `${l.id}@${l.price}`);
  assert.deepEqual(ids(chart.supportLevels), ids(atlas.scoredAnalysis.displayLevels.support));
  assert.deepEqual(ids(chart.resistanceLevels), ids(atlas.scoredAnalysis.displayLevels.resistance));
  assert.equal(chart.barsUsed, LEVEL_WINDOW_BARS);
  assert.equal(chart.asOfTimestamp, bars[bars.length - 1].timestamp);
});

await test('chart ranges are classified by the bar size they fetch', () => {
  assert.equal(getTimeframeCategory('1d'), 'intraday'); // 5-minute bars
  assert.equal(getTimeframeCategory('5d'), 'intraday'); // 30-minute bars
  for (const k of ['1mo', '3mo', '6mo', '1y']) assert.equal(getTimeframeCategory(k), 'daily', k);
  for (const k of ['2y', '5y']) assert.equal(getTimeframeCategory(k), 'weekly', k);
  assert.equal(isFibonacciTimeframe('1d'), false);
  assert.equal(isFibonacciTimeframe('5d'), false);
  assert.equal(isFibonacciTimeframe('3mo'), true);
  assert.equal(getSwingBars('1y'), 5);
  assert.equal(getSwingBars('1d'), 3);
  assert.equal(getSwingBars('5y'), 8);
});

await test('the Atlas prompt says "unavailable" for a missing EMA and never prints $0.00', async () => {
  const { buildUserPrompt } = await import('../runAtlasAnalysis.js');
  const ind = calculateAllIndicators(drift(60, 100, 0.001), 'TEST', '3mo')!;
  const prompt = buildUserPrompt('TEST', '3mo', ind, levelsFromIndicators(ind).scoredAnalysis);
  assert.ok(prompt.includes('EMA 65: unavailable'), 'EMA 65 line');
  assert.ok(prompt.includes('EMA 200: unavailable'), 'EMA 200 line');
  assert.ok(!prompt.includes('$0.00'), 'no $0.00 in prompt');
  const full = calculateAllIndicators(drift(300, 100, 0.001), 'TEST', '1y')!;
  const fullPrompt = buildUserPrompt('TEST', '1y', full, levelsFromIndicators(full).scoredAnalysis);
  assert.ok(/EMA 200: \$\d/.test(fullPrompt), 'EMA 200 printed with full history');
});

console.log(`\n${passed} passed`);
