import { create } from 'zustand';
import type { DataFreshness } from '@chartsignl/core';

interface MarketDataState {
  lastFreshness: DataFreshness | undefined;
  setLastFreshness: (freshness: DataFreshness | undefined) => void;
}

export const useMarketDataStore = create<MarketDataState>((set) => ({
  lastFreshness: undefined,
  setLastFreshness: (freshness) => set({ lastFreshness: freshness }),
}));
