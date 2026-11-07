import { atrSeries, emaSeries, pctChange } from './indicators.mjs';
import { unfilledGapsAbove } from './gaps.mjs';
import { setupDedupeKey } from './runs.mjs';

const SWING = 2;

/**
 * @param {{ high: number }[]} bars
 * @param {number} i
 */
function isSwingHigh(bars, i, left = SWING, right = SWING) {
  if (i < left || i > bars.length - 1 - right) return false;
  const h = bars[i].high;
  for (let j = i - left; j <= i + right; j++) {
    if (j === i) continue;
    if (bars[j].high >= h) return false;
  }
  return true;
}

/**
 * Detect confirmed lower-high setups on daily bars.
 * Confirmation: after H1 swing high and a later lower swing high (retest),
 * a bar closes below the retest bar's low.
 *
 * @param {string} ticker
 * @param {{ date: string, open: number, high: number, low: number, close: number }[]} bars
 * @param {{ onlyLatest?: boolean, knownKeys?: Set<string> }} [opts]
 */
export function detectLowerHighs(ticker, bars, { onlyLatest = true, knownKeys = new Set() } = {}) {
  if (!bars || bars.length < 220) {
    const err = new Error(`bar count < 220 (${bars?.length ?? 0})`);
    err.step = 'validate_bars';
    throw err;
  }

  const closes = bars.map((b) => b.close);
  const ema65 = emaSeries(closes, 65);
  const ema200 = emaSeries(closes, 200);
  const atr = atrSeries(bars, 14);
  const fiveDay = pctChange(closes, 5);

  /** @type {number[]} */
  const swingIdx = [];
  for (let i = 0; i < bars.length; i++) {
    if (isSwingHigh(bars, i)) swingIdx.push(i);
  }

  /** @type {object[]} */
  const setups = [];

  for (let s = 0; s < swingIdx.length; s++) {
    const h1i = swingIdx[s];
    const h1 = bars[h1i];

    for (let r = s + 1; r < swingIdx.length; r++) {
      const retestI = swingIdx[r];
      if (retestI <= h1i) continue;
      const retest = bars[retestI];
      if (!(retest.high < h1.high)) continue;

      for (let c = retestI + 1; c < bars.length; c++) {
        const bar = bars[c];
        if (!(bar.close < retest.low)) continue;

        // First confirmation close only for this H1/retest pair
        const confI = c;
        const conf = bars[confI];
        const atrVal = atr[confI];
        const e65 = ema65[confI];
        const e200 = ema200[confI];
        const away = h1.high - conf.close;
        const atrMult = atrVal ? away / atrVal : null;

        const setup = {
          ticker: ticker.toUpperCase(),
          h1Date: h1.date,
          h1Price: round2(h1.high),
          retestDate: retest.date,
          retestHigh: round2(retest.high),
          retestLow: round2(retest.low),
          close: round2(conf.close),
          confirmDate: conf.date,
          invalidationAway: round2(away),
          invalidationAtr: atrMult == null ? null : round2(atrMult),
          ema65: e65 == null ? null : round2(e65),
          ema200: e200 == null ? null : round2(e200),
          priceVsEma65: e65 == null ? null : conf.close >= e65 ? 'above' : 'below',
          priceVsEma200: e200 == null ? null : conf.close >= e200 ? 'above' : 'below',
          fiveDayPct: fiveDay == null ? null : round2(fiveDay),
          gapsAbove: unfilledGapsAbove(bars.slice(0, confI + 1), { limit: 3 }).map((g) =>
            round2(g.gapLow),
          ),
        };
        setup.key = setupDedupeKey(setup);
        if (!knownKeys.has(setup.key)) setups.push(setup);
        break;
      }
    }
  }

  if (onlyLatest) {
    if (!setups.length) return [];
    // Prefer confirmation on the last bar (today's signal)
    const lastDate = bars[bars.length - 1].date;
    const today = setups.filter((s) => s.confirmDate === lastDate);
    if (today.length) return [today[today.length - 1]];
    return [];
  }
  return setups;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
