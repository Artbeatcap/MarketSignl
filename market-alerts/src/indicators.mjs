/**
 * @param {number[]} values
 * @param {number} length
 * @returns {(number|null)[]}
 */
export function emaSeries(values, length) {
  const out = Array(values.length).fill(null);
  if (values.length < length || length < 1) return out;
  const k = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length; i++) sum += values[i];
  let prev = sum / length;
  out[length - 1] = prev;
  for (let i = length; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder ATR series.
 * @param {{ high: number, low: number, close: number }[]} bars
 * @param {number} length
 * @returns {(number|null)[]}
 */
export function atrSeries(bars, length = 14) {
  const out = Array(bars.length).fill(null);
  if (bars.length < length + 1) return out;
  const trs = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trs.push(bars[i].high - bars[i].low);
    } else {
      const prevClose = bars[i - 1].close;
      trs.push(
        Math.max(
          bars[i].high - bars[i].low,
          Math.abs(bars[i].high - prevClose),
          Math.abs(bars[i].low - prevClose),
        ),
      );
    }
  }
  let sum = 0;
  for (let i = 0; i < length; i++) sum += trs[i];
  let atr = sum / length;
  out[length - 1] = atr;
  for (let i = length; i < bars.length; i++) {
    atr = (atr * (length - 1) + trs[i]) / length;
    out[i] = atr;
  }
  return out;
}

/**
 * @param {number[]} closes
 * @param {number} lookback
 */
export function pctChange(closes, lookback = 5) {
  if (closes.length <= lookback) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - lookback];
  if (!prev) return null;
  return ((last - prev) / prev) * 100;
}
