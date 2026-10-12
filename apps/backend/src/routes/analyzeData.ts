import { Hono } from 'hono';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import { FREE_ANALYSIS_LIMIT } from '@chartsignl/core';
import { notifyFirstAnalysis, notifyPaywallHit } from '../lib/growthhub.js';
import { createAlertsFromAnalysis } from '../services/pushNotificationService.js';
import type { MarketDataPoint } from '../lib/technicalCalculator.js';
import { PROMPT_VERSION, runAtlasAnalysis } from '../lib/runAtlasAnalysis.js';
import { clientMessageForError } from '../lib/openaiGuard.js';

const analyzeDataRoute = new Hono();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getEffectiveUsedThisWeek(
  usage: { free_analyses_used: number; last_analysis_at: string | null } | null | undefined
): number {
  if (!usage) return 0;
  if (!usage.last_analysis_at) return 0;
  const elapsed = Date.now() - new Date(usage.last_analysis_at).getTime();
  return elapsed < WEEK_MS ? usage.free_analyses_used : 0;
}

export { PROMPT_VERSION };

analyzeDataRoute.post('/', async (c) => {
  try {
    console.log('[Analysis] Request received');

    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Missing authorization token' }, 401);
    }

    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);

    if (!userId) {
      return c.json({ success: false, error: 'Invalid authorization token' }, 401);
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_pro, email')
      .eq('id', userId)
      .single();

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

    const body = await c.req.json();
    const { symbol, interval, data, forecast, predictionId, freshness: rawFreshness } = body as {
      symbol: string;
      interval: string;
      data: MarketDataPoint[];
      forecast?: { direction: string; confidence: number } | null;
      predictionId?: string;
      freshness?: unknown;
    };

    if (!symbol || !interval || !Array.isArray(data) || data.length === 0) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const result = await runAtlasAnalysis({
      symbol,
      interval,
      data,
      forecast,
      rawFreshness,
    });

    if (!result.ok) {
      return c.json({ success: false, error: result.error }, result.status);
    }

    const analysis = result.analysis;

    let linkedPredictionId: string | null = null;
    if (predictionId) {
      const { data: linkedPred } = await supabaseAdmin
        .from('predictions')
        .select('id')
        .eq('id', predictionId)
        .eq('user_id', userId)
        .maybeSingle();
      if (linkedPred?.id) {
        linkedPredictionId = linkedPred.id;
      }
    }

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
        prediction_id: linkedPredictionId,
      })
      .select('id')
      .single();

    if (saveError) {
      console.error('[Analysis] Database save error:', saveError);
    } else {
      console.log('[Analysis] Saved to database with ID:', savedAnalysis?.id);

      if (savedAnalysis?.id && linkedPredictionId) {
        await supabaseAdmin
          .from('predictions')
          .update({ analysis_id: savedAnalysis.id })
          .eq('id', linkedPredictionId)
          .eq('user_id', userId);
      }

      if (savedAnalysis?.id) {
        void createAlertsFromAnalysis(
          supabaseAdmin,
          userId,
          savedAnalysis.id,
          symbol,
          analysis.currentPrice,
          analysis.supportLevels.map((l) => ({
            price: l.price,
            strength: l.strength,
            description: l.description,
          })),
          analysis.resistanceLevels.map((l) => ({
            price: l.price,
            strength: l.strength,
            description: l.description,
          }))
        ).catch((err) =>
          console.error('[PUSH] createAlertsFromAnalysis failed:', err)
        );
      }
    }

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
        if (previousCount === 0) {
          notifyFirstAnalysis(email, symbol).catch(() => {});
          console.log('[Webhook] First analysis event fired for:', email);
        }

        if (newCount >= FREE_ANALYSIS_LIMIT) {
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
      promptVersion: PROMPT_VERSION,
      asOf: analysis.freshness?.asOf ?? null,
    });

    return c.json({
      success: true,
      analysis,
      analysisId: savedAnalysis?.id,
    });
  } catch (error) {
    console.error('[Analysis] Error:', error);
    const mapped = clientMessageForError(error);
    return c.json({ success: false, error: mapped.message }, mapped.status);
  }
});

export default analyzeDataRoute;
