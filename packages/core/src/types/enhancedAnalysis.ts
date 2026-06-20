// Enhanced Analysis Types for @chartsignl/core
// These types define the structure of the enhanced technical analysis system

// ============================================================================
// INDICATOR TYPES (from technical calculator)
// ============================================================================

export interface EMAValues {
  period: number;
  value: number;
  pricePosition: 'above' | 'below';
}

export interface EMAData {
  ema9: number;
  ema21: number;
  ema65: number;
  ema100: number;
  ema200: number;
  values: EMAValues[];
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
  strength: number;
  tradingBias: 'long' | 'neutral' | 'short';
  biasReason: string;
}

export interface ATRData {
  atr: number;
  atrPercent: number;
  volatilityRegime: 'low' | 'medium' | 'high';
  atrMultiplier: number;
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

export interface OverextensionData {
  distanceFromEma21: number;
  distanceFromEma21Percent: number;
  atrNormalizedDistance: number;
  status: 'normal' | 'moderately_extended' | 'overextended' | 'extremely_extended';
  direction: 'above' | 'below';
  meanReversionSignal: boolean;
  signalType: 'none' | 'pullback_expected' | 'reversal_candidate' | 'strong_reversal';
}

export interface FibonacciLevel {
  level: number;
  price: number;
  label: string;
  weight: number;
}

export interface FibonacciData {
  swingHigh: number;
  swingHighDate: string;
  swingLow: number;
  swingLowDate: string;
  swingDirection: 'up' | 'down';
  levels: FibonacciLevel[];
  currentRetracement: number;
}

export interface VolumeNode {
  priceRangeLow: number;
  priceRangeHigh: number;
  priceMid: number;
  volumePercent: number;
}

export interface VolumeProfile {
  highVolumeNodes: VolumeNode[];
  pointOfControl: number;
  averageVolume: number;
}

// ============================================================================
// CONFLUENCE SCORING TYPES
// ============================================================================

export interface ConfluenceFactors {
  historicalTouches: { count: number; points: number };
  fibonacciAlignment: { level: string | null; distance: number; points: number };
  emaProximity: { ema: string | null; distance: number; points: number };
  volumeNode: { isHighVolume: boolean; volumePercent: number; points: number };
  roundNumber: { isRound: boolean; nearestRound: number | null; points: number };
  recentRelevance: { isRecent: boolean; points: number };
}

export interface ScoredLevel {
  id: string;
  price: number;
  type: 'support' | 'resistance';
  confluenceScore: number;
  strength: 'strong' | 'medium' | 'weak';
  factors: ConfluenceFactors;
  description: string;
  zone: {
    high: number;
    low: number;
  };
  distanceFromPrice: number;
  distancePercent: number;
}

export interface ConfidenceFactor {
  name: string;
  impact: number;
  reason: string;
}

export interface ConfidenceScoring {
  overall: number;
  label: 'high' | 'moderate' | 'low' | 'very_low';
  factors: ConfidenceFactor[];
}

// ============================================================================
// TECHNICAL DETAILS (for expandable section)
// ============================================================================

export interface TechnicalDetailItem {
  indicator: string;
  value: string;
  status: 'bullish' | 'bearish' | 'neutral' | 'warning';
  statusLabel: string;
}

export interface TechnicalDetails {
  summary: TechnicalDetailItem[];
  raw: {
    ema: EMAData;
    atr: ATRData;
    bollinger: BollingerData;
    overextension: OverextensionData;
    fibonacci: FibonacciData | null;
    volumeProfile: VolumeProfile;
  };
}

// ============================================================================
// TRADE IDEAS
// ============================================================================

export interface TradeIdea {
  direction: 'long' | 'short';
  scenario: string;
  entryZone: {
    low: number;
    high: number;
  };
  target: number;
  stop: number;
  riskRewardRatio: number;
  confidence: number;
  invalidation: string;
}

// ============================================================================
// MAIN ANALYSIS RESPONSE
// ============================================================================

export interface EnhancedAIAnalysis {
  // Metadata
  symbol: string;
  timeframe: string;
  analyzedAt: string;

  // Price info
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;

  // Confidence
  overallConfidence: number;
  confidenceLabel: 'high' | 'moderate' | 'low' | 'very_low';
  confidenceFactors: ConfidenceFactor[];

  // Trend
  trend: {
    direction: string;
    strength: number;
    bias: 'long' | 'neutral' | 'short';
    summary: string;
  };

  // Levels - default display (max 4)
  supportLevels: ScoredLevel[];
  resistanceLevels: ScoredLevel[];

  // Levels - expanded (for "show more")
  allSupportLevels: ScoredLevel[];
  allResistanceLevels: ScoredLevel[];

  // Mean reversion
  overextension: {
    status: string;
    signal: string | null;
    description: string;
  };

  // AI-generated content
  headline: string;
  summary: string;
  keyObservations: string[];

  // Trade ideas
  tradeIdeas: TradeIdea[];

  // Risk factors
  riskFactors: string[];

  // Technical details for expandable section
  technicalDetails: TechnicalDetails;
}

// ============================================================================
// API RESPONSE WRAPPER
// ============================================================================

export interface EnhancedAnalysisResponse {
  success: boolean;
  error?: string;
  analysis?: EnhancedAIAnalysis;
  analysisId?: string;
}

