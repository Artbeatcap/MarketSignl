import sgMail from '@sendgrid/mail';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WeeklyBriefRecipient, WeeklyContent } from './types.js';
import { getApiBaseUrl, getWeeklyBriefFrom } from './brand.js';
import {
  buildPreheader,
  buildSubject,
  renderWeeklyBriefEmail,
} from './renderEmail.js';

const apiKey = process.env.SENDGRID_API_KEY?.trim();
if (!apiKey) {
  throw new Error('SENDGRID_API_KEY is not configured');
}
sgMail.setApiKey(apiKey);

const BATCH_SIZE = 50;

export async function fetchRecipients(
  supabase: SupabaseClient
): Promise<WeeklyBriefRecipient[]> {
  const { data, error } = await supabase.rpc('get_weekly_brief_recipients');

  if (error) {
    throw new Error(`Failed to fetch weekly brief recipients: ${error.message}`);
  }

  return (data ?? []) as WeeklyBriefRecipient[];
}

function buildUnsubscribeUrl(token: string): string {
  return `${getApiBaseUrl()}/api/weekly-brief/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function renderForRecipient(
  content: WeeklyContent,
  unsubscribeToken: string
): { html: string; subject: string; preheader: string } {
  const preheader = buildPreheader(content);
  const html = renderWeeklyBriefEmail({
    content,
    preheader,
    unsubscribeUrl: buildUnsubscribeUrl(unsubscribeToken),
  });

  return {
    html,
    subject: buildSubject(content),
    preheader,
  };
}

export async function sendToRecipient(
  content: WeeklyContent,
  to: string,
  unsubscribeToken: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { html, subject, preheader } = renderForRecipient(content, unsubscribeToken);

  try {
    await sgMail.send({
      to,
      from: getWeeklyBriefFrom(),
      subject,
      html,
      headers: {
        'List-Unsubscribe': `<${buildUnsubscribeUrl(unsubscribeToken)}>`,
      },
      categories: ['weekly-brief'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }

  console.log(`[weekly-brief] Sent to ${to} — preheader: ${preheader.slice(0, 40)}…`);
  return { ok: true };
}

export async function sendBatchInBackground(
  content: WeeklyContent,
  recipients: WeeklyBriefRecipient[]
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
          recipient.unsubscribe_token
        );
        if (result.ok) {
          sent += 1;
        } else {
          failed += 1;
          console.error(
            `[weekly-brief] Failed to send to ${recipient.email}: ${result.error}`
          );
        }
      })
    );
  }

  console.log(
    `[weekly-brief] Batch complete — sent: ${sent}, failed: ${failed}, total: ${recipients.length}`
  );
}

export async function sendTestEmail(
  content: WeeklyContent,
  testEmail: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const testToken = '00000000-0000-0000-0000-000000000000';
  return sendToRecipient(content, testEmail, testToken);
}
