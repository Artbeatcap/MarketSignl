/**
 * Plain-English copy for a support/resistance level (tap-a-level panel).
 * Pure functions, no React Native imports, so they can be tested in Node.
 */

import type { ScoredLevel } from '@chartsignl/core';

/** Same output as formatPrice in lib/marketData.ts (that module pulls in app state, so it is not imported here). */
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return price >= 1 ? price.toFixed(2) : price.toFixed(4);
}

export interface LevelReason {
  key: string;
  text: string;
}

/** Plain-English list of the factors that scored for this level. */
export function levelReasons(level: ScoredLevel): LevelReason[] {
  const f = level.factors;
  const out: LevelReason[] = [];
  if (f.historicalTouches.points > 0 && f.historicalTouches.count > 0) {
    out.push({
      key: 'touches',
      text: `Price has reached this area on ${f.historicalTouches.count} ${f.historicalTouches.count === 1 ? 'bar' : 'bars'} in this window`,
    });
  }
  if (f.fibonacciAlignment.points > 0 && f.fibonacciAlignment.level) {
    out.push({
      key: 'fib',
      text: `Lines up with the ${f.fibonacciAlignment.level} Fibonacci retracement of the recent swing`,
    });
  }
  if (f.emaProximity.points > 0 && f.emaProximity.ema) {
    out.push({ key: 'ema', text: `Sits near the ${f.emaProximity.ema} EMA` });
  }
  if (f.volumeNode.points > 0 && f.volumeNode.isHighVolume) {
    out.push({ key: 'volume', text: 'Heavy trading volume happened around this price' });
  }
  if (f.roundNumber.points > 0 && f.roundNumber.isRound && f.roundNumber.nearestRound != null) {
    out.push({
      key: 'round',
      text: `Close to the $${Number.isInteger(f.roundNumber.nearestRound) ? f.roundNumber.nearestRound.toLocaleString('en-US') : formatPrice(f.roundNumber.nearestRound)} round number`,
    });
  }
  if (f.recentRelevance.points > 0 && f.recentRelevance.isRecent) {
    out.push({ key: 'recent', text: 'Tested recently' });
  }
  return out;
}

const PROXIMITY_TEXT: Record<NonNullable<ScoredLevel['proximityLabel']>, string> = {
  at_price: 'At price',
  in_play: 'In play',
  nearby: 'Nearby',
  extended: 'Further out',
  distant: 'Distant',
};

/** "1.2% above · 0.4 ATR", measured from the chart's last price. */
export function levelDistanceText(level: ScoredLevel, currentPrice: number): string {
  const side = level.type === 'support' ? 'below' : 'above';
  const pct =
    currentPrice > 0 ? (Math.abs(level.price - currentPrice) / currentPrice) * 100 : level.distancePercent;
  const atr =
    typeof level.distanceATR === 'number' && Number.isFinite(level.distanceATR)
      ? ` · ${level.distanceATR.toFixed(1)} ATR`
      : '';
  return `${pct.toFixed(1)}% ${side}${atr}`;
}

export function proximityText(level: Pick<ScoredLevel, 'proximityLabel'>): string | null {
  return level.proximityLabel ? PROXIMITY_TEXT[level.proximityLabel] : null;
}
