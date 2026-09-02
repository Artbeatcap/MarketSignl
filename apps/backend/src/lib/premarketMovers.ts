import { type MoverQualityConfig, type TickerMeta } from './moversFilter.js';
import { MARKET_DATA_DELAY_MINUTES } from '@chartsignl/core';

export type SessionWindow = 'premarket' | 'prior_session';

/**
 * Premarket thresholds. Volume is 1–2 orders of magnitude below session.
 * Unchanged in this pass — do not retune while wiring index drivers.
 */
export const PREMARKET_MOVER_CONFIG: MoverQualityConfig = {
  minPrice: 5,
  minAvgVolume: 25_000,
  minDollarVolume: 3_000_000,
  minMarketCap: 300_000_000,
  minAbsChangePct: 3,
  maxAbsChangePct: 60,
};

/**
 * Extract price and volume correctly for whichever session window we're in.
 *
 * Before the open Polygon's `day` aggregate is literal zeros, not null.
 * `??` keeps those zeros; `||` falls through. This is the extractor every
 * driver path must reuse — do not write a second one.
 */
export function readWindowFields(snap: any, window: SessionWindow) {
  if (window === 'premarket') {
    return {
      price: snap.day?.c || snap.lastTrade?.p || snap.min?.c || 0,
      volume: snap.min?.av || snap.day?.v || 0,
      changePct: snap.todaysChangePerc ?? 0,
      lastTradeNs: snap.lastTrade?.t ?? snap.min?.t ?? 0,
    };
  }
  return {
    price: snap.prevDay?.c || 0,
    volume: snap.prevDay?.v || 0,
    changePct: snap.todaysChangePerc ?? 0,
    lastTradeNs: snap.lastTrade?.t ?? snap.min?.t ?? 0,
  };
}

/**
 * Reject rows whose last trade is stale. A stock halted for news (T12) keeps
 * showing its pre-halt premarket price, which would print a move that no one
 * can actually trade. Polygon does not expose halt state on all tiers, so
 * staleness is the cheap proxy.
 *
 * `lastTradeNs` may be nanoseconds (`lastTrade.t`) or milliseconds (`min.t`).
 * `nowMs` must be the feed clock (`deriveFeedNowMs`), not `Date.now()`.
 */
export function isStale(lastTradeNs: number, nowMs: number, maxAgeMin = 20): boolean {
  if (!lastTradeNs) return true;
  const asMs = lastTradeNs > 1e15 ? lastTradeNs / 1_000_000 : lastTradeNs;
  const ageMin = (nowMs - asMs) / 60_000;
  return ageMin > maxAgeMin;
}

/**
 * Wall clock minus the contractual delay. On a 15-minute delayed plan a healthy
 * lastTrade is already ~15 minutes old; measuring against Date.now() rejects
 * almost everything. Do not raise `maxAgeMin` to compensate — that defeats halt detection.
 */
let loggedFeedClock = false;
export function deriveFeedNowMs(
  nowMs: number = Date.now(),
  delayMinutes: number = MARKET_DATA_DELAY_MINUTES,
): number {
  const feedNow = nowMs - delayMinutes * 60_000;
  if (!loggedFeedClock) {
    loggedFeedClock = true;
    console.log(
      `[premarket] feed clock delay=${delayMinutes}min wall=${new Date(nowMs).toISOString()} feedNow=${new Date(feedNow).toISOString()}`,
    );
  }
  return feedNow;
}

export function passesPremarketGate(
  snap: any,
  meta: TickerMeta,
  nowMs: number = deriveFeedNowMs(),
  cfg: MoverQualityConfig = PREMARKET_MOVER_CONFIG
): boolean {
  const { price, volume, changePct, lastTradeNs } = readWindowFields(snap, 'premarket');
  const absChange = Math.abs(changePct);
  if (isStale(lastTradeNs, nowMs)) return false;
  if (price < cfg.minPrice) return false;
  if (absChange < cfg.minAbsChangePct) return false;
  if (absChange > cfg.maxAbsChangePct) return false;
  if (volume < cfg.minAvgVolume) return false;
  if (price * volume < cfg.minDollarVolume) return false;
  if (meta.marketCap !== null && meta.marketCap < cfg.minMarketCap) return false;
  return true;
}
