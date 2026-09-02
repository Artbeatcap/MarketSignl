import sgMail from '@sendgrid/mail';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyBriefRecipient, DailyContent } from './types.js';
import { getApiBaseUrl, getDailyBriefFrom } from './brand.js';
import {
  buildPreheader,
  buildSubject,
  renderDailyBriefEmail,
} from './renderEmail.js';
import type { CalendarRow } from '../../lib/weekAhead.js';

const apiKey = process.env.SENDGRID_API_KEY?.trim();
if (!apiKey) {
  throw new Error('SENDGRID_API_KEY is not configured');
}
sgMail.setApiKey(apiKey);

const BATCH_SIZE = 50;

export async function fetchRecipients(
  supabase: SupabaseClient
): Promise<DailyBriefRecipient[]> {
  const { data, error } = await supabase.rpc('get_daily_brief_recipients');

  if (error) {
    throw new Error(`Failed to fetch daily brief recipients: ${error.message}`);
  }

  return (data ?? []) as DailyBriefRecipient[];
}

function buildUnsubscribeUrl(token: string): string {
  return `${getApiBaseUrl()}/api/daily-brief/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function renderForRecipient(
  content: DailyContent,
  unsubscribeToken: string,
  calendar?: CalendarRow[]
): { html: string; subject: string; preheader: string } {
  const preheader = buildPreheader(content);
  const html = renderDailyBriefEmail({
    content,
    preheader,
    unsubscribeUrl: buildUnsubscribeUrl(unsubscribeToken),
    calendar,
  });

  return {
    html,
    subject: buildSubject(content),
    preheader,
  };
}

export async function sendToRecipient(
  content: DailyContent,
  to: string,
  unsubscribeToken: string,
  calendar?: CalendarRow[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { html, subject, preheader } = renderForRecipient(content, unsubscribeToken, calendar);

  try {
    await sgMail.send({
      to,
      from: getDailyBriefFrom(),
      subject,
      html,
      headers: {
        'List-Unsubscribe': `<${buildUnsubscribeUrl(unsubscribeToken)}>`,
      },
      categories: ['daily-brief'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }

  console.log(`[daily-brief] Sent to ${to} — preheader: ${preheader.slice(0, 40)}…`);
  return { ok: true };
}

export async function sendBatchInBackground(
  content: DailyContent,
  recipients: DailyBriefRecipient[],
  calendar?: CalendarRow[]
): Promise<void> {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (recipient) => {
        const result = await sendToRecipient(
          content,
          recipient.email,
          recipient.unsubscribe_token,
          calendar
        );
        if (result.ok) {
          sent += 1;
        } else {
          failed += 1;
          console.error(
            `[daily-brief] Failed to send to ${recipient.email}: ${result.error}`
          );
        }
      })
    );
  }

  console.log(
    `[daily-brief] Batch complete — sent: ${sent}, failed: ${failed}, total: ${recipients.length}`
  );
}

export async function sendTestEmail(
  content: DailyContent,
  testEmail: string,
  calendar?: CalendarRow[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const testToken = '00000000-0000-0000-0000-000000000000';
  return sendToRecipient(content, testEmail, testToken, calendar);
}
