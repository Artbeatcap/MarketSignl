import { Hono } from 'hono';
import { mkdir, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getUserFromToken, supabaseAdmin } from '../lib/supabase.js';
import { saveArtifact, getLatestArtifact } from '../services/dailyBrief/store.js';
import { checkArtifactFreshness } from '../services/dailyBrief/freshness.js';
import { postDailyBriefAlert } from '../services/dailyBrief/alert.js';
import { parseDailyContent } from '../services/dailyBrief/validate.js';
import { sanitizeAiField, sanitizeDailySections } from '../lib/briefSanitize.js';
import { filterMoversByType } from '../lib/tickerMeta.js';
import {
  buildPreheader,
  buildSubject,
  renderDailyBriefEmail,
} from '../services/dailyBrief/renderEmail.js';
import {
  fetchRecipients,
  sendBatchInBackground,
  sendTestEmail,
} from '../services/dailyBrief/sendEmail.js';
import { getApiBaseUrl } from '../services/dailyBrief/brand.js';
import { ZodError } from 'zod';
import { loadWeekAhead } from '../lib/weekAheadLoad.js';
import { buildThisWeekBlock, ATLAS_HARD_RULE, ATLAS_CALENDAR_OUTPUT_RULES } from '../lib/weekAhead.js';
import { refreshEarningsCalendar } from '../lib/earningsCalendarRefresh.js';
import { unsubscribeByToken } from '../lib/newsletter.js';
import { buildLiveAtlasPrompt, flagStalePrompt, prepareDailyContent } from '../lib/briefQaLive.js';
import { guardMorningSend, priorCloseWeekday, renderQa, saveBriefRun } from '../lib/briefRenderQa.js';
import { supabaseBriefDb } from '../services/dailyBrief/briefStore.js';
import { publishGatedBrief, type PublishResult } from '../services/dailyBrief/publish.js';
import {
  accountForMorningPush,
  holdMorningPush,
  sendDailyBriefPush,
  type BriefPushResult,
} from '../services/dailyBrief/push.js';
import { easternDay } from '../services/dailyBrief/easternDay.js';
import { checkDailyBriefReceipts } from '../services/dailyBrief/receipts.js';
import { registerPublicBriefRoutes } from '../services/dailyBrief/publicRead.js';
import type { DailyContent, StoredDailyBrief } from '../services/dailyBrief/types.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DRY_RUN_PATH = resolve(__dirname, '../../tmp/daily-brief-dryrun.html');

const internalDailyBriefRoute = new Hono();
const publicDailyBriefRoute = new Hono();

type SendHooks = {
  loadArtifact?: (supabase: SupabaseClient) => Promise<StoredDailyBrief | null>;
  prepare?: typeof prepareDailyContent;
  publish?: (content: DailyContent) => Promise<PublishResult>;
  push?: (input: { asOf: string; content: DailyContent; onlyUserId?: string }) => Promise<BriefPushResult>;
  fetchRecipients?: typeof fetchRecipients;
  sendBatch?: typeof sendBatchInBackground;
  sendTest?: typeof sendTestEmail;
  loadWeekAhead?: () => Promise<{ rows: Awaited<ReturnType<typeof loadWeekAhead>>['rows'] }>;
};

let sendHooks: SendHooks | null = null;

export function setDailyBriefSendHooksForTests(next: SendHooks | null): void {
  sendHooks = next;
}

let publicDbOverride: ReturnType<typeof supabaseBriefDb> | null = null;

export function setBriefPublicDbForTests(
  next: ReturnType<typeof supabaseBriefDb> | null
): void {
  publicDbOverride = next;
}

function briefDb() {
  return publicDbOverride ?? supabaseBriefDb(supabaseAdmin);
}

registerPublicBriefRoutes(publicDailyBriefRoute, {
  db: briefDb,
  userFromAuthHeader: async (header) => {
    if (!header?.startsWith('Bearer ')) return null;
    return getUserFromToken(header.slice(7));
  },
});

/** Shared ingest secret with weekly; optional DAILY_CONTENT_INGEST_SECRET override. */
function checkIngestSecret(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const secret = c.req.header('x-ingest-secret');
  const expected =
    process.env.DAILY_CONTENT_INGEST_SECRET || process.env.WEEKLY_CONTENT_INGEST_SECRET;
  return !!expected && secret === expected;
}

function checkCronSecret(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const secret = c.req.header('x-cron-secret');
  const expected = process.env.CRON_SECRET;
  return !!expected && secret === expected;
}

internalDailyBriefRoute.post('/ingest', async (c) => {
  if (!checkIngestSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  try {
    const content = parseDailyContent(body);
    await flagStalePrompt(content.promptVersion);
    content.sections = sanitizeDailySections(content.sections);
    if (content.preheader) content.preheader = sanitizeAiField(content.preheader);
    const before = content.movers.length;
    content.movers = await filterMoversByType(content.movers);
    console.log(
      JSON.stringify({
        event: 'movers_filter',
        candidates: before,
        rendered: content.movers.length,
      })
    );
    if (content.movers.length < 3) {
      console.warn(`[daily-brief] movers_filter rendered ${content.movers.length} (< 3)`);
    }
    const { id } = await saveArtifact(supabaseAdmin, content);
    console.log(`[daily-brief] Ingested artifact ${id} for ${content.date_label}`);
    return c.json({ success: true, id });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json(
        {
          success: false,
          error: 'Invalid artifact shape',
          details: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
        },
        400
      );
    }
    console.error('[daily-brief] Ingest error:', err);
    return c.json(
      { success: false, error: err instanceof Error ? err.message : 'Ingest failed' },
      500
    );
  }
});

internalDailyBriefRoute.post('/send', async (c) => {
  if (!checkCronSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const dryRun = c.req.query('dryRun') === '1';
  const testEmail = c.req.query('testEmail');

  const stored = await (sendHooks?.loadArtifact ?? getLatestArtifact)(supabaseAdmin);
  const freshness = checkArtifactFreshness(stored);

  if (!freshness.ok) {
    await postDailyBriefAlert(`Send skipped: ${freshness.reason}`);
    return c.json({ success: false, error: freshness.reason, skipped: true }, 409);
  }

  const storedContent = stored!.artifact;
  const prepared = await (sendHooks?.prepare ?? prepareDailyContent)({
    content: storedContent,
    edition: 'morning',
    notify: !dryRun,
    persist: !dryRun && !testEmail,
  });
  const guarded = guardMorningSend({
    content: prepared.content,
    weekday: priorCloseWeekday(prepared.content.date_label),
  });
  const content = guarded.content;
  if (guarded.status !== 'pass') {
    await postDailyBriefAlert(
      `BRIEF QA FIXED morning ${content.date_label}\nrepairs: ${guarded.repairs.join(', ') || 'none'}\nomitted: ${guarded.omitted.join(', ') || 'none'}`
    );
  }
  const placeholderUnsub = `${getApiBaseUrl()}/api/daily-brief/unsubscribe?token=preview`;
  const weekAhead = sendHooks?.loadWeekAhead
    ? await sendHooks.loadWeekAhead()
    : await loadWeekAhead();
  const calendar = weekAhead.rows;

  if (dryRun) {
    const html = renderDailyBriefEmail({
      content,
      preheader: content.preheader || buildPreheader(content),
      unsubscribeUrl: placeholderUnsub,
      calendar: guarded.calendar.length ? guarded.calendar : calendar,
      priorLevels: prepared.gradedLines,
      tapeCaption: guarded.tapeCaption,
    });
    const renderCodes = renderQa({
      html,
      tapeCaption: guarded.tapeCaption,
      expectedCaption: guarded.tapeCaption,
      topStory: guarded.topStory,
      calendarBlocks: (guarded.calendar.length ? guarded.calendar : calendar).length ? 1 : 0,
    });
    const renderStatus = guarded.repairs.length || renderCodes.length ? 'fixed' : 'pass';
    console.log(JSON.stringify({ event: 'brief_qa', asOf: content.date_label, edition: 'morning', status: prepared.qa.status }));
    console.log(JSON.stringify({ event: 'render_qa', status: renderStatus, repairs: guarded.repairs, codes: renderCodes }));
    await saveBriefRun({
      asOf: content.date_label,
      edition: 'morning',
      payload: { content, qa: prepared.qa, render: renderCodes, repairs: guarded.repairs },
      alert: async (subject, body) => postDailyBriefAlert(`${subject}\n${body}`),
    });

    await mkdir(resolve(__dirname, '../../tmp'), { recursive: true });
    await writeFile(DRY_RUN_PATH, html, 'utf-8');
    console.log(`[daily-brief] Dry run HTML written to ${DRY_RUN_PATH}`);

    return c.json({
      success: true,
      dryRun: true,
      html,
      htmlPath: DRY_RUN_PATH,
      subject: buildSubject(content),
      preheader: buildPreheader(content),
      qa: { ...prepared.qa, status: renderStatus, renderCodes },
    });
  }

  if (testEmail) {
    const sendTest = sendHooks?.sendTest ?? sendTestEmail;
    const result = await sendTest(content, testEmail, calendar, prepared.gradedLines, guarded.tapeCaption);
    if (!result.ok) {
      await postDailyBriefAlert(`Test send failed to ${testEmail}: ${result.error}`);
      return c.json({ success: false, error: result.error }, 500);
    }

    return c.json({
      success: true,
      testEmail,
      subject: buildSubject(content),
    });
  }

  await saveBriefRun({
    asOf: content.date_label,
    edition: 'morning',
    payload: { content, qa: prepared.qa, repairs: guarded.repairs, omitted: guarded.omitted },
    alert: async (subject, body) => postDailyBriefAlert(`${subject}\n${body}`),
  });

  const published = sendHooks?.publish
    ? await sendHooks.publish(content)
    : await publishGatedBrief(briefDb(), content);

  const recipients = await (sendHooks?.fetchRecipients ?? fetchRecipients)(supabaseAdmin);
  if (recipients.length === 0) {
    await postDailyBriefAlert('Send skipped: no opted-in verified recipients');
    return c.json({ success: false, error: 'No recipients', skipped: true }, 409);
  }

  const sendBatch = sendHooks?.sendBatch ?? sendBatchInBackground;
  void sendBatch(content, recipients, guarded.calendar.length ? guarded.calendar : calendar, prepared.gradedLines, guarded.tapeCaption).catch(async (err) => {
    console.error('[daily-brief] Background send failed:', err);
    await postDailyBriefAlert(
      `Background send failed: ${err instanceof Error ? err.message : String(err)}`
    );
  });

  return c.json({
    success: true,
    status: 'sending',
    recipientCount: recipients.length,
    date_label: content.date_label,
    qa: prepared.qa,
    push: published.status === 'stored' ? 'deferred' : 'disabled',
  });
});

internalDailyBriefRoute.post('/push', async (c) => {
  if (!checkCronSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const asOf = easternDay(Date.now());
  const row = await briefDb().getMorning(asOf);
  if (!row) return c.json({ success: true, skipped: 'no_brief', asOf });
  try {
    const result = await sendDailyBriefPush(supabaseAdmin, { asOf, content: row.content });
    return c.json({ success: true, asOf, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await postDailyBriefAlert(`Brief push failed: ${message}`);
    return c.json({ success: false, error: message }, 500);
  }
});

internalDailyBriefRoute.post('/push-hold', async (c) => {
  if (!checkCronSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const asOf = c.req.query('asOf') || easternDay(Date.now());
  const result = await holdMorningPush(supabaseAdmin, asOf);
  if ('skipped' in result && result.skipped === 'no_brief') {
    return c.json({ success: false, ...result }, 404);
  }
  if ('skipped' in result) return c.json({ success: false, ...result }, 409);
  return c.json({ success: true, ...result });
});

internalDailyBriefRoute.post('/push-check', async (c) => {
  if (!checkCronSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const result = await accountForMorningPush(supabaseAdmin);
  return c.json({ success: true, ...result });
});

internalDailyBriefRoute.post('/push-test', async (c) => {
  if (!checkCronSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = c.req.query('userId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return c.json({ success: false, error: 'userId is required' }, 400);
  }
  const row = await briefDb().getNewestPublished();
  if (!row) return c.json({ success: false, error: 'no_brief' }, 404);
  try {
    const result = await (sendHooks?.push
      ? sendHooks.push({ asOf: row.as_of, content: row.content, onlyUserId: userId })
      : sendDailyBriefPush(supabaseAdmin, {
          asOf: row.as_of,
          content: row.content,
          onlyUserId: userId,
        }));
    return c.json({ success: true, asOf: row.as_of, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await postDailyBriefAlert(`Brief push-test failed: ${message}`);
    return c.json({ success: false, error: message }, 500);
  }
});

internalDailyBriefRoute.post('/push-receipts', async (c) => {
  if (!checkCronSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  try {
    const result = await checkDailyBriefReceipts(supabaseAdmin);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await postDailyBriefAlert(`Brief push receipts failed: ${message}`);
    return c.json({ success: false, error: message }, 500);
  }
});

/** FACTS + PRIOR CALLS + hard rules for Options Plunge / n8n. No reference-note text. */
internalDailyBriefRoute.get('/atlas-prompt', async (c) => {
  if (!checkCronSecret(c) && !checkIngestSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const edition = c.req.query('edition') === 'close' ? 'close' : 'morning';
  const movers = (c.req.query('tickers') ?? '')
    .split(',')
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => /^[A-Z.]{1,6}$/.test(ticker))
    .slice(0, 12);
  try {
    const prompt = await buildLiveAtlasPrompt(edition, movers);
    return c.json({ success: true, edition, ...prompt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 503);
  }
});

/** Nightly FMP cache refresh. Never called from the 8:30 send path. */
internalDailyBriefRoute.post('/refresh-calendar', async (c) => {
  if (!checkCronSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  try {
    const result = await refreshEarningsCalendar();
    return c.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[week-ahead] refresh-calendar failed:', message);
    await postDailyBriefAlert(`Earnings calendar refresh failed: ${message}`);
    return c.json({ success: false, error: message }, 500);
  }
});

/**
 * Structured calendar + Atlas THIS WEEK block for Options Plunge / n8n.
 * Reads the cache. Does not call FMP.
 */
internalDailyBriefRoute.get('/week-ahead', async (c) => {
  if (!checkCronSecret(c) && !checkIngestSecret(c)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const weekAhead = await loadWeekAhead();
  return c.json({
    success: true,
    rows: weekAhead.rows,
    promptBlock: buildThisWeekBlock(weekAhead.rows),
    hardRule: ATLAS_HARD_RULE,
    outputRules: ATLAS_CALENDAR_OUTPUT_RULES,
    log: weekAhead.log,
  });
});

publicDailyBriefRoute.get('/unsubscribe', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    return c.html(
      '<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h1>Invalid link</h1><p>Missing unsubscribe token.</p></body></html>',
      400
    );
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ daily_brief_opt_in: false })
    .eq('unsubscribe_token', token)
    .select('id')
    .maybeSingle();

  if (!error && data?.id) {
    await supabaseAdmin
      .from('newsletter_subscribers')
      .update({
        status: 'unsubscribed',
        unsubscribed_at: new Date().toISOString(),
        unsubscribe_reason: 'email_link',
      })
      .eq('user_id', data.id)
      .eq('status', 'subscribed');
  }

  if (error) {
    console.error('[daily-brief] Unsubscribe error:', error);
    return c.html(
      '<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h1>Something went wrong</h1><p>Please try again later or contact support@chartsignl.com.</p></body></html>',
      500
    );
  }

  if (!data) {
    const newsletter = await unsubscribeByToken(token, 'email_link');
    if (!newsletter.ok) {
      return c.html(
        '<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h1>Link not found</h1><p>This unsubscribe link is invalid or has already been used.</p></body></html>',
        404
      );
    }
  }

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribed — ChartSignl</title>
</head>
<body style="margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAF9;color:#57534E;text-align:center;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#14B8A6;margin-bottom:12px;">ChartSignl</div>
    <h1 style="font-size:24px;color:#0b1220;margin:0 0 12px;">You're unsubscribed</h1>
    <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">You won't receive ChartSignl Morning Brief emails anymore.</p>
    <a href="https://app.chartsignl.com" style="display:inline-block;padding:12px 24px;background:#3B82F6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open ChartSignl</a>
  </div>
</body>
</html>`);
});

export { internalDailyBriefRoute, publicDailyBriefRoute };
