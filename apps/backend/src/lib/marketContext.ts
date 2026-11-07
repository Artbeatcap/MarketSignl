import type { MarketContext } from '@chartsignl/core';
import type { MarketDataPoint } from './technicalCalculator.js';

export const CONTEXT_VERSION = 'semiconductor-leadership-v1';
const BENCHMARKS = ['SMH', 'QQQ', 'RSP'] as const;
type Benchmark = typeof BENCHMARKS[number];
type Bars = Record<Benchmark, MarketDataPoint[]>;
const DAY_MS = 86_400_000;
const etDate = (ms: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(ms));

/** Conservatively exclude the analysis session, including partial daily bars. */
export function contextCutoff(asOfMs: number): string {
  return new Date(Date.parse(`${etDate(asOfMs)}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

function mean(values: number[]): number {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

/** OLS slope, expressed as percent of the first ratio per observed session. */
function ratioSlope(a: MarketDataPoint[], b: MarketDataPoint[]): number {
  const values = a.slice(-20).map((bar, i) => bar.close / b.slice(-20)[i].close);
  const midpoint = (values.length - 1) / 2;
  const average = mean(values);
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, i) => {
    numerator += (i - midpoint) * (value - average);
    denominator += (i - midpoint) ** 2;
  });
  return numerator / denominator / values[0] * 100;
}

export function computeMarketContext(input: Bars, cutoff: string): MarketContext {
  const bars = {} as Bars;
  for (const ticker of BENCHMARKS) {
    const eligible = input[ticker].filter((bar) => etDate(bar.timestamp) <= cutoff);
    if (eligible.length < 200) throw new Error('insufficient_history');
    for (let i = 0; i < eligible.length; i++) {
      const bar = eligible[i];
      if (![bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
          || bar.close <= 0 || bar.low <= 0 || bar.open <= 0 || bar.volume < 0
          || bar.low > Math.min(bar.close, bar.open) || bar.high < Math.max(bar.close, bar.open)
          || (i > 0 && etDate(eligible[i - 1].timestamp) >= etDate(bar.timestamp))) {
        throw new Error('invalid_bars');
      }
    }
    bars[ticker] = eligible;
  }
  const dates = bars.QQQ.slice(-200).map((bar) => etDate(bar.timestamp));
  for (const ticker of BENCHMARKS) {
    if (bars[ticker].slice(-200).some((bar, i) => etDate(bar.timestamp) !== dates[i])) {
      throw new Error('unaligned_sessions');
    }
  }
  const asOfSession = dates[dates.length - 1];
  if (Date.parse(cutoff) - Date.parse(asOfSession) > 5 * DAY_MS) throw new Error('stale_bars');
  const last = bars.QQQ[bars.QQQ.length - 1];
  const averageVolume = mean(bars.QQQ.slice(-21, -1).map((bar) => bar.volume));
  if (averageVolume <= 0) throw new Error('missing_volume');
  const volumeMultiple = last.volume / averageVolume;
  const range = last.high - last.low;
  const distribution = range > 0 && (last.close - last.low) / range <= 0.1 && volumeMultiple >= 2;
  const smhQqqSlope20 = ratioSlope(bars.SMH, bars.QQQ);
  const rspQqqSlope20 = ratioSlope(bars.RSP, bars.QQQ);
  const smhAbove200 = bars.SMH.at(-1)!.close > mean(bars.SMH.slice(-200).map((bar) => bar.close));
  const qqqAbove200 = last.close > mean(bars.QQQ.slice(-200).map((bar) => bar.close));
  const regime = smhQqqSlope20 < 0 && (!smhAbove200 || distribution)
    ? 'factor_breakdown'
    : smhQqqSlope20 > 0 && smhAbove200 && qqqAbove200 && !distribution ? 'risk_on' : 'neutral';
  return {
    status: 'available', version: CONTEXT_VERSION, scope: 'semiconductor_leadership',
    asOfSession, regime, smhQqqSlope20, rspQqqSlope20, smhAbove200, qqqAbove200,
    qqqDistributionDay: distribution, qqqVolumeMultiple: volumeMultiple,
  };
}

type FetchBars = (ticker: string, fromMs: number, toMs: number) => Promise<MarketDataPoint[]>;
const cache = new Map<string, { expires: number; value: MarketContext }>();

async function fetchDaily(ticker: string, fromMs: number, toMs: number): Promise<MarketDataPoint[]> {
  const key = process.env.MASSIVE_API_KEY?.trim() || process.env.POLYGON_API_KEY?.trim();
  if (!key) throw new Error('provider_unavailable');
  const base = process.env.MASSIVE_BASE_URL?.trim() || 'https://api.massive.com';
  // Same auth as marketDataFetcher (apiKey query param), so the URL must never be logged.
  const response = await fetch(`${base}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromMs}/${toMs}?adjusted=true&sort=asc&limit=5000&apiKey=${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const body = await response.json() as { results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> };
  if (!Array.isArray(body.results)) throw new Error('provider_no_results');
  return body.results.map((b) => ({ timestamp: b.t, date: etDate(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
}

/** Explicit degraded state: a missing provider never becomes a neutral regime. */
export async function loadMarketContext(asOfMs: number, fetchBars?: FetchBars): Promise<MarketContext> {
  const unavailable = (): MarketContext => ({
    status: 'unavailable', version: CONTEXT_VERSION, scope: 'semiconductor_leadership',
    reason: 'Market context unavailable. Broader conditions could not be verified; a stretched price is not confirmation of a reversal.',
  });
  if (!Number.isFinite(asOfMs) || asOfMs > Date.now()) {
    console.warn(`[MarketContext] Benchmark data unavailable: invalid_as_of`, { asOfMs });
    return unavailable();
  }
  const cutoff = contextCutoff(asOfMs);
  const cached = !fetchBars ? cache.get(cutoff) : undefined;
  if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
  try {
    const to = Date.parse(`${cutoff}T23:59:59Z`);
    const entries = await Promise.all(BENCHMARKS.map(async (ticker) => [ticker,
      await (fetchBars ?? fetchDaily)(ticker, to - 450 * DAY_MS, to)] as const));
    const context = computeMarketContext(Object.fromEntries(entries) as Bars, cutoff);
    if (!fetchBars) {
      cache.set(cutoff, { expires: Date.now() + 15 * 60_000, value: context });
      while (cache.size > 8) cache.delete(cache.keys().next().value!);
    }
    return context;
  } catch (error) {
    // Only log our own reason codes; foreign error messages may echo the request URL and its apiKey.
    const message = error instanceof Error ? error.message : '';
    const reason = /^(provider_[a-z0-9_]+|insufficient_history|invalid_bars|unaligned_sessions|stale_bars|missing_volume)$/.test(message)
      ? message
      : `unexpected_${error instanceof Error ? error.name : typeof error}`;
    console.warn(`[MarketContext] Benchmark data unavailable: ${reason}`, { cutoff });
    return unavailable();
  }
}
