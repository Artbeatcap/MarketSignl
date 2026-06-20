import { create } from 'zustand';
import type { ChartAnalysis } from '@chartsignl/core';

interface AnalysisState {
  // Current analysis being viewed
  currentImageUri: string | null;
  currentAnalysis: ChartAnalysis | null;
  currentImageUrl: string | null;
  isAnalyzing: boolean;
  error: string | null;
  
  // Actions
  setCurrentImage: (uri: string) => void;
  setAnalysis: (analysis: ChartAnalysis, imageUrl: string) => void;
  setAnalyzing: (isAnalyzing: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  currentImageUri: null,
  currentAnalysis: null,
  currentImageUrl: null,
  isAnalyzing: false,
  error: null,

  setCurrentImage: (uri) =>
    set({
      currentImageUri: uri,
      currentAnalysis: null,
      currentImageUrl: null,
      error: null,
    }),

  setAnalysis: (analysis, imageUrl) =>
    set({
      currentAnalysis: analysis,
      currentImageUrl: imageUrl,
      isAnalyzing: false,
      error: null,
    }),

  setAnalyzing: (isAnalyzing) => set({ isAnalyzing, error: null }),

  setError: (error) => set({ error, isAnalyzing: false }),

  clear: () =>
    set({
      currentImageUri: null,
      currentAnalysis: null,
      currentImageUrl: null,
      isAnalyzing: false,
      error: null,
    }),
}));
