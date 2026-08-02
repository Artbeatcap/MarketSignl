/**
 * Time-based volume as a low-opacity underlay inside the price plot.
 * Mount FIRST inside <Svg>. Scale to 95th percentile, not max.
 */

import React, { memo, useMemo } from 'react';
import { G, Rect } from 'react-native-svg';
import { CHART_COLORS } from '@chartsignl/core';

export interface VolumeBarsProps {
  data: Array<{
    volume?: number | null;
    close: number;
    open?: number;
  }>;
  chartHeight: number;
  xForIndex: (index: number) => number;
  heightFraction?: number;
  opacity?: number;
  barWidth?: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p))
  );
  return sorted[idx];
}

function VolumeBarsBase({
  data,
  chartHeight,
  xForIndex,
  heightFraction = 0.18,
  opacity = 0.28,
  barWidth,
}: VolumeBarsProps) {
  const scale = useMemo(() => {
    const vols = data
      .map((d) => d.volume ?? 0)
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (vols.length === 0) return null;

    const p95 = percentile(vols, 0.95);
    return p95 > 0 ? p95 : vols[vols.length - 1] || null;
  }, [data]);

  const computedBarWidth = useMemo(() => {
    if (barWidth) return barWidth;
    if (data.length < 2) return 3;
    const spacing = Math.abs(xForIndex(1) - xForIndex(0));
    return Math.max(1, Math.min(spacing * 0.65, 12));
  }, [barWidth, data.length, xForIndex]);

  if (!scale || data.length < 2) return null;

  const maxBarHeight = chartHeight * heightFraction;
  const baseline = chartHeight;

  return (
    <G opacity={opacity}>
      {data.map((point, i) => {
        const vol = point.volume ?? 0;
        if (!Number.isFinite(vol) || vol <= 0) return null;

        const h = Math.min(vol / scale, 1) * maxBarHeight;
        if (h < 0.5) return null;

        const up = point.open == null ? true : point.close >= point.open;

        return (
          <Rect
            key={`vol-${i}`}
            x={xForIndex(i) - computedBarWidth / 2}
            y={baseline - h}
            width={computedBarWidth}
            height={h}
            fill={up ? CHART_COLORS.candleUp : CHART_COLORS.candleDown}
            rx={computedBarWidth > 4 ? 1 : 0}
          />
        );
      })}
    </G>
  );
}

export const VolumeBars = memo(VolumeBarsBase);
