// Constants only - types are for TypeScript compilation only
export const FREE_ANALYSIS_LIMIT = 3;
export const FREE_PREDICTION_LIMIT = 3;
export const MAX_IMAGE_SIZE_MB = 10;
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Color palette for chart markup
export const MARKUP_COLORS = {
  support_strong: '#10B981',
  support_medium: '#34D399',
  support_weak: '#6EE7B7',
  resistance_strong: '#EF4444',
  resistance_medium: '#F87171',
  resistance_weak: '#FCA5A5',
  breakout: '#3B82F6',
  breakdown: '#F97316',
  pattern: '#8B5CF6',
};

// Chart colors for the clean aesthetic
export const CHART_COLORS = {
  lineStroke: '#14B8A6',
  candleUp: '#10B981',
  candleDown: '#EF4444',
  candleWick: '#78716C',
  ema9: '#F59E0B',
  ema21: '#8B5CF6',
  ema50: '#EC4899',
  support: '#10B981',
  resistance: '#EF4444',
  grid: '#E7E5E4',
  axis: '#A8A29E',
  text: '#57534E',
  background: '#FAFAF9',
  prediction: '#3B82F6',
  predictionBand: 'rgba(59, 130, 246, 0.18)',
  predictionLabel: '#2563EB',
};
