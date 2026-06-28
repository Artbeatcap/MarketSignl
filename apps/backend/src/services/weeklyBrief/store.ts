import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredWeeklyBrief, WeeklyContent } from './types.js';

export async function saveArtifact(
  supabase: SupabaseClient,
  content: WeeklyContent
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('weekly_brief_content')
    .insert({
      week_label: content.week_label,
      generated_at: content.generated_at,
      data_stale: content.data_stale,
      artifact: content,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to store weekly brief artifact: ${error.message}`);
  }

  return { id: data.id };
}

export async function getLatestArtifact(
  supabase: SupabaseClient
): Promise<StoredWeeklyBrief | null> {
  const { data, error } = await supabase
    .from('weekly_brief_content')
    .select('id, week_label, generated_at, data_stale, artifact, received_at')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest weekly brief: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    week_label: data.week_label,
    generated_at: data.generated_at,
    data_stale: data.data_stale,
    artifact: data.artifact as WeeklyContent,
    received_at: data.received_at,
  };
}
