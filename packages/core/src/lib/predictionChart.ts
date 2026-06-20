import type { ProjectedPoint } from '../types/prediction';

/** Fraction of chart width reserved for the AI prediction future zone */
export const PREDICTION_ZONE_RATIO = 0.28;

export interface PredictionLayout {
  historicalWidth: number;
  futureWidth: number;
  dividerX: number;
  xForHistoricalIndex: (index: number, dataLength: number) => number;
  xForFutureIndex: (index: number, pathLength: number) => number;
}

export function getPredictionLayout(
  chartLeft: number,
  chartDrawableWidth: number
): PredictionLayout {
  const historicalWidth = chartDrawableWidth * (1 - PREDICTION_ZONE_RATIO);
  const futureWidth = chartDrawableWidth * PREDICTION_ZONE_RATIO;
  const dividerX = chartLeft + historicalWidth;

  return {
    historicalWidth,
    futureWidth,
    dividerX,
    xForHistoricalIndex: (index: number, dataLength: number) => {
      if (dataLength <= 1) return chartLeft;
      return chartLeft + (index / (dataLength - 1)) * historicalWidth;
    },
    xForFutureIndex: (index: number, pathLength: number) => {
      if (pathLength <= 0) return dividerX;
      return dividerX + ((index + 1) / pathLength) * futureWidth;
    },
  };
}

export function getPriceDomainWithPrediction(
  dataPrices: number[],
  projectedPath: ProjectedPoint[]
): { minPrice: number; maxPrice: number } {
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

export function buildPredictionBandPath(
  projectedPath: ProjectedPoint[],
  xForFutureIndex: (index: number, pathLength: number) => number,
  priceToY: (price: number) => number,
  startX: number,
  startY: number
): string {
  if (projectedPath.length === 0) return '';

  const upperPoints = projectedPath.map((p, i) => {
    const x = xForFutureIndex(i, projectedPath.length);
    const y = priceToY(p.upperBand ?? p.price);
    return `${i === 0 ? 'L' : 'L'} ${x} ${y}`;
  });

  const lowerPoints = [...projectedPath]
    .reverse()
    .map((p, i) => {
      const origIndex = projectedPath.length - 1 - i;
      const x = xForFutureIndex(origIndex, projectedPath.length);
      const y = priceToY(p.lowerBand ?? p.price);
      return `L ${x} ${y}`;
    });

  return `M ${startX} ${startY} ${upperPoints.join(' ')} ${lowerPoints.join(' ')} Z`;
}

export function buildPredictionLinePath(
  projectedPath: ProjectedPoint[],
  xForFutureIndex: (index: number, pathLength: number) => number,
  priceToY: (price: number) => number,
  startX: number,
  startY: number
): string {
  if (projectedPath.length === 0) return '';

  const segments = projectedPath.map((p, i) => {
    const x = xForFutureIndex(i, projectedPath.length);
    const y = priceToY(p.price);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  });

  return `M ${startX} ${startY} ${segments.join(' ').replace(/^M /, 'L ')}`;
}
