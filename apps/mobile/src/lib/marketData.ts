import type { MarketDataPoint, ChartInterval } from '@chartsignl/core';
import { API_URL } from './apiConfig';

export interface MarketDataResponse {
  symbol: string;
  interval: string;
  resultsCount?: number;
  data: MarketDataPoint[];
  visibleStartIndex?: number;
  emaWarmupBars?: number;
  totalBars?: number;
}

export interface FetchMarketDataResult {
  data: MarketDataPoint[];
  visibleStartIndex: number;
  emaWarmupBars: number;
}

// Fetch market data from our backend (which proxies to Massive.com)
export async function fetchMarketData(
  symbol: string,
  interval: ChartInterval = '3mo'
): Promise<FetchMarketDataResult> {
  const url = `${API_URL}/api/market-data/${encodeURIComponent(symbol)}?interval=${interval}`;
  
  let response: Response;
  try {
    response = await fetch(url);
  } catch (fetchError) {
    throw new Error(`Network error: ${fetchError instanceof Error ? fetchError.message : 'Failed to fetch'}`);
  }

  if (!response.ok) {
    let error: any;
    try {
      error = await response.json();
    } catch (parseError) {
      error = { error: `HTTP ${response.status}: ${response.statusText}` };
    }
    throw new Error(error.error || 'Failed to fetch market data');
  }

  let data: any;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error('Failed to parse response');
  }

  if (!data.data) {
    throw new Error('Response missing data property');
  }

  if (!Array.isArray(data.data)) {
    throw new Error('Response data is not an array');
  }

  const visibleStartIndex =
    typeof data.visibleStartIndex === 'number' && Number.isFinite(data.visibleStartIndex) && data.visibleStartIndex >= 0
      ? Math.floor(data.visibleStartIndex)
      : 0;

  const emaWarmupBars =
    typeof data.emaWarmupBars === 'number' && Number.isFinite(data.emaWarmupBars) && data.emaWarmupBars >= 0
      ? Math.floor(data.emaWarmupBars)
      : visibleStartIndex;

  return {
    data: data.data as MarketDataPoint[],
    visibleStartIndex,
    emaWarmupBars,
  };
}

// Calculate EMA (Exponential Moving Average)
export function calculateEMA(data: number[], period: number): (number | undefined)[] {
  const ema: (number | undefined)[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ema.push(undefined);
    } else if (i === period - 1) {
      // First EMA is SMA
      const sum = data.slice(0, period).reduce((a, b) => a + b, 0);
      ema.push(sum / period);
    } else {
      const prevEma = ema[i - 1] as number;
      ema.push((data[i] - prevEma) * multiplier + prevEma);
    }
  }

  return ema;
}

// Add EMAs to market data
export function addIndicators(data: MarketDataPoint[]): MarketDataPoint[] {
  if (!data || data.length === 0) {
    return [];
  }
  
  const closes = data.map((d) => d.close);

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);

  const result = data.map((point, i) => ({
    ...point,
    ema9: ema9[i],
    ema21: ema21[i],
    ema50: ema50[i],
  }));
  
  return result;
}

// Calculate indicators on full data, then trim warmup bars before display
export function addIndicatorsAndTrim(data: MarketDataPoint[], visibleStartIndex: number): MarketDataPoint[] {
  const withIndicators = addIndicators(data);
  if (!withIndicators.length) return [];

  const safeIndex =
    Number.isFinite(visibleStartIndex) && visibleStartIndex > 0
      ? Math.min(Math.floor(visibleStartIndex), withIndicators.length)
      : 0;

  const trimmed = withIndicators.slice(safeIndex);

  return trimmed;
}

// Convenience function: fetch + add indicators + trim warmup
export async function fetchMarketDataWithIndicators(
  symbol: string,
  interval: ChartInterval = '3mo'
): Promise<MarketDataPoint[]> {
  const { data, visibleStartIndex } = await fetchMarketData(symbol, interval);
  return addIndicatorsAndTrim(data, visibleStartIndex);
}

// Format price for display
export function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } else if (price >= 1) {
    return price.toFixed(2);
  } else {
    return price.toFixed(4);
  }
}

// Format volume for display
export function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) {
    return (volume / 1_000_000_000).toFixed(1) + 'B';
  } else if (volume >= 1_000_000) {
    return (volume / 1_000_000).toFixed(1) + 'M';
  } else if (volume >= 1_000) {
    return (volume / 1_000).toFixed(1) + 'K';
  }
  return volume.toString();
}

// Format date based on interval
export function formatChartDate(timestamp: number, interval: ChartInterval): string {
  const date = new Date(timestamp);

  if (interval === '1d' || interval === '5d') {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } else if (interval === '1mo') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
}

// Calculate price change
export function calculatePriceChange(data: MarketDataPoint[]): {
  change: number;
  changePercent: number;
  isPositive: boolean;
} {
  if (data.length < 2) {
    return { change: 0, changePercent: 0, isPositive: true };
  }

  const firstClose = data[0].close;
  const lastClose = data[data.length - 1].close;
  const change = lastClose - firstClose;
  const changePercent = (change / firstClose) * 100;

  return {
    change,
    changePercent,
    isPositive: change >= 0,
  };
}
