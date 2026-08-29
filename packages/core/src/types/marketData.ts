// Market Data Types for Chart Display

import type { DataFreshness } from './dataFreshness';

export interface OHLCV {
  timestamp: number; // Unix timestamp in ms
  date: string; // ISO date string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataPoint {
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Calculated indicators
  ema9?: number;
  ema21?: number;
  ema50?: number;
}

export interface AILevel {
  id: string;
  type: 'support' | 'resistance';
  price: number;
  strength: 'strong' | 'medium' | 'weak';
  touches: number;
  description: string;
}

export interface AITrendLine {
  id: string;
  type: 'uptrend' | 'downtrend';
  startPrice: number;
  endPrice: number;
  startIndex: number;
  endIndex: number;
  description: string;
}

export interface AIChartAnalysis {
  symbol: string;
  timeframe: string;
  analyzedAt: string;
  /** Freshness of the price data this analysis was computed from. */
  freshness?: DataFreshness;

  // Current price context
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  
  // Detected levels
  supportLevels: AILevel[];
  resistanceLevels: AILevel[];
  
  // Trend analysis
  overallTrend: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  trendStrength: number; // 0-1
  trendLines: AITrendLine[];
  
  // Key observations
  keyObservations: string[];
  
  // Trading ideas (educational only)
  tradingIdeas: {
    scenario: string;
    entry?: string;
    target?: string;
    stop?: string;
    riskNote: string;
  }[];
}

export type ChartViewType = 'line' | 'candle';

export type ChartInterval = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y';

export const CHART_INTERVAL_OPTIONS: { label: string; value: ChartInterval }[] = [
  { label: '1D', value: '1d' },
  { label: '5D', value: '5d' },
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y' },
  { label: '2Y', value: '2y' },
  { label: '5Y', value: '5y' },
];
