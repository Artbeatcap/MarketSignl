// Runtime entry — keep in sync with index.ts
export const FREE_ANALYSIS_LIMIT = 3;
export const FREE_PREDICTION_LIMIT = 3;
export const MAX_IMAGE_SIZE_MB = 10;
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const MARKUP_COLORS = {
  support_strong: '#10B981',
  support_medium: '#34D399',
  support_weak: '#6EE7B7',
  resistance_strong: '#EF4444',
  resistance_medium: '#F87171',
  resistance_weak: '#FCA5A5',
  breakout: '#3B82F6',
  breakdown: '#F97316',
  pattern: '#8B5CF6',
};

export const CHART_COLORS = {
  lineStroke: '#14B8A6',
  candleUp: '#10B981',
  candleDown: '#EF4444',
  candleWick: '#78716C',
  ema9: '#F59E0B',
  ema21: '#8B5CF6',
  ema50: '#EC4899',
  support: '#10B981',
  resistance: '#EF4444',
  grid: '#E7E5E4',
  axis: '#A8A29E',
  text: '#57534E',
  background: '#FAFAF9',
  prediction: '#3B82F6',
  predictionBand: 'rgba(59, 130, 246, 0.18)',
  predictionLabel: '#2563EB',
};

// Prediction chart helpers (used by mobile/web bundlers)
export const PREDICTION_ZONE_RATIO = 0.28;

export function getPredictionLayout(chartLeft, chartDrawableWidth) {
  const historicalWidth = chartDrawableWidth * (1 - PREDICTION_ZONE_RATIO);
  const futureWidth = chartDrawableWidth * PREDICTION_ZONE_RATIO;
  const dividerX = chartLeft + historicalWidth;
  return {
    historicalWidth,
    futureWidth,
    dividerX,
    xForHistoricalIndex: (index, dataLength) => {
      if (dataLength <= 1) return chartLeft;
      return chartLeft + (index / (dataLength - 1)) * historicalWidth;
    },
    xForFutureIndex: (index, pathLength) => {
      if (pathLength <= 0) return dividerX;
      return dividerX + ((index + 1) / pathLength) * futureWidth;
    },
  };
}

export function getPriceDomainWithPrediction(dataPrices, projectedPath) {
  const allPrices = [
    ...dataPrices,
    ...projectedPath.flatMap((p) => [p.price, p.lowerBand ?? p.price, p.upperBand ?? p.price]),
  ];
  if (allPrices.length === 0) return { minPrice: 0, maxPrice: 100 };
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const padding = (max - min) * 0.05 || 1;
  return { minPrice: min - padding, maxPrice: max + padding };
}

export function buildPredictionBandPath(projectedPath, xForFutureIndex, priceToY, startX, startY) {
  if (projectedPath.length === 0) return '';
  const upperPoints = projectedPath.map((p, i) => {
    const x = xForFutureIndex(i, projectedPath.length);
    const y = priceToY(p.upperBand ?? p.price);
    return `L ${x} ${y}`;
  });
  const lowerPoints = [...projectedPath].reverse().map((p, i) => {
    const origIndex = projectedPath.length - 1 - i;
    const x = xForFutureIndex(origIndex, projectedPath.length);
    const y = priceToY(p.lowerBand ?? p.price);
    return `L ${x} ${y}`;
  });
  return `M ${startX} ${startY} ${upperPoints.join(' ')} ${lowerPoints.join(' ')} Z`;
}

export function buildPredictionLinePath(projectedPath, xForFutureIndex, priceToY, startX, startY) {
  if (projectedPath.length === 0) return '';
  const segments = projectedPath.map((p, i) => {
    const x = xForFutureIndex(i, projectedPath.length);
    const y = priceToY(p.price);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  });
  return `M ${startX} ${startY} ${segments.join(' ').replace(/^M /, 'L ')}`;
}
