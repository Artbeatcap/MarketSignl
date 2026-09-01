import { z } from 'zod';
import { supabaseAdmin } from './supabase.js';

export type SubscriberStatus =
  | 'pending'
  | 'subscribed'
  | 'unsubscribed'
  | 'bounced'
  | 'complained';

export type SubscriberSource =
  | 'landing_hero'
  | 'landing_footer'
  | 'app_signup'
  | 'settings_toggle'
  | 'manual'
  | 'import';

export type SubscribeResult =
  | 'created'
  | 'already_subscribed'
  | 'suppressed'
  | 'invalid';

export interface Subscriber {
  id: string;
  email: string;
  user_id: string | null;
  status: SubscriberStatus;
  source: SubscriberSource;
  unsubscribe_token: string;
  unsubscribed_at: string | null;
  bounce_count: number;
}

export interface NewsletterStore {
  findByEmail(email: string): Promise<Subscriber | null>;
  findByUserId(userId: string): Promise<Subscriber | null>;
  findByToken(token: string): Promise<Subscriber | null>;
  insertSubscriber(row: {
    email: string;
    user_id?: string | null;
    status: SubscriberStatus;
    source: SubscriberSource;
    consent_ip?: string | null;
    consent_user_agent?: string | null;
  }): Promise<Subscriber | 'conflict'>;
  updateSubscriber(
    id: string,
    patch: Record<string, unknown>
  ): Promise<Subscriber | null>;
  listActive(): Promise<Subscriber[]>;
  getProfileEmail(userId: string): Promise<string | null>;
  /** Returns true if this is the first time we've seen the id. */
  claimWebhookEvent(sgEventId: string, event: string, email?: string): Promise<boolean>;
}

const emailSchema = z.string().trim().max(254).email();

const SUPPRESSED: SubscriberStatus[] = ['unsubscribed', 'bounced', 'complained', 'pending'];
const RESUBSCRIBE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeEmail(raw: string): string | null {
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.toLowerCase();
}

function rowToSubscriber(row: Record<string, unknown>): Subscriber {
  return {
    id: String(row.id),
    email: String(row.email),
    user_id: (row.user_id as string | null) ?? null,
    status: row.status as SubscriberStatus,
    source: row.source as SubscriberSource,
    unsubscribe_token: String(row.unsubscribe_token),
    unsubscribed_at: (row.unsubscribed_at as string | null) ?? null,
    bounce_count: Number(row.bounce_count ?? 0),
  };
}

const supabaseStore: NewsletterStore = {
  async findByEmail(email) {
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .select(
        'id, email, user_id, status, source, unsubscribe_token, unsubscribed_at, bounce_count'
      )
      .eq('email', email)
      .maybeSingle();
    if (error) throw new Error(`newsletter findByEmail: ${error.message}`);
    return data ? rowToSubscriber(data) : null;
  },

  async findByUserId(userId) {
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .select(
        'id, email, user_id, status, source, unsubscribe_token, unsubscribed_at, bounce_count'
      )
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`newsletter findByUserId: ${error.message}`);
    return data ? rowToSubscriber(data) : null;
  },

  async findByToken(token) {
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .select(
        'id, email, user_id, status, source, unsubscribe_token, unsubscribed_at, bounce_count'
      )
      .eq('unsubscribe_token', token)
      .maybeSingle();
    if (error) throw new Error(`newsletter findByToken: ${error.message}`);
    return data ? rowToSubscriber(data) : null;
  },

  async insertSubscriber(row) {
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .insert({
        email: row.email,
        user_id: row.user_id ?? null,
        status: row.status,
        source: row.source,
        consent_ip: row.consent_ip ?? null,
        consent_user_agent: row.consent_user_agent ?? null,
        unsubscribed_at: row.status === 'unsubscribed' ? new Date().toISOString() : null,
      })
      .select(
        'id, email, user_id, status, source, unsubscribe_token, unsubscribed_at, bounce_count'
      )
      .maybeSingle();

    if (error) {
      if (error.code === '23505') return 'conflict';
      throw new Error(`newsletter insert: ${error.message}`);
    }
    return data ? rowToSubscriber(data) : 'conflict';
  },

  async updateSubscriber(id, patch) {
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .update(patch)
      .eq('id', id)
      .select(
        'id, email, user_id, status, source, unsubscribe_token, unsubscribed_at, bounce_count'
      )
      .maybeSingle();
    if (error) throw new Error(`newsletter update: ${error.message}`);
    return data ? rowToSubscriber(data) : null;
  },

  async listActive() {
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .select(
        'id, email, user_id, status, source, unsubscribe_token, unsubscribed_at, bounce_count'
      )
      .eq('status', 'subscribed');
    if (error) throw new Error(`newsletter listActive: ${error.message}`);
    return (data ?? []).map((row) => rowToSubscriber(row));
  },

  async getProfileEmail(userId) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(`newsletter getProfileEmail: ${error.message}`);
    return data?.email ? String(data.email) : null;
  },

  async claimWebhookEvent(sgEventId, event, email) {
    const { error } = await supabaseAdmin.from('newsletter_webhook_events').insert({
      sg_event_id: sgEventId,
      event,
      email: email ?? null,
    });
    if (error) {
      if (error.code === '23505') return false;
      throw new Error(`newsletter claimWebhookEvent: ${error.message}`);
    }
    return true;
  },
};

let store: NewsletterStore = supabaseStore;

export function setNewsletterStoreForTests(next: NewsletterStore | null): void {
  store = next ?? supabaseStore;
}

export function getNewsletterStore(): NewsletterStore {
  return store;
}

export function logNewsletter(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event));
}

export function warnNewsletter(event: Record<string, unknown>): void {
  console.warn(JSON.stringify(event));
}

/**
 * Public subscribe (landing page). Never revives a suppressed row.
 * Returns a discriminated result for logging only — the HTTP layer
 * collapses every non-`invalid` outcome into an identical response.
 */
export async function subscribePublic(input: {
  email: string;
  source: 'landing_hero' | 'landing_footer';
  ip?: string;
  userAgent?: string;
  website?: string;
}): Promise<SubscribeResult> {
  if (input.website && input.website.trim() !== '') {
    logNewsletter({
      event: 'newsletter_subscribe',
      source: input.source,
      result: 'honeypot',
    });
    return 'created';
  }

  const email = normalizeEmail(input.email);
  if (!email) {
    logNewsletter({
      event: 'newsletter_subscribe',
      source: input.source,
      result: 'invalid',
    });
    return 'invalid';
  }

  const existing = await store.findByEmail(email);
  if (existing) {
    const result: SubscribeResult =
      existing.status === 'subscribed' ? 'already_subscribed' : 'suppressed';
    logNewsletter({
      event: 'newsletter_subscribe',
      source: input.source,
      result,
    });
    return result;
  }

  const inserted = await store.insertSubscriber({
    email,
    status: 'subscribed',
    source: input.source,
    consent_ip: input.ip ?? null,
    consent_user_agent: input.userAgent ?? null,
  });

  if (inserted === 'conflict') {
    const raced = await store.findByEmail(email);
    const result: SubscribeResult =
      raced?.status === 'subscribed' ? 'already_subscribed' : 'suppressed';
    logNewsletter({
      event: 'newsletter_subscribe',
      source: input.source,
      result,
    });
    return result;
  }

  logNewsletter({
    event: 'newsletter_subscribe',
    source: input.source,
    result: 'created',
  });
  return 'created';
}

/** Authenticated Settings toggle. The ONLY path that may revive a suppressed row. */
export async function setSubscriptionForUser(
  userId: string,
  subscribed: boolean
): Promise<{ status: SubscriberStatus }> {
  const profileEmail = await store.getProfileEmail(userId);
  const existing =
    (await store.findByUserId(userId)) ??
    (profileEmail ? await store.findByEmail(profileEmail.toLowerCase()) : null);

  if (subscribed) {
    if (!profileEmail && !existing) {
      throw new Error('Cannot subscribe: profile has no email');
    }
    const email = (existing?.email ?? profileEmail)!.toLowerCase();
    if (!existing) {
      const inserted = await store.insertSubscriber({
        email,
        user_id: userId,
        status: 'subscribed',
        source: 'settings_toggle',
      });
      if (inserted === 'conflict') {
        const raced = await store.findByEmail(email);
        if (!raced) throw new Error('Subscribe conflict with no row');
        await store.updateSubscriber(raced.id, {
          status: 'subscribed',
          source: 'settings_toggle',
          user_id: userId,
          subscribed_at: new Date().toISOString(),
          unsubscribed_at: null,
          unsubscribe_reason: null,
        });
      }
    } else {
      await store.updateSubscriber(existing.id, {
        status: 'subscribed',
        source: 'settings_toggle',
        user_id: userId,
        email,
        subscribed_at: new Date().toISOString(),
        unsubscribed_at: null,
        unsubscribe_reason: null,
      });
    }
    logNewsletter({
      event: 'newsletter_lifecycle',
      action: 'resubscribe',
      source: 'settings',
    });
    return { status: 'subscribed' };
  }

  if (!existing) {
    if (profileEmail) {
      await store.insertSubscriber({
        email: profileEmail.toLowerCase(),
        user_id: userId,
        status: 'unsubscribed',
        source: 'settings_toggle',
      });
    }
    logNewsletter({
      event: 'newsletter_lifecycle',
      action: 'unsubscribe',
      source: 'settings',
    });
    return { status: 'unsubscribed' };
  }

  await store.updateSubscriber(existing.id, {
    status: 'unsubscribed',
    unsubscribed_at: new Date().toISOString(),
    unsubscribe_reason: 'settings_toggle',
    user_id: userId,
  });
  logNewsletter({
    event: 'newsletter_lifecycle',
    action: 'unsubscribe',
    source: 'settings',
  });
  return { status: 'unsubscribed' };
}

export async function getSubscriptionForUser(
  userId: string
): Promise<{ subscribed: boolean; status: SubscriberStatus | null }> {
  const profileEmail = await store.getProfileEmail(userId);
  const existing =
    (await store.findByUserId(userId)) ??
    (profileEmail ? await store.findByEmail(profileEmail.toLowerCase()) : null);

  if (!existing) {
    return { subscribed: false, status: null };
  }
  return {
    subscribed: existing.status === 'subscribed',
    status: existing.status,
  };
}

/** Token-based, unauthenticated. Idempotent. */
export async function unsubscribeByToken(
  token: string,
  reason?: string
): Promise<{ ok: boolean; email?: string; already?: boolean }> {
  if (!token || token.length < 16) {
    return { ok: false };
  }

  const row = await store.findByToken(token);
  if (!row) {
    return { ok: false };
  }

  if (row.status === 'unsubscribed' || row.status === 'complained') {
    return { ok: true, email: row.email, already: true };
  }

  await store.updateSubscriber(row.id, {
    status: 'unsubscribed',
    unsubscribed_at: new Date().toISOString(),
    unsubscribe_reason: reason ?? 'email_link',
  });
  logNewsletter({
    event: 'newsletter_lifecycle',
    action: 'unsubscribe',
    source: 'email_link',
  });
  return { ok: true, email: row.email };
}

/**
 * Token resubscribe from the confirmation page. Recoverable for 30 days
 * after unsubscribe. Never revives complained or bounced.
 */
export async function resubscribeByToken(
  token: string
): Promise<{ ok: boolean; email?: string; reason?: string }> {
  if (!token || token.length < 16) {
    return { ok: false };
  }

  const row = await store.findByToken(token);
  if (!row) {
    return { ok: false };
  }

  if (row.status === 'subscribed') {
    return { ok: true, email: row.email };
  }

  if (row.status === 'complained' || row.status === 'bounced') {
    return { ok: false, email: row.email, reason: 'suppressed' };
  }

  if (row.status === 'unsubscribed') {
    const unsubscribedAt = row.unsubscribed_at
      ? new Date(row.unsubscribed_at).getTime()
      : 0;
    if (!unsubscribedAt || Date.now() - unsubscribedAt > RESUBSCRIBE_WINDOW_MS) {
      return { ok: false, email: row.email, reason: 'expired' };
    }
    await store.updateSubscriber(row.id, {
      status: 'subscribed',
      source: 'settings_toggle',
      subscribed_at: new Date().toISOString(),
      unsubscribed_at: null,
      unsubscribe_reason: null,
    });
    logNewsletter({
      event: 'newsletter_lifecycle',
      action: 'resubscribe',
      source: 'email_link',
    });
    return { ok: true, email: row.email };
  }

  return { ok: false, email: row.email };
}

export async function getSubscriberByToken(
  token: string
): Promise<Subscriber | null> {
  if (!token || token.length < 16) return null;
  return store.findByToken(token);
}

/** Recipients for a send: status = 'subscribed' only. */
export async function getActiveSubscribers(): Promise<Subscriber[]> {
  return store.listActive();
}

/** Webhook-driven. Marks bounced/complained. A complained row is never revived here. */
export async function recordDeliveryEvent(
  email: string,
  event: 'bounced' | 'complained' | 'unsubscribed' | 'dropped',
  bounceType?: 'Permanent' | 'Temporary' | 'bounce' | 'blocked' | string,
  droppedReason?: string
): Promise<void> {
  const normalized = normalizeEmail(email) ?? email.trim().toLowerCase();
  if (!normalized) return;

  const row = await store.findByEmail(normalized);
  if (!row) return;

  if (event === 'complained') {
    if (row.status !== 'complained') {
      await store.updateSubscriber(row.id, { status: 'complained' });
      warnNewsletter({
        event: 'newsletter_lifecycle',
        action: 'complaint',
        source: 'webhook',
      });
    }
    return;
  }

  if (event === 'unsubscribed') {
    if (row.status === 'complained') return;
    if (row.status !== 'unsubscribed') {
      await store.updateSubscriber(row.id, {
        status: 'unsubscribed',
        unsubscribed_at: new Date().toISOString(),
        unsubscribe_reason: 'webhook',
      });
      logNewsletter({
        event: 'newsletter_lifecycle',
        action: 'unsubscribe',
        source: 'webhook',
      });
    }
    return;
  }

  if (event === 'dropped') {
    const reason = (droppedReason || '').toLowerCase();
    let next: SubscriberStatus | null = null;
    if (reason.includes('spam')) next = 'complained';
    else if (reason.includes('unsubscribed')) next = 'unsubscribed';
    else if (reason.includes('bounce') || reason.includes('invalid')) next = 'bounced';

    warnNewsletter({
      event: 'newsletter_lifecycle',
      action: 'dropped',
      source: 'webhook',
      warning: 'sendgrid_suppression_drift',
      reason: droppedReason,
      currentStatus: row.status,
      reconciledTo: next,
    });

    if (!next) return;
    if (row.status === 'complained' && next !== 'complained') return;
    if (row.status === next) return;

    const patch: Record<string, unknown> = { status: next };
    if (next === 'unsubscribed') {
      patch.unsubscribed_at = new Date().toISOString();
      patch.unsubscribe_reason = 'sendgrid_dropped';
    }
    await store.updateSubscriber(row.id, patch);
    return;
  }

  if (row.status === 'complained') {
    return;
  }

  const isSoft = bounceType === 'Temporary' || bounceType === 'blocked';
  if (isSoft) {
    const nextCount = row.bounce_count + 1;
    const patch: Record<string, unknown> = { bounce_count: nextCount };
    if (nextCount >= 3) {
      patch.status = 'bounced';
    }
    await store.updateSubscriber(row.id, patch);
    logNewsletter({
      event: 'newsletter_lifecycle',
      action: 'bounce',
      source: 'webhook',
    });
    return;
  }

  await store.updateSubscriber(row.id, {
    status: 'bounced',
    bounce_count: row.bounce_count + 1,
  });
  logNewsletter({
    event: 'newsletter_lifecycle',
    action: 'bounce',
    source: 'webhook',
  });
}

export interface SendGridEvent {
  email?: string;
  event?: string;
  type?: string;
  reason?: string;
  sg_event_id?: string;
}

export async function processSendGridEvents(events: SendGridEvent[]): Promise<void> {
  for (const item of events) {
    const email = item.email;
    const name = item.event;
    if (!email || !name) continue;

    if (item.sg_event_id) {
      const first = await store.claimWebhookEvent(item.sg_event_id, name, email);
      if (!first) continue;
    }

    if (name === 'spamreport') {
      await recordDeliveryEvent(email, 'complained');
    } else if (name === 'bounce') {
      await recordDeliveryEvent(email, 'bounced', item.type);
    } else if (name === 'unsubscribe' || name === 'group_unsubscribe') {
      await recordDeliveryEvent(email, 'unsubscribed');
    } else if (name === 'dropped') {
      await recordDeliveryEvent(email, 'dropped', undefined, item.reason);
    }
  }
}

export function isSuppressedStatus(status: SubscriberStatus): boolean {
  return SUPPRESSED.includes(status);
}

export { normalizeEmail };
