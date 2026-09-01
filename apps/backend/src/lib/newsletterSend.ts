import sgMail from '@sendgrid/mail';
import type { MailDataRequired } from '@sendgrid/mail';
import {
  getActiveSubscribers,
  logNewsletter,
  warnNewsletter,
  type Subscriber,
} from './newsletter.js';
import { supabaseAdmin } from './supabase.js';

export const SENDGRID_PERSONALIZATION_MAX = 500;

export interface SendInput {
  sendKey: string;
  subject: string;
  html: string;
  text?: string;
}

export interface NewsletterPersonalization {
  to: Array<{ email: string }>;
  headers: {
    'List-Unsubscribe': string;
    'List-Unsubscribe-Post': string;
  };
  substitutions: {
    unsubscribe_url: string;
  };
}

export interface NewsletterMailPayload {
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  personalizations: NewsletterPersonalization[];
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
  sendChunk: (mail: NewsletterMailPayload) => Promise<{
    ok: boolean;
    messageId?: string;
    error?: string;
  }>;
  ledger?: SendLedger;
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

/**
 * Shared body: one HTML blob per request. Per-recipient URL is a substitution.
 * The Node SDK wraps substitution keys with `{{ }}`, so the placeholder in
 * HTML must be `{{unsubscribe_url}}` — not SendGrid's raw `-unsubscribe_url-`
 * form, which the SDK would turn into `{{-unsubscribe_url-}}`.
 */
export function prepareSharedContent(template: string): string {
  return template
    .replaceAll('{{UNSUBSCRIBE_URL}}', '{{unsubscribe_url}}')
    .replaceAll('-unsubscribe_url-', '{{unsubscribe_url}}');
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function buildPersonalizations(subscribers: Subscriber[]): NewsletterPersonalization[] {
  return subscribers.map((subscriber) => {
    const unsubUrl = buildUnsubscribeUrl(subscriber.unsubscribe_token);
    return {
      to: [{ email: subscriber.email }],
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      substitutions: {
        unsubscribe_url: unsubUrl,
      },
    };
  });
}

/** Guards the batching risk: every recipient must carry their own token. */
export function assertPerRecipientUnsubscribeTokens(
  personalizations: NewsletterPersonalization[]
): void {
  const tokens = personalizations.map((item) => item.headers['List-Unsubscribe']);
  const unique = new Set(tokens);
  if (tokens.length > 1 && unique.size !== tokens.length) {
    throw new Error('Personalizations share a List-Unsubscribe token');
  }
}

let sendGridReady = false;

function ensureSendGrid(): string | null {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  if (!apiKey) return null;
  if (!sendGridReady) {
    sgMail.setApiKey(apiKey);
    sendGridReady = true;
  }
  return apiKey;
}

export async function defaultSendChunk(
  mail: NewsletterMailPayload
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!ensureSendGrid()) {
    return { ok: false, error: 'SENDGRID_API_KEY is not configured' };
  }

  const payload: MailDataRequired = {
    from: mail.from,
    subject: mail.subject,
    html: mail.html,
    ...(mail.text ? { text: mail.text } : {}),
    personalizations: mail.personalizations,
    trackingSettings: {
      subscriptionTracking: { enable: false },
      openTracking: { enable: true },
      clickTracking: { enable: false },
    },
    mailSettings: {
      bypassListManagement: { enable: false },
    },
    substitutionWrappers: ['{{', '}}'],
    categories: ['newsletter'],
  };
  if (mail.replyTo) {
    payload.replyTo = mail.replyTo;
  }

  try {
    const [response] = await sgMail.send(payload);
    const messageId =
      (response.headers?.['x-message-id'] as string | undefined) ||
      (response.headers?.['X-Message-Id'] as string | undefined);
    return { ok: true, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
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
  const sendChunk = deps.sendChunk ?? defaultSendChunk;
  const ledger = deps.ledger ?? supabaseSendLedger;
  const from = process.env.NEWSLETTER_FROM || 'ChartSignl <brief@chartsignl.com>';
  const replyTo = process.env.NEWSLETTER_REPLY_TO || 'support@chartsignl.com';

  const begun = await ledger.beginSend(input.sendKey, input.subject);
  if ('skipped' in begun) {
    return { skipped: true };
  }

  const sendId = begun.sendId;
  const subscribers = await getActiveSubscribers();
  const batches = chunk(subscribers, SENDGRID_PERSONALIZATION_MAX);
  const html = prepareSharedContent(input.html);
  const text = input.text ? prepareSharedContent(input.text) : undefined;
  let delivered = 0;
  let failed = 0;

  try {
    await ledger.markEligible(sendId, subscribers.length);

    for (const batchSubscribers of batches) {
      const personalizations = buildPersonalizations(batchSubscribers);
      assertPerRecipientUnsubscribeTokens(personalizations);

      const result = await sendChunk({
        from,
        replyTo,
        subject: input.subject,
        html,
        text,
        personalizations,
      });

      for (const subscriber of batchSubscribers) {
        if (result.ok) {
          delivered += 1;
          await ledger.bumpDelivered(subscriber.id, deps.now?.() ?? new Date());
        } else {
          failed += 1;
        }
        await ledger.recordRecipient({
          sendId,
          subscriberId: subscriber.id,
          providerMessageId: result.ok ? result.messageId ?? null : null,
          status: result.ok ? 'sent' : 'failed',
          error: result.ok ? null : result.error || 'send failed',
        });
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
