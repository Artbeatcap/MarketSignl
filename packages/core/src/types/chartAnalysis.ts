// Chart Analysis Domain Types
// These define the contract between OpenAI Vision output and the app

export type TrendType = 'uptrend' | 'downtrend' | 'range' | 'mixed';
export type TimeframeType = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | 'D' | 'W' | 'M' | null;
export type LevelRole = 'support' | 'resistance' | 'demand_zone' | 'supply_zone';
export type StrengthLevel = 'strong' | 'medium' | 'weak';

export interface ImageRegion {
  x0: number; // 0-1 normalized
  y0: number; // 0-1 normalized
  x1: number; // 0-1 normalized
  y1: number; // 0-1 normalized
}

export interface ChartLevel {
  id: string;
  role: LevelRole;
  label: string;
  approxPrice: number | null;
  strength: StrengthLevel;
  confidence: number; // 0-1
  touchCount: number;
  isRecent: boolean;
  reasonTags: ReasonTag[];
  imageRegion: ImageRegion;
}

export type ReasonTag =
  | 'multiple_touches'
  | 'gap_edge'
  | 'prior_high'
  | 'prior_low'
  | 'pre_market_level'
  | 'round_number'
  | 'volume_cluster'
  | 'swing_point'
  | 'moving_average'
  | 'fibonacci_level';

export type PatternType =
  | 'flag'
  | 'pennant'
  | 'triangle'
  | 'wedge'
  | 'channel'
  | 'head_and_shoulders'
  | 'inverse_head_and_shoulders'
  | 'double_top'
  | 'double_bottom'
  | 'cup_and_handle'
  | 'ascending_triangle'
  | 'descending_triangle';

export type PatternBias = 'bullish' | 'bearish' | 'neutral';

export interface ChartPattern {
  id: string;
  type: PatternType;
  bias: PatternBias;
  confidence: number; // 0-1
  imageRegion: ImageRegion;
  notes: string;
}

export type BreakoutDirection = 'breakout' | 'breakdown';

export interface BreakoutZone {
  id: string;
  direction: BreakoutDirection;
  approxPrice: number | null;
  confidence: number; // 0-1
  imageRegion: ImageRegion;
  notes: string;
}

export interface TrendInfo {
  type: TrendType;
  confidence: number; // 0-1
  notes: string;
}

export interface ChartMeta {
  symbol: string | null;
  timeframe: TimeframeType;
  trend: TrendInfo;
}

export interface TradingIdea {
  idea: string;
  riskNote: string;
}

export interface ChartSummary {
  headline: string;
  keyLevelsCommentary: string[];
  tradingIdeas: TradingIdea[];
}

// Markup Instructions for Frontend Rendering
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type LineThickness = 'thin' | 'normal' | 'thick';
export type ColorRole =
  | 'support_strong'
  | 'support_medium'
  | 'support_weak'
  | 'resistance_strong'
  | 'resistance_medium'
  | 'resistance_weak'
  | 'breakout'
  | 'breakdown'
  | 'pattern';

export interface MarkupLine {
  sourceId: string;
  role: LevelRole;
  style: LineStyle;
  thickness: LineThickness;
  colorRole: ColorRole;
  imageY: number; // 0-1 normalized
}

export interface MarkupLabel {
  sourceId: string;
  text: string;
  anchor: {
    x: number; // 0-1
    y: number; // 0-1
  };
}

export type HighlightStyle = 'box' | 'halo' | 'gradient';

export interface MarkupHighlight {
  sourceId: string;
  style: HighlightStyle;
  imageRegion: ImageRegion;
}

export interface MarkupInstructions {
  lines: MarkupLine[];
  labels: MarkupLabel[];
  highlights: MarkupHighlight[];
}

// The main analysis object returned by the API
export interface ChartAnalysis {
  meta: ChartMeta;
  levels: ChartLevel[];
  patterns: ChartPattern[];
  breakoutZones: BreakoutZone[];
  markupInstructions: MarkupInstructions;
  summary: ChartSummary;
}

// API Response wrapper
export interface AnalysisResponse {
  success: boolean;
  data?: ChartAnalysis;
  analysisId?: string;
  error?: string;
}

// Analysis history item
export interface AnalysisHistoryItem {
  id: string;
  createdAt: string;
  symbol: string | null;
  timeframe: TimeframeType;
  headline: string;
  /** Linked forecast from the same Atlas run, when available */
  predictionId?: string;
}
