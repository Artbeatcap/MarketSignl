import type { SupabaseClient } from '@supabase/supabase-js';
import type { BriefGap } from '../../lib/briefCompleteness.js';
import {
  isValidExpoPushToken,
  sendExpoPushNotifications,
} from '../pushNotificationService.js';
import { postDailyBriefAlert } from './alert.js';
import {
  supabaseBriefDb,
  type BriefInAppDb,
  type BriefNotificationInsert,
  type RecipientSkipReason,
} from './briefStore.js';
import { buildPreheader } from './renderEmail.js';
import type { DailyContent } from './types.js';

export type BriefPushSkip =
  | 'disabled'
  | 'thin'
  | 'already_sent'
  | 'no_lead'
  | 'no_brief'
  | RecipientSkipReason;

export type BriefPushResult =
  | { skipped: BriefPushSkip }
  | {
      recipients: number;
      byPlatform: Record<string, number>;
      ticketsOk: number;
      ticketsFailed: number;
    };

export interface BriefPushDeps {
  db?: BriefInAppDb;
  send?: typeof sendExpoPushNotifications;
  alert?: (message: string) => Promise<void>;
  enabled?: boolean;
  now?: () => Date;
}

export function briefPushTitle(asOf: string): string {
  const stamp = new Date(`${asOf}T12:00:00Z`);
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(stamp);
  return `Morning Brief · ${short}`;
}

function missingSections(missing: BriefGap[] | null): string {
  return (missing ?? []).map((gap) => gap.section).join(', ');
}

export async function sendDailyBriefPush(
  supabase: SupabaseClient,
  input: { asOf: string; content: DailyContent; onlyUserId?: string },
  deps: BriefPushDeps = {}
): Promise<BriefPushResult> {
  const db = deps.db ?? supabaseBriefDb(supabase);
  const send = deps.send ?? sendExpoPushNotifications;
  const alert = deps.alert ?? postDailyBriefAlert;
  const enabled = deps.enabled ?? process.env.BRIEF_PUSH_ENABLED === 'true';
  const now = deps.now ?? (() => new Date());
  const { asOf, content, onlyUserId } = input;

  if (!onlyUserId && !enabled) return { skipped: 'disabled' };

  const row = await db.getMorning(asOf);
  if (!row) {
    await alert(`BRIEF PUSH SKIPPED no published row ${asOf}`);
    return { skipped: 'no_brief' };
  }
  if (!row.complete) {
    await alert(`BRIEF PUSH SKIPPED thin ${asOf}: ${missingSections(row.missing)}`);
    return { skipped: 'thin' };
  }

  if (!onlyUserId) {
    const claimed = await db.claimMorningPush(asOf, now().toISOString());
    if (!claimed) return { skipped: 'already_sent' };
  }

  const recipients = (await db.listRecipients(onlyUserId)).filter((recipient) =>
    isValidExpoPushToken(recipient.token)
  );
  if (recipients.length === 0) {
    if (onlyUserId) return { skipped: await db.recipientSkipReason(onlyUserId) };
    const empty = { recipients: 0, byPlatform: {}, ticketsOk: 0, ticketsFailed: 0 };
    await db.mergePushSummary(asOf, empty);
    console.log(JSON.stringify({ event: 'brief_push', asOf, ...empty }));
    return empty;
  }

  const body = buildPreheader(content, 150);
  if (!body) {
    await alert(`BRIEF PUSH SKIPPED no lead ${asOf}`);
    return { skipped: 'no_lead' };
  }

  const title = briefPushTitle(asOf);
  const messages = recipients.map((recipient) => ({
    to: recipient.token,
    title,
    body,
    data: { type: 'daily_brief', asOf, url: '/brief' },
    channelId: 'daily-brief',
    priority: 'default' as const,
    sound: null,
  }));

  const tickets = await send(messages);
  const byPlatform: Record<string, number> = {};
  let ticketsOk = 0;
  let ticketsFailed = 0;
  const logs: BriefNotificationInsert[] = [];

  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index];
    byPlatform[recipient.platform] = (byPlatform[recipient.platform] ?? 0) + 1;
    const ticket = tickets[index];
    const ok = ticket?.status === 'ok';
    if (ok) ticketsOk += 1;
    else ticketsFailed += 1;
    const errorCode = ticket?.details?.error ?? ticket?.message ?? null;
    if (ticket?.details?.error === 'DeviceNotRegistered') {
      await db.deactivateToken(recipient.token);
    }
    logs.push({
      user_id: recipient.userId,
      expo_push_token: recipient.token,
      title,
      body,
      data: {
        type: 'daily_brief',
        asOf,
        url: '/brief',
        platform: recipient.platform,
        expo_receipt_id: ticket?.id ?? null,
      },
      expo_receipt_id: ticket?.id ?? null,
      status: ok ? ('sent' as const) : ('failed' as const),
      error_message: ok ? null : errorCode,
    });
  }

  await db.insertLogs(logs);
  const summary = {
    recipients: recipients.length,
    byPlatform,
    ticketsOk,
    ticketsFailed,
  };
  await db.mergePushSummary(asOf, summary);
  console.log(JSON.stringify({ event: 'brief_push', asOf, ...summary }));
  if (summary.recipients > 0 && summary.ticketsOk === 0) {
    await alert(`BRIEF PUSH FAILED: 0 of ${summary.recipients} tickets accepted`);
  }
  return summary;
}
