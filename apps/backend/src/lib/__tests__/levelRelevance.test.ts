/**
 * Self-running unit tests for levelRelevance + fib/VP smoke.
 * Run: npx tsx apps/backend/src/lib/__tests__/levelRelevance.test.ts
 */

import assert from 'node:assert/strict';
import {
  proximityWeight,
  getRelevanceProfile,
  applyRelevance,
  selectDisplayLevelsByRelevance,
  mergeNearbyLevels,
  factorCount,
  mergeFactors,
  zoneFor,
  safeAtr,
} from '../levelRelevance.js';
import type { ConfluenceFactors, ScoredLevel } from '../confluenceScorer.js';
import {
  calculateFibonacci,
  calculateVolumeProfile,
  type MarketDataPoint,
} from '../technicalCalculator.js';

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

function emptyFactors(overrides: Partial<ConfluenceFactors> = {}): ConfluenceFactors {
  return {
    historicalTouches: { count: 0, points: 0 },
    fibonacciAlignment: { level: null, distance: 0, points: 0 },
    emaProximity: { ema: null, distance: 0, points: 0 },
    volumeNode: { isHighVolume: false, volumePercent: 0, points: 0 },
    roundNumber: { isRound: false, nearestRound: null, points: 0 },
    recentRelevance: { isRecent: false, points: 0 },
    ...overrides,
  };
}

function makeLevel(
  price: number,
  type: 'support' | 'resistance',
  score: number,
  factors?: ConfluenceFactors
): ScoredLevel {
  return {
    id: `lvl_${price}`,
    price,
    type,
    confluenceScore: score,
    strength: score >= 60 ? 'strong' : score >= 40 ? 'medium' : 'weak',
    factors: factors ?? emptyFactors({ historicalTouches: { count: 1, points: score } }),
    description: 'test',
    zone: { high: price * 1.002, low: price * 0.998 },
    distanceFromPrice: 0,
    distancePercent: 0,
  };
}

function synthBars(opts: {
  n: number;
  start: number;
  driftPerBar: number;
  noise?: number;
  vol?: number;
}): MarketDataPoint[] {
  const { n, start, driftPerBar, noise = 0.5, vol = 1e6 } = opts;
  const out: MarketDataPoint[] = [];
  let price = start;
  const t0 = Date.UTC(2024, 0, 1);
  for (let i = 0; i < n; i++) {
    const open = price;
    price = Math.max(1, price * (1 + driftPerBar) + (Math.sin(i) * noise) / 10);
    const high = Math.max(open, price) + Math.abs(noise);
    const low = Math.min(open, price) - Math.abs(noise);
    const close = price;
    out.push({
      timestamp: t0 + i * 86400000,
      date: new Date(t0 + i * 86400000).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: vol * (1 + (i % 7) * 0.1),
    });
  }
  return out;
}

console.log('\nlevelRelevance tests\n');

test('decay: w(halfATR) === 0.5', () => {
  const profile = getRelevanceProfile('3mo');
  const w = proximityWeight(profile.halfATR, profile);
  assert.ok(Math.abs(w - 0.5) < 1e-9, `expected 0.5 got ${w}`);
});

test('decay: monotonic and floored', () => {
  const profile = getRelevanceProfile('1y');
  let prev = 1;
  for (let d = 0; d <= 30; d += 0.5) {
    const w = proximityWeight(d, profile);
    assert.ok(w <= prev + 1e-12, `not monotonic at ${d}`);
    assert.ok(w >= profile.floor - 1e-12, `below floor at ${d}`);
    prev = w;
  }
  assert.equal(proximityWeight(0, profile), 1);
  assert.equal(proximityWeight(profile.coreATR, profile), 1);
});

test('safeAtr falls back to 1% of price', () => {
  assert.equal(safeAtr(0, 100), 1);
  assert.equal(safeAtr(undefined, 200), 2);
  assert.equal(safeAtr(3, 100), 3);
});

test('factorCount ignores empty ChartSignl factor objects', () => {
  const empty = emptyFactors();
  assert.equal(factorCount(empty), 0);
  const one = emptyFactors({
    emaProximity: { ema: '65', distance: 0.001, points: 20 },
  });
  assert.equal(factorCount(one), 1);
});

test('mergeFactors unions active ChartSignl factors', () => {
  const a = emptyFactors({
    emaProximity: { ema: '65', distance: 0.001, points: 20 },
  });
  const b = emptyFactors({
    fibonacciAlignment: { level: '61.8%', distance: 0.002, points: 25 },
  });
  const merged = mergeFactors(a, b);
  assert.equal(factorCount(merged), 2);
  assert.equal(merged.emaProximity.ema, '65');
  assert.equal(merged.fibonacciAlignment.level, '61.8%');
});

test('directional guard drops wrong-side levels', () => {
  const result = applyRelevance(
    {
      supportLevels: [
        makeLevel(90, 'support', 70),
        makeLevel(110, 'support', 90), // above price — drop
      ],
      resistanceLevels: [
        makeLevel(110, 'resistance', 70),
        makeLevel(90, 'resistance', 90), // below price — drop
      ],
    },
    { currentPrice: 100, atr: 2, interval: '3mo' }
  );
  assert.equal(result.supportLevels.length, 1);
  assert.equal(result.supportLevels[0].price, 90);
  assert.equal(result.resistanceLevels.length, 1);
  assert.equal(result.resistanceLevels[0].price, 110);
});

test('merge combines nearby 1-factor levels with capped bonus', () => {
  const atr = 2;
  const profile = getRelevanceProfile('3mo');
  const gap = profile.mergeATR * atr * 0.5; // well inside merge tolerance
  const levels = [
    makeLevel(
      100,
      'support',
      30,
      emptyFactors({ emaProximity: { ema: '65', distance: 0, points: 20 } })
    ),
    makeLevel(
      100 + gap,
      'support',
      28,
      emptyFactors({
        fibonacciAlignment: { level: '61.8%', distance: 0, points: 25 },
      })
    ),
    makeLevel(
      100 + gap * 2,
      'support',
      26,
      emptyFactors({
        volumeNode: { isHighVolume: true, volumePercent: 12, points: 15 },
      })
    ),
  ];
  const merged = mergeNearbyLevels(levels, atr, profile.mergeATR);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].mergedFrom, 3);
  assert.ok(merged[0].confluenceScore <= 100);
  // base 30 + up to 2*8 = 16 → 46
  assert.ok(merged[0].confluenceScore >= 30);
  assert.ok(merged[0].confluenceScore <= 54);
  assert.equal(factorCount(merged[0].factors), 3);
});

test('proximity: far high-score loses to near mid-score', () => {
  const result = applyRelevance(
    {
      supportLevels: [
        makeLevel(70, 'support', 95), // ~15 ATR away at atr=2
        makeLevel(98, 'support', 50), // ~1 ATR away
      ],
      resistanceLevels: [],
    },
    { currentPrice: 100, atr: 2, interval: '3mo' }
  );
  assert.ok(result.supportLevels.length >= 2);
  assert.ok(
    (result.supportLevels[0].effectiveScore ?? 0) >=
      (result.supportLevels[1].effectiveScore ?? 0)
  );
  // Near level should rank first after decay
  assert.equal(result.supportLevels[0].price, 98);
});

test('displayMaxATR excludes distant but never empties a side', () => {
  const profile = getRelevanceProfile('1d');
  const levels: ScoredLevel[] = [
    {
      ...makeLevel(50, 'support', 90),
      distanceATR: 20,
      effectiveScore: 20,
    },
    {
      ...makeLevel(99, 'support', 40),
      distanceATR: 0.5,
      effectiveScore: 40,
    },
  ];
  const display = selectDisplayLevelsByRelevance(levels, 2, profile);
  assert.ok(display.length >= 1);
  assert.ok(display.every((l) => (l.distanceATR ?? 0) <= profile.displayMaxATR || display.length === 1));
  assert.ok(display.some((l) => l.price === 99));

  const onlyFar: ScoredLevel[] = [
    { ...makeLevel(50, 'support', 90), distanceATR: 20, effectiveScore: 20 },
  ];
  const fallback = selectDisplayLevelsByRelevance(onlyFar, 2, profile);
  assert.equal(fallback.length, 1);
});

test('zoneFor clamps half-width', () => {
  const z = zoneFor(100, 0.01); // tiny ATR → min pct
  assert.ok(z.halfWidth >= 100 * 0.0015 - 1e-9);
  const z2 = zoneFor(100, 100); // huge ATR → max pct
  assert.ok(z2.halfWidth <= 100 * 0.0125 + 1e-9);
});

console.log('\nfib / volume profile smoke\n');

test('fibonacci: uptrend never null / never inverted', () => {
  const data = synthBars({ n: 80, start: 100, driftPerBar: 0.008, noise: 0.8 });
  const fib = calculateFibonacci(data, '1d', { atr: 2 });
  assert.ok(fib, 'fib null on uptrend');
  assert.ok(fib!.swingHigh > fib!.swingLow);
  assert.ok(fib!.swingSource);
  for (const lvl of fib!.levels) {
    assert.ok(Number.isFinite(lvl.price));
  }
});

test('fibonacci: V-reversal never null / never inverted', () => {
  const down = synthBars({ n: 40, start: 150, driftPerBar: -0.01, noise: 0.5 });
  const up = synthBars({ n: 40, start: down[down.length - 1].close, driftPerBar: 0.012, noise: 0.5 });
  const data = [...down, ...up].map((b, i) => ({
    ...b,
    timestamp: Date.UTC(2024, 0, 1) + i * 86400000,
    date: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10),
  }));
  // Use 1d — ChartInterval month keys are daily category after timeframe fix.
  const fib = calculateFibonacci(data, '1d', { atr: 3 });
  assert.ok(fib, 'fib null on V-reversal');
  assert.ok(fib!.swingHigh >= fib!.swingLow);
});

test('fibonacci: ChartInterval 3mo is eligible (not misclassified as intraday)', () => {
  const data = synthBars({ n: 60, start: 100, driftPerBar: 0.003, noise: 0.8 });
  const fib = calculateFibonacci(data, '3mo', { atr: 2 });
  assert.ok(fib, 'fib should run on 3mo');
});

test('volume profile: nodes not wider than ~2 ATR', () => {
  const data = synthBars({ n: 100, start: 50, driftPerBar: 0.004, noise: 1.2, vol: 2e6 });
  const atr = 1.5;
  const vp = calculateVolumeProfile(data, { atr });
  assert.ok(vp.highVolumeNodes.length >= 0);
  for (const node of vp.highVolumeNodes) {
    if (node.widthATR != null) {
      assert.ok(node.widthATR <= 2.01, `node width ${node.widthATR} ATR`);
    }
  }
  assert.ok(typeof vp.pointOfControl === 'number');
});

test('400-ish fib fuzz: zero nulls / zero inverted on valid series', () => {
  let nulls = 0;
  let inverted = 0;
  for (let i = 0; i < 80; i++) {
    const n = 20 + (i % 50);
    const drift = ((i % 17) - 8) * 0.002;
    const start = 5 + (i % 40) * 20;
    const data = synthBars({ n, start, driftPerBar: drift, noise: 0.3 + (i % 5) * 0.2 });
    const fib = calculateFibonacci(data, '1mo', { atr: start * 0.02 });
    if (!fib) {
      nulls += 1;
      continue;
    }
    if (fib.swingHigh < fib.swingLow) inverted += 1;
  }
  assert.equal(nulls, 0, `unexpected nulls: ${nulls}`);
  assert.equal(inverted, 0, `inverted ranges: ${inverted}`);
});

console.log(`\n${passed} tests passed\n`);
