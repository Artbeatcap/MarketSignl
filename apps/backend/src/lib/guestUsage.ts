import { createHash, randomUUID } from 'crypto';
import { supabaseAdmin } from './supabase.js';

export const GUEST_COOKIE_NAME = 'cs_guest';
export const GUEST_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const GUEST_LIMIT_MESSAGE =
  "You've used your free analysis. Create an account for 3 Atlas runs per week.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function guestKeyFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!UUID_RE.test(value)) return null;
  return value.toLowerCase();
}

export function newGuestKey(): string {
  return randomUUID();
}

export function hashGuestIp(ip: string): string | null {
  const trimmed = ip.trim();
  if (!trimmed || trimmed === 'unknown') return null;
  const secret =
    process.env.GUEST_RATE_LIMIT_SECRET ||
    process.env.NEWSLETTER_API_SECRET ||
    'dev-guest-rate-limit';
  return createHash('sha256').update(`${secret}:${trimmed}`).digest('hex');
}

export function isGuestUsedThisWeek(
  rows: Array<{ last_used_at: string }>,
  now = Date.now()
): boolean {
  return rows.some((row) => {
    const at = Date.parse(row.last_used_at);
    return Number.isFinite(at) && now - at < GUEST_WEEK_MS;
  });
}

export async function lookupGuestUsage(input: {
  guestKey: string;
  ipHash: string | null;
}): Promise<Array<{ last_used_at: string }>> {
  const since = new Date(Date.now() - GUEST_WEEK_MS).toISOString();
  const filters = [`guest_key.eq.${input.guestKey}`];
  if (input.ipHash) filters.push(`ip_hash.eq.${input.ipHash}`);

  const { data, error } = await supabaseAdmin
    .from('guest_usage')
    .select('last_used_at')
    .or(filters.join(','))
    .gte('last_used_at', since)
    .limit(5);

  if (error) {
    console.error('[Guest] lookup failed:', error);
    throw error;
  }
  return data ?? [];
}

export async function guestRemaining(input: {
  guestKey: string;
  ipHash: string | null;
}): Promise<0 | 1> {
  const rows = await lookupGuestUsage(input);
  return isGuestUsedThisWeek(rows) ? 0 : 1;
}

export async function consumeGuestQuota(input: {
  guestKey: string;
  ipHash: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('guest_usage').insert({
    guest_key: input.guestKey,
    ip_hash: input.ipHash,
    last_used_at: new Date().toISOString(),
    used_count: 1,
  });
  if (error) {
    console.error('[Guest] consume failed:', error);
    throw error;
  }
}
