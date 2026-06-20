// History Route - Simplified (No Images)

import { Hono } from 'hono';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import type { GetHistoryResponse, GetAnalysisResponse, AnalysisHistoryItem } from '@chartsignl/core';

const historyRoute = new Hono();

// GET /api/analyses - Get user's analysis history
historyRoute.get('/', async (c) => {
  try {
    // Get authorization
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json<GetHistoryResponse>({
        success: false,
        error: 'Missing authorization token',
      }, 401);
    }
    
    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    
    if (!userId) {
      return c.json<GetHistoryResponse>({
        success: false,
        error: 'Invalid authorization token',
      }, 401);
    }

    // Parse pagination params
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);
    const offset = (page - 1) * limit;

    // Fetch analyses (no image_url needed)
    const { data: analyses, error, count } = await supabaseAdmin
      .from('chart_analyses')
      .select('id, created_at, symbol, timeframe, headline', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('History fetch error:', error);
      return c.json<GetHistoryResponse>({
        success: false,
        error: 'Failed to fetch analysis history',
      }, 500);
    }

    // Transform to response format (no imageUrl)
    const historyItems: AnalysisHistoryItem[] = (analyses || []).map((a) => ({
      id: a.id,
      createdAt: a.created_at,
      symbol: a.symbol,
      timeframe: a.timeframe,
      headline: a.headline || 'Chart analysis',
    }));

    return c.json<GetHistoryResponse>({
      success: true,
      analyses: historyItems,
      total: count || 0,
      hasMore: (count || 0) > offset + limit,
    });

  } catch (error) {
    console.error('History route error:', error);
    return c.json<GetHistoryResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

// GET /api/analyses/:id - Get single analysis
historyRoute.get('/:id', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json<GetAnalysisResponse>({
        success: false,
        error: 'Missing authorization token',
      }, 401);
    }
    
    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    
    if (!userId) {
      return c.json<GetAnalysisResponse>({
        success: false,
        error: 'Invalid authorization token',
      }, 401);
    }

    const analysisId = c.req.param('id');

    // Fetch the analysis (no image_url)
    const { data: analysis, error } = await supabaseAdmin
      .from('chart_analyses')
      .select('analysis_json, created_at')
      .eq('id', analysisId)
      .eq('user_id', userId)
      .single();

    if (error || !analysis) {
      return c.json<GetAnalysisResponse>({
        success: false,
        error: 'Analysis not found',
      }, 404);
    }

    return c.json<GetAnalysisResponse>({
      success: true,
      analysis: analysis.analysis_json,
      createdAt: analysis.created_at,
    });

  } catch (error) {
    console.error('Get analysis error:', error);
    return c.json<GetAnalysisResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

// DELETE /api/analyses/:id - Delete an analysis
historyRoute.delete('/:id', async (c) => {
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

    const analysisId = c.req.param('id');

    // Delete from database (no storage cleanup needed)
    const { error } = await supabaseAdmin
      .from('chart_analyses')
      .delete()
      .eq('id', analysisId)
      .eq('user_id', userId);

    if (error) {
      return c.json({ success: false, error: 'Failed to delete analysis' }, 500);
    }

    return c.json({ success: true });

  } catch (error) {
    console.error('Delete analysis error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

export default historyRoute;
