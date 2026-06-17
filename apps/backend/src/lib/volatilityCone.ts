// Deterministic forward price projection ("volatility cone").
// Numbers are computed here — the LLM never produces prices.
// Anchored to last close, drift is bounded in ATR units, bands widen with √t.

import type { ProjectedPoint } from '@marketsignl/core';
import type { TechnicalIndicators } from './technicalCalculator.js';

export interface VolatilityConeInput {
  lastClose: number;
  atr: number;
  driftBias: number;
  horizonBars: number;
  stepMs: number;
  lastTimestamp: number;
  bandK?: number;
  driftAtrPerBar?: number;
}

export interface VolatilityConeResult {
  projectedPath: ProjectedPoint[];
  expectedChangePct: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, dp = 4) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

export function buildVolatilityCone(input: VolatilityConeInput): VolatilityConeResult {
  const {
    lastClose,
    atr,
    horizonBars,
    stepMs,
    lastTimestamp,
    bandK = 1.0,
    driftAtrPerBar = 0.25,
  } = input;

  const bias = clamp(input.driftBias ?? 0, -1, 1);
  const safeAtr = Number.isFinite(atr) && atr > 0 ? atr : Math.max(lastClose * 0.005, 0.01);
  const driftPerBar = bias * safeAtr * driftAtrPerBar;

  const projectedPath: ProjectedPoint[] = [];
  for (let i = 1; i <= horizonBars; i++) {
    const center = lastClose + driftPerBar * i;
    const spread = bandK * safeAtr * Math.sqrt(i);
    projectedPath.push({
      timestamp: lastTimestamp + stepMs * i,
      price: round(center),
      lowerBand: round(center - spread),
      upperBand: round(center + spread),
    });
  }

  const finalPrice = projectedPath[projectedPath.length - 1].price;
  const expectedChangePct = round((finalPrice / lastClose - 1) * 100, 2);
  return { projectedPath, expectedChangePct };
}

/** Fully deterministic bias from EMA alignment + overextension damping. */
export function deriveDriftBias(indicators: Pick<TechnicalIndicators, 'trend' | 'overextension'>): number {
  const align = indicators.trend?.emaAlignment ?? 'mixed';
  const base =
    align === 'perfectly_bullish'
      ? 0.7
      : align === 'mostly_bullish'
        ? 0.4
        : align === 'mostly_bearish'
          ? -0.4
          : align === 'perfectly_bearish'
            ? -0.7
            : 0;

  const ext = indicators.overextension?.atrNormalizedDistance ?? 0;
  const damp = ext > 2.5 ? Math.max(0, 1 - (ext - 2.5) / 2) : 1;
  return clamp(base * damp, -1, 1);
}
