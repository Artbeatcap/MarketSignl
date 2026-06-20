import type { MarketDataPoint, EnhancedAIAnalysis, AILevel, EnhancedAnalysisResponse } from '@chartsignl/core';
import { getAccessToken } from './supabase';
import { API_URL } from './apiConfig';

// Analyze chart data using AI (via our backend)
export async function analyzeChartData(
  symbol: string,
  interval: string,
  data: MarketDataPoint[],
  forecast?: { direction: string; confidence: number } | null
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
      data: data.slice(-100), // Send last 100 data points
      ...(forecast ? { forecast } : {}),
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

// Local analysis - find support/resistance levels algorithmically
// This runs without AI for instant feedback
export function findLocalLevels(data: MarketDataPoint[]): {
  support: AILevel[];
  resistance: AILevel[];
} {
  if (data.length < 10) {
    return { support: [], resistance: [] };
  }

  const support: AILevel[] = [];
  const resistance: AILevel[] = [];

  // Find swing highs and lows
  const swingWindow = 5;

  for (let i = swingWindow; i < data.length - swingWindow; i++) {
    const current = data[i];
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - swingWindow; j <= i + swingWindow; j++) {
      if (j === i) continue;
      if (data[j].high >= current.high) isSwingHigh = false;
      if (data[j].low <= current.low) isSwingLow = false;
    }

    if (isSwingHigh) {
      // Check if similar level already exists
      const existingIdx = resistance.findIndex(
        (r) => Math.abs(r.price - current.high) / current.high < 0.01
      );
      if (existingIdx >= 0) {
        resistance[existingIdx].touches++;
      } else {
        resistance.push({
          id: `r-${i}`,
          type: 'resistance',
          price: current.high,
          strength: 'medium',
          touches: 1,
          description: `Swing high at $${current.high.toFixed(2)}`,
        });
      }
    }

    if (isSwingLow) {
      const existingIdx = support.findIndex(
        (s) => Math.abs(s.price - current.low) / current.low < 0.01
      );
      if (existingIdx >= 0) {
        support[existingIdx].touches++;
      } else {
        support.push({
          id: `s-${i}`,
          type: 'support',
          price: current.low,
          strength: 'medium',
          touches: 1,
          description: `Swing low at $${current.low.toFixed(2)}`,
        });
      }
    }
  }

  // Update strength based on touches
  const updateStrength = (levels: AILevel[]) => {
    levels.forEach((level) => {
      if (level.touches >= 3) {
        level.strength = 'strong';
      } else if (level.touches === 1) {
        level.strength = 'weak';
      }
    });
  };

  updateStrength(support);
  updateStrength(resistance);

  // Sort by price and take top levels
  const sortedSupport = support
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 3);
  const sortedResistance = resistance
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 3);

  return {
    support: sortedSupport,
    resistance: sortedResistance,
  };
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
