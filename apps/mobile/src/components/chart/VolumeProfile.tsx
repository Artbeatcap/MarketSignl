/**
 * Volume by price — right-edge histogram. Highlight via bucket containment
 * matching the confluence scorer (not a price epsilon).
 */

import React, { memo, useMemo } from 'react';
import { G, Line as SvgLine, Rect } from 'react-native-svg';
import { CHART_COLORS } from '@chartsignl/core';

export interface VolumeProfileNode {
  priceRangeLow: number;
  priceRangeHigh: number;
  priceMid: number;
  volumePercent: number;
}

export interface VolumeProfileProps {
  nodes: VolumeProfileNode[];
  pointOfControl?: number | null;
  priceToY: (price: number) => number;
  rightEdge: number;
  leftEdge: number;
  highlightedPrices?: Array<{ price: number; role: 'support' | 'resistance' }>;
  widthFraction?: number;
  opacity?: number;
  showPointOfControl?: boolean;
}

function VolumeProfileBase({
  nodes,
  pointOfControl,
  priceToY,
  rightEdge,
  leftEdge,
  highlightedPrices = [],
  widthFraction = 0.22,
  opacity = 0.5,
  showPointOfControl = true,
}: VolumeProfileProps) {
  const maxVolumePercent = useMemo(
    () =>
      nodes.reduce(
        (max, n) => (n.volumePercent > max ? n.volumePercent : max),
        0
      ),
    [nodes]
  );

  const plotWidth = rightEdge - leftEdge;
  const maxBarWidth = plotWidth * widthFraction;

  const roleForNode = useMemo(() => {
    const map = new Map<number, 'support' | 'resistance'>();
    nodes.forEach((node, i) => {
      const hit = highlightedPrices.find(
        (h) => h.price >= node.priceRangeLow && h.price <= node.priceRangeHigh
      );
      if (hit) map.set(i, hit.role);
    });
    return map;
  }, [nodes, highlightedPrices]);

  if (!nodes || nodes.length === 0 || maxVolumePercent <= 0 || plotWidth <= 0) {
    return null;
  }

  return (
    <G>
      <G opacity={opacity}>
        {nodes.map((node, i) => {
          const yHigh = priceToY(node.priceRangeHigh);
          const yLow = priceToY(node.priceRangeLow);
          const rawHeight = Math.abs(yLow - yHigh);
          const h = Math.max(rawHeight, 2);
          const y = Math.min(yHigh, yLow) - (h - rawHeight) / 2;

          const w = (node.volumePercent / maxVolumePercent) * maxBarWidth;
          if (w < 1) return null;

          const role = roleForNode.get(i);
          const fill = role
            ? role === 'support'
              ? CHART_COLORS.support
              : CHART_COLORS.resistance
            : CHART_COLORS.grid;

          return (
            <Rect
              key={`vp-${i}`}
              x={rightEdge - w}
              y={y}
              width={w}
              height={Math.max(h - 1, 1)}
              fill={fill}
              opacity={role ? 0.95 : 0.45}
              rx={1}
            />
          );
        })}
      </G>

      {showPointOfControl && pointOfControl != null ? (
        <SvgLine
          x1={rightEdge - maxBarWidth}
          y1={priceToY(pointOfControl)}
          x2={rightEdge}
          y2={priceToY(pointOfControl)}
          stroke={CHART_COLORS.grid}
          strokeWidth={1}
          strokeDasharray="2,2"
          strokeOpacity={0.9}
        />
      ) : null}
    </G>
  );
}

export const VolumeProfile = memo(VolumeProfileBase);
