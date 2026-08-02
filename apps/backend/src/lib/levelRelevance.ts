/**
 * levelRelevance.ts
 * ---------------------------------------------------------------------------
 * Makes scored support/resistance levels actionable by weighting them against
 * distance from spot in ATR units.
 *
 * Pipeline (in order):
 *   1. DIRECTIONAL GUARD  — support below price, resistance above
 *   2. MERGE              — ATR-scaled zone collapse + factor union + bonus
 *   3. PROXIMITY DECAY    — score × ATR-normalized weight (soft floor)
 *   4. RE-RANK            — sort by effectiveScore
 *
 * UI must keep showing confluenceScore (factor agreement). effectiveScore is
 * ranking-only; surface distance as an ATR badge.
 */

import { ANALYSIS_CONFIG, type StrengthLevel } from './analysisConstants.js';
import type { ConfluenceFactors, ScoredLevel } from './confluenceScorer.js';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface RelevanceProfile {
  coreATR: number;
  halfATR: number;
  floor: number;
  mergeATR: number;
  maxPerSide: number;
  displayMaxATR: number;
}

export const RELEVANCE_PROFILES: Record<string, RelevanceProfile> = {
  '1d': { coreATR: 0.75, halfATR: 3.0, floor: 0.08, mergeATR: 0.3, maxPerSide: 8, displayMaxATR: 4.0 },
  '5d': { coreATR: 1.0, halfATR: 3.5, floor: 0.08, mergeATR: 0.3, maxPerSide: 8, displayMaxATR: 4.5 },
  '1mo': { coreATR: 1.0, halfATR: 4.0, floor: 0.08, mergeATR: 0.35, maxPerSide: 8, displayMaxATR: 5.0 },
  '3mo': { coreATR: 1.25, halfATR: 5.0, floor: 0.1, mergeATR: 0.4, maxPerSide: 8, displayMaxATR: 6.0 },
  '6mo': { coreATR: 1.5, halfATR: 5.5, floor: 0.1, mergeATR: 0.45, maxPerSide: 8, displayMaxATR: 7.0 },
  '1y': { coreATR: 1.5, halfATR: 6.0, floor: 0.12, mergeATR: 0.5, maxPerSide: 8, displayMaxATR: 7.5 },
  '2y': { coreATR: 2.0, halfATR: 7.0, floor: 0.12, mergeATR: 0.6, maxPerSide: 8, displayMaxATR: 8.5 },
  '5y': { coreATR: 2.0, halfATR: 8.0, floor: 0.15, mergeATR: 0.75, maxPerSide: 8, displayMaxATR: 10.0 },
};

const DEFAULT_PROFILE = RELEVANCE_PROFILES['3mo'];

const ZONE_ATR_FRACTION = 0.25;
const ZONE_MIN_PCT = 0.0015;
const ZONE_MAX_PCT = 0.0125;

export type ProximityLabel =
  | 'at_price'
  | 'in_play'
  | 'nearby'
  | 'extended'
  | 'distant';

export interface RelevanceOptions {
  /** When false, relevance=1 for every level (Phase 2 staging). Default true. */
  applyDecay?: boolean;
}

export interface RelevanceContext {
  currentPrice: number;
  atr: number;
  interval: string;
  options?: RelevanceOptions;
}

export interface RelevanceMeta {
  interval: string;
  atr: number;
  profile: RelevanceProfile;
  inPlayBand: number;
  halfLifeBand: number;
  supportCount: number;
  resistanceCount: number;
}

const isFiniteNum = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), hi);

export function getRelevanceProfile(interval: string): RelevanceProfile {
  return RELEVANCE_PROFILES[interval] || DEFAULT_PROFILE;
}

export function safeAtr(atr: number | undefined | null, currentPrice: number): number {
  if (isFiniteNum(atr) && atr > 0) return atr;
  const price = isFiniteNum(currentPrice) && currentPrice > 0 ? currentPrice : 1;
  return Math.max(price * 0.01, 1e-6);
}

export function zoneFor(
  price: number,
  atr: number
): { high: number; low: number; halfWidth: number } {
  const raw = ZONE_ATR_FRACTION * atr;
  const halfWidth = clamp(raw, price * ZONE_MIN_PCT, price * ZONE_MAX_PCT);
  return { high: price + halfWidth, low: price - halfWidth, halfWidth };
}

export function proximityWeight(
  distanceATR: number,
  profile: Pick<RelevanceProfile, 'coreATR' | 'halfATR' | 'floor'>
): number {
  if (!isFiniteNum(distanceATR) || distanceATR < 0) return profile.floor;
  if (distanceATR <= profile.coreATR) return 1;

  const span = Math.max(profile.halfATR - profile.coreATR, 0.25);
  const lambda = Math.LN2 / span;
  const w = Math.exp(-lambda * (distanceATR - profile.coreATR));
  return clamp(w, profile.floor, 1);
}

function strengthFor(score: number): StrengthLevel {
  const thresholds = ANALYSIS_CONFIG.STRENGTH_THRESHOLDS;
  if (score >= thresholds.strong) return 'strong';
  if (score >= thresholds.medium) return 'medium';
  return 'weak';
}

/**
 * ChartSignl ConfluenceFactors are always objects. A factor is "active" when
 * it contributed points / has a non-null match — NOT merely because the object exists.
 */
export function isActiveFactor(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.points === 'number') return v.points > 0;
  if (typeof v.isHighVolume === 'boolean') return v.isHighVolume;
  if (typeof v.isRound === 'boolean') return v.isRound;
  if (typeof v.isRecent === 'boolean') return v.isRecent;
  if ('level' in v) return v.level != null;
  if ('ema' in v) return v.ema != null;
  if (typeof v.count === 'number') return v.count > 0;
  return false;
}

export function factorCount(factors: ConfluenceFactors | null | undefined): number {
  if (!factors) return 0;
  return Object.values(factors).filter(isActiveFactor).length;
}

function emptyFactors(): ConfluenceFactors {
  return {
    historicalTouches: { count: 0, points: 0 },
    fibonacciAlignment: { level: null, distance: 0, points: 0 },
    emaProximity: { ema: null, distance: 0, points: 0 },
    volumeNode: { isHighVolume: false, volumePercent: 0, points: 0 },
    roundNumber: { isRound: false, nearestRound: null, points: 0 },
    recentRelevance: { isRecent: false, points: 0 },
  };
}

/** Prefer the sub-object with more signal (higher points / active flags). */
export function mergeFactors(
  a: ConfluenceFactors | undefined,
  b: ConfluenceFactors | undefined
): ConfluenceFactors {
  const left = a ?? emptyFactors();
  const right = b ?? emptyFactors();
  const out = { ...left };

  (Object.keys(right) as (keyof ConfluenceFactors)[]).forEach((key) => {
    const rv = right[key];
    const lv = left[key];
    if (!isActiveFactor(rv)) return;
    if (!isActiveFactor(lv)) {
      (out as Record<string, unknown>)[key] = rv;
      return;
    }
    const lp = typeof (lv as { points?: number }).points === 'number'
      ? (lv as { points: number }).points
      : 0;
    const rp = typeof (rv as { points?: number }).points === 'number'
      ? (rv as { points: number }).points
      : 0;
    if (rp >= lp) {
      (out as Record<string, unknown>)[key] = rv;
    }
  });

  return out;
}

export function describeProximity(
  distanceATR: number,
  profile: Pick<RelevanceProfile, 'coreATR' | 'halfATR'>
): ProximityLabel {
  if (distanceATR <= 0.25) return 'at_price';
  if (distanceATR <= profile.coreATR) return 'in_play';
  if (distanceATR <= profile.halfATR) return 'nearby';
  if (distanceATR <= profile.halfATR * 2) return 'extended';
  return 'distant';
}

export function mergeNearbyLevels(
  levels: ScoredLevel[],
  atr: number,
  mergeATR: number
): ScoredLevel[] {
  if (!Array.isArray(levels) || levels.length <= 1) {
    return (levels || []).map((l) => ({ ...l, mergedFrom: l.mergedFrom ?? 1 }));
  }

  const tolerance = Math.max(mergeATR * atr, 1e-9);
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const clusters: {
    anchorPrice: number;
    anchorScore: number;
    members: ScoredLevel[];
  }[] = [];

  for (const level of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(level.price - last.anchorPrice) <= tolerance) {
      last.members.push(level);
      if ((level.confluenceScore || 0) > (last.anchorScore || 0)) {
        last.anchorPrice = level.price;
        last.anchorScore = level.confluenceScore || 0;
      }
    } else {
      clusters.push({
        anchorPrice: level.price,
        anchorScore: level.confluenceScore || 0,
        members: [level],
      });
    }
  }

  return clusters.map((cluster) => {
    const { members } = cluster;
    if (members.length === 1) {
      return { ...members[0], mergedFrom: 1 };
    }

    const totalWeight = members.reduce(
      (sum, m) => sum + Math.max(m.confluenceScore || 0, 1),
      0
    );
    const price =
      members.reduce(
        (sum, m) => sum + m.price * Math.max(m.confluenceScore || 0, 1),
        0
      ) / totalWeight;

    const factors = members.reduce<ConfluenceFactors>(
      (acc, m) => mergeFactors(acc, m.factors),
      emptyFactors()
    );
    const base = members.reduce(
      (best, m) =>
        (m.confluenceScore || 0) > (best.confluenceScore || 0) ? m : best,
      members[0]
    );

    const uncovered = Math.max(
      factorCount(factors) - factorCount(base.factors),
      0
    );
    const bonus = Math.min(uncovered * 8, 24);
    const confluenceScore = clamp((base.confluenceScore || 0) + bonus, 0, 100);

    return {
      ...base,
      price,
      factors,
      confluenceScore,
      strength: strengthFor(confluenceScore),
      mergedFrom: members.length,
      distanceFromPrice: 0,
      distancePercent: 0,
    };
  });
}

function applyRelevanceToSide(
  levels: ScoredLevel[],
  role: 'support' | 'resistance',
  ctx: RelevanceContext
): ScoredLevel[] {
  const { currentPrice, interval } = ctx;
  const atr = safeAtr(ctx.atr, currentPrice);
  const profile = getRelevanceProfile(interval);
  const applyDecay = ctx.options?.applyDecay !== false;

  if (!Array.isArray(levels) || levels.length === 0) return [];

  const directional = levels.filter((l) => {
    if (!isFiniteNum(l?.price) || l.price <= 0) return false;
    const tol = zoneFor(l.price, atr).halfWidth * 0.5;
    return role === 'support'
      ? l.price <= currentPrice + tol
      : l.price >= currentPrice - tol;
  });

  if (directional.length === 0) return [];

  const merged = mergeNearbyLevels(directional, atr, profile.mergeATR);

  const weighted = merged.map((level) => {
    const distance = Math.abs(level.price - currentPrice);
    const distanceATR = distance / atr;
    const distancePercent = (distance / currentPrice) * 100;
    const relevance = applyDecay ? proximityWeight(distanceATR, profile) : 1;
    const baseScore = clamp(level.confluenceScore || 0, 0, 100);
    const effectiveScore = Math.round(baseScore * relevance);
    const zone = zoneFor(level.price, atr);

    return {
      ...level,
      type: role,
      zone: { high: zone.high, low: zone.low, halfWidth: zone.halfWidth },
      confluenceScore: baseScore,
      effectiveScore,
      relevance: Math.round(relevance * 100) / 100,
      distanceATR: Math.round(distanceATR * 100) / 100,
      distanceFromPrice: distance,
      distancePercent: Math.round(distancePercent * 100) / 100,
      proximityLabel: describeProximity(distanceATR, profile),
      strength: strengthFor(applyDecay ? effectiveScore : baseScore),
      factorCount: factorCount(level.factors),
    } satisfies ScoredLevel;
  });

  return weighted
    .sort((a, b) => {
      const ae = a.effectiveScore ?? a.confluenceScore;
      const be = b.effectiveScore ?? b.confluenceScore;
      if (be !== ae) return be - ae;
      return (a.distanceATR ?? 0) - (b.distanceATR ?? 0);
    })
    .slice(0, profile.maxPerSide);
}

export function applyRelevance(
  scored: {
    supportLevels?: ScoredLevel[];
    resistanceLevels?: ScoredLevel[];
  },
  ctx: RelevanceContext
): {
  supportLevels: ScoredLevel[];
  resistanceLevels: ScoredLevel[];
  relevanceMeta: RelevanceMeta;
} {
  const atr = safeAtr(ctx?.atr, ctx?.currentPrice);
  const profile = getRelevanceProfile(ctx?.interval);
  const sideCtx = { ...ctx, atr };

  const supportLevels = applyRelevanceToSide(
    scored?.supportLevels ?? [],
    'support',
    sideCtx
  );
  const resistanceLevels = applyRelevanceToSide(
    scored?.resistanceLevels ?? [],
    'resistance',
    sideCtx
  );

  return {
    supportLevels,
    resistanceLevels,
    relevanceMeta: {
      interval: ctx?.interval,
      atr,
      profile,
      inPlayBand: profile.coreATR * atr,
      halfLifeBand: profile.halfATR * atr,
      supportCount: supportLevels.length,
      resistanceCount: resistanceLevels.length,
    },
  };
}

/**
 * Pick display levels with distance cap + nearest-level guarantee.
 * Keep display density via `limit` (repo default: 2/side).
 */
export function selectDisplayLevelsByRelevance(
  levels: ScoredLevel[],
  limit = 2,
  profile?: Pick<RelevanceProfile, 'displayMaxATR'>
): ScoredLevel[] {
  if (!Array.isArray(levels) || levels.length === 0) return [];

  const cap = profile?.displayMaxATR;
  let pool = levels;
  if (isFiniteNum(cap)) {
    const within = levels.filter((l) => (l.distanceATR ?? 0) <= cap);
    pool = within.length > 0 ? within : levels;
  }

  if (pool.length <= limit) {
    return [...pool].sort((a, b) => a.price - b.price);
  }

  const nearest = pool.reduce(
    (best, l) =>
      (l.distanceATR ?? Infinity) < (best.distanceATR ?? Infinity) ? l : best,
    pool[0]
  );

  const picked: ScoredLevel[] = [nearest];
  for (const level of pool) {
    if (picked.length >= limit) break;
    if (level === nearest) continue;
    picked.push(level);
  }

  return picked.sort((a, b) => a.price - b.price);
}

/** Human-readable distance badge text. */
export function proximityLabelText(
  level: Pick<ScoredLevel, 'distanceATR' | 'type' | 'proximityLabel'>,
  fallbackPercent?: number
): string {
  const side = level.type === 'support' ? 'below' : 'above';
  if (isFiniteNum(level.distanceATR)) {
    return `${level.distanceATR.toFixed(1)} ATR ${side}`;
  }
  if (isFiniteNum(fallbackPercent)) {
    return `${fallbackPercent.toFixed(1)}% ${side}`;
  }
  return side;
}
