import {
  getActiveSubscribers,
  logNewsletter,
  warnNewsletter,
  type Subscriber,
} from './newsletter.js';
import { supabaseAdmin } from './supabase.js';

export const RESEND_BATCH_MAX = 100;
export const BATCH_GAP_MS = 150;

export interface SendInput {
  sendKey: string;
  subject: string;
  html: string;
  text?: string;
}

export interface BatchEmail {
  from: string;
  reply_to?: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  headers: {
    'List-Unsubscribe': string;
    'List-Unsubscribe-Post': string;
  };
}

export interface SendLedger {
  beginSend(
    sendKey: string,
    subject: string
  ): Promise<{ skipped: true } | { sendId: string }>;
  markEligible(sendId: string, eligible: number): Promise<void>;
  recordRecipient(row: {
    sendId: string;
    subscriberId: string;
    providerMessageId?: string | null;
    status: 'sent' | 'failed';
    error?: string | null;
  }): Promise<void>;
  bumpDelivered(subscriberId: string, at: Date): Promise<void>;
  completeSend(
    sendId: string,
    status: 'completed' | 'failed',
    delivered: number,
    failed: number
  ): Promise<void>;
}

export interface SendDeps {
  sendBatch: (emails: BatchEmail[]) => Promise<{
    ok: boolean;
    ids?: Array<{ id?: string } | null>;
    error?: string;
  }>;
  ledger?: SendLedger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface SendResult {
  skipped?: boolean;
  sendId?: string;
  eligible?: number;
  batches?: number;
  delivered?: number;
  failed?: number;
  durationMs?: number;
}

export function getPublicApiUrl(): string {
  return (
    process.env.PUBLIC_API_URL ||
    process.env.API_URL ||
    'https://api.chartsignl.com'
  ).replace(/\/$/, '');
}

export function buildUnsubscribeUrl(token: string): string {
  return `${getPublicApiUrl()}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function personalizeContent(template: string, unsubscribeUrl: string): string {
  return template
    .replaceAll('{{unsubscribe_url}}', unsubscribeUrl)
    .replaceAll('{{UNSUBSCRIBE_URL}}', unsubscribeUrl);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function buildBatchMessages(
  subscribers: Subscriber[],
  input: SendInput,
  from: string,
  replyTo?: string
): BatchEmail[] {
  return subscribers.map((subscriber) => {
    const unsubUrl = buildUnsubscribeUrl(subscriber.unsubscribe_token);
    const email: BatchEmail = {
      from,
      to: [subscriber.email],
      subject: input.subject,
      html: personalizeContent(input.html, unsubUrl),
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
    if (replyTo) email.reply_to = replyTo;
    if (input.text) email.text = personalizeContent(input.text, unsubUrl);
    return email;
  });
}

/** Guards the batching risk: every recipient must carry their own token. */
export function assertPerRecipientUnsubscribeTokens(batch: BatchEmail[]): void {
  const tokens = batch.map((email) => email.headers['List-Unsubscribe']);
  const unique = new Set(tokens);
  if (tokens.length > 1 && unique.size !== tokens.length) {
    throw new Error('Batch messages share a List-Unsubscribe token');
  }
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function defaultSendBatch(
  emails: BatchEmail[]
): Promise<{ ok: boolean; ids?: Array<{ id?: string } | null>; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured' };
  }

  const response = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emails),
  });

  const body = (await response.json().catch(() => null)) as
    | { data?: Array<{ id: string }>; error?: { message?: string } }
    | null;

  if (!response.ok) {
    return {
      ok: false,
      error: body?.error?.message || `Resend batch failed (${response.status})`,
    };
  }

  return { ok: true, ids: body?.data ?? [] };
}

export const supabaseSendLedger: SendLedger = {
  async beginSend(sendKey, subject) {
    const { data, error } = await supabaseAdmin
      .from('newsletter_sends')
      .insert({ send_key: sendKey, subject, status: 'in_progress' })
      .select('id')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') return { skipped: true };
      throw new Error(`newsletter send insert: ${error.message}`);
    }
    if (!data?.id) return { skipped: true };
    return { sendId: data.id as string };
  },

  async markEligible(sendId, eligible) {
    const { error } = await supabaseAdmin
      .from('newsletter_sends')
      .update({ eligible_count: eligible })
      .eq('id', sendId);
    if (error) throw new Error(`newsletter markEligible: ${error.message}`);
  },

  async recordRecipient(row) {
    const { error } = await supabaseAdmin.from('newsletter_send_recipients').insert({
      send_id: row.sendId,
      subscriber_id: row.subscriberId,
      provider_message_id: row.providerMessageId ?? null,
      status: row.status,
      error: row.error ?? null,
    });
    if (error) throw new Error(`newsletter recordRecipient: ${error.message}`);
  },

  async bumpDelivered(subscriberId, at) {
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .select('send_count')
      .eq('id', subscriberId)
      .maybeSingle();
    if (error) throw new Error(`newsletter bumpDelivered: ${error.message}`);
    const nextCount = Number(data?.send_count ?? 0) + 1;
    const { error: updateError } = await supabaseAdmin
      .from('newsletter_subscribers')
      .update({ last_sent_at: at.toISOString(), send_count: nextCount })
      .eq('id', subscriberId);
    if (updateError) throw new Error(`newsletter bumpDelivered update: ${updateError.message}`);
  },

  async completeSend(sendId, status, delivered, failed) {
    const { error } = await supabaseAdmin
      .from('newsletter_sends')
      .update({
        status,
        delivered_count: delivered,
        failed_count: failed,
        completed_at: new Date().toISOString(),
      })
      .eq('id', sendId);
    if (error) throw new Error(`newsletter completeSend: ${error.message}`);
  },
};

export async function sendNewsletter(
  input: SendInput,
  deps: Partial<SendDeps> = {}
): Promise<SendResult> {
  const started = Date.now();
  const sendBatch = deps.sendBatch ?? defaultSendBatch;
  const ledger = deps.ledger ?? supabaseSendLedger;
  const sleep = deps.sleep ?? defaultSleep;
  const from = process.env.NEWSLETTER_FROM || 'ChartSignl <brief@mail.chartsignl.com>';
  const replyTo = process.env.NEWSLETTER_REPLY_TO || undefined;

  const begun = await ledger.beginSend(input.sendKey, input.subject);
  if ('skipped' in begun) {
    return { skipped: true };
  }

  const sendId = begun.sendId;
  const subscribers = await getActiveSubscribers();
  const batches = chunk(subscribers, RESEND_BATCH_MAX);
  let delivered = 0;
  let failed = 0;

  try {
    await ledger.markEligible(sendId, subscribers.length);

    for (let i = 0; i < batches.length; i += 1) {
      const batchSubscribers = batches[i];
      const messages = buildBatchMessages(batchSubscribers, input, from, replyTo);
      assertPerRecipientUnsubscribeTokens(messages);

      const result = await sendBatch(messages);

      for (let index = 0; index < batchSubscribers.length; index += 1) {
        const subscriber = batchSubscribers[index];
        const id = result.ok ? result.ids?.[index]?.id ?? null : null;
        const ok = result.ok && !!id;
        if (ok) {
          delivered += 1;
          await ledger.bumpDelivered(subscriber.id, deps.now?.() ?? new Date());
        } else {
          failed += 1;
        }
        await ledger.recordRecipient({
          sendId,
          subscriberId: subscriber.id,
          providerMessageId: id,
          status: ok ? 'sent' : 'failed',
          error: ok ? null : result.error || 'batch failed',
        });
      }

      if (i < batches.length - 1) {
        await sleep(BATCH_GAP_MS);
      }
    }

    await ledger.completeSend(sendId, 'completed', delivered, failed);

    const durationMs = Date.now() - started;
    logNewsletter({
      event: 'newsletter_send',
      sendKey: input.sendKey,
      eligible: subscribers.length,
      batches: batches.length,
      delivered,
      failed,
      durationMs,
    });

    if (subscribers.length > 0 && failed > subscribers.length * 0.02) {
      warnNewsletter({
        event: 'newsletter_send',
        sendKey: input.sendKey,
        warning: 'high_failure_rate',
        failed,
        eligible: subscribers.length,
      });
    }

    return {
      sendId,
      eligible: subscribers.length,
      batches: batches.length,
      delivered,
      failed,
      durationMs,
    };
  } catch (err) {
    await ledger.completeSend(sendId, 'failed', delivered, failed);
    throw err;
  }
}
