// Re-export all types
export * from './types/chartAnalysis';
export * from './types/user';
export * from './types/api';
export * from './types/marketData';
export * from './types/enhancedAnalysis';
export * from './types/prediction';

// Theme tokens (shared web + mobile)
export * from './theme/index';
export * from './lib/predictionChart';

// Constants
export const FREE_ANALYSIS_LIMIT = 3;
export const FREE_PREDICTION_LIMIT = 3;
export const MAX_IMAGE_SIZE_MB = 10;
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Color palette for chart markup
export const MARKUP_COLORS: Record<string, string> = {
  support_strong: '#10B981', // emerald-500
  support_medium: '#34D399', // emerald-400
  support_weak: '#6EE7B7', // emerald-300
  resistance_strong: '#EF4444', // red-500
  resistance_medium: '#F87171', // red-400
  resistance_weak: '#FCA5A5', // red-300
  breakout: '#3B82F6', // blue-500
  breakdown: '#F97316', // orange-500
  pattern: '#8B5CF6', // violet-500
};

// Chart colors for the clean aesthetic
export const CHART_COLORS = {
  // Line chart
  lineStroke: '#14B8A6', // primary-500 teal
  
  // Candle colors
  candleUp: '#10B981', // green
  candleDown: '#EF4444', // red
  candleWick: '#78716C', // neutral-500
  
  // EMA lines
  ema9: '#F59E0B', // amber
  ema21: '#8B5CF6', // violet
  ema50: '#EC4899', // pink
  
  // Support/Resistance
  support: '#10B981',
  resistance: '#EF4444',
  
  // Grid and axes
  grid: '#E7E5E4', // neutral-200
  axis: '#A8A29E', // neutral-400
  text: '#57534E', // neutral-600
  
  // Background
  background: '#FAFAF9', // warm white

  // AI Prediction overlay
  prediction: '#3B82F6',
  predictionBand: 'rgba(59, 130, 246, 0.18)',
  predictionLabel: '#2563EB',
};
