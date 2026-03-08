// Enhanced Analysis Route - DATA ONLY VERSION
// This version saves analyses to database without any image handling

import { Hono } from 'hono';
import OpenAI from 'openai';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import { FREE_ANALYSIS_LIMIT } from '@chartsignl/core';
import { notifyFirstAnalysis, notifyPaywallHit } from '../lib/growthhub.js';

// Import our technical analysis modules
import {
  calculateAllIndicators,
  type MarketDataPoint,
  type TechnicalIndicators,
} from '../lib/technicalCalculator.js';

import {
  scoreLevels,
  getExpandedLevels,
  type ScoredAnalysis,
} from '../lib/confluenceScorer.js';

import type {
  EnhancedAIAnalysis,
  TechnicalDetails,
  TradeIdea,
} from '@chartsignl/core';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const analyzeDataRoute = new Hono();

/** 7 days in ms for weekly free-analysis reset */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getEffectiveUsedThisWeek(
  usage: { free_analyses_used: number; last_analysis_at: string | null } | null | undefined
): number {
  if (!usage) return 0;
  if (!usage.last_analysis_at) return 0;
  const elapsed = Date.now() - new Date(usage.last_analysis_at).getTime();
  return elapsed < WEEK_MS ? usage.free_analyses_used : 0;
}

// ============================================================================
// AI PROMPT TEMPLATES
// ============================================================================

const SYSTEM_PROMPT = `You are a technical analysis expert for ChartSignl. You receive pre-calculated technical indicators and scored support/resistance levels. Your job is to:

1. INTERPRET the data - explain what it means in plain English
2. SYNTHESIZE - connect the indicators to form a cohesive market view
3. IDENTIFY the highest-probability trade setups based on the scored levels
4. PROVIDE context using the pre-calculated entry/exit zones

IMPORTANT: You are NOT calculating indicators - they are provided. Focus on interpretation and actionable insights.

Rules:
- Be concise and actionable
- Lead with the most important insight
- Always include risk context
- Use the provided zones and levels, don't make up new numbers
- Reference specific indicator values to support your analysis
- If signals conflict, acknowledge the uncertainty
- Keep the headline under 15 words
- Keep observations to 3-5 bullet points max

Return your analysis as JSON with this exact structure:
{
  "headline": "One sentence summary",
  "summary": "2-3 sentence market overview",
  "keyObservations": ["observation 1", "observation 2", "observation 3"],
  "tradeIdeas": [
    {
      "direction": "long" or "short",
      "scenario": "Description of the trade setup",
      "confidence": 0-100,
      "invalidation": "What would make this setup invalid"
    }
  ],
  "riskFactors": ["risk 1", "risk 2"]
}

Return ONLY valid JSON, no other text.`;

function buildUserPrompt(
  symbol: string,
  timeframe: string,
  indicators: TechnicalIndicators,
  scoredAnalysis: ScoredAnalysis
): string {
  const { currentPrice, priceChangePercent, trend, ema, atr, bollinger, overextension, fibonacci } =
    indicators;

  const { supportLevels, resistanceLevels, confidence } = scoredAnalysis;

  const topSupport = supportLevels.slice(0, 3);
  const topResistance = resistanceLevels.slice(0, 3);

  // Calculate EMA percentage differences from current price
  const ema9Diff = ema.ema9 > 0 ? ((ema.ema9 - currentPrice) / currentPrice) * 100 : 0;
  const ema21Diff = ema.ema21 > 0 ? ((ema.ema21 - currentPrice) / currentPrice) * 100 : 0;
  const ema65Diff = ema.ema65 > 0 ? ((ema.ema65 - currentPrice) / currentPrice) * 100 : 0;

  return `Analyze ${symbol} on the ${timeframe} timeframe.

CURRENT STATE:
- Price: $${currentPrice.toFixed(2)} (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)
- Trend: ${trend.direction} (${(trend.strength * 100).toFixed(0)}% strength)
- Trading Bias: ${trend.tradingBias} - ${trend.biasReason}

MOVING AVERAGES:
- EMA 9: $${(ema.ema9 || 0).toFixed(2)} (${ema9Diff > 0 ? '+' : ''}${ema9Diff.toFixed(2)}%)
- EMA 21: $${(ema.ema21 || 0).toFixed(2)} (${ema21Diff > 0 ? '+' : ''}${ema21Diff.toFixed(2)}%)
- EMA 65: $${(ema.ema65 || 0).toFixed(2)} (${ema65Diff > 0 ? '+' : ''}${ema65Diff.toFixed(2)}%)
- Alignment: ${trend.emaAlignment || 'mixed'}

VOLATILITY & MOMENTUM:
- ATR: $${atr.atr.toFixed(2)} (${atr.atrPercent.toFixed(2)}% of price)
- Bollinger Bands: Lower $${bollinger.lowerBand.toFixed(2)} | Middle $${bollinger.middleBand.toFixed(2)} | Upper $${bollinger.upperBand.toFixed(2)}
- Band Position: ${(bollinger.percentB * 100).toFixed(1)}% (0% = lower band, 100% = upper band)
- Overextension: ${overextension.status} (${overextension.direction} EMA21, signal: ${overextension.signalType})

${fibonacci ? `FIBONACCI LEVELS (${fibonacci.swingDirection === 'up' ? 'retracement' : 'extension'} from ${fibonacci.swingHighDate} to ${fibonacci.swingLowDate}):
- 0%: $${(fibonacci.swingDirection === 'up' ? fibonacci.swingLow : fibonacci.swingHigh).toFixed(2)}
${fibonacci.levels.map((fib: any) => `- ${fib.label}: $${fib.price.toFixed(2)}`).join('\n')}
- 100%: $${(fibonacci.swingDirection === 'up' ? fibonacci.swingHigh : fibonacci.swingLow).toFixed(2)}
` : ''}

TOP SUPPORT LEVELS (${supportLevels.length} total, showing top 3):
${topSupport.map((l: any, i: number) => `${i + 1}. $${l.price.toFixed(2)} - ${l.strength} (${l.confluenceScore}% confluence, ${l.distancePercent.toFixed(2)}% away)
   Factors: ${Object.entries(l.factors)
     .filter(([_k, v]: [string, any]) => v)
     .map((entry: [string, any]) => entry[0])
     .join(', ')}`).join('\n')}

TOP RESISTANCE LEVELS (${resistanceLevels.length} total, showing top 3):
${topResistance.map((l: any, i: number) => `${i + 1}. $${l.price.toFixed(2)} - ${l.strength} (${l.confluenceScore}% confluence, ${l.distancePercent.toFixed(2)}% away)
   Factors: ${Object.entries(l.factors)
     .filter(([_k, v]: [string, any]) => v)
     .map((entry: [string, any]) => entry[0])
     .join(', ')}`).join('\n')}

ANALYSIS CONFIDENCE: ${confidence.overall}% (${confidence.label})
Factors affecting confidence:
${confidence.factors.map((f: any) => `- ${f.name}: ${f.impact > 0 ? '+' : ''}${f.impact}% - ${f.reason}`).join('\n')}

Based on this data, provide your analysis focusing on the most actionable insights for a trader.`;
}

// ============================================================================
// MAIN ROUTE
// ============================================================================

analyzeDataRoute.post('/', async (c) => {
  try {
    console.log('[Analysis] Request received');

    // ========================================================================
    // STEP 1: Authentication & Authorization
    // ========================================================================
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Missing authorization token' }, 401);
    }

    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);

    if (!userId) {
      return c.json({ success: false, error: 'Invalid authorization token' }, 401);
    }

    // Get user profile (include email for GrowthHub webhooks)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_pro, email')
      .eq('id', userId)
      .single();

    // Check usage limits (maybeSingle: no error when 0 rows, so we can upsert later)
    const { data: usage } = await supabaseAdmin
      .from('usage_counters')
      .select('free_analyses_used, last_analysis_at')
      .eq('user_id', userId)
      .maybeSingle();

    const effectiveUsed = getEffectiveUsedThisWeek(usage ?? undefined);

    if (!profile?.is_pro && effectiveUsed >= FREE_ANALYSIS_LIMIT) {
      return c.json(
        {
          success: false,
          error: `Free tier limit reached (${FREE_ANALYSIS_LIMIT} analyses). Please upgrade to Pro.`,
        },
        403
      );
    }

    // ========================================================================
    // STEP 2: Parse request data
    // ========================================================================
    const body = await c.req.json();
    const { symbol, interval, data } = body as {
      symbol: string;
      interval: string;
      data: MarketDataPoint[];
    };

    if (!symbol || !interval || !Array.isArray(data) || data.length === 0) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    console.log(`[Analysis] Analyzing ${symbol} (${interval}) with ${data.length} data points`);

    // ========================================================================
    // STEP 3: Calculate technical indicators
    // ========================================================================
    const indicators = calculateAllIndicators(data, symbol, interval);

    if (!indicators) {
      return c.json({ success: false, error: 'Failed to calculate technical indicators' }, 500);
    }

    console.log(`[Analysis] Indicators calculated:`, {
      trend: indicators.trend.direction,
      emaAlignment: indicators.trend.emaAlignment,
      overextension: indicators.overextension.status,
    });

    // ========================================================================
    // STEP 4: Score levels with confluence
    // ========================================================================
    const scoredAnalysis = scoreLevels(indicators);
    const expandedLevels = getExpandedLevels(scoredAnalysis, indicators.currentPrice);

    console.log(`[Analysis] Levels scored:`, {
      support: scoredAnalysis.displayLevels.support.length,
      resistance: scoredAnalysis.displayLevels.resistance.length,
      confidence: scoredAnalysis.confidence.overall,
    });

    // ========================================================================
    // STEP 5: Get AI interpretation
    // ========================================================================
    const userPrompt = buildUserPrompt(symbol, interval, indicators, scoredAnalysis);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: 800,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const aiResponseText = completion.choices[0]?.message?.content;
    if (!aiResponseText) {
      throw new Error('No response from AI');
    }

    const aiResponse = JSON.parse(aiResponseText) as {
      headline: string;
      summary: string;
      keyObservations: string[];
      tradeIdeas: Array<{
        direction: 'long' | 'short';
        scenario: string;
        confidence: number;
        invalidation: string;
      }>;
      riskFactors: string[];
    };

    // ========================================================================
    // STEP 6: Build complete analysis response
    // ========================================================================
    
    // Build trade ideas with proper zones
    const tradeIdeas: TradeIdea[] = aiResponse.tradeIdeas.map((idea) => {
      const isLong = idea.direction === 'long';
      const entryLevels = isLong ? scoredAnalysis.supportLevels : scoredAnalysis.resistanceLevels;
      const targetLevels = isLong ? scoredAnalysis.resistanceLevels : scoredAnalysis.supportLevels;

      const entry = entryLevels[0];
      const target = targetLevels[0];

      if (!entry || !target) {
        return {
          direction: idea.direction,
          scenario: idea.scenario,
          entryZone: {
            low: indicators.currentPrice * 0.98,
            high: indicators.currentPrice * 1.02,
          },
          target: indicators.currentPrice * (isLong ? 1.05 : 0.95),
          stop: indicators.currentPrice * (isLong ? 0.97 : 1.03),
          riskRewardRatio: 1.5,
          confidence: idea.confidence,
          invalidation: idea.invalidation,
        };
      }

      const entryPrice = entry.price;
      const targetPrice = target.price;
      const stopDistance = indicators.atr.atr * 2;
      const stopPrice = isLong ? entryPrice - stopDistance : entryPrice + stopDistance;
      const risk = Math.abs(entryPrice - stopPrice);
      const reward = Math.abs(targetPrice - entryPrice);
      const rr = reward / risk;

      return {
        direction: idea.direction,
        scenario: idea.scenario,
        entryZone: entry.zone,
        target: targetPrice,
        stop: stopPrice,
        riskRewardRatio: parseFloat(rr.toFixed(2)),
        confidence: idea.confidence,
        invalidation: idea.invalidation,
      };
    });

    // Build technical details
    const technicalDetails: TechnicalDetails = {
      summary: [
        {
          indicator: 'Trend',
          value: `${indicators.trend.direction} (${(indicators.trend.strength * 100).toFixed(0)}%)`,
          status: indicators.trend.tradingBias === 'long' ? 'bullish' : indicators.trend.tradingBias === 'short' ? 'bearish' : 'neutral',
          statusLabel: indicators.trend.biasReason,
        },
        {
          indicator: 'EMA Alignment',
          value: indicators.trend.emaAlignment,
          status: indicators.trend.emaAlignment.includes('bullish') ? 'bullish' : indicators.trend.emaAlignment.includes('bearish') ? 'bearish' : 'neutral',
          statusLabel: `9: ${indicators.ema.ema9.toFixed(2)}, 21: ${indicators.ema.ema21.toFixed(2)}, 65: ${indicators.ema.ema65.toFixed(2)}`,
        },
        {
          indicator: 'Volatility (ATR)',
          value: `${indicators.atr.atrPercent.toFixed(2)}%`,
          status: indicators.atr.atrPercent > 3 ? 'warning' : 'neutral',
          statusLabel: `$${indicators.atr.atr.toFixed(2)} average range`,
        },
        {
          indicator: 'Bollinger Position',
          value: `${(indicators.bollinger.percentB * 100).toFixed(0)}%`,
          status: indicators.bollinger.percentB > 0.8 ? 'warning' : indicators.bollinger.percentB < 0.2 ? 'warning' : 'neutral',
          statusLabel: indicators.bollinger.percentB > 0.8 ? 'Near upper band' : indicators.bollinger.percentB < 0.2 ? 'Near lower band' : 'Mid-range',
        },
      ],
      raw: {
        ema: indicators.ema,
        atr: indicators.atr,
        bollinger: indicators.bollinger,
        overextension: indicators.overextension,
        fibonacci: indicators.fibonacci,
        volumeProfile: indicators.volumeProfile,
      },
    };

    // Build overextension description
    let overextensionDescription: string;
    if (indicators.overextension.status === 'normal') {
      overextensionDescription = 'Price is trading near the 21 EMA. No overextension detected.';
    } else if (indicators.overextension.status === 'moderately_extended') {
      overextensionDescription = `Price is moderately extended ${indicators.overextension.direction} the 21 EMA. A pullback may be healthy.`;
    } else if (indicators.overextension.status === 'overextended') {
      overextensionDescription = `Price is overextended ${indicators.overextension.direction} the 21 EMA. Mean reversion is likely.`;
    } else {
      overextensionDescription = `Price is extremely extended ${indicators.overextension.direction} the 21 EMA. High probability of reversal.`;
    }

    const analysis: EnhancedAIAnalysis = {
      symbol,
      timeframe: interval,
      analyzedAt: new Date().toISOString(),

      currentPrice: indicators.currentPrice,
      priceChange: indicators.priceChange,
      priceChangePercent: indicators.priceChangePercent,

      overallConfidence: scoredAnalysis.confidence.overall,
      confidenceLabel: scoredAnalysis.confidence.label,
      confidenceFactors: scoredAnalysis.confidence.factors,

      trend: {
        direction: indicators.trend.direction,
        strength: indicators.trend.strength,
        bias: indicators.trend.tradingBias,
        summary: indicators.trend.biasReason,
      },

      supportLevels: scoredAnalysis.displayLevels.support,
      resistanceLevels: scoredAnalysis.displayLevels.resistance,
      allSupportLevels: expandedLevels.support,
      allResistanceLevels: expandedLevels.resistance,

      overextension: {
        status: indicators.overextension.status,
        signal: indicators.overextension.signalType === 'none' ? null : indicators.overextension.signalType,
        description: overextensionDescription,
      },

      headline: aiResponse.headline || `${symbol} in ${indicators.trend.direction.replace(/_/g, ' ')}`,
      summary: aiResponse.summary || indicators.trend.biasReason,
      keyObservations: aiResponse.keyObservations || [],

      tradeIdeas,
      riskFactors: aiResponse.riskFactors || [],

      technicalDetails,
    };

    // ========================================================================
    // STEP 7: SAVE TO DATABASE
    // ========================================================================
    const { data: savedAnalysis, error: saveError } = await supabaseAdmin
      .from('chart_analyses')
      .insert({
        user_id: userId,
        symbol: symbol,
        timeframe: interval,
        analysis_json: analysis,
        headline: analysis.headline,
        trend_type: analysis.trend.direction,
        level_count: analysis.supportLevels.length + analysis.resistanceLevels.length,
      })
      .select('id')
      .single();

    if (saveError) {
      console.error('[Analysis] Database save error:', saveError);
      // Don't fail the request - the analysis was successful
    } else {
      console.log('[Analysis] Saved to database with ID:', savedAnalysis?.id);
    }

    // ========================================================================
    // STEP 8: Enforce 50-analysis limit — delete oldest beyond 50
    // ========================================================================
    if (!saveError) {
      const { data: oldAnalyses } = await supabaseAdmin
        .from('chart_analyses')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(50, 9999);

      if (oldAnalyses && oldAnalyses.length > 0) {
        const idsToDelete = oldAnalyses.map((a) => a.id);
        await supabaseAdmin.from('chart_analyses').delete().in('id', idsToDelete);
      }
    }

    // ========================================================================
    // STEP 9: Update usage counter (upsert so missing row is created; weekly reset via effectiveUsed)
    //         and fire GrowthHub webhooks for key milestones
    // ========================================================================
    if (!profile?.is_pro) {
      const previousCount = effectiveUsed;
      const newCount = previousCount + 1;
      const lastAnalysisAt = new Date().toISOString();

      await supabaseAdmin
        .from('usage_counters')
        .upsert(
          {
            user_id: userId,
            free_analyses_used: newCount,
            last_analysis_at: lastAnalysisAt,
          },
          { onConflict: 'user_id' }
        )
        .select('user_id');

      const email = profile?.email as string | null | undefined;

      if (email) {
        // First analysis for this user in the current rolling window
        if (previousCount === 0) {
          // Fire and forget — don't block the response
          notifyFirstAnalysis(email, symbol).catch(() => {});
          console.log('[Webhook] First analysis event fired for:', email);
        }

        // User has now reached or exceeded the free analysis limit
        if (newCount >= FREE_ANALYSIS_LIMIT) {
          // Fire and forget
          notifyPaywallHit(email, newCount).catch(() => {});
          console.log('[Webhook] Paywall hit event fired for:', email);
        }
      }
    }

    console.log(`[Analysis] Complete for ${symbol}:`, {
      confidence: analysis.overallConfidence,
      supportLevels: analysis.supportLevels.length,
      resistanceLevels: analysis.resistanceLevels.length,
      savedToDb: !saveError,
    });

    return c.json({ 
      success: true, 
      analysis,
      analysisId: savedAnalysis?.id,
    });
    
  } catch (error) {
    console.error('[Analysis] Error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      500
    );
  }
});

export default analyzeDataRoute;
