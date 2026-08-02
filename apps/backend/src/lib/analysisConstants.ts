// Analysis Configuration Constants
// All tunable parameters for the technical analysis system

export const ANALYSIS_CONFIG = {
  // === MOVING AVERAGES ===
  EMA_PERIODS: [9, 21, 65, 100, 200] as const,

  // === ATR ===
  ATR_PERIOD: 10,

  // === BOLLINGER BANDS ===
  BOLLINGER_PERIOD: 20,
  BOLLINGER_STD_DEV: 2,

  // === SWING DETECTION ===
  // Bars required on each side to confirm a swing point
  SWING_BARS: {
    intraday: 3, // 1h and below
    daily: 5,
    weekly: 8,
  } as const,

  // === FIBONACCI ===
  FIB_LEVELS: [
    { level: 0.236, label: '23.6%', weight: 10 },
    { level: 0.382, label: '38.2%', weight: 15 },
    { level: 0.5, label: '50%', weight: 25 },
    { level: 0.618, label: '61.8%', weight: 25 },
    { level: 0.786, label: '78.6%', weight: 15 },
  ] as const,
  // Minimum timeframe for Fib calculations (skip for intraday)
  FIB_MIN_TIMEFRAME: 'daily' as const,

  // === CONFLUENCE SCORING ===
  TOLERANCE_BAND_PERCENT: 1.0, // 1% tolerance for alignment

  CONFLUENCE_WEIGHTS: {
    historicalTouches: {
      perTouch: 5,
      maxTouches: 5,
      maxPoints: 25,
    },
    fibonacci: {
      maxPoints: 25,
      // Individual level weights defined in FIB_LEVELS above
    },
    emaProximity: {
      maxPoints: 20,
    },
    volumeNode: {
      maxPoints: 15,
    },
    roundNumber: {
      maxPoints: 10,
    },
    recentRelevance: {
      maxPoints: 5,
      recentPercent: 0.2, // Last 20% of data
    },
  },

  // === STRENGTH THRESHOLDS ===
  STRENGTH_THRESHOLDS: {
    strong: 60,
    medium: 40,
    weak: 25,
  } as const,

  // === DISPLAY SETTINGS ===
  MAX_LEVELS_DEFAULT: 4, // 2 support + 2 resistance
  MAX_LEVELS_EXPANDED: 6, // 3 support + 3 resistance
  MIN_LEVEL_SPACING_PERCENT: 2.0, // Minimum spacing between displayed levels

  // === VOLATILITY REGIME ===
  VOLATILITY_THRESHOLDS: {
    low: 1.5, // ATR% below this = low volatility
    high: 3.0, // ATR% above this = high volatility
  } as const,

  // ATR multipliers for zone calculations based on volatility
  VOLATILITY_ATR_MULTIPLIERS: {
    low: 1.0,
    medium: 1.2,
    high: 1.5,
  } as const,

  // Confluence threshold adjustments based on volatility
  VOLATILITY_CONFLUENCE_ADJUSTMENTS: {
    low: 0, // No adjustment
    medium: 5, // +5 to thresholds
    high: 15, // +15 to thresholds (stricter for volatile stocks)
  } as const,

  // === OVEREXTENSION DETECTION ===
  OVEREXTENSION_THRESHOLDS: {
    // ATR-normalized distance from 21 EMA
    moderate: 1.5,
    overextended: 2.0,
    extreme: 3.0,
  } as const,

  // Percentage-based thresholds (fallback)
  OVEREXTENSION_PERCENT_THRESHOLDS: {
    moderate: 2.0,
    overextended: 4.0,
    extreme: 6.0,
  } as const,

  // === VOLUME PROFILE ===
  VOLUME_PROFILE_BUCKETS: 20,
  VOLUME_NODE_THRESHOLD: 1.5, // Volume > 1.5x average = high volume node

  // === OVERALL CONFIDENCE SCORING ===
  CONFIDENCE: {
    baseScore: 50,
    adjustments: {
      clearTrend: 15, // Not ranging
      strongLevels: 10, // At least one strong S and R
      notOverextended: 10,
      volumeConfirms: 10,
      multiTimeframe: 5, // Reserved for future
    },
    penalties: {
      bollingerSqueeze: -15,
      conflictingSignals: -10,
      insufficientData: -10,
    },
    minDataPoints: 50,
  },

  // === ROUND NUMBER DETECTION ===
  ROUND_NUMBER_DIVISORS: [100, 50, 25, 10, 5] as const, // Check in order of significance
} as const;

// Timeframe classification helper
export function getTimeframeCategory(
  timeframe: string
): 'intraday' | 'daily' | 'weekly' {
  const lowerTf = timeframe.toLowerCase();

  // ChartInterval keys used by the app (must be checked before the generic 'm' match).
  if (
    lowerTf === '1d' ||
    lowerTf === '5d' ||
    lowerTf === '1mo' ||
    lowerTf === '3mo' ||
    lowerTf === '6mo'
  ) {
    return 'daily';
  }
  if (lowerTf === '1y' || lowerTf === '2y' || lowerTf === '5y') {
    return 'weekly';
  }

  if (
    lowerTf.includes('w') ||
    lowerTf.includes('week') ||
    lowerTf.includes('month')
  ) {
    return 'weekly';
  }

  if (
    lowerTf.includes('min') ||
    lowerTf.endsWith('m') ||
    lowerTf === '1h' ||
    lowerTf === '60' ||
    /^\d+m$/.test(lowerTf)
  ) {
    return 'intraday';
  }

  return 'daily';
}

// Check if timeframe is suitable for Fibonacci analysis
export function isFibonacciTimeframe(timeframe: string): boolean {
  const category = getTimeframeCategory(timeframe);
  return category === 'daily' || category === 'weekly';
}

// Get swing bar count for timeframe
export function getSwingBars(timeframe: string): number {
  const category = getTimeframeCategory(timeframe);
  return ANALYSIS_CONFIG.SWING_BARS[category];
}

// Type exports for configuration
export type VolatilityRegime = 'low' | 'medium' | 'high';
export type StrengthLevel = 'strong' | 'medium' | 'weak';
export type TimeframeCategory = 'intraday' | 'daily' | 'weekly';




