/**
 * Self-running tests for chartLevels — the shared level path for the chart and Atlas.
 * Run: npx tsx apps/backend/src/lib/__tests__/chartLevels.test.ts
 *  or: npm test chartLevels   (from apps/backend)
 */

import assert from 'node:assert/strict';
import {
  computeChartLevels,
  levelsFromIndicators,
  pickTradeLevel,
  withReferencedLevels,
  LEVEL_WINDOW_BARS,
} from '../chartLevels.js';
import { calculateAllIndicators, type MarketDataPoint } from '../technicalCalculator.js';
import type { ScoredLevel } from '../confluenceScorer.js';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/** Deterministic wavy uptrend: swings both above and below the last close. */
function syntheticBars(n: number): MarketDataPoint[] {
  const bars: MarketDataPoint[] = [];
  const start = Date.UTC(2026, 5, 1);
  for (let i = 0; i < n; i++) {
    const base = 300 + i * 0.35 + 14 * Math.sin(i / 6) + 5 * Math.sin(i / 2.3);
    const close = base + 1.2 * Math.sin(i * 1.7);
    const open = base - 1.2 * Math.sin(i * 1.7);
    bars.push({
      timestamp: start + i * 86_400_000,
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      open,
      high: Math.max(open, close) + 2 + Math.abs(Math.sin(i)),
      low: Math.min(open, close) - 2 - Math.abs(Math.cos(i)),
      close,
      volume: 1_000_000 + 250_000 * Math.sin(i / 3),
    });
  }
  return bars;
}

const ids = (ls: ScoredLevel[]) => ls.map((l) => `${l.id}@${l.price.toFixed(4)}`);

console.log('chartLevels');

test('support is below price and resistance above (display and expanded)', () => {
  const r = computeChartLevels('TEST', '3mo', syntheticBars(140));
  assert.ok(r, 'expected levels');
  assert.ok(r.supportLevels.length + r.resistanceLevels.length > 0, 'expected at least one level');
  for (const l of [...r.supportLevels, ...r.allSupportLevels]) assert.ok(l.price <= r.currentPrice, `support ${l.price} above ${r.currentPrice}`);
  for (const l of [...r.resistanceLevels, ...r.allResistanceLevels]) assert.ok(l.price >= r.currentPrice, `resistance ${l.price} below ${r.currentPrice}`);
});

test('uses only the last LEVEL_WINDOW_BARS bars, like Atlas', () => {
  const bars = syntheticBars(250);
  const r = computeChartLevels('TEST', '3mo', bars);
  assert.ok(r);
  assert.equal(r.barsUsed, LEVEL_WINDOW_BARS);
  assert.equal(r.asOfTimestamp, bars[bars.length - 1].timestamp);
});

test('same bars give the same ids and prices as the Atlas path, whatever the regime', () => {
  const bars = syntheticBars(140).slice(-LEVEL_WINDOW_BARS);
  const chart = computeChartLevels('TEST', '3mo', bars);
  assert.ok(chart);
  for (const regime of [undefined, 'risk_on', 'neutral', 'factor_breakdown', 'unavailable'] as const) {
    const ind = calculateAllIndicators(bars, 'TEST', '3mo', regime);
    assert.ok(ind);
    const atlas = levelsFromIndicators(ind);
    assert.deepEqual(ids(atlas.scoredAnalysis.displayLevels.support), ids(chart.supportLevels), `support differs (${regime})`);
    assert.deepEqual(ids(atlas.scoredAnalysis.displayLevels.resistance), ids(chart.resistanceLevels), `resistance differs (${regime})`);
    assert.deepEqual(ids(atlas.expanded.support), ids(chart.allSupportLevels));
    assert.deepEqual(ids(atlas.expanded.resistance), ids(chart.allResistanceLevels));
  }
});

const lvl = (id: string, price: number): ScoredLevel =>
  ({ id, price, type: 'support' } as unknown as ScoredLevel);

test('pickTradeLevel prefers the highest-ranked level that is drawn', () => {
  const ranked = [lvl('a', 90), lvl('b', 95), lvl('c', 97)];
  assert.equal(pickTradeLevel(ranked, [lvl('c', 97), lvl('b', 95)])?.id, 'b');
  assert.equal(pickTradeLevel(ranked, [])?.id, 'a');
  assert.equal(pickTradeLevel([], [lvl('b', 95)]), undefined);
});

test('withReferencedLevels adds missing referenced levels once, sorted by price', () => {
  const out = withReferencedLevels([lvl('b', 95)], [lvl('a', 90), lvl('b', 95), undefined, lvl('a', 90)]);
  assert.deepEqual(out.map((l) => l.id), ['a', 'b']);
});

console.log(`\n${passed} passed`);
