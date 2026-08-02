/**
 * Synthetic eyeball gate: runs the full indicator + scoring pipeline on
 * scenario shapes that mimic known tickers / regimes.
 * Run: npx tsx apps/backend/src/lib/__tests__/eyeballLevels.ts
 */

import { calculateAllIndicators, type MarketDataPoint } from '../technicalCalculator.js';
import { scoreLevels } from '../confluenceScorer.js';

function bars(opts: {
  n: number;
  start: number;
  drift: number;
  noise: number;
  vol?: number;
}): MarketDataPoint[] {
  const { n, start, drift, noise, vol = 1e6 } = opts;
  const out: MarketDataPoint[] = [];
  let price = start;
  const t0 = Date.UTC(2023, 0, 1);
  for (let i = 0; i < n; i++) {
    const open = price;
    price = Math.max(1, price * (1 + drift) + Math.sin(i / 3) * noise * 0.05);
    const high = Math.max(open, price) + Math.abs(noise);
    const low = Math.min(open, price) - Math.abs(noise) * 0.6;
    out.push({
      timestamp: t0 + i * 86400000,
      date: new Date(t0 + i * 86400000).toISOString().slice(0, 10),
      open,
      high,
      low,
      close: price,
      volume: vol * (1 + ((i * 7) % 11) * 0.08),
    });
  }
  return out;
}

type Scenario = {
  name: string;
  symbol: string;
  interval: string;
  data: MarketDataPoint[];
};

const scenarios: Scenario[] = [
  {
    name: 'NVDA-shaped melt-up',
    symbol: 'NVDA',
    interval: '1y',
    data: bars({ n: 100, start: 120, drift: 0.012, noise: 4 }),
  },
  {
    name: 'Mega-cap grind (AAPL)',
    symbol: 'AAPL',
    interval: '3mo',
    data: bars({ n: 65, start: 180, drift: 0.002, noise: 1.5 }),
  },
  {
    name: 'Volatile small-cap',
    symbol: 'SOFI',
    interval: '1mo',
    data: bars({ n: 45, start: 8, drift: 0.004, noise: 0.35 }),
  },
  {
    name: 'Index ETF quiet (SPY)',
    symbol: 'SPY',
    interval: '1d',
    data: bars({ n: 78, start: 500, drift: 0.001, noise: 2 }),
  },
  {
    name: 'Mid downtrend',
    symbol: 'BA',
    interval: '1y',
    data: bars({ n: 100, start: 220, drift: -0.006, noise: 3 }),
  },
  {
    name: 'Choppy range',
    symbol: 'XOM',
    interval: '3mo',
    data: bars({ n: 65, start: 110, drift: 0.0002, noise: 2.5 }),
  },
  {
    name: 'V-reversal',
    symbol: 'TSLA',
    interval: '6mo',
    data: [
      ...bars({ n: 40, start: 280, drift: -0.015, noise: 5 }),
      ...bars({ n: 40, start: 160, drift: 0.018, noise: 5 }),
    ].map((b, i) => ({
      ...b,
      timestamp: Date.UTC(2023, 0, 1) + i * 86400000,
      date: new Date(Date.UTC(2023, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    })),
  },
  {
    name: '1d intraday-ish daily',
    symbol: 'MSFT',
    interval: '1d',
    data: bars({ n: 78, start: 420, drift: 0.0015, noise: 3 }),
  },
];

function summarizeSide(levels: ReturnType<typeof scoreLevels>['supportLevels']) {
  return levels.map((l) => ({
    price: +l.price.toFixed(2),
    conf: l.confluenceScore,
    eff: l.effectiveScore,
    atr: l.distanceATR,
    merged: l.mergedFrom ?? 1,
    label: l.proximityLabel,
    factors: l.factorCount,
  }));
}

let warnings = 0;

for (const s of scenarios) {
  const indicators = calculateAllIndicators(s.data, s.symbol, s.interval);
  if (!indicators) {
    console.error(`FAIL ${s.name}: indicators null`);
    warnings += 1;
    continue;
  }
  const scored = scoreLevels(indicators);
  const supportMerged = scored.supportLevels.map((l) => l.mergedFrom ?? 1);
  const resistMerged = scored.resistanceLevels.map((l) => l.mergedFrom ?? 1);
  const allMerged = [...supportMerged, ...resistMerged];
  const avgMerged =
    allMerged.length === 0
      ? 0
      : allMerged.reduce((a, b) => a + b, 0) / allMerged.length;
  const maxMerged = allMerged.length ? Math.max(...allMerged) : 0;

  if (scored.displayLevels.support.length === 0 && scored.displayLevels.resistance.length === 0) {
    console.warn(`WARN ${s.name}: empty both sides`);
    warnings += 1;
  }
  if (maxMerged >= 5) {
    console.warn(`WARN ${s.name}: mergedFrom max=${maxMerged} (may be too loose)`);
    warnings += 1;
  }

  const distantDisplay = [
    ...scored.displayLevels.support,
    ...scored.displayLevels.resistance,
  ].filter((l) => (l.proximityLabel ?? '') === 'distant');
  if (distantDisplay.length > 0) {
    console.warn(`WARN ${s.name}: ${distantDisplay.length} distant level(s) in display`);
    warnings += 1;
  }

  console.log(`\n=== ${s.name} (${s.symbol} ${s.interval}) ===`);
  console.log(
    `price=${indicators.currentPrice.toFixed(2)} atr=${indicators.atr.atr.toFixed(2)} fib=${indicators.fibonacci?.swingSource ?? 'n/a'}`
  );
  console.log(
    `support=${scored.supportLevels.length} displayS=${scored.displayLevels.support.length} | resistance=${scored.resistanceLevels.length} displayR=${scored.displayLevels.resistance.length}`
  );
  console.log(`avgMerged=${avgMerged.toFixed(2)} maxMerged=${maxMerged} distantInDisplay=${distantDisplay.length}`);
  console.log('display support:', summarizeSide(scored.displayLevels.support));
  console.log('display resistance:', summarizeSide(scored.displayLevels.resistance));
}

console.log(`\nEyeball gate complete. warnings=${warnings}`);
if (warnings > 2) {
  process.exitCode = 1;
}
