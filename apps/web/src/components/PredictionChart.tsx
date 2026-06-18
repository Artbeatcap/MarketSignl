import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  AIPrediction,
  ChartInterval,
  MarketDataPoint,
  ProjectedPoint,
} from '@marketsignl/core';
import {
  CHART_COLORS,
  getPredictionLayout,
  getPriceDomainWithPrediction,
  buildPredictionBandPath,
  buildPredictionLinePath,
} from '@marketsignl/core';
import './PredictionChart.css';

/**
 * PredictionChart — MarketSignl's signature "future zone" forecast chart (web).
 *
 * LAYOUT CONTRACT (shared with mobile via @marketsignl/core):
 *   The drawable width is split by PREDICTION_ZONE_RATIO (0.28):
 *     - left ~72% = historical price ("now" ends at layout.dividerX)
 *     - right ~28% = the empty "future" canvas where the forecast is drawn
 *
 *   When a prediction is active, TWO things change at once — this is the part
 *   the old Recharts overlay got wrong and the reason we render raw SVG here:
 *     1. The historical line re-lays-out into the left 72% (xForHistoricalIndex),
 *        so its last point lands EXACTLY on layout.dividerX.
 *     2. The y-domain widens to include the forecast band
 *        (getPriceDomainWithPrediction), so the whole chart rescales together.
 *
 *   Because the forecast band/line are anchored from that same last-close pixel
 *   (startX = dividerX, startY = priceToY(lastClose)) using the SAME priceToY,
 *   the seam between history and forecast is continuous by construction — no gap,
 *   no jump. Do not give the historical series its own y-scale; that reintroduces
 *   the toggle-jump bug.
 *
 * Recharts can't express this (it owns its own coordinate system); the core
 * helpers assume the caller owns chartLeft / drawableWidth / priceToY. Hence SVG.
 */

interface PredictionChartProps {
  data: MarketDataPoint[];
  symbol: string;
  interval: ChartInterval;
  prediction?: AIPrediction | null;
  height?: number;
  actualPath?: ProjectedPoint[];
  priceDomainOverride?: { minPrice: number; maxPrice: number };
  replayOutcome?: boolean | null;
  isReplay?: boolean;
}

// Matches the mobile chart's geometry intent, tuned for desktop readability.
const X_AXIS_HEIGHT = 28;
const CHART_LEFT_MARGIN = 56; // room for "$000.00" y labels
const CHART_RIGHT_MARGIN = 16;
const TOP_PAD = 14;
const BOTTOM_PAD = 14;
const Y_TICK_COUNT = 5;
const X_TICK_COUNT = 6;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function getNum(point: MarketDataPoint, key: string): number | undefined {
  const v = (point as unknown as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function formatAxisPrice(price: number): string {
  if (Math.abs(price) >= 100) return `$${Math.round(price)}`;
  if (Math.abs(price) >= 10) return `$${price.toFixed(1)}`;
  return `$${price.toFixed(2)}`;
}

function formatTickDate(ts: number, interval: ChartInterval): string {
  const d = new Date(ts);
  if (interval === '1d') {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (interval === '5d' || interval === '1mo' || interval === '3mo' || interval === '6mo') {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(ts: number, interval: ChartInterval): string {
  const d = new Date(ts);
  if (interval === '1d' || interval === '5d') {
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type Hover =
  | { kind: 'historical'; index: number; x: number; y: number }
  | { kind: 'future'; index: number; x: number; y: number }
  | null;

export default function PredictionChart({
  data,
  symbol,
  interval,
  prediction,
  height = 420,
  actualPath = [],
  priceDomainOverride,
  replayOutcome = null,
  isReplay = false,
}: PredictionChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover>(null);

  // Responsive width via ResizeObserver (replaces Recharts' ResponsiveContainer).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projected: ProjectedPoint[] = prediction?.projectedPath ?? [];
  const hasPrediction = !!prediction && projected.length > 0;

  const svgHeight = height - X_AXIS_HEIGHT;
  const chartDrawableWidth = Math.max(0, width - CHART_LEFT_MARGIN - CHART_RIGHT_MARGIN);
  const rightEdge = width - CHART_RIGHT_MARGIN;
  const layout = useMemo(
    () => getPredictionLayout(CHART_LEFT_MARGIN, chartDrawableWidth),
    [chartDrawableWidth]
  );

  // Shared y-domain — history + forecast band live on ONE scale.
  const { minPrice, maxPrice } = useMemo(() => {
    if (priceDomainOverride) return priceDomainOverride;
    if (data.length === 0) return { minPrice: 0, maxPrice: 100 };
    const prices: number[] = [];
    for (const d of data) {
      const close = getNum(d, 'close');
      const high = getNum(d, 'high');
      const low = getNum(d, 'low');
      if (high !== undefined) prices.push(high);
      if (low !== undefined) prices.push(low);
      if (high === undefined && low === undefined && close !== undefined) prices.push(close);
    }
    if (hasPrediction) return getPriceDomainWithPrediction(prices, projected);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.05 || 1;
    return { minPrice: min - padding, maxPrice: max + padding };
  }, [data, hasPrediction, projected, priceDomainOverride]);

  const priceToY = useMemo(() => {
    const usable = svgHeight - TOP_PAD - BOTTOM_PAD;
    const range = maxPrice - minPrice;
    return (price: number) => {
      const ratio = range > 0 ? (maxPrice - price) / range : 0;
      return ratio * usable + TOP_PAD;
    };
  }, [svgHeight, minPrice, maxPrice]);

  // x for a historical bar: full width normally, compressed to 72% under prediction.
  const stepX =
    data.length > 1
      ? (hasPrediction ? layout.historicalWidth : chartDrawableWidth) / (data.length - 1)
      : 0;
  const xForIndex = (i: number) =>
    hasPrediction
      ? layout.xForHistoricalIndex(i, data.length)
      : CHART_LEFT_MARGIN + i * stepX;

  const xAxisIndices = useMemo(() => {
    if (data.length === 0) return [];
    if (data.length <= X_TICK_COUNT) return data.map((_, i) => i);
    const idx: number[] = [];
    const step = Math.floor(data.length / (X_TICK_COUNT - 1));
    for (let i = 0; i < X_TICK_COUNT - 1; i++) idx.push(i * step);
    idx.push(data.length - 1);
    return idx;
  }, [data.length]);

  const closePathD = useMemo(() => {
    if (data.length === 0) return '';
    return data
      .map((p, i) => {
        const close = getNum(p, 'close') ?? 0;
        return `${i === 0 ? 'M' : 'L'} ${xForIndex(i)} ${priceToY(close)}`;
      })
      .join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hasPrediction, priceToY, stepX, layout]);

  // Forecast overlay paths, anchored to the last historical close.
  const overlay = useMemo(() => {
    if (!hasPrediction || data.length === 0) return null;
    const lastIndex = data.length - 1;
    const startX = xForIndex(lastIndex); // === layout.dividerX
    const startY = priceToY(getNum(data[lastIndex], 'close') ?? 0);
    const actualLinePath =
      actualPath.length > 0
        ? buildPredictionLinePath(actualPath, layout.xForFutureIndex, priceToY, startX, startY)
        : '';
    return {
      bandPath: buildPredictionBandPath(projected, layout.xForFutureIndex, priceToY, startX, startY),
      linePath: buildPredictionLinePath(projected, layout.xForFutureIndex, priceToY, startX, startY),
      actualLinePath,
      startX,
      startY,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPrediction, data, projected, layout, priceToY, actualPath]);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i < Y_TICK_COUNT; i++) {
      ticks.push(maxPrice - ((maxPrice - minPrice) * i) / (Y_TICK_COUNT - 1));
    }
    return ticks;
  }, [minPrice, maxPrice]);

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    if (data.length === 0 || width === 0) return;
    const px = e.nativeEvent.offsetX;
    if (hasPrediction && px > layout.dividerX) {
      // xForFutureIndex maps i -> dividerX + ((i+1)/len)*futureWidth, so invert.
      const rel = (px - layout.dividerX) / layout.futureWidth;
      const i = clamp(Math.round(rel * projected.length - 1), 0, projected.length - 1);
      setHover({
        kind: 'future',
        index: i,
        x: layout.xForFutureIndex(i, projected.length),
        y: priceToY(projected[i].price),
      });
      return;
    }
    const span = hasPrediction ? layout.historicalWidth : chartDrawableWidth;
    const rel = span > 0 ? (px - CHART_LEFT_MARGIN) / span : 0;
    const i = clamp(Math.round(rel * (data.length - 1)), 0, data.length - 1);
    setHover({
      kind: 'historical',
      index: i,
      x: xForIndex(i),
      y: priceToY(getNum(data[i], 'close') ?? 0),
    });
  }

  // Empty / not-yet-measured states
  if (data.length === 0) {
    return (
      <div ref={wrapRef} className="pc-wrap" style={{ height }}>
        <div className="pc-empty">No chart data.</div>
      </div>
    );
  }

  const expectedPct = prediction?.expectedChangePct ?? 0;
  const lastClose = getNum(data[data.length - 1], 'close') ?? 0;

  return (
    <div ref={wrapRef} className="pc-wrap" style={{ height }}>
      {width > 0 && (
        <>
          <svg
            width={width}
            height={svgHeight}
            className="pc-svg"
            role="img"
            aria-label={
              hasPrediction
                ? `${symbol} price with AI forecast of ${expectedPct >= 0 ? '+' : ''}${expectedPct.toFixed(2)}%`
                : `${symbol} price chart`
            }
          >
            {/* Future-zone background tint */}
            {hasPrediction && (
              <rect
                x={layout.dividerX}
                y={0}
                width={Math.max(0, rightEdge - layout.dividerX)}
                height={svgHeight}
                fill="rgba(59, 130, 246, 0.045)"
              />
            )}

            {/* Horizontal grid + y labels */}
            {yTicks.map((p, i) => {
              const y = priceToY(p);
              return (
                <g key={`y-${i}`}>
                  <line
                    x1={CHART_LEFT_MARGIN}
                    y1={y}
                    x2={rightEdge}
                    y2={y}
                    stroke={CHART_COLORS.grid}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={CHART_LEFT_MARGIN - 8}
                    y={y + 3}
                    textAnchor="end"
                    className="pc-axis-text"
                  >
                    {formatAxisPrice(p)}
                  </text>
                </g>
              );
            })}

            {/* Historical close line */}
            <path
              d={closePathD}
              stroke={CHART_COLORS.lineStroke}
              strokeWidth={2.5}
              fill="none"
              strokeLinejoin="round"
            />

            {/* Forecast overlay */}
            {hasPrediction && overlay && (
              <g>
                <line
                  x1={layout.dividerX}
                  y1={TOP_PAD}
                  x2={layout.dividerX}
                  y2={svgHeight - BOTTOM_PAD}
                  stroke={CHART_COLORS.axis}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <text
                  x={layout.dividerX + 8}
                  y={TOP_PAD + 4}
                  className="pc-zone-label"
                  fill={CHART_COLORS.predictionLabel}
                >
                  AI Forecast
                </text>
                {overlay.bandPath && (
                  <path d={overlay.bandPath} fill={CHART_COLORS.predictionBand} stroke="none" />
                )}
                {overlay.linePath && (
                  <path
                    d={overlay.linePath}
                    stroke={CHART_COLORS.prediction}
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    fill="none"
                    strokeLinejoin="round"
                  />
                )}
                {overlay.actualLinePath && (
                  <>
                    <path
                      d={overlay.actualLinePath}
                      stroke={CHART_COLORS.lineStroke}
                      strokeWidth={2.5}
                      fill="none"
                      strokeLinejoin="round"
                    />
                    {actualPath.length > 0 && replayOutcome != null && (
                      <circle
                        cx={layout.xForFutureIndex(actualPath.length - 1, actualPath.length)}
                        cy={priceToY(actualPath[actualPath.length - 1].price)}
                        r={4}
                        fill={replayOutcome ? '#10B981' : '#EF4444'}
                        stroke="#fff"
                        strokeWidth={1.5}
                      />
                    )}
                  </>
                )}
                {/* Anchor dot at "now" */}
                <circle
                  cx={layout.dividerX}
                  cy={priceToY(lastClose)}
                  r={3.5}
                  fill={CHART_COLORS.lineStroke}
                />
              </g>
            )}

            {/* Crosshair */}
            {hover && (
              <g pointerEvents="none">
                <line
                  x1={hover.x}
                  y1={TOP_PAD}
                  x2={hover.x}
                  y2={svgHeight - BOTTOM_PAD}
                  stroke={CHART_COLORS.axis}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  opacity={0.6}
                />
                <circle
                  cx={hover.x}
                  cy={hover.y}
                  r={4}
                  fill={hover.kind === 'future' ? CHART_COLORS.prediction : CHART_COLORS.lineStroke}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              </g>
            )}

            {/* Mouse capture (topmost) */}
            <rect
              x={CHART_LEFT_MARGIN}
              y={0}
              width={Math.max(0, rightEdge - CHART_LEFT_MARGIN)}
              height={svgHeight}
              fill="transparent"
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
            />
          </svg>

          {/* X-axis labels */}
          <div className="pc-xaxis" style={{ height: X_AXIS_HEIGHT }}>
            {xAxisIndices.map((i) => {
              const ts = getNum(data[i], 'timestamp');
              if (ts === undefined) return null;
              return (
                <span key={`x-${i}`} className="pc-xaxis-label" style={{ left: xForIndex(i) }}>
                  {formatTickDate(ts, interval)}
                </span>
              );
            })}
            {hasPrediction && projected.length > 0 && (
              <span
                className="pc-xaxis-label pc-xaxis-future"
                style={{ left: layout.xForFutureIndex(projected.length - 1, projected.length) }}
              >
                {formatTickDate(projected[projected.length - 1].timestamp, interval)}
              </span>
            )}
          </div>

          {/* Forecast chip (top-right overlay) */}
          {hasPrediction && (
            <div className="pc-chip">
              {isReplay ? (
                <>
                  Replay
                  {replayOutcome != null && (
                    <span> · {replayOutcome ? '✓ Hit' : '✗ Miss'}</span>
                  )}
                </>
              ) : (
                <>
                  ✨ AI Prediction {expectedPct >= 0 ? '+' : ''}
                  {expectedPct.toFixed(2)}%
                </>
              )}
            </div>
          )}

          {/* Hover tooltip */}
          {hover && (
            <div
              className="pc-tooltip"
              style={{
                left: clamp(hover.x + 12, 8, Math.max(8, width - 160)),
                top: clamp(hover.y - 12, 4, svgHeight - 64),
              }}
            >
              {hover.kind === 'historical' ? (
                <>
                  <div className="pc-tt-date">
                    {formatFullDate(getNum(data[hover.index], 'timestamp') ?? 0, interval)}
                  </div>
                  <div className="pc-tt-row">
                    <span>Price</span>
                    <strong>${(getNum(data[hover.index], 'close') ?? 0).toFixed(2)}</strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="pc-tt-date pc-tt-forecast">
                    Forecast · {formatFullDate(projected[hover.index].timestamp, interval)}
                  </div>
                  <div className="pc-tt-row">
                    <span>Projected</span>
                    <strong>${projected[hover.index].price.toFixed(2)}</strong>
                  </div>
                  {projected[hover.index].lowerBand != null &&
                    projected[hover.index].upperBand != null && (
                      <div className="pc-tt-row pc-tt-band">
                        <span>Range</span>
                        <span>
                          ${projected[hover.index].lowerBand!.toFixed(2)} – $
                          {projected[hover.index].upperBand!.toFixed(2)}
                        </span>
                      </div>
                    )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
