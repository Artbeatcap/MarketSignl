import type {
  MarketDataPoint,
  EnhancedAIAnalysis,
  EnhancedAnalysisResponse,
  DataFreshness,
  ChartLevels,
  ChartLevelsResponse,
} from '@chartsignl/core';
import { getAccessToken } from './supabase';
import { API_URL } from './apiConfig';

// Analyze a chart using AI (via our backend).
// The backend fetches its own price bars for the symbol and interval, so no
// bars are sent. `_data` and `_freshness` stay in the signature for callers.
export async function analyzeChartData(
  symbol: string,
  interval: string,
  _data: MarketDataPoint[],
  options?: { direction: string; confidence: number; predictionId?: string } | null,
  _freshness?: DataFreshness,
): Promise<EnhancedAIAnalysis> {
  const token = await getAccessToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${API_URL}/api/analyze-data`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      symbol,
      interval,
      ...(options
        ? {
            forecast: { direction: options.direction, confidence: options.confidence },
            ...(options.predictionId ? { predictionId: options.predictionId } : {}),
          }
        : {}),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Analysis failed' }));
    throw new Error(errorData.error || 'Failed to analyze chart');
  }

  const result: EnhancedAnalysisResponse = await response.json();
  
  if (!result.success || !result.analysis) {
    throw new Error(result.error || 'Analysis failed');
  }

  return result.analysis;
}

/**
 * POST /api/levels — the chart's support/resistance before Atlas runs.
 * Same backend function Atlas uses, on bars the backend fetches itself, so the
 * lines do not move or change price when Atlas runs. No AI call and no usage counted.
 * Throws on failure: the caller shows "Levels unavailable" rather than
 * drawing levels from some other calculation.
 */
export async function fetchChartLevels(
  symbol: string,
  interval: string,
  _data: MarketDataPoint[],
): Promise<ChartLevels> {
  const response = await fetch(`${API_URL}/api/levels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, interval }),
  });
  const result: ChartLevelsResponse = await response
    .json()
    .catch(() => ({ success: false, error: `Levels request failed (${response.status})` }));
  if (!response.ok || !result.success || !result.levels) {
    throw new Error(result.error || `Levels request failed (${response.status})`);
  }
  return result.levels;
}

// Determine trend from data
export function detectTrend(data: MarketDataPoint[]): {
  trend: 'bullish' | 'bearish' | 'neutral';
  strength: number;
} {
  if (data.length < 20) {
    return { trend: 'neutral', strength: 0.5 };
  }

  // Compare EMA 9 vs EMA 21
  const recentData = data.slice(-20);
  let bullishCount = 0;
  let bearishCount = 0;

  recentData.forEach((point) => {
    if (point.ema9 && point.ema21) {
      if (point.ema9 > point.ema21) {
        bullishCount++;
      } else {
        bearishCount++;
      }
    }
  });

  const total = bullishCount + bearishCount;
  if (total === 0) {
    return { trend: 'neutral', strength: 0.5 };
  }

  const bullishRatio = bullishCount / total;

  if (bullishRatio > 0.7) {
    return { trend: 'bullish', strength: bullishRatio };
  } else if (bullishRatio < 0.3) {
    return { trend: 'bearish', strength: 1 - bullishRatio };
  }

  return { trend: 'neutral', strength: 0.5 };
}
