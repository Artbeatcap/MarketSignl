import type { SupabaseClient } from '@supabase/supabase-js';
import type { BriefGap } from '../../lib/briefCompleteness.js';
import { isValidExpoPushToken } from '../pushNotificationService.js';
import type { DailyContent } from './types.js';

export interface BriefProfileFlags {
  id: string;
  push_notifications_enabled: boolean | null;
  brief_push_enabled: boolean | null;
}

export interface BriefTokenRow {
  userId: string;
  token: string;
  platform: string;
  isActive: boolean;
}

export interface PushRecipient {
  userId: string;
  token: string;
  platform: string;
}

export interface PublishedBriefRow {
  id: number;
  as_of: string;
  edition: 'morning' | 'close';
  content: DailyContent;
  complete: boolean;
  missing: BriefGap[] | null;
  published_at: string;
  push_claimed_at: string | null;
  push_summary: Record<string, unknown> | null;
}

export interface BriefLogRow {
  id: string;
  user_id: string | null;
  expo_push_token: string;
  status: string;
  expo_receipt_id: string | null;
  error_message: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface BriefNotificationInsert {
  user_id: string;
  expo_push_token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  expo_receipt_id: string | null;
  status: 'sent' | 'failed';
  error_message: string | null;
}

export type RecipientSkipReason =
  | 'brief_push_disabled'
  | 'push_disabled'
  | 'no_active_token'
  | 'invalid_token'
  | 'no_user';

export interface BriefInAppDb {
  upsertPublished(input: {
    asOf: string;
    content: DailyContent;
    complete: boolean;
    missing: BriefGap[];
    publishedAt: string;
  }): Promise<void>;
  getNewestPublished(): Promise<PublishedBriefRow | null>;
  getMorning(asOf: string): Promise<PublishedBriefRow | null>;
  claimMorningPush(asOf: string, atIso: string): Promise<boolean>;
  mergePushSummary(asOf: string, patch: Record<string, unknown>): Promise<void>;
  listRecipients(onlyUserId?: string): Promise<PushRecipient[]>;
  recipientSkipReason(userId: string): Promise<RecipientSkipReason>;
  insertLogs(rows: BriefNotificationInsert[]): Promise<void>;
  deactivateToken(token: string): Promise<void>;
  insertOpen(input: {
    userId: string | null;
    asOf: string;
    source: 'push' | 'email' | 'tab' | 'link';
    platform: string | null;
  }): Promise<void>;
  listBriefLogsSince(iso: string): Promise<BriefLogRow[]>;
  updateLogReceipt(id: string, status: 'delivered' | 'error', errorMessage: string | null): Promise<void>;
  hasIosBriefBefore(iso: string): Promise<boolean>;
}

export function isBriefPushProfile(profile: BriefProfileFlags | undefined): boolean {
  if (!profile) return false;
  if (profile.push_notifications_enabled === false) return false;
  if (profile.brief_push_enabled === false) return false;
  return true;
}

/** Active tokens whose profile has neither push switch off. Invalid tokens stay in the list. */
export function selectBriefPushRecipients(
  tokens: BriefTokenRow[],
  profiles: BriefProfileFlags[],
  onlyUserId?: string
): PushRecipient[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return tokens
    .filter((row) => row.isActive)
    .filter((row) => (onlyUserId ? row.userId === onlyUserId : true))
    .filter((row) => isBriefPushProfile(byId.get(row.userId)))
    .map((row) => ({
      userId: row.userId,
      token: row.token,
      platform: row.platform,
    }));
}

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asPublished(row: Record<string, unknown> | null): PublishedBriefRow | null {
  if (!row) return null;
  const edition = row.edition === 'close' ? 'close' : 'morning';
  return {
    id: Number(row.id),
    as_of: String(row.as_of).slice(0, 10),
    edition,
    content: row.content as DailyContent,
    complete: row.complete === true,
    missing: (row.missing as BriefGap[] | null) ?? null,
    published_at: String(row.published_at),
    push_claimed_at: row.push_claimed_at ? String(row.push_claimed_at) : null,
    push_summary: asRecord(row.push_summary),
  };
}

export function supabaseBriefDb(supabase: SupabaseClient): BriefInAppDb {
  return {
    async upsertPublished(input) {
      const { error } = await supabase.from('daily_brief_published').upsert(
        {
          as_of: input.asOf,
          edition: 'morning',
          content: input.content,
          complete: input.complete,
          missing: input.missing,
          published_at: input.publishedAt,
        },
        { onConflict: 'as_of,edition' }
      );
      throwIf(error);
    },

    async getNewestPublished() {
      const { data, error } = await supabase
        .from('daily_brief_published')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      throwIf(error);
      return asPublished(data as Record<string, unknown> | null);
    },

    async getMorning(asOf) {
      const { data, error } = await supabase
        .from('daily_brief_published')
        .select('*')
        .eq('as_of', asOf)
        .eq('edition', 'morning')
        .maybeSingle();
      throwIf(error);
      return asPublished(data as Record<string, unknown> | null);
    },

    async claimMorningPush(asOf, atIso) {
      const { data, error } = await supabase
        .from('daily_brief_published')
        .update({ push_claimed_at: atIso })
        .eq('as_of', asOf)
        .eq('edition', 'morning')
        .is('push_claimed_at', null)
        .select('id');
      throwIf(error);
      return (data ?? []).length > 0;
    },

    async mergePushSummary(asOf, patch) {
      const current = await this.getMorning(asOf);
      const next = { ...(current?.push_summary ?? {}), ...patch };
      const { error } = await supabase
        .from('daily_brief_published')
        .update({ push_summary: next })
        .eq('as_of', asOf)
        .eq('edition', 'morning');
      throwIf(error);
    },

    async listRecipients(onlyUserId) {
      let tokenQuery = supabase
        .from('push_tokens')
        .select('user_id, expo_push_token, platform, is_active');
      if (onlyUserId) tokenQuery = tokenQuery.eq('user_id', onlyUserId);
      const { data: tokenData, error: tokenError } = await tokenQuery;
      throwIf(tokenError);
      const tokens: BriefTokenRow[] = (tokenData ?? []).map((row) => ({
        userId: String(row.user_id),
        token: String(row.expo_push_token),
        platform: String(row.platform),
        isActive: row.is_active !== false,
      }));
      const ids = [...new Set(tokens.map((row) => row.userId))];
      if (ids.length === 0) return [];
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, push_notifications_enabled, brief_push_enabled')
        .in('id', ids);
      throwIf(profileError);
      const profiles: BriefProfileFlags[] = (profileData ?? []).map((row) => ({
        id: String(row.id),
        push_notifications_enabled: row.push_notifications_enabled ?? null,
        brief_push_enabled: row.brief_push_enabled ?? null,
      }));
      return selectBriefPushRecipients(tokens, profiles, onlyUserId);
    },

    async recipientSkipReason(userId) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, push_notifications_enabled, brief_push_enabled')
        .eq('id', userId)
        .maybeSingle();
      throwIf(profileError);
      if (!profile) return 'no_user';
      if (profile.brief_push_enabled === false) return 'brief_push_disabled';
      if (profile.push_notifications_enabled === false) return 'push_disabled';
      const { data: tokens, error: tokenError } = await supabase
        .from('push_tokens')
        .select('expo_push_token, is_active')
        .eq('user_id', userId);
      throwIf(tokenError);
      const active = (tokens ?? []).filter((row) => row.is_active !== false);
      if (active.length === 0) return 'no_active_token';
      if (!active.some((row) => isValidExpoPushToken(String(row.expo_push_token)))) {
        return 'invalid_token';
      }
      return 'no_active_token';
    },

    async insertLogs(rows) {
      if (rows.length === 0) return;
      const { error } = await supabase.from('notification_log').insert(
        rows.map((row) => ({
          user_id: row.user_id,
          alert_id: null,
          expo_push_token: row.expo_push_token,
          title: row.title,
          body: row.body,
          data: row.data,
          expo_receipt_id: row.expo_receipt_id,
          status: row.status,
          error_message: row.error_message,
        }))
      );
      throwIf(error);
    },

    async deactivateToken(token) {
      const { error } = await supabase
        .from('push_tokens')
        .update({ is_active: false })
        .eq('expo_push_token', token);
      throwIf(error);
    },

    async insertOpen(input) {
      const { error } = await supabase.from('brief_opens').insert({
        user_id: input.userId,
        as_of: input.asOf,
        source: input.source,
        platform: input.platform,
      });
      throwIf(error);
    },

    async listBriefLogsSince(iso) {
      const { data, error } = await supabase
        .from('notification_log')
        .select('id, user_id, expo_push_token, status, expo_receipt_id, error_message, data, created_at')
        .gte('created_at', iso);
      throwIf(error);
      return (data ?? []).map((row) => ({
        id: String(row.id),
        user_id: row.user_id ? String(row.user_id) : null,
        expo_push_token: String(row.expo_push_token),
        status: String(row.status),
        expo_receipt_id: row.expo_receipt_id ? String(row.expo_receipt_id) : null,
        error_message: row.error_message ? String(row.error_message) : null,
        data: asRecord(row.data),
        created_at: String(row.created_at),
      }));
    },

    async updateLogReceipt(id, status, errorMessage) {
      const { error } = await supabase
        .from('notification_log')
        .update({ status, error_message: errorMessage })
        .eq('id', id);
      throwIf(error);
    },

    async hasIosBriefBefore(iso) {
      const { data, error } = await supabase
        .from('notification_log')
        .select('id')
        .eq('data->>type', 'daily_brief')
        .eq('data->>platform', 'ios')
        .lt('created_at', iso)
        .limit(1);
      throwIf(error);
      return (data ?? []).length > 0;
    },
  };
}
