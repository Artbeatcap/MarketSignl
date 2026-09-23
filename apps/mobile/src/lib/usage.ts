import { FREE_ANALYSIS_LIMIT, FREE_PREDICTION_LIMIT, type UsageResponse } from '@chartsignl/core';

/**
 * Unified Atlas run consumes one analysis and one prediction credit.
 * If one call succeeds and the other fails, the counters diverge. The number
 * shown in the UI is the higher counter, so the badge matches the lock.
 */
export function getWeeklyAtlasUsed(usage: UsageResponse | undefined): number {
  if (!usage) return 0;
  return Math.max(usage.freeAnalysesUsed ?? 0, usage.freePredictionsUsed ?? 0);
}

export function getWeeklyAtlasLimit(usage: UsageResponse | undefined): number {
  return Math.min(
    usage?.freeAnalysesLimit ?? FREE_ANALYSIS_LIMIT,
    usage?.freePredictionsLimit ?? FREE_PREDICTION_LIMIT,
  );
}

/** True when either weekly free counter is exhausted. */
export function isWeeklyAtlasLocked(usage: UsageResponse | undefined): boolean {
  if (!usage || usage.isPro) return false;
  const analysisLimit = usage.freeAnalysesLimit ?? FREE_ANALYSIS_LIMIT;
  const predictionLimit = usage.freePredictionsLimit ?? FREE_PREDICTION_LIMIT;
  return (
    (usage.freeAnalysesUsed ?? 0) >= analysisLimit ||
    (usage.freePredictionsUsed ?? 0) >= predictionLimit
  );
}
