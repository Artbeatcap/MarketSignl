import type { MarketDataPoint } from '@chartsignl/core';

const MASSIVE_BASE_URL = process.env.MASSIVE_BASE_URL?.trim() || 'https://api.massive.com';

export type MassiveTimespan = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface IntervalBarConfig {
  timespan: MassiveTimespan;
  multiplier: number;
}

/** Bar size config aligned with marketData route intervals. */
export const INTERVAL_BAR_CONFIG: Record<string, IntervalBarConfig> = {
  '1d': { timespan: 'minute', multiplier: 5 },
  '5d': { timespan: 'minute', multiplier: 30 },
  '1mo': { timespan: 'day', multiplier: 1 },
  '3mo': { timespan: 'day', multiplier: 1 },
  '6mo': { timespan: 'day', multiplier: 1 },
  '1y': { timespan: 'day', multiplier: 1 },
  '2y': { timespan: 'week', multiplier: 1 },
  '5y': { timespan: 'week', multiplier: 1 },
};

function getMassiveApiKey(): string | null {
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  return apiKey || null;
}

function barDurationMs(config: IntervalBarConfig): number {
  const base: Record<MassiveTimespan, number> = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    quarter: 91 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  return config.multiplier * base[config.timespan];
}

export async function fetchAggregatesInRange(
  symbol: string,
  fromMs: number,
  toMs: number,
  interval: string
): Promise<MarketDataPoint[]> {
  const apiKey = getMassiveApiKey();
  if (!apiKey) {
    throw new Error('MASSIVE_API_KEY not configured');
  }

  const config = INTERVAL_BAR_CONFIG[interval] ?? INTERVAL_BAR_CONFIG['3mo'];
  const symbolUpper = symbol.toUpperCase();

  const url = `${MASSIVE_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(symbolUpper)}/range/${config.multiplier}/${config.timespan}/${fromMs}/${toMs}?adjusted=true&sort=asc&limit=5000&apiKey=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Massive API error: ${response.status}`);
  }

  const json = (await response.json()) as {
    status?: string;
    results?: Array<{ t: number; o: number; h: number; l: number; c: number; v?: number }>;
  };

  if (json.status === 'ERROR' || json.status === 'NOT_FOUND' || !json.results?.length) {
    return [];
  }

  return json.results.map((bar) => ({
    timestamp: bar.t,
    date: new Date(bar.t).toISOString(),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v ?? 0,
  }));
}

/** Last bar at or before targetMs; falls forward one bar if needed. */
export function closeAtTimestamp(bars: MarketDataPoint[], targetMs: number): number | null {
  if (bars.length === 0) return null;

  let best: MarketDataPoint | null = null;
  for (const bar of bars) {
    if (bar.timestamp <= targetMs) best = bar;
    else break;
  }

  if (best) return best.close;

  // Target is before first bar — use first available
  return bars[0].close;
}

export function getBarDurationMs(interval: string): number {
  const config = INTERVAL_BAR_CONFIG[interval] ?? INTERVAL_BAR_CONFIG['3mo'];
  return barDurationMs(config);
}
