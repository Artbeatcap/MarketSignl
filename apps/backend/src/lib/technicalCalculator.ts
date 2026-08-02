// Technical Calculator Module
// All indicator calculations performed server-side

import {
  ANALYSIS_CONFIG,
  getSwingBars,
  isFibonacciTimeframe,
  type VolatilityRegime,
} from './analysisConstants.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface MarketDataPoint {
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EMAData {
  ema9: number;
  ema21: number;
  ema65: number;
  ema100: number;
  ema200: number;
  values: {
    period: number;
    value: number;
    pricePosition: 'above' | 'below';
  }[];
}

export interface TrendState {
  direction:
    | 'strong_uptrend'
    | 'uptrend'
    | 'weak_uptrend'
    | 'ranging'
    | 'weak_downtrend'
    | 'downtrend'
    | 'strong_downtrend';
  emaAlignment:
    | 'perfectly_bullish'
    | 'mostly_bullish'
    | 'mixed'
    | 'mostly_bearish'
    | 'perfectly_bearish';
  strength: number; // 0-100
  tradingBias: 'long' | 'neutral' | 'short';
  biasReason: string;
}

export interface ATRData {
  atr: number;
  atrPercent: number;
  volatilityRegime: VolatilityRegime;
  atrMultiplier: number; // Based on volatility regime
}

export interface BollingerData {
  upperBand: number;
  middleBand: number;
  lowerBand: number;
  bandWidth: number;
  percentB: number;
  squeeze: boolean;
  position: 'above_upper' | 'upper_half' | 'lower_half' | 'below_lower';
}

export interface SwingPoint {
  price: number;
  type: 'high' | 'low';
  date: string;
  barIndex: number;
  touches: number;
  lastTouchDate: string | null;
  isRecent: boolean;
}

export interface FibonacciData {
  swingHigh: number;
  swingHighDate: string;
  swingLow: number;
  swingLowDate: string;
  swingDirection: 'up' | 'down';
  levels: {
    level: number;
    price: number;
    label: string;
    weight: number;
  }[];
  currentRetracement: number;
  swingSource?: string;
  swingBarsAgo?: number;
  swingRangeATR?: number | null;
}

export interface VolumeProfile {
  highVolumeNodes: {
    priceRangeLow: number;
    priceRangeHigh: number;
    priceMid: number;
    volumePercent: number;
    widthATR?: number | null;
    distanceATR?: number | null;
    trimmed?: boolean;
  }[];
  pointOfControl: number;
  averageVolume: number;
  valueAreaHigh?: number;
  valueAreaLow?: number;
  bucketCount?: number;
  bucketSize?: number;
  recencyHalfLifeBars?: number;
}

export interface OverextensionData {
  distanceFromEma21: number;
  distanceFromEma21Percent: number;
  atrNormalizedDistance: number;
  status: 'normal' | 'moderately_extended' | 'overextended' | 'extremely_extended';
  direction: 'above' | 'below';
  meanReversionSignal: boolean;
  signalType: 'none' | 'pullback_expected' | 'reversal_candidate' | 'strong_reversal';
}

export interface TechnicalIndicators {
  symbol: string;
  timeframe: string;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  dataPoints: number;

  ema: EMAData;
  trend: TrendState;
  atr: ATRData;
  bollinger: BollingerData;
  overextension: OverextensionData;
  fibonacci: FibonacciData | null;
  volumeProfile: VolumeProfile;
  swingPoints: SwingPoint[];
}

// ============================================================================
// EMA CALCULATION
// ============================================================================

function calculateEMA(data: number[], period: number): number[] {
  if (data.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const emaValues: number[] = [];

  // First EMA value is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  emaValues.push(sum / period);

  // Calculate subsequent EMAs
  for (let i = period; i < data.length; i++) {
    const ema = (data[i] - emaValues[emaValues.length - 1]) * multiplier + emaValues[emaValues.length - 1];
    emaValues.push(ema);
  }

  return emaValues;
}

export function calculateAllEMAs(data: MarketDataPoint[]): EMAData | null {
  if (data.length < 200) {
    // Need at least 200 points for 200 EMA
    // We'll work with what we have
  }

  const closes = data.map((d) => d.close);
  const currentPrice = closes[closes.length - 1];

  const periods = ANALYSIS_CONFIG.EMA_PERIODS;
  const values: EMAData['values'] = [];

  let ema9 = 0,
    ema21 = 0,
    ema65 = 0,
    ema100 = 0,
    ema200 = 0;

  for (const period of periods) {
    if (closes.length >= period) {
      const emaArray = calculateEMA(closes, period);
      const currentEma = emaArray[emaArray.length - 1];

      values.push({
        period,
        value: currentEma,
        pricePosition: currentPrice >= currentEma ? 'above' : 'below',
      });

      switch (period) {
        case 9:
          ema9 = currentEma;
          break;
        case 21:
          ema21 = currentEma;
          break;
        case 65:
          ema65 = currentEma;
          break;
        case 100:
          ema100 = currentEma;
          break;
        case 200:
          ema200 = currentEma;
          break;
      }
    }
  }

  return {
    ema9,
    ema21,
    ema65,
    ema100,
    ema200,
    values,
  };
}

// ============================================================================
// TREND STATE CLASSIFICATION
// ============================================================================

export function classifyTrendState(
  currentPrice: number,
  ema: EMAData
): TrendState {
  const { ema9, ema21, ema65, ema100, ema200 } = ema;

  // Count how many EMAs price is above
  const emas = [ema9, ema21, ema65, ema100, ema200].filter((e) => e > 0);
  const aboveCount = emas.filter((e) => currentPrice >= e).length;
  const totalEmas = emas.length;

  // Check EMA stacking order
  const isBullishStack =
    ema9 >= ema21 && ema21 >= ema65 && ema65 >= ema100 && ema100 >= ema200;
  const isBearishStack =
    ema9 <= ema21 && ema21 <= ema65 && ema65 <= ema100 && ema100 <= ema200;

  // Determine alignment
  let emaAlignment: TrendState['emaAlignment'];
  if (isBullishStack && aboveCount === totalEmas) {
    emaAlignment = 'perfectly_bullish';
  } else if (aboveCount >= totalEmas * 0.8) {
    emaAlignment = 'mostly_bullish';
  } else if (isBearishStack && aboveCount === 0) {
    emaAlignment = 'perfectly_bearish';
  } else if (aboveCount <= totalEmas * 0.2) {
    emaAlignment = 'mostly_bearish';
  } else {
    emaAlignment = 'mixed';
  }

  // Determine direction
  let direction: TrendState['direction'];
  let tradingBias: TrendState['tradingBias'];
  let biasReason: string;

  const aboveRatio = aboveCount / totalEmas;

  if (isBullishStack && aboveCount === totalEmas) {
    direction = 'strong_uptrend';
    tradingBias = 'long';
    biasReason = 'Price above all EMAs with perfect bullish alignment';
  } else if (aboveRatio >= 0.8 && currentPrice > ema200) {
    direction = 'uptrend';
    tradingBias = 'long';
    biasReason = 'Price above most EMAs and above 200 EMA';
  } else if (currentPrice > ema200 && aboveRatio < 0.6) {
    direction = 'weak_uptrend';
    tradingBias = 'neutral';
    biasReason = 'Price above 200 EMA but below shorter-term EMAs';
  } else if (isBearishStack && aboveCount === 0) {
    direction = 'strong_downtrend';
    tradingBias = 'short';
    biasReason = 'Price below all EMAs with perfect bearish alignment';
  } else if (aboveRatio <= 0.2 && currentPrice < ema200) {
    direction = 'downtrend';
    tradingBias = 'short';
    biasReason = 'Price below most EMAs and below 200 EMA';
  } else if (currentPrice < ema200 && aboveRatio > 0.4) {
    direction = 'weak_downtrend';
    tradingBias = 'neutral';
    biasReason = 'Price below 200 EMA but above some shorter-term EMAs';
  } else {
    direction = 'ranging';
    tradingBias = 'neutral';
    biasReason = 'EMAs intertwined, no clear trend direction';
  }

  // Calculate strength (0-100)
  let strength = 50;
  if (direction.includes('strong')) {
    strength = 85 + aboveRatio * 15;
  } else if (direction === 'uptrend' || direction === 'downtrend') {
    strength = 60 + aboveRatio * 20;
  } else if (direction.includes('weak')) {
    strength = 40 + aboveRatio * 10;
  } else {
    strength = 30 + Math.abs(aboveRatio - 0.5) * 20;
  }

  return {
    direction,
    emaAlignment,
    strength: Math.min(100, Math.max(0, Math.round(strength))),
    tradingBias,
    biasReason,
  };
}

// ============================================================================
// ATR CALCULATION
// ============================================================================

export function calculateATR(data: MarketDataPoint[]): ATRData | null {
  const period = ANALYSIS_CONFIG.ATR_PERIOD;

  if (data.length < period + 1) {
    return null;
  }

  // Calculate True Range for each bar
  const trueRanges: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  // Calculate ATR as EMA of True Range
  const atrValues = calculateEMA(trueRanges, period);
  const atr = atrValues[atrValues.length - 1];
  const currentPrice = data[data.length - 1].close;
  const atrPercent = (atr / currentPrice) * 100;

  // Determine volatility regime
  let volatilityRegime: VolatilityRegime;
  if (atrPercent < ANALYSIS_CONFIG.VOLATILITY_THRESHOLDS.low) {
    volatilityRegime = 'low';
  } else if (atrPercent > ANALYSIS_CONFIG.VOLATILITY_THRESHOLDS.high) {
    volatilityRegime = 'high';
  } else {
    volatilityRegime = 'medium';
  }

  const atrMultiplier = ANALYSIS_CONFIG.VOLATILITY_ATR_MULTIPLIERS[volatilityRegime];

  return {
    atr,
    atrPercent,
    volatilityRegime,
    atrMultiplier,
  };
}

// ============================================================================
// BOLLINGER BANDS CALCULATION
// ============================================================================

function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  const slice = data.slice(-period);
  return slice.reduce((sum, val) => sum + val, 0) / period;
}

function calculateStdDev(data: number[], period: number, mean: number): number {
  if (data.length < period) return 0;
  const slice = data.slice(-period);
  const squaredDiffs = slice.map((val) => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / period;
  return Math.sqrt(variance);
}

export function calculateBollingerBands(data: MarketDataPoint[]): BollingerData | null {
  const period = ANALYSIS_CONFIG.BOLLINGER_PERIOD;
  const stdDevMultiplier = ANALYSIS_CONFIG.BOLLINGER_STD_DEV;

  if (data.length < period) {
    return null;
  }

  const closes = data.map((d) => d.close);
  const currentPrice = closes[closes.length - 1];

  const middleBand = calculateSMA(closes, period);
  const stdDev = calculateStdDev(closes, period, middleBand);

  const upperBand = middleBand + stdDevMultiplier * stdDev;
  const lowerBand = middleBand - stdDevMultiplier * stdDev;
  const bandWidth = (upperBand - lowerBand) / middleBand;

  // %B calculation
  const percentB = (currentPrice - lowerBand) / (upperBand - lowerBand);

  // Check for squeeze (compare current bandwidth to average)
  const bandWidths: number[] = [];
  for (let i = period; i < data.length; i++) {
    const slice = closes.slice(i - period, i);
    const sma = slice.reduce((s, v) => s + v, 0) / period;
    const sd = calculateStdDev(slice, period, sma);
    const bw = (2 * stdDevMultiplier * sd) / sma;
    bandWidths.push(bw);
  }
  const avgBandWidth =
    bandWidths.length > 0
      ? bandWidths.reduce((s, v) => s + v, 0) / bandWidths.length
      : bandWidth;
  const squeeze = bandWidth < avgBandWidth * 0.8;

  // Position relative to bands
  let position: BollingerData['position'];
  if (currentPrice > upperBand) {
    position = 'above_upper';
  } else if (currentPrice >= middleBand) {
    position = 'upper_half';
  } else if (currentPrice >= lowerBand) {
    position = 'lower_half';
  } else {
    position = 'below_lower';
  }

  return {
    upperBand,
    middleBand,
    lowerBand,
    bandWidth,
    percentB,
    squeeze,
    position,
  };
}

// ============================================================================
// SWING HIGH/LOW DETECTION
// ============================================================================

export function detectSwingPoints(
  data: MarketDataPoint[],
  timeframe: string
): SwingPoint[] {
  const barsRequired = getSwingBars(timeframe);
  const swingPoints: SwingPoint[] = [];
  const toleranceBand = ANALYSIS_CONFIG.TOLERANCE_BAND_PERCENT / 100;
  const recentThreshold = Math.floor(data.length * 0.8); // Last 20% is "recent"

  // Detect swing highs
  for (let i = barsRequired; i < data.length - barsRequired; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;

    const currentHigh = data[i].high;
    const currentLow = data[i].low;

    // Check left side
    for (let j = 1; j <= barsRequired; j++) {
      if (data[i - j].high >= currentHigh) isSwingHigh = false;
      if (data[i - j].low <= currentLow) isSwingLow = false;
    }

    // Check right side
    for (let j = 1; j <= barsRequired; j++) {
      if (data[i + j].high >= currentHigh) isSwingHigh = false;
      if (data[i + j].low <= currentLow) isSwingLow = false;
    }

    if (isSwingHigh) {
      swingPoints.push({
        price: currentHigh,
        type: 'high',
        date: data[i].date,
        barIndex: i,
        touches: 1, // Will be counted later
        lastTouchDate: null,
        isRecent: i >= recentThreshold,
      });
    }

    if (isSwingLow) {
      swingPoints.push({
        price: currentLow,
        type: 'low',
        date: data[i].date,
        barIndex: i,
        touches: 1,
        lastTouchDate: null,
        isRecent: i >= recentThreshold,
      });
    }
  }

  // Count touches for each swing point
  for (const swing of swingPoints) {
    let touches = 0;
    let lastTouchDate: string | null = null;

    for (let i = 0; i < data.length; i++) {
      const bar = data[i];
      const priceDiffHigh = Math.abs(bar.high - swing.price) / swing.price;
      const priceDiffLow = Math.abs(bar.low - swing.price) / swing.price;

      // A touch occurs if price came within tolerance of the level
      if (priceDiffHigh <= toleranceBand || priceDiffLow <= toleranceBand) {
        touches++;
        lastTouchDate = bar.date;
      }
    }

    swing.touches = touches;
    swing.lastTouchDate = lastTouchDate;
  }

  // Sort by recency (most recent first) then by significance (more touches)
  swingPoints.sort((a, b) => {
    if (a.isRecent !== b.isRecent) return a.isRecent ? -1 : 1;
    return b.touches - a.touches;
  });

  return swingPoints;
}

// ============================================================================
// FIBONACCI RETRACEMENT
// ============================================================================

/**
 * Pivot-based Fibonacci with shrinking-window and last-resort fallbacks.
 *
 * IMPORTANT: assign swingHigh/swingLow by PRICE, not by pivot type. A pivot
 * tagged 'high' is only a local high — in a rising market it can sit below a
 * later pivot tagged 'low'. Assigning by type yields a negative range.
 * Don't "simplify" this back.
 */
export function calculateFibonacci(
  data: MarketDataPoint[],
  timeframe: string,
  options: { atr?: number | null; lookback?: number; minSwingATR?: number; maxSwingATR?: number } = {}
): FibonacciData | null {
  if (!isFibonacciTimeframe(timeframe)) {
    return null;
  }

  const {
    lookback = 120,
    minSwingATR = 1.5,
    maxSwingATR = 20,
    atr = null,
  } = options;

  if (!Array.isArray(data) || data.length < 8) return null;

  const slice = data.slice(-lookback);
  const n = slice.length;
  const currentPrice = slice[n - 1].close;

  const effAtr =
    typeof atr === 'number' && atr > 0
      ? atr
      : slice.reduce((s, b) => s + (b.high - b.low), 0) / n || currentPrice * 0.01;

  const minRange = minSwingATR * effAtr;
  const maxRange = maxSwingATR * effAtr;
  const maxSwingAgeBars = Math.max(20, Math.floor(n * 0.4));

  function findPivots(strength: number) {
    const out: { type: 'high' | 'low'; price: number; index: number }[] = [];
    for (let i = strength; i < n - strength; i++) {
      let isHigh = true;
      let isLow = true;
      for (let j = i - strength; j <= i + strength; j++) {
        if (j === i) continue;
        if (slice[j].high >= slice[i].high) isHigh = false;
        if (slice[j].low <= slice[i].low) isLow = false;
        if (!isHigh && !isLow) break;
      }
      if (isHigh) out.push({ type: 'high', price: slice[i].high, index: i });
      if (isLow) out.push({ type: 'low', price: slice[i].low, index: i });
    }
    return out;
  }

  let swingHigh: { price: number; index: number } | null = null;
  let swingLow: { price: number; index: number } | null = null;
  let swingSource: string | null = null;

  for (const strength of [3, 2, 1]) {
    if (n < strength * 2 + 2) continue;
    const pivots = findPivots(strength);

    for (let i = pivots.length - 1; i > 0 && !swingHigh; i--) {
      const b = pivots[i];
      let a: (typeof pivots)[number] | null = null;
      for (let k = i - 1; k >= 0; k--) {
        if (pivots[k].type !== b.type) {
          a = pivots[k];
          break;
        }
      }
      if (!a) continue;

      const legRange = Math.abs(b.price - a.price);
      if (legRange < minRange || legRange > maxRange) continue;

      const nearEnd = Math.min(
        Math.abs(b.price - currentPrice),
        Math.abs(a.price - currentPrice)
      );
      if (nearEnd > maxRange * 0.5) continue;

      const legAge = n - 1 - Math.max(b.index, a.index);
      if (legAge > maxSwingAgeBars) continue;

      const hiP = Math.max(b.price, a.price);
      const loP = Math.min(b.price, a.price);
      const hiPivot = b.price === hiP ? b : a;
      const loPivot = b.price === loP ? b : a;

      swingHigh = { price: hiP, index: hiPivot.index };
      swingLow = { price: loP, index: loPivot.index };
      swingSource = `pivot_s${strength}`;
    }
    if (swingHigh) break;
  }

  if (!swingHigh || !swingLow) {
    for (const win of [90, 60, 40, 25, 15, 10]) {
      if (win > n) continue;
      const w = slice.slice(n - win);
      const offset = n - win;
      let hi = { price: -Infinity, index: 0 };
      let lo = { price: Infinity, index: 0 };
      w.forEach((bar, i) => {
        if (bar.high > hi.price) hi = { price: bar.high, index: i + offset };
        if (bar.low < lo.price) lo = { price: bar.low, index: i + offset };
      });
      if (hi.price - lo.price <= maxRange && hi.price - lo.price >= minRange) {
        swingHigh = hi;
        swingLow = lo;
        swingSource = `window_${win}`;
        break;
      }
    }
  }

  if (!swingHigh || !swingLow) {
    const win = Math.min(20, n);
    const w = slice.slice(n - win);
    const offset = n - win;
    let hi = { price: -Infinity, index: 0 };
    let lo = { price: Infinity, index: 0 };
    w.forEach((bar, i) => {
      if (bar.high > hi.price) hi = { price: bar.high, index: i + offset };
      if (bar.low < lo.price) lo = { price: bar.low, index: i + offset };
    });
    swingHigh = hi;
    swingLow = lo;
    swingSource = 'last_resort';
  }

  if (swingHigh.price < swingLow.price) {
    const t = swingHigh;
    swingHigh = swingLow;
    swingLow = t;
  }

  const range = swingHigh.price - swingLow.price;
  if (!Number.isFinite(range) || range < 0.001) return null;

  const swingDirection: 'up' | 'down' =
    swingHigh.index > swingLow.index ? 'up' : 'down';

  // Keep ANALYSIS_CONFIG weights (point values for confluenceScorer).
  const levels = ANALYSIS_CONFIG.FIB_LEVELS.map(
    (fib: { level: number; label: string; weight: number }) => {
      const price =
        swingDirection === 'up'
          ? swingHigh!.price - range * fib.level
          : swingLow!.price + range * fib.level;
      return {
        level: fib.level,
        price,
        label: fib.label,
        weight: fib.weight,
      };
    }
  );

  const currentRetracement =
    swingDirection === 'up'
      ? (swingHigh.price - currentPrice) / range
      : (currentPrice - swingLow.price) / range;

  return {
    swingHigh: swingHigh.price,
    swingHighDate: slice[swingHigh.index].date,
    swingLow: swingLow.price,
    swingLowDate: slice[swingLow.index].date,
    swingDirection,
    levels,
    currentRetracement: Math.max(0, Math.min(1, currentRetracement)),
    swingBarsAgo: n - 1 - Math.max(swingHigh.index, swingLow.index),
    swingRangeATR: effAtr > 0 ? range / effAtr : null,
    swingSource: swingSource ?? 'last_resort',
  };
}

// ============================================================================
// VOLUME PROFILE
// ============================================================================

export function calculateVolumeProfile(
  data: MarketDataPoint[],
  options: {
    atr?: number | null;
    halfLifeBars?: number | null;
    minBuckets?: number;
    maxBuckets?: number;
    hvnThresholdMult?: number;
    maxNodeWidthATR?: number;
  } = {}
): VolumeProfile {
  const {
    atr = null,
    halfLifeBars = null,
    minBuckets = 24,
    maxBuckets = 120,
    hvnThresholdMult = 1.6,
    maxNodeWidthATR = 1.5,
  } = options;

  if (!Array.isArray(data) || data.length === 0) {
    return {
      highVolumeNodes: [],
      pointOfControl: 0,
      averageVolume: 0,
    };
  }

  const n = data.length;
  const currentPrice = data[n - 1].close;
  const minPrice = Math.min(...data.map((b) => b.low));
  const maxPrice = Math.max(...data.map((b) => b.high));
  const range = maxPrice - minPrice;
  if (!Number.isFinite(range) || range <= 0) {
    return {
      highVolumeNodes: [],
      pointOfControl: currentPrice,
      averageVolume: 0,
    };
  }

  const effAtr =
    typeof atr === 'number' && atr > 0
      ? atr
      : data.reduce((s, b) => s + (b.high - b.low), 0) / n || currentPrice * 0.01;

  const buckets = Math.max(
    minBuckets,
    Math.min(maxBuckets, Math.round(range / (effAtr / 3)) || minBuckets)
  );
  const bucketSize = range / buckets;
  const halfLife = halfLifeBars || Math.max(Math.floor(n / 3), 5);
  const volumeBuckets = new Array(buckets).fill(0);

  data.forEach((bar, i) => {
    const barsAgo = n - 1 - i;
    const recency = Math.pow(0.5, barsAgo / halfLife);
    const vol = (bar.volume || 0) * recency;
    if (vol <= 0) return;

    const loIdx = Math.min(
      Math.floor((bar.low - minPrice) / bucketSize),
      buckets - 1
    );
    const hiIdx = Math.min(
      Math.floor((bar.high - minPrice) / bucketSize),
      buckets - 1
    );
    const span = Math.max(hiIdx - loIdx + 1, 1);
    const per = vol / span;
    for (let b = Math.max(0, loIdx); b <= hiIdx; b++) volumeBuckets[b] += per;
  });

  const totalVolume = volumeBuckets.reduce((a: number, b: number) => a + b, 0);
  if (totalVolume <= 0) {
    return {
      highVolumeNodes: [],
      pointOfControl: currentPrice,
      averageVolume: 0,
    };
  }

  const avgBucket = totalVolume / buckets;
  const threshold = avgBucket * hvnThresholdMult;

  type Run = {
    startIdx: number;
    endIdx: number;
    volume: number;
    peakIdx: number;
    peakVol: number;
    trimmed?: boolean;
  };

  const rawNodes: Run[] = [];
  let run: Run | null = null;
  volumeBuckets.forEach((vol: number, i: number) => {
    if (vol >= threshold) {
      if (!run) {
        run = { startIdx: i, endIdx: i, volume: vol, peakIdx: i, peakVol: vol };
      } else {
        run.endIdx = i;
        run.volume += vol;
        if (vol > run.peakVol) {
          run.peakVol = vol;
          run.peakIdx = i;
        }
      }
    } else if (run) {
      rawNodes.push(run);
      run = null;
    }
  });
  if (run) rawNodes.push(run);

  const maxNodeBuckets = Math.max(
    1,
    Math.round((maxNodeWidthATR * effAtr) / bucketSize)
  );

  const trimmed = rawNodes.map((node) => {
    const width = node.endIdx - node.startIdx + 1;
    if (width <= maxNodeBuckets) return node;

    const half = Math.floor(maxNodeBuckets / 2);
    let start = Math.max(node.startIdx, node.peakIdx - half);
    let end = Math.min(node.endIdx, start + maxNodeBuckets - 1);
    start = Math.max(node.startIdx, end - maxNodeBuckets + 1);

    let volume = 0;
    for (let i = start; i <= end; i++) volume += volumeBuckets[i];
    return { ...node, startIdx: start, endIdx: end, volume, trimmed: true };
  });

  const highVolumeNodes = trimmed
    .map((node) => {
      const priceRangeLow = minPrice + node.startIdx * bucketSize;
      const priceRangeHigh = minPrice + (node.endIdx + 1) * bucketSize;
      const priceMid = minPrice + (node.peakIdx + 0.5) * bucketSize;
      return {
        priceRangeLow,
        priceRangeHigh,
        priceMid,
        volumePercent: (node.volume / totalVolume) * 100,
        widthATR: effAtr > 0 ? (priceRangeHigh - priceRangeLow) / effAtr : null,
        distanceATR: effAtr > 0 ? Math.abs(priceMid - currentPrice) / effAtr : null,
        trimmed: !!node.trimmed,
      };
    })
    .sort((a, b) => b.volumePercent - a.volumePercent)
    .slice(0, 5);

  const pocIndex = volumeBuckets.indexOf(Math.max(...volumeBuckets));

  let vaVolume = volumeBuckets[pocIndex];
  let lowIdx = pocIndex;
  let highIdx = pocIndex;
  while (vaVolume < totalVolume * 0.7 && (lowIdx > 0 || highIdx < buckets - 1)) {
    const below = lowIdx > 0 ? volumeBuckets[lowIdx - 1] : -1;
    const above = highIdx < buckets - 1 ? volumeBuckets[highIdx + 1] : -1;
    if (above >= below) {
      highIdx += 1;
      vaVolume += above;
    } else {
      lowIdx -= 1;
      vaVolume += below;
    }
  }

  return {
    highVolumeNodes,
    pointOfControl: minPrice + (pocIndex + 0.5) * bucketSize,
    averageVolume: data.reduce((s, b) => s + (b.volume || 0), 0) / n,
    valueAreaHigh: minPrice + (highIdx + 1) * bucketSize,
    valueAreaLow: minPrice + lowIdx * bucketSize,
    bucketCount: buckets,
    bucketSize,
    recencyHalfLifeBars: halfLife,
  };
}

// ============================================================================
// OVEREXTENSION DETECTION
// ============================================================================

export function calculateOverextension(
  currentPrice: number,
  ema21: number,
  atr: number
): OverextensionData {
  const distance = currentPrice - ema21;
  const distancePercent = (distance / ema21) * 100;
  const atrNormalized = atr > 0 ? Math.abs(distance) / atr : 0;
  const direction: 'above' | 'below' = distance >= 0 ? 'above' : 'below';

  const thresholds = ANALYSIS_CONFIG.OVEREXTENSION_THRESHOLDS;

  let status: OverextensionData['status'];
  let signalType: OverextensionData['signalType'];
  let meanReversionSignal = false;

  if (atrNormalized < thresholds.moderate) {
    status = 'normal';
    signalType = 'none';
  } else if (atrNormalized < thresholds.overextended) {
    status = 'moderately_extended';
    signalType = 'pullback_expected';
    meanReversionSignal = true;
  } else if (atrNormalized < thresholds.extreme) {
    status = 'overextended';
    signalType = 'reversal_candidate';
    meanReversionSignal = true;
  } else {
    status = 'extremely_extended';
    signalType = 'strong_reversal';
    meanReversionSignal = true;
  }

  return {
    distanceFromEma21: distance,
    distanceFromEma21Percent: distancePercent,
    atrNormalizedDistance: atrNormalized,
    status,
    direction,
    meanReversionSignal,
    signalType,
  };
}

// ============================================================================
// MAIN CALCULATOR FUNCTION
// ============================================================================

export function calculateAllIndicators(
  data: MarketDataPoint[],
  symbol: string,
  timeframe: string
): TechnicalIndicators | null {
  if (!data || data.length < 20) {
    console.error('Insufficient data for analysis:', data?.length || 0);
    return null;
  }

  const currentPrice = data[data.length - 1].close;
  const firstPrice = data[0].close;
  const priceChange = currentPrice - firstPrice;
  const priceChangePercent = (priceChange / firstPrice) * 100;

  // Calculate all indicators
  const ema = calculateAllEMAs(data);
  if (!ema) {
    console.error('Failed to calculate EMAs');
    return null;
  }

  const trend = classifyTrendState(currentPrice, ema);

  const atr = calculateATR(data);
  if (!atr) {
    console.error('Failed to calculate ATR');
    return null;
  }

  const bollinger = calculateBollingerBands(data);
  if (!bollinger) {
    console.error('Failed to calculate Bollinger Bands');
    return null;
  }

  const overextension = calculateOverextension(currentPrice, ema.ema21, atr.atr);

  const fibonacci = calculateFibonacci(data, timeframe, { atr: atr.atr });

  const volumeProfile = calculateVolumeProfile(data, { atr: atr.atr });

  const swingPoints = detectSwingPoints(data, timeframe);

  return {
    symbol,
    timeframe,
    currentPrice,
    priceChange,
    priceChangePercent,
    dataPoints: data.length,
    ema,
    trend,
    atr,
    bollinger,
    overextension,
    fibonacci,
    volumeProfile,
    swingPoints,
  };
}




