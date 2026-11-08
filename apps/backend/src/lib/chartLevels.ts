/**
 * chartLevels.ts
 * ---------------------------------------------------------------------------
 * The one place support/resistance levels are produced for the app.
 *
 * Both the chart (before Atlas runs, via POST /api/levels) and Atlas
 * (runAtlasAnalysis) go through levelsFromIndicators(), so the lines a user
 * sees before and after running Atlas are the same prices with the same ids.
 * Level ids are index-based and deterministic, so identical bars produce
 * identical ids.
 *
 * Market regime only feeds overextension, never level scoring, so the levels
 * endpoint can skip loading market context and still match Atlas exactly.
 */

import {
  calculateAllIndicators,
  type MarketDataPoint,
  type TechnicalIndicators,
} from './technicalCalculator.js';
import {
  scoreLevels,
  getExpandedLevels,
  type ScoredAnalysis,
  type ScoredLevel,
} from './confluenceScorer.js';

/** Bars Atlas analyzes. The app sends this same window to /api/levels. */
export const LEVEL_WINDOW_BARS = 100;

export interface LevelSet {
  scoredAnalysis: ScoredAnalysis;
  expanded: { support: ScoredLevel[]; resistance: ScoredLevel[] };
}

export function levelsFromIndicators(indicators: TechnicalIndicators): LevelSet {
  const scoredAnalysis = scoreLevels(indicators);
  return {
    scoredAnalysis,
    expanded: getExpandedLevels(scoredAnalysis, indicators.currentPrice),
  };
}

export interface ChartLevelsResult {
  symbol: string;
  interval: string;
  currentPrice: number;
  atr: number;
  /** Timestamp (ms) of the last bar the levels were computed from. */
  asOfTimestamp: number;
  barsUsed: number;
  /** Default display set (2 per side). Same lists Atlas returns as supportLevels/resistanceLevels. */
  supportLevels: ScoredLevel[];
  resistanceLevels: ScoredLevel[];
  /** "Show all" set (3 per side, no distance cap). Same as Atlas allSupportLevels/allResistanceLevels. */
  allSupportLevels: ScoredLevel[];
  allResistanceLevels: ScoredLevel[];
}

export function computeChartLevels(
  symbol: string,
  interval: string,
  data: MarketDataPoint[],
): ChartLevelsResult | null {
  const bars = data.slice(-LEVEL_WINDOW_BARS);
  const indicators = calculateAllIndicators(bars, symbol, interval);
  if (!indicators) return null;
  const { scoredAnalysis, expanded } = levelsFromIndicators(indicators);
  return {
    symbol,
    interval,
    currentPrice: indicators.currentPrice,
    atr: indicators.atr.atr,
    asOfTimestamp: bars[bars.length - 1].timestamp,
    barsUsed: bars.length,
    supportLevels: scoredAnalysis.displayLevels.support,
    resistanceLevels: scoredAnalysis.displayLevels.resistance,
    allSupportLevels: expanded.support,
    allResistanceLevels: expanded.resistance,
  };
}

/**
 * Trade ideas must reference a level the chart actually draws. Prefer the
 * highest-ranked level that is in the display set; fall back to the overall
 * top level (which withReferencedLevels then adds to the display set).
 */
export function pickTradeLevel(
  ranked: ScoredLevel[],
  display: ScoredLevel[],
): ScoredLevel | undefined {
  return ranked.find((l) => display.some((d) => d.id === l.id)) ?? ranked[0];
}

/** Display set plus any referenced level not already in it, sorted by price. */
export function withReferencedLevels(
  display: ScoredLevel[],
  referenced: Array<ScoredLevel | undefined>,
): ScoredLevel[] {
  const out = [...display];
  for (const level of referenced) {
    if (level && !out.some((d) => d.id === level.id)) out.push(level);
  }
  return out.sort((a, b) => a.price - b.price);
}
