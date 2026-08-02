/**
 * Which chart layers are visible. Zustand + AsyncStorage.
 * Defaults keep the first chart clean: price, EMAs, levels. Volume/profile opt-in.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ChartLayerKey = 'ema' | 'volume' | 'volumeProfile' | 'levels';

export interface ChartLayerState {
  ema: boolean;
  volume: boolean;
  volumeProfile: boolean;
  levels: boolean;
  toggle: (key: ChartLayerKey) => void;
  set: (key: ChartLayerKey, value: boolean) => void;
  reset: () => void;
}

const DEFAULTS: Record<ChartLayerKey, boolean> = {
  ema: true,
  levels: true,
  volume: false,
  volumeProfile: false,
};

export const useChartLayers = create<ChartLayerState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      toggle: (key) => set({ [key]: !get()[key] } as Partial<ChartLayerState>),
      set: (key, value) => set({ [key]: value } as Partial<ChartLayerState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'chartsignl.chartLayers.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        ema: s.ema,
        volume: s.volume,
        volumeProfile: s.volumeProfile,
        levels: s.levels,
      }),
      version: 1,
    }
  )
);

export function useChartLayer(key: ChartLayerKey): boolean {
  return useChartLayers((s) => s[key]);
}
