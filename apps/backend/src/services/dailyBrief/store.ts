import type { SupabaseClient } from '@supabase/supabase-js';
import { parseGeneratedAt } from '../briefShared/parseGeneratedAt.js';
import type { DailyContent, StoredDailyBrief } from './types.js';

function toTimestamptz(value: string): string | null {
  const ms = parseGeneratedAt(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export async function saveArtifact(
  supabase: SupabaseClient,
  content: DailyContent
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('daily_brief_content')
    .insert({
      date_label: content.date_label,
      generated_at: toTimestamptz(content.generated_at),
      data_stale: content.data_stale,
      artifact: content,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to store daily brief artifact: ${error.message}`);
  }

  return { id: data.id };
}

export async function getLatestArtifact(
  supabase: SupabaseClient
): Promise<StoredDailyBrief | null> {
  const { data, error } = await supabase
    .from('daily_brief_content')
    .select('id, date_label, generated_at, data_stale, artifact, received_at')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest daily brief: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    date_label: data.date_label,
    generated_at: data.generated_at,
    data_stale: data.data_stale,
    artifact: data.artifact as DailyContent,
    received_at: data.received_at,
  };
}
