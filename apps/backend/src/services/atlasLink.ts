import { supabaseAdmin } from '../lib/supabase.js';

/** Max gap between predict + analyze saves in a single Atlas run. */
const LINK_WINDOW_MS = 3 * 60 * 1000;

export async function findLinkedPredictionId(
  userId: string,
  analysis: {
    id: string;
    symbol: string | null;
    timeframe: string | null;
    created_at: string;
    prediction_id?: string | null;
  }
): Promise<string | null> {
  if (analysis.prediction_id) return analysis.prediction_id;
  if (!analysis.symbol || !analysis.timeframe) return null;

  const createdMs = Date.parse(analysis.created_at);
  const windowStart = new Date(createdMs - LINK_WINDOW_MS).toISOString();
  const windowEnd = new Date(createdMs + LINK_WINDOW_MS).toISOString();

  const { data } = await supabaseAdmin
    .from('predictions')
    .select('id')
    .eq('user_id', userId)
    .eq('symbol', analysis.symbol)
    .eq('interval', analysis.timeframe)
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

export async function findLinkedAnalysisId(
  userId: string,
  prediction: {
    id: string;
    symbol: string;
    interval: string;
    created_at: string;
    analysis_id?: string | null;
  }
): Promise<string | null> {
  if (prediction.analysis_id) return prediction.analysis_id;

  const createdMs = Date.parse(prediction.created_at);
  const windowStart = new Date(createdMs - LINK_WINDOW_MS).toISOString();
  const windowEnd = new Date(createdMs + LINK_WINDOW_MS).toISOString();

  const { data } = await supabaseAdmin
    .from('chart_analyses')
    .select('id')
    .eq('user_id', userId)
    .eq('symbol', prediction.symbol)
    .eq('timeframe', prediction.interval)
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}
