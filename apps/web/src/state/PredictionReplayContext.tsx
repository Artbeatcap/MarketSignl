import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getPriceDomainWithPrediction,
  type AIPrediction,
  type ChartInterval,
  type GetPredictionResponse,
  type MarketDataPoint,
  type ProjectedPoint,
} from '@marketsignl/core';
import { apiFetch, publicFetch } from '../lib/api';

const WARMUP_BARS = 40;

function barDurationMs(interval: string): number {
  const base: Record<string, number> = {
    '1d': 5 * 60 * 1000,
    '5d': 30 * 60 * 1000,
    '1mo': 24 * 60 * 60 * 1000,
    '3mo': 24 * 60 * 60 * 1000,
    '6mo': 24 * 60 * 60 * 1000,
    '1y': 24 * 60 * 60 * 1000,
    '2y': 7 * 24 * 60 * 60 * 1000,
    '5y': 7 * 24 * 60 * 60 * 1000,
  };
  return base[interval] ?? base['3mo'];
}

export interface ReplayData {
  prediction: AIPrediction;
  historical: MarketDataPoint[];
  actual: ProjectedPoint[];
  priceDomain: { minPrice: number; maxPrice: number };
}

interface ReplayContextValue {
  active: ReplayData | null;
  loading: boolean;
  error: string | null;
  replay: (id: string) => Promise<void>;
  clear: () => void;
}

const ReplayContext = createContext<ReplayContextValue | null>(null);

export function PredictionReplayProvider({
  getToken,
  children,
}: {
  getToken: () => Promise<string | null>;
  children: ReactNode;
}) {
  const [active, setActive] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    setActive(null);
    setError(null);
  }, []);

  const replay = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        await getToken();

        const pRes = await apiFetch<GetPredictionResponse>(`/api/predictions/${id}`);
        if (!pRes.success || !pRes.prediction) {
          throw new Error(pRes.error ?? 'Prediction not found');
        }
        const prediction = pRes.prediction;

        const createdMs = prediction.createdAt ? Date.parse(prediction.createdAt) : NaN;
        const horizonMs = prediction.horizonEndAt
          ? Date.parse(prediction.horizonEndAt)
          : (prediction.projectedPath.at(-1)?.timestamp ?? NaN);

        const interval = prediction.interval as ChartInterval;
        const barMs = barDurationMs(interval);
        const fromMs = Number.isFinite(createdMs)
          ? createdMs - WARMUP_BARS * barMs
          : Date.now() - 140 * 24 * 60 * 60 * 1000;
        const toMs = Number.isFinite(horizonMs)
          ? Math.max(Date.now(), horizonMs)
          : Date.now();

        const md = await publicFetch<{ data: MarketDataPoint[] }>(
          `/api/market-data/${encodeURIComponent(prediction.symbol)}?interval=${encodeURIComponent(interval)}&from=${fromMs}&to=${toMs}`
        );
        const candles = md?.data ?? [];

        const hasAnchor = Number.isFinite(createdMs);
        const historical = hasAnchor
          ? candles.filter((c) => c.timestamp <= createdMs)
          : candles;

        const actual: ProjectedPoint[] =
          hasAnchor && Number.isFinite(horizonMs)
            ? candles
                .filter((c) => c.timestamp > createdMs && c.timestamp <= horizonMs)
                .map((c) => ({ timestamp: c.timestamp, price: c.close }))
            : [];

        const priceDomain = getPriceDomainWithPrediction(
          [
            ...(historical.length ? historical : candles).map((c) => c.close),
            ...actual.map((a) => a.price),
          ],
          prediction.projectedPath
        );

        setActive({
          prediction,
          historical: historical.length ? historical : candles,
          actual,
          priceDomain,
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Replay failed');
        setActive(null);
      } finally {
        setLoading(false);
      }
    },
    [getToken]
  );

  const value = useMemo(
    () => ({ active, loading, error, replay, clear }),
    [active, loading, error, replay, clear]
  );

  return <ReplayContext.Provider value={value}>{children}</ReplayContext.Provider>;
}

export function usePredictionReplay(): ReplayContextValue {
  const ctx = useContext(ReplayContext);
  if (!ctx) {
    throw new Error('usePredictionReplay must be used inside PredictionReplayProvider');
  }
  return ctx;
}
