// Enhanced Analysis Types for @chartsignl/core
// These types define the structure of the enhanced technical analysis system

import type { DataFreshness } from './dataFreshness';

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
  signalType: 'none' | 'pullback_expected' | 'reversal_candidate' | 'strong_reversal' | 'extended_in_downtrend' | 'context_unavailable';
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
  /** Additive: how the swing was chosen (pivot_sN | window_N | last_resort). */
  swingSource?: string;
  swingBarsAgo?: number;
  swingRangeATR?: number | null;
}

export interface VolumeNode {
  priceRangeLow: number;
  priceRangeHigh: number;
  priceMid: number;
  volumePercent: number;
  widthATR?: number | null;
  distanceATR?: number | null;
  trimmed?: boolean;
}

export interface VolumeProfile {
  highVolumeNodes: VolumeNode[];
  pointOfControl: number;
  averageVolume: number;
  valueAreaHigh?: number;
  valueAreaLow?: number;
  bucketCount?: number;
  bucketSize?: number;
  recencyHalfLifeBars?: number;
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
    halfWidth?: number;
  };
  distanceFromPrice: number;
  distancePercent: number;
  /** Ranking score = confluenceScore × proximity. UI shows confluenceScore. */
  effectiveScore?: number;
  relevance?: number;
  distanceATR?: number;
  proximityLabel?: 'at_price' | 'in_play' | 'nearby' | 'extended' | 'distant';
  factorCount?: number;
  mergedFrom?: number;
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
  /** Id of the support/resistance level used as the entry (absent on older saved analyses). */
  entryLevelId?: string;
  /** Id of the support/resistance level used as the target (absent on older saved analyses). */
  targetLevelId?: string;
}

// ============================================================================
// MAIN ANALYSIS RESPONSE
// ============================================================================

export type MarketContext = {
  status: 'available';
  version: string;
  scope: 'semiconductor_leadership';
  asOfSession: string;
  regime: 'risk_on' | 'neutral' | 'factor_breakdown';
  /** OLS ratio slope as percent of starting ratio per session. */
  smhQqqSlope20: number;
  rspQqqSlope20: number;
  smhAbove200: boolean;
  qqqAbove200: boolean;
  qqqDistributionDay: boolean;
  qqqVolumeMultiple: number;
} | {
  status: 'unavailable';
  version: string;
  scope: 'semiconductor_leadership';
  reason: string;
};

export interface AnalysisGuide {
  whatIsHappening: string;
  /** Only present for symbols the sector rule covers. */
  marketContext?: string;
  whatToWatch: string[];
  whatWouldChange: string;
  whenToReassess: string;
  scoreMeaning: string;
}

export interface EnhancedAIAnalysis {
  /** Optional for compatibility with previously saved analyses. */
  marketContext?: MarketContext;
  guide?: AnalysisGuide;
  // Metadata
  symbol: string;
  timeframe: string;
  analyzedAt: string;
  /** Freshness of the price data this analysis was computed from. */
  freshness?: DataFreshness;

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

/**
 * POST /api/levels — the chart's levels before Atlas runs. Computed by the same
 * backend function Atlas uses, so prices and ids match the later Atlas result.
 */
export interface ChartLevels {
  symbol: string;
  interval: string;
  currentPrice: number;
  atr: number;
  asOfTimestamp: number;
  barsUsed: number;
  supportLevels: ScoredLevel[];
  resistanceLevels: ScoredLevel[];
  allSupportLevels: ScoredLevel[];
  allResistanceLevels: ScoredLevel[];
}

export interface ChartLevelsResponse {
  success: boolean;
  error?: string;
  levels?: ChartLevels;
}

export interface EnhancedAnalysisResponse {
  success: boolean;
  error?: string;
  analysis?: EnhancedAIAnalysis;
  analysisId?: string;
}

