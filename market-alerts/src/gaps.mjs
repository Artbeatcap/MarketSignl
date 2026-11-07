/**
 * Unfilled upside gaps: prior close < next open, and subsequent trade has not
 * revisited the gap zone (low never <= prior close).
 * Returns nearest gaps above last close, capped at `limit`.
 *
 * @param {{ open: number, high: number, low: number, close: number, date: string }[]} bars
 * @param {{ limit?: number }} [opts]
 * @returns {{ date: string, gapLow: number, gapHigh: number }[]}
 */
export function unfilledGapsAbove(bars, { limit = 3 } = {}) {
  if (!bars?.length) return [];
  const lastClose = bars[bars.length - 1].close;
  /** @type {{ date: string, gapLow: number, gapHigh: number }[]} */
  const gaps = [];

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (!(cur.open > prev.close)) continue;

    const gapLow = prev.close;
    const gapHigh = cur.open;
    let filled = false;
    for (let j = i; j < bars.length; j++) {
      if (bars[j].low <= gapLow) {
        filled = true;
        break;
      }
    }
    if (filled) continue;
    if (gapLow <= lastClose) continue;
    gaps.push({ date: cur.date, gapLow, gapHigh });
  }

  gaps.sort((a, b) => a.gapLow - b.gapLow);
  return gaps.slice(0, limit);
}
