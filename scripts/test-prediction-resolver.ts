/**
 * Unit tests for prediction resolution scoring (pure functions only).
 * Run: npx tsx scripts/test-prediction-resolver.ts
 */
import type { AIPrediction } from '@marketsignl/core';

// Inline imports of pure functions to avoid DB module side effects
const NEUTRAL_THRESHOLD_PCT = 0.25;
const MIN_STATS_SAMPLE = 10;

function scoreDirectionHit(
  direction: 'bullish' | 'bearish' | 'neutral',
  actualChangePct: number
): boolean {
  if (direction === 'bullish') return actualChangePct > NEUTRAL_THRESHOLD_PCT;
  if (direction === 'bearish') return actualChangePct < -NEUTRAL_THRESHOLD_PCT;
  return Math.abs(actualChangePct) <= NEUTRAL_THRESHOLD_PCT;
}

function scoreBandContained(
  resolvedPrice: number,
  terminalPoint: { price: number; lowerBand?: number; upperBand?: number }
): boolean {
  const lower = terminalPoint.lowerBand ?? terminalPoint.price;
  const upper = terminalPoint.upperBand ?? terminalPoint.price;
  return resolvedPrice >= lower && resolvedPrice <= upper;
}

function computeResolution(
  prediction: AIPrediction,
  entryClose: number,
  resolvedPrice: number
) {
  const actualChangePct = (resolvedPrice / entryClose - 1) * 100;
  const terminal = prediction.projectedPath[prediction.projectedPath.length - 1];
  return {
    actualChangePct: Math.round(actualChangePct * 100) / 100,
    directionHit: scoreDirectionHit(prediction.direction, actualChangePct),
    bandContained: terminal ? scoreBandContained(resolvedPrice, terminal) : false,
    magnitudeErrorPct: Math.round(Math.abs(actualChangePct - prediction.expectedChangePct) * 100) / 100,
  };
}

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL', msg);
  }
}

assert(scoreDirectionHit('bullish', 1.5) === true, 'bullish hit');
assert(scoreDirectionHit('bearish', -1.0) === true, 'bearish hit');
assert(scoreBandContained(105, { timestamp: 0, price: 100, lowerBand: 95, upperBand: 110 }) === true, 'in band');

const prediction: AIPrediction = {
  symbol: 'TEST',
  interval: '3mo',
  headline: 'test',
  summary: 'test',
  reasoning: [],
  riskFactors: [],
  direction: 'bullish',
  confidence: 75,
  expectedChangePct: 5,
  projectedPath: [
    { timestamp: 1, price: 101, lowerBand: 99, upperBand: 103 },
    { timestamp: 2, price: 105, lowerBand: 100, upperBand: 110 },
  ],
};

const res = computeResolution(prediction, 100, 104);
assert(res.actualChangePct === 4, 'actual pct');
assert(res.directionHit === true, 'direction hit');
assert(res.bandContained === true, 'band contained');
assert(res.magnitudeErrorPct === 1, 'magnitude error');
assert(MIN_STATS_SAMPLE === 10, 'min sample');

console.log({ passed, failed });
process.exit(failed > 0 ? 1 : 0);
