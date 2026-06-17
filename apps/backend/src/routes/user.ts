import { Hono } from 'hono';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import type { UsageResponse, AuthResponse } from '@marketsignl/core';
import { FREE_ANALYSIS_LIMIT, FREE_PREDICTION_LIMIT } from '@marketsignl/core';

const userRoute = new Hono();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getEffectiveUsedThisWeek(
  usage: { free_analyses_used: number; last_analysis_at: string | null } | null | undefined
): number {
  if (!usage) return 0;
  if (!usage.last_analysis_at) return 0;
  const elapsed = Date.now() - new Date(usage.last_analysis_at).getTime();
  return elapsed < WEEK_MS ? usage.free_analyses_used : 0;
}

function getEffectivePredictionsThisWeek(
  usage: { free_predictions_used: number; last_prediction_at: string | null } | null | undefined
): number {
  if (!usage) return 0;
  if (!usage.last_prediction_at) return 0;
  const elapsed = Date.now() - new Date(usage.last_prediction_at).getTime();
  return elapsed < WEEK_MS ? usage.free_predictions_used : 0;
}

// GET /api/user/me - Get current user profile
userRoute.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json<AuthResponse>({
        success: false,
        error: 'Missing authorization token',
      }, 401);
    }
    
    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    
    if (!userId) {
      return c.json<AuthResponse>({
        success: false,
        error: 'Invalid authorization token',
      }, 401);
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return c.json<AuthResponse>({
        success: false,
        error: 'Profile not found',
      }, 404);
    }

    // Also get usage (maybeSingle: no error when 0 rows)
    const { data: usage } = await supabaseAdmin
      .from('usage_counters')
      .select('free_analyses_used, last_analysis_at')
      .eq('user_id', userId)
      .maybeSingle();

    const effectiveUsed = getEffectiveUsedThisWeek(usage ?? undefined);

    return c.json<AuthResponse>({
      success: true,
      user: {
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        createdAt: profile.created_at,
        tradingStyle: profile.trading_style,
        experienceLevel: profile.experience_level,
        stressReducer: profile.stress_reducer,
        isPro: profile.is_pro || false,
        freeAnalysesUsed: effectiveUsed,
        pushNotificationsEnabled: profile.push_notifications_enabled ?? true,
        alertSoundEnabled: profile.alert_sound_enabled ?? true,
      },
    });

  } catch (error) {
    console.error('Get user error:', error);
    return c.json<AuthResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

// PUT /api/user/profile - Update user profile
userRoute.put('/profile', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Missing authorization token' }, 401);
    }
    
    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    
    if (!userId) {
      return c.json({ success: false, error: 'Invalid authorization token' }, 401);
    }

    const body = await c.req.json();
    
    // Only allow updating specific fields
    const allowedFields = [
      'display_name',
      'trading_style',
      'experience_level',
      'stress_reducer',
      'onboarding_completed',
    ];

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ success: false, error: 'No valid fields to update' }, 400);
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) {
      return c.json({ success: false, error: 'Failed to update profile' }, 500);
    }

    return c.json({ success: true });

  } catch (error) {
    console.error('Update profile error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

// GET /api/user/usage - Get usage stats
userRoute.get('/usage', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json<UsageResponse>({
        success: false,
        error: 'Missing authorization token',
      }, 401);
    }
    
    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    
    if (!userId) {
      return c.json<UsageResponse>({
        success: false,
        error: 'Invalid authorization token',
      }, 401);
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_pro')
      .eq('id', userId)
      .single();

    const { data: usage } = await supabaseAdmin
      .from('usage_counters')
      .select('free_analyses_used, last_analysis_at, free_predictions_used, last_prediction_at')
      .eq('user_id', userId)
      .maybeSingle();

    const effectiveUsed = getEffectiveUsedThisWeek(usage ?? undefined);
    const effectivePredictionsUsed = getEffectivePredictionsThisWeek(usage ?? undefined);

    return c.json<UsageResponse>({
      success: true,
      freeAnalysesUsed: effectiveUsed,
      freeAnalysesLimit: FREE_ANALYSIS_LIMIT,
      freePredictionsUsed: effectivePredictionsUsed,
      freePredictionsLimit: FREE_PREDICTION_LIMIT,
      isPro: profile?.is_pro || false,
    });

  } catch (error) {
    console.error('Get usage error:', error);
    return c.json<UsageResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

export default userRoute;
