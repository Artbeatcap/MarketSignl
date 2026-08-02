// Confluence Scorer Module
// Scores potential support/resistance levels and selects the best ones for display

import {
  ANALYSIS_CONFIG,
  type VolatilityRegime,
  type StrengthLevel,
} from './analysisConstants.js';

import type {
  TechnicalIndicators,
  SwingPoint,
  FibonacciData,
  EMAData,
  VolumeProfile,
  ATRData,
  TrendState,
  BollingerData,
} from './technicalCalculator.js';

import {
  applyRelevance,
  selectDisplayLevelsByRelevance,
  getRelevanceProfile,
} from './levelRelevance.js';

// ============================================================================
// TYPE DEFINITIONS
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
  strength: StrengthLevel;
  factors: ConfluenceFactors;
  description: string;
  zone: {
    high: number;
    low: number;
    halfWidth?: number;
  };
  // For display filtering
  distanceFromPrice: number;
  distancePercent: number;
  /** Ranking score = confluenceScore × proximity relevance. UI shows confluenceScore. */
  effectiveScore?: number;
  /** Proximity multiplier in [floor, 1]. */
  relevance?: number;
  /** Distance from spot in ATR units. */
  distanceATR?: number;
  proximityLabel?: 'at_price' | 'in_play' | 'nearby' | 'extended' | 'distant';
  factorCount?: number;
  mergedFrom?: number;
}

export interface ConfidenceScoring {
  overall: number;
  label: 'high' | 'moderate' | 'low' | 'very_low';
  factors: {
    name: string;
    impact: number;
    reason: string;
  }[];
}

export interface ScoredAnalysis {
  supportLevels: ScoredLevel[];
  resistanceLevels: ScoredLevel[];
  displayLevels: {
    support: ScoredLevel[];
    resistance: ScoredLevel[];
  };
  confidence: ConfidenceScoring;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isWithinTolerance(
  price1: number,
  price2: number,
  tolerancePercent: number = ANALYSIS_CONFIG.TOLERANCE_BAND_PERCENT
): boolean {
  const diff = Math.abs(price1 - price2) / price1;
  return diff <= tolerancePercent / 100;
}

function getStrengthLevel(score: number, volatilityRegime: VolatilityRegime): StrengthLevel {
  const adjustment = ANALYSIS_CONFIG.VOLATILITY_CONFLUENCE_ADJUSTMENTS[volatilityRegime];
  const thresholds = ANALYSIS_CONFIG.STRENGTH_THRESHOLDS;

  if (score >= thresholds.strong + adjustment) return 'strong';
  if (score >= thresholds.medium + adjustment) return 'medium';
  if (score >= thresholds.weak + adjustment) return 'weak';
  return 'weak';
}

function findNearestRoundNumber(price: number): number | null {
  const divisors = ANALYSIS_CONFIG.ROUND_NUMBER_DIVISORS;

  for (const divisor of divisors) {
    const rounded = Math.round(price / divisor) * divisor;
    if (isWithinTolerance(price, rounded)) {
      return rounded;
    }
  }

  return null;
}

function generateLevelId(type: 'support' | 'resistance', index: number): string {
  return `${type.charAt(0)}${index + 1}`;
}

function buildDescription(factors: ConfluenceFactors, type: 'support' | 'resistance'): string {
  const parts: string[] = [];

  if (factors.historicalTouches.count >= 3) {
    parts.push(`${factors.historicalTouches.count} historical touches`);
  }

  if (factors.fibonacciAlignment.level) {
    parts.push(`${factors.fibonacciAlignment.level} Fib`);
  }

  if (factors.emaProximity.ema) {
    parts.push(`near ${factors.emaProximity.ema} EMA`);
  }

  if (factors.volumeNode.isHighVolume) {
    parts.push('high volume node');
  }

  if (factors.roundNumber.isRound && factors.roundNumber.nearestRound) {
    parts.push(`$${factors.roundNumber.nearestRound} psychological level`);
  }

  if (factors.recentRelevance.isRecent) {
    parts.push('recently tested');
  }

  if (parts.length === 0) {
    return type === 'support' ? 'Support level' : 'Resistance level';
  }

  const prefix = type === 'support' ? 'Support' : 'Resistance';
  return `${prefix}: ${parts.join(' + ')}`;
}

// ============================================================================
// CANDIDATE LEVEL GENERATION
// ============================================================================

interface CandidateLevel {
  price: number;
  type: 'support' | 'resistance';
  source: 'swing' | 'fib' | 'ema' | 'volume' | 'round';
  touches?: number;
  isRecent?: boolean;
}

function generateCandidateLevels(
  currentPrice: number,
  swingPoints: SwingPoint[],
  fibonacci: FibonacciData | null,
  ema: EMAData,
  volumeProfile: VolumeProfile
): CandidateLevel[] {
  const candidates: CandidateLevel[] = [];

  // Add swing points
  for (const swing of swingPoints) {
    candidates.push({
      price: swing.price,
      type: swing.type === 'high' ? 'resistance' : 'support',
      source: 'swing',
      touches: swing.touches,
      isRecent: swing.isRecent,
    });
  }

  // Add Fibonacci levels
  if (fibonacci) {
    for (const fib of fibonacci.levels) {
      candidates.push({
        price: fib.price,
        type: fib.price < currentPrice ? 'support' : 'resistance',
        source: 'fib',
      });
    }
  }

  // Add EMA levels
  for (const emaValue of ema.values) {
    if (emaValue.value > 0) {
      candidates.push({
        price: emaValue.value,
        type: emaValue.value < currentPrice ? 'support' : 'resistance',
        source: 'ema',
      });
    }
  }

  // Add volume nodes
  for (const node of volumeProfile.highVolumeNodes) {
    candidates.push({
      price: node.priceMid,
      type: node.priceMid < currentPrice ? 'support' : 'resistance',
      source: 'volume',
    });
  }

  return candidates;
}

// ============================================================================
// CONFLUENCE SCORING
// ============================================================================

function scoreLevel(
  price: number,
  _type: 'support' | 'resistance',
  _currentPrice: number,
  swingPoints: SwingPoint[],
  fibonacci: FibonacciData | null,
  ema: EMAData,
  volumeProfile: VolumeProfile,
  _atr: ATRData
): { score: number; factors: ConfluenceFactors } {
  const weights = ANALYSIS_CONFIG.CONFLUENCE_WEIGHTS;
  const tolerance = ANALYSIS_CONFIG.TOLERANCE_BAND_PERCENT;

  let totalScore = 0;
  const factors: ConfluenceFactors = {
    historicalTouches: { count: 0, points: 0 },
    fibonacciAlignment: { level: null, distance: 0, points: 0 },
    emaProximity: { ema: null, distance: 0, points: 0 },
    volumeNode: { isHighVolume: false, volumePercent: 0, points: 0 },
    roundNumber: { isRound: false, nearestRound: null, points: 0 },
    recentRelevance: { isRecent: false, points: 0 },
  };

  // 1. Historical Touches
  let maxTouches = 0;
  let isRecent = false;
  for (const swing of swingPoints) {
    if (isWithinTolerance(price, swing.price, tolerance)) {
      if (swing.touches > maxTouches) {
        maxTouches = swing.touches;
      }
      if (swing.isRecent) {
        isRecent = true;
      }
    }
  }
  const touchPoints = Math.min(
    maxTouches * weights.historicalTouches.perTouch,
    weights.historicalTouches.maxPoints
  );
  factors.historicalTouches = { count: maxTouches, points: touchPoints };
  totalScore += touchPoints;

  // 2. Fibonacci Alignment
  if (fibonacci) {
    let bestFibMatch: { level: string; distance: number; weight: number } | null = null;
    let minDistance = Infinity;

    for (const fib of fibonacci.levels) {
      const distance = Math.abs(price - fib.price) / price;
      if (distance <= tolerance / 100 && distance < minDistance) {
        minDistance = distance;
        bestFibMatch = { level: fib.label, distance, weight: fib.weight };
      }
    }

    if (bestFibMatch) {
      let fibPoints = bestFibMatch.weight;
      // Weak structure (no clean pivot leg) — down-weight fib contribution.
      const source = fibonacci.swingSource ?? '';
      if (source.startsWith('window_') || source === 'last_resort') {
        fibPoints = Math.round(fibPoints * 0.6);
      }
      factors.fibonacciAlignment = {
        level: bestFibMatch.level,
        distance: bestFibMatch.distance,
        points: fibPoints,
      };
      totalScore += fibPoints;
    }
  }

  // 3. EMA Proximity
  let closestEma: { name: string; distance: number } | null = null;
  let minEmaDistance = Infinity;

  const emaNames: Record<number, string> = {
    9: '9',
    21: '21',
    65: '65',
    100: '100',
    200: '200',
  };

  for (const emaValue of ema.values) {
    if (emaValue.value > 0) {
      const distance = Math.abs(price - emaValue.value) / price;
      if (distance <= tolerance / 100 && distance < minEmaDistance) {
        minEmaDistance = distance;
        closestEma = { name: emaNames[emaValue.period], distance };
      }
    }
  }

  if (closestEma) {
    factors.emaProximity = {
      ema: closestEma.name,
      distance: closestEma.distance,
      points: weights.emaProximity.maxPoints,
    };
    totalScore += weights.emaProximity.maxPoints;
  }

  // 4. Volume Node
  for (const node of volumeProfile.highVolumeNodes) {
    if (
      isWithinTolerance(price, node.priceMid, tolerance) ||
      (price >= node.priceRangeLow && price <= node.priceRangeHigh)
    ) {
      factors.volumeNode = {
        isHighVolume: true,
        volumePercent: node.volumePercent,
        points: weights.volumeNode.maxPoints,
      };
      totalScore += weights.volumeNode.maxPoints;
      break;
    }
  }

  // 5. Round Number
  const nearestRound = findNearestRoundNumber(price);
  if (nearestRound !== null) {
    factors.roundNumber = {
      isRound: true,
      nearestRound,
      points: weights.roundNumber.maxPoints,
    };
    totalScore += weights.roundNumber.maxPoints;
  }

  // 6. Recent Relevance
  if (isRecent) {
    factors.recentRelevance = {
      isRecent: true,
      points: weights.recentRelevance.maxPoints,
    };
    totalScore += weights.recentRelevance.maxPoints;
  }

  return { score: totalScore, factors };
}

// ============================================================================
// LEVEL CONSOLIDATION
// ============================================================================

function consolidateLevels(
  candidates: CandidateLevel[],
  currentPrice: number,
  swingPoints: SwingPoint[],
  fibonacci: FibonacciData | null,
  ema: EMAData,
  volumeProfile: VolumeProfile,
  atr: ATRData
): ScoredLevel[] {
  const tolerance = ANALYSIS_CONFIG.TOLERANCE_BAND_PERCENT;
  const scoredLevels: ScoredLevel[] = [];

  // Group candidates by price (within tolerance)
  const priceGroups: Map<number, CandidateLevel[]> = new Map();

  for (const candidate of candidates) {
    let foundGroup = false;
    for (const [groupPrice] of priceGroups) {
      if (isWithinTolerance(candidate.price, groupPrice, tolerance)) {
        priceGroups.get(groupPrice)!.push(candidate);
        foundGroup = true;
        break;
      }
    }
    if (!foundGroup) {
      priceGroups.set(candidate.price, [candidate]);
    }
  }

  // Score each price group
  let supportIndex = 0;
  let resistanceIndex = 0;

  for (const [_groupPrice, group] of priceGroups) {
    // Use the average price of the group
    const avgPrice = group.reduce((sum, c) => sum + c.price, 0) / group.length;

    // Determine type based on current price
    const type: 'support' | 'resistance' = avgPrice < currentPrice ? 'support' : 'resistance';

    // Skip if too close to current price (within 0.5%)
    const distancePercent = Math.abs(avgPrice - currentPrice) / currentPrice * 100;
    if (distancePercent < 0.5) continue;

    // Score the level
    const { score, factors } = scoreLevel(
      avgPrice,
      type,
      currentPrice,
      swingPoints,
      fibonacci,
      ema,
      volumeProfile,
      atr
    );

    // Skip levels with very low scores
    if (score < ANALYSIS_CONFIG.STRENGTH_THRESHOLDS.weak) continue;

    // Calculate zone
    const zoneWidth = atr.atr * atr.atrMultiplier * 0.5;
    const zone = {
      high: avgPrice + zoneWidth,
      low: avgPrice - zoneWidth,
    };

    // Generate ID
    const id = type === 'support'
      ? generateLevelId('support', supportIndex++)
      : generateLevelId('resistance', resistanceIndex++);

    scoredLevels.push({
      id,
      price: Math.round(avgPrice * 100) / 100, // Round to cents
      type,
      confluenceScore: score,
      strength: getStrengthLevel(score, atr.volatilityRegime),
      factors,
      description: buildDescription(factors, type),
      zone: {
        high: Math.round(zone.high * 100) / 100,
        low: Math.round(zone.low * 100) / 100,
      },
      distanceFromPrice: Math.abs(avgPrice - currentPrice),
      distancePercent,
    });
  }

  return scoredLevels;
}

// ============================================================================
// OVERALL CONFIDENCE SCORING
// ============================================================================

function calculateOverallConfidence(
  trend: TrendState,
  supportLevels: ScoredLevel[],
  resistanceLevels: ScoredLevel[],
  bollinger: BollingerData,
  overextensionStatus: string,
  dataPoints: number
): ConfidenceScoring {
  const config = ANALYSIS_CONFIG.CONFIDENCE;
  let score: number = config.baseScore;
  const factors: ConfidenceScoring['factors'] = [];

  // Positive factors
  if (trend.direction !== 'ranging') {
    score += config.adjustments.clearTrend;
    factors.push({
      name: 'Clear Trend',
      impact: config.adjustments.clearTrend,
      reason: `${trend.direction} detected`,
    });
  }

  const hasStrongSupport = supportLevels.some((l) => l.strength === 'strong');
  const hasStrongResistance = resistanceLevels.some((l) => l.strength === 'strong');
  if (hasStrongSupport && hasStrongResistance) {
    score += config.adjustments.strongLevels;
    factors.push({
      name: 'Strong Levels',
      impact: config.adjustments.strongLevels,
      reason: 'Both strong support and resistance identified',
    });
  }

  if (overextensionStatus === 'normal') {
    score += config.adjustments.notOverextended;
    factors.push({
      name: 'Not Overextended',
      impact: config.adjustments.notOverextended,
      reason: 'Price within normal range of 21 EMA',
    });
  }

  // Negative factors
  if (bollinger.squeeze) {
    score += config.penalties.bollingerSqueeze;
    factors.push({
      name: 'Bollinger Squeeze',
      impact: config.penalties.bollingerSqueeze,
      reason: 'Low volatility squeeze detected - breakout pending',
    });
  }

  // Check for conflicting signals (e.g., uptrend but near strong resistance)
  const nearResistance = resistanceLevels.some(
    (l) => l.strength === 'strong' && l.distancePercent < 3
  );
  const nearSupport = supportLevels.some(
    (l) => l.strength === 'strong' && l.distancePercent < 3
  );

  if (
    (trend.tradingBias === 'long' && nearResistance) ||
    (trend.tradingBias === 'short' && nearSupport)
  ) {
    score += config.penalties.conflictingSignals;
    factors.push({
      name: 'Conflicting Signals',
      impact: config.penalties.conflictingSignals,
      reason:
        trend.tradingBias === 'long'
          ? 'Bullish trend but approaching strong resistance'
          : 'Bearish trend but approaching strong support',
    });
  }

  if (dataPoints < config.minDataPoints) {
    score += config.penalties.insufficientData;
    factors.push({
      name: 'Limited Data',
      impact: config.penalties.insufficientData,
      reason: `Only ${dataPoints} data points (recommend ${config.minDataPoints}+)`,
    });
  }

  // Clamp score
  score = Math.max(30, Math.min(100, Math.round(score)));

  // Determine label
  let label: ConfidenceScoring['label'];
  if (score >= 80) label = 'high';
  else if (score >= 60) label = 'moderate';
  else if (score >= 40) label = 'low';
  else label = 'very_low';

  return { overall: score, label, factors };
}

// ============================================================================
// MAIN SCORING FUNCTION
// ============================================================================

export function scoreLevels(indicators: TechnicalIndicators): ScoredAnalysis {
  const {
    currentPrice,
    swingPoints,
    fibonacci,
    ema,
    volumeProfile,
    atr,
    trend,
    bollinger,
    overextension,
    dataPoints,
  } = indicators;

  // Generate candidate levels
  const candidates = generateCandidateLevels(
    currentPrice,
    swingPoints,
    fibonacci,
    ema,
    volumeProfile
  );

  // Score and consolidate
  const allLevels = consolidateLevels(
    candidates,
    currentPrice,
    swingPoints,
    fibonacci,
    ema,
    volumeProfile,
    atr
  );

  // Separate by type
  const rawSupport = allLevels
    .filter((l) => l.type === 'support')
    .sort((a, b) => b.confluenceScore - a.confluenceScore);

  const rawResistance = allLevels
    .filter((l) => l.type === 'resistance')
    .sort((a, b) => b.confluenceScore - a.confluenceScore);

  const interval = indicators.timeframe;
  const relevant = applyRelevance(
    { supportLevels: rawSupport, resistanceLevels: rawResistance },
    {
      currentPrice,
      atr: atr.atr,
      interval,
      // Full proximity decay enabled (Phases 2+3).
      options: { applyDecay: true },
    }
  );

  const supportLevels = relevant.supportLevels;
  const resistanceLevels = relevant.resistanceLevels;
  const profile = getRelevanceProfile(interval);

  // Select display levels (keep repo density: 2/side default)
  const maxPerSide = Math.floor(ANALYSIS_CONFIG.MAX_LEVELS_DEFAULT / 2);
  const displaySupport = selectDisplayLevelsByRelevance(
    supportLevels,
    maxPerSide,
    profile
  );
  const displayResistance = selectDisplayLevelsByRelevance(
    resistanceLevels,
    maxPerSide,
    profile
  );

  // Calculate overall confidence
  const confidence = calculateOverallConfidence(
    trend,
    supportLevels,
    resistanceLevels,
    bollinger,
    overextension.status,
    dataPoints
  );

  return {
    supportLevels,
    resistanceLevels,
    displayLevels: {
      support: displaySupport,
      resistance: displayResistance,
    },
    confidence,
  };
}

// ============================================================================
// EXPANDED LEVELS FOR "SHOW MORE"
// ============================================================================

export function getExpandedLevels(
  scoredAnalysis: ScoredAnalysis,
  _currentPrice: number
): { support: ScoredLevel[]; resistance: ScoredLevel[] } {
  const maxPerSide = Math.floor(ANALYSIS_CONFIG.MAX_LEVELS_EXPANDED / 2);
  // Expanded list: no displayMaxATR cap so distant strong levels remain available.
  const expandedSupport = selectDisplayLevelsByRelevance(
    scoredAnalysis.supportLevels,
    maxPerSide,
    undefined
  );
  const expandedResistance = selectDisplayLevelsByRelevance(
    scoredAnalysis.resistanceLevels,
    maxPerSide,
    undefined
  );

  return {
    support: expandedSupport,
    resistance: expandedResistance,
  };
}




