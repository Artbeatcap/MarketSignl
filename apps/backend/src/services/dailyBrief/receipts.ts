import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchExpoPushReceipts, type ExpoPushReceipt } from '../pushNotificationService.js';
import { easternDay } from './easternDay.js';
import { postDailyBriefAlert } from './alert.js';
import { supabaseBriefDb, type BriefInAppDb, type BriefLogRow } from './briefStore.js';

export interface ReceiptPlatformCount {
  delivered: number;
  error: number;
  pending: number;
}

export interface BriefReceiptResult {
  success: true;
  delivered: number;
  error: number;
  pending: number;
  byError: Record<string, number>;
  byPlatform: Record<string, ReceiptPlatformCount>;
}

export interface BriefReceiptDeps {
  db?: BriefInAppDb;
  fetchReceipts?: (ids: string[]) => Promise<Record<string, ExpoPushReceipt>>;
  alert?: (message: string) => Promise<void>;
  now?: Date;
}

function platformOf(row: BriefLogRow): string {
  const value = row.data?.platform;
  return typeof value === 'string' && value ? value : 'unknown';
}

function emptyCount(): ReceiptPlatformCount {
  return { delivered: 0, error: 0, pending: 0 };
}

function easternStartIso(day: string): string {
  const probe = new Date(`${day}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(probe);
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-5';
  const match = offset.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const sign = match?.[1] === '+' ? 1 : -1;
  const hours = Number(match?.[2] ?? 5);
  const minutes = Number(match?.[3] ?? 0);
  const utc = new Date(`${day}T00:00:00Z`).getTime() - sign * (hours * 60 + minutes) * 60_000;
  return new Date(utc).toISOString();
}

export async function checkDailyBriefReceipts(
  supabase: SupabaseClient,
  deps: BriefReceiptDeps = {}
): Promise<BriefReceiptResult> {
  const db = deps.db ?? supabaseBriefDb(supabase);
  const fetchReceipts = deps.fetchReceipts ?? fetchExpoPushReceipts;
  const alert = deps.alert ?? postDailyBriefAlert;
  const now = deps.now ?? new Date();
  const today = easternDay(now.getTime());
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const logs = await db.listBriefLogsSince(since);
  const rows = logs.filter((row) => {
    if (row.data?.type !== 'daily_brief') return false;
    if (row.status !== 'sent') return false;
    if (!row.expo_receipt_id) return false;
    const created = new Date(row.created_at).getTime();
    return easternDay(created) === today;
  });

  const receipts = rows.length
    ? await fetchReceipts(rows.map((row) => row.expo_receipt_id as string))
    : {};

  const byError: Record<string, number> = {};
  const byPlatform: Record<string, ReceiptPlatformCount> = {};
  let delivered = 0;
  let error = 0;
  let pending = 0;
  const credentialAlerts = new Set<string>();
  const iosOutcomes: string[] = [];

  for (const row of rows) {
    const platform = platformOf(row);
    const bucket = (byPlatform[platform] ??= emptyCount());
    const receipt = receipts[row.expo_receipt_id as string];
    if (!receipt) {
      pending += 1;
      bucket.pending += 1;
      if (platform === 'ios') iosOutcomes.push('pending');
      continue;
    }
    if (receipt.status === 'ok') {
      delivered += 1;
      bucket.delivered += 1;
      await db.updateLogReceipt(row.id, 'delivered', null);
      if (platform === 'ios') iosOutcomes.push('delivered');
      continue;
    }
    const code = receipt.details?.error || receipt.message || 'error';
    error += 1;
    bucket.error += 1;
    byError[code] = (byError[code] ?? 0) + 1;
    await db.updateLogReceipt(row.id, 'error', code);
    if (code === 'DeviceNotRegistered') {
      await db.deactivateToken(row.expo_push_token);
    }
    if (code === 'InvalidCredentials' || code === 'MismatchSenderId') {
      credentialAlerts.add(`${code} on ${platform}`);
    }
    if (platform === 'ios') iosOutcomes.push(`error ${code}`);
  }

  const result: BriefReceiptResult = {
    success: true,
    delivered,
    error,
    pending,
    byError,
    byPlatform,
  };

  const morning = await db.getMorning(today);
  const alreadyAnnounced = morning?.push_summary?.firstIosBriefPushAlerted === true;
  await db.mergePushSummary(today, { ...result }).catch((err) => {
    console.error('[brief_push] receipt summary write failed', err);
  });

  for (const item of credentialAlerts) {
    await alert(`BRIEF PUSH RECEIPT ${item}`);
  }
  if (rows.length > 0 && delivered === 0) {
    await alert(`BRIEF PUSH RECEIPTS: 0 delivered of ${rows.length} sent`);
  } else if (rows.length > 0 && pending / rows.length > 0.2) {
    await alert(`BRIEF PUSH RECEIPTS: ${pending} of ${rows.length} still pending`);
  }

  const resolvedIos = iosOutcomes.filter((item) => item === 'delivered' || item.startsWith('error'));
  if (resolvedIos.length > 0 && !alreadyAnnounced) {
    const earlier = await db.hasIosBriefBefore(easternStartIso(today));
    if (!earlier) {
      const failed = resolvedIos.find((item) => item.startsWith('error'));
      await alert(failed ? `FIRST iOS BRIEF PUSH: ${failed}` : 'FIRST iOS BRIEF PUSH: delivered');
      await db.mergePushSummary(today, { firstIosBriefPushAlerted: true }).catch((err) => {
        console.error('[brief_push] first-ios flag write failed', err);
      });
    }
  }

  console.log(JSON.stringify({ event: 'brief_push_receipts', asOf: today, ...result }));
  return result;
}
