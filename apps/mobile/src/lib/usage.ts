import type { UsageResponse } from '@chartsignl/core';

/** Unified Atlas run consumes one analysis + one prediction counter. */
export function getWeeklyAtlasUsed(usage: UsageResponse | undefined): number {
  if (!usage) return 0;
  return Math.min(usage.freeAnalysesUsed ?? 0, usage.freePredictionsUsed ?? 0);
}
