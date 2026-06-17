import type { ChartInterval } from './marketData';

export interface ProjectedPoint {
  timestamp: number;
  price: number;
  lowerBand?: number;
  upperBand?: number;
}

export type PredictionDirection = 'bullish' | 'bearish' | 'neutral';

export interface AIPrediction {
  id?: string;
  symbol: string;
  interval: ChartInterval;
  headline: string;
  summary: string;
  reasoning: string[];
  riskFactors: string[];
  direction: PredictionDirection;
  confidence: number;
  expectedChangePct: number;
  projectedPath: ProjectedPoint[];
  createdAt?: string;
}

export interface PredictRequest {
  symbol: string;
  interval: ChartInterval;
  data: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    ema9?: number;
    ema21?: number;
    ema65?: number;
  }>;
  horizonBars?: number;
}

export interface PredictResponse {
  success: boolean;
  predictionId?: string;
  prediction?: AIPrediction;
  error?: string;
}

export interface PredictionHistoryItem {
  id: string;
  symbol: string;
  interval: string;
  headline: string;
  expectedChangePct: number;
  confidence: number;
  direction: PredictionDirection;
  createdAt: string;
}

export interface GetPredictionsResponse {
  success: boolean;
  predictions?: PredictionHistoryItem[];
  total?: number;
  hasMore?: boolean;
  error?: string;
}

export interface GetPredictionResponse {
  success: boolean;
  prediction?: AIPrediction;
  createdAt?: string;
  error?: string;
}
