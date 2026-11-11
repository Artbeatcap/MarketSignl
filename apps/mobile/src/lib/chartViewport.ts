/**
 * chartViewport.ts
 * ---------------------------------------------------------------------------
 * Which bars the chart shows when the user zooms or scrolls back.
 *
 * A view is "how many bars" and "how far back from the newest bar", so it stays
 * put when a refresh appends a new bar. Pure functions: no React, no gestures.
 */

export interface ChartView {
  /** Bars shown. */
  count: number;
  /** Bars between the right edge of the view and the newest bar. 0 = showing the latest. */
  endOffset: number;
}

/** Fewest bars a zoom-in can reach. */
export const MIN_VISIBLE_BARS = 20;

/** Keep a view inside the bars that exist. */
export function clampView(view: ChartView, total: number): ChartView {
  if (total <= 0) return { count: 0, endOffset: 0 };
  const minCount = Math.min(MIN_VISIBLE_BARS, total);
  const count = Math.max(minCount, Math.min(total, Math.round(view.count)));
  const endOffset = Math.max(0, Math.min(total - count, Math.round(view.endOffset)));
  return { count, endOffset };
}

/** Start (inclusive) and end (exclusive) indices of a view. */
export function viewRange(view: ChartView, total: number): { start: number; end: number } {
  const v = clampView(view, total);
  const end = total - v.endOffset;
  return { start: end - v.count, end };
}

/**
 * Zoom by `factor` (above 1 zooms in, below 1 zooms out), keeping the bar under
 * `anchor` in place. `anchor` is the position across the chart, 0 = left edge,
 * 1 = right edge.
 */
export function zoomView(view: ChartView, factor: number, anchor: number, total: number): ChartView {
  const v = clampView(view, total);
  if (!(factor > 0) || !Number.isFinite(factor)) return v;
  const a = Math.max(0, Math.min(1, anchor));
  const minCount = Math.min(MIN_VISIBLE_BARS, total);
  const count = Math.max(minCount, Math.min(total, Math.round(v.count / factor)));
  const start = total - v.endOffset - v.count;
  const anchorBar = start + a * v.count;
  const newEnd = anchorBar - a * count + count;
  return clampView({ count, endOffset: total - newEnd }, total);
}

/** Scroll by a number of bars. Positive moves back in time (older bars). */
export function panView(view: ChartView, bars: number, total: number): ChartView {
  const v = clampView(view, total);
  return clampView({ count: v.count, endOffset: v.endOffset + bars }, total);
}

export function isSameView(a: ChartView, b: ChartView): boolean {
  return a.count === b.count && a.endOffset === b.endOffset;
}
