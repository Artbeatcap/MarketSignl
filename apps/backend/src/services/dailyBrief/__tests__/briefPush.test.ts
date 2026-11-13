/**
 * Morning brief publish, push, receipts, and the public read route.
 * Run: npm test briefPush
 */
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DailyContent } from '../types.js';
import { buildPreheader, renderDailyBriefEmail } from '../renderEmail.js';
import { publishGatedBrief } from '../publish.js';
import { sendDailyBriefPush } from '../push.js';
import { checkDailyBriefReceipts } from '../receipts.js';
import { registerPublicBriefRoutes } from '../publicRead.js';
import { fetchExpoPushReceipts } from '../../pushNotificationService.js';
import {
  selectBriefPushRecipients,
  type BriefInAppDb,
  type BriefLogRow,
  type BriefNotificationInsert,
  type BriefProfileFlags,
  type BriefTokenRow,
  type PublishedBriefRow,
  type PushRecipient,
  type RecipientSkipReason,
} from '../briefStore.js';
import { resetBriefPublicRateLimitForTests } from '../../../lib/briefPublicRateLimit.js';
import type { BriefGap } from '../../../lib/briefCompleteness.js';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function content(partial: Partial<DailyContent> = {}): DailyContent {
  return {
    schema_version: 1,
    date_label: 'Thursday, November 12, 2026',
    generated_at: '08:15 ET',
    data_stale: false,
    promptVersion: 'secret-prompt',
    preheader: 'Futures are firm and the open leans higher.',
    tape: [{ symbol: 'SPY', price: '$500', pct: 0.4 }],
    sectors: [],
    movers: [],
    levels: { SPY: { support: '495', resistance: '505' } },
    catalyst_bullets: [],
    headlines: [],
    sections: {
      greeting: 'Good morning.',
      opening_bias: 'Futures are firm and the open leans higher. Breadth is the tell.',
      session_setup_html: '<p>The <strong>open</strong> is set.</p>',
      key_level_note: '',
      todays_watch_html: '',
      biggest_risk: 'A hot print.',
    },
    ...partial,
  };
}

class MemoryDb implements BriefInAppDb {
  published = new Map<string, PublishedBriefRow>();
  logs: BriefLogRow[] = [];
  tokens: BriefTokenRow[] = [];
  profiles: BriefProfileFlags[] = [];
  deactivated: string[] = [];
  private seq = 1;

  seedMorning(row: Partial<PublishedBriefRow> & { as_of: string; content: DailyContent }): void {
    this.published.set(row.as_of, {
      id: row.id ?? this.seq++,
      as_of: row.as_of,
      edition: 'morning',
      content: row.content,
      complete: row.complete ?? true,
      missing: row.missing ?? null,
      published_at: row.published_at ?? '2026-11-12T13:30:00.000Z',
      push_claimed_at: row.push_claimed_at ?? null,
      push_summary: row.push_summary ?? null,
    });
  }

  async upsertPublished(input: {
    asOf: string;
    content: DailyContent;
    complete: boolean;
    missing: BriefGap[];
    publishedAt: string;
  }): Promise<void> {
    const existing = this.published.get(input.asOf);
    this.published.set(input.asOf, {
      id: existing?.id ?? this.seq++,
      as_of: input.asOf,
      edition: 'morning',
      content: input.content,
      complete: input.complete,
      missing: input.missing,
      published_at: input.publishedAt,
      push_claimed_at: existing?.push_claimed_at ?? null,
      push_summary: existing?.push_summary ?? null,
    });
  }

  async getNewestPublished(): Promise<PublishedBriefRow | null> {
    const rows = [...this.published.values()].sort((a, b) =>
      a.published_at < b.published_at ? 1 : -1
    );
    return rows[0] ?? null;
  }

  async getMorning(asOf: string): Promise<PublishedBriefRow | null> {
    return this.published.get(asOf) ?? null;
  }

  async claimMorningPush(asOf: string, atIso: string): Promise<boolean> {
    const row = this.published.get(asOf);
    if (!row || row.push_claimed_at) return false;
    row.push_claimed_at = atIso;
    return true;
  }

  async mergePushSummary(asOf: string, patch: Record<string, unknown>): Promise<void> {
    const row = this.published.get(asOf);
    if (!row) return;
    row.push_summary = { ...(row.push_summary ?? {}), ...patch };
  }

  async listRecipients(onlyUserId?: string): Promise<PushRecipient[]> {
    return selectBriefPushRecipients(this.tokens, this.profiles, onlyUserId);
  }

  async recipientSkipReason(userId: string): Promise<RecipientSkipReason> {
    const profile = this.profiles.find((row) => row.id === userId);
    if (!profile) return 'no_user';
    if (profile.brief_push_enabled === false) return 'brief_push_disabled';
    if (profile.push_notifications_enabled === false) return 'push_disabled';
    const active = this.tokens.filter((row) => row.userId === userId && row.isActive);
    if (active.length === 0) return 'no_active_token';
    return 'invalid_token';
  }

  async insertLogs(rows: BriefNotificationInsert[]): Promise<void> {
    for (const row of rows) {
      this.logs.push({
        id: `log-${this.seq++}`,
        user_id: row.user_id,
        expo_push_token: row.expo_push_token,
        status: row.status,
        expo_receipt_id: row.expo_receipt_id,
        error_message: row.error_message,
        data: row.data,
        created_at: new Date().toISOString(),
      });
    }
  }

  async deactivateToken(token: string): Promise<void> {
    this.deactivated.push(token);
    for (const row of this.tokens) {
      if (row.token === token) row.isActive = false;
    }
  }

  async insertOpen(): Promise<void> {}

  async listBriefLogsSince(): Promise<BriefLogRow[]> {
    return this.logs;
  }

  async updateLogReceipt(
    id: string,
    status: 'delivered' | 'error',
    errorMessage: string | null
  ): Promise<void> {
    const row = this.logs.find((item) => item.id === id);
    if (!row) return;
    row.status = status;
    row.error_message = errorMessage;
  }

  async hasIosBriefBefore(iso: string): Promise<boolean> {
    return this.logs.some(
      (row) =>
        row.data?.type === 'daily_brief' &&
        row.data?.platform === 'ios' &&
        row.created_at < iso
    );
  }
}

const supabase = {} as SupabaseClient;

function morningRow(db: MemoryDb, brief = content(), complete = true, missing: BriefGap[] | null = null) {
  db.seedMorning({ as_of: '2026-11-12', content: brief, complete, missing });
}

await test('email gains one in-app link and keeps the chart button', async () => {
  const html = renderDailyBriefEmail({
    content: content(),
    unsubscribeUrl: 'https://example.com/unsub',
  });
  const linkAt = html.indexOf('https://app.chartsignl.com/brief?src=email');
  const biasAt = html.indexOf('Opening bias');
  const buttonAt = html.indexOf('Pull these levels up on live charts');
  assert.ok(linkAt > biasAt);
  assert.ok(buttonAt > linkAt);
  assert.equal(html.split('Read this brief in the app').length, 2);
});

await test('a second push for the same morning is already_sent and does not call Expo', async () => {
  const db = new MemoryDb();
  const brief = content();
  morningRow(db, brief);
  db.tokens = [{ userId: 'u1', token: 'ExponentPushToken[one]', platform: 'android', isActive: true }];
  db.profiles = [{ id: 'u1', push_notifications_enabled: true, brief_push_enabled: true }];
  let calls = 0;
  const send = async (messages: { to: string }[]) => {
    calls += 1;
    return messages.map((_, index) => ({ status: 'ok' as const, id: `t-${index}` }));
  };
  const first = await sendDailyBriefPush(supabase, { asOf: '2026-11-12', content: brief }, {
    db,
    send,
    enabled: true,
    alert: async () => {},
  });
  assert.equal('skipped' in first, false);
  const second = await sendDailyBriefPush(supabase, { asOf: '2026-11-12', content: brief }, {
    db,
    send,
    enabled: true,
    alert: async () => {},
  });
  assert.deepEqual(second, { skipped: 'already_sent' });
  assert.equal(calls, 1);
});

await test('a thin brief skips the push, calls no Expo API, and alerts', async () => {
  const db = new MemoryDb();
  const brief = content();
  morningRow(db, brief, false, [{ section: 'Opening Bias', reason: 'missing' }]);
  let calls = 0;
  const alerts: string[] = [];
  const result = await sendDailyBriefPush(supabase, { asOf: '2026-11-12', content: brief }, {
    db,
    enabled: true,
    send: async () => {
      calls += 1;
      return [];
    },
    alert: async (message) => {
      alerts.push(message);
    },
  });
  assert.deepEqual(result, { skipped: 'thin' });
  assert.equal(calls, 0);
  assert.equal(db.published.get('2026-11-12')?.push_claimed_at, null);
  assert.ok(alerts.some((message) => message.includes('BRIEF PUSH SKIPPED thin 2026-11-12: Opening Bias')));
});

await test('opted-out profiles and inactive tokens are excluded; the body is the preheader', async () => {
  const db = new MemoryDb();
  const brief = content();
  morningRow(db, brief);
  db.tokens = [
    { userId: 'ok', token: 'ExponentPushToken[ok]', platform: 'android', isActive: true },
    { userId: 'briefOff', token: 'ExponentPushToken[brief]', platform: 'android', isActive: true },
    { userId: 'pushOff', token: 'ExponentPushToken[push]', platform: 'android', isActive: true },
    { userId: 'inactive', token: 'ExponentPushToken[off]', platform: 'android', isActive: false },
    { userId: 'bad', token: 'not-a-token', platform: 'android', isActive: true },
  ];
  db.profiles = [
    { id: 'ok', push_notifications_enabled: true, brief_push_enabled: true },
    { id: 'briefOff', push_notifications_enabled: true, brief_push_enabled: false },
    { id: 'pushOff', push_notifications_enabled: false, brief_push_enabled: true },
    { id: 'inactive', push_notifications_enabled: true, brief_push_enabled: true },
    { id: 'bad', push_notifications_enabled: true, brief_push_enabled: true },
  ];
  let sent: Array<{ to: string; body: string; data?: Record<string, unknown>; sound?: 'default' | null }> = [];
  await sendDailyBriefPush(supabase, { asOf: '2026-11-12', content: brief }, {
    db,
    enabled: true,
    alert: async () => {},
    send: async (messages) => {
      sent = messages;
      return messages.map((_, index) => ({ status: 'ok' as const, id: `ok-${index}` }));
    },
  });
  assert.deepEqual(sent.map((message) => message.to), ['ExponentPushToken[ok]']);
  assert.equal(sent[0].body, buildPreheader(brief, 150));
  assert.equal(sent[0].data?.type, 'daily_brief');
  assert.equal(sent[0].sound, null);
  const off = await sendDailyBriefPush(
    supabase,
    { asOf: '2026-11-12', content: brief, onlyUserId: 'briefOff' },
    { db, enabled: false, alert: async () => {}, send: async () => [] }
  );
  assert.deepEqual(off, { skipped: 'brief_push_disabled' });
});

await test('receipts: ok delivers, DeviceNotRegistered deactivates, InvalidCredentials names iOS', async () => {
  const db = new MemoryDb();
  db.seedMorning({ as_of: '2026-11-12', content: content(), complete: true });
  const created = '2026-11-12T13:40:00.000Z';
  db.logs = [
    {
      id: 'a',
      user_id: 'u1',
      expo_push_token: 'ExponentPushToken[and]',
      status: 'sent',
      expo_receipt_id: 'r-ok',
      error_message: null,
      data: { type: 'daily_brief', platform: 'android' },
      created_at: created,
    },
    {
      id: 'b',
      user_id: 'u2',
      expo_push_token: 'ExponentPushToken[dead]',
      status: 'sent',
      expo_receipt_id: 'r-dead',
      error_message: null,
      data: { type: 'daily_brief', platform: 'android' },
      created_at: created,
    },
    {
      id: 'c',
      user_id: 'u3',
      expo_push_token: 'ExponentPushToken[ios]',
      status: 'sent',
      expo_receipt_id: 'r-ios',
      error_message: null,
      data: { type: 'daily_brief', platform: 'ios' },
      created_at: created,
    },
  ];
  const alerts: string[] = [];
  const result = await checkDailyBriefReceipts(supabase, {
    db,
    now: new Date('2026-11-12T14:00:00.000Z'),
    alert: async (message) => {
      alerts.push(message);
    },
    fetchReceipts: async () => ({
      'r-ok': { status: 'ok' },
      'r-dead': { status: 'error', details: { error: 'DeviceNotRegistered' } },
      'r-ios': { status: 'error', details: { error: 'InvalidCredentials' } },
    }),
  });
  assert.equal(db.logs.find((row) => row.id === 'a')?.status, 'delivered');
  assert.equal(db.logs.find((row) => row.id === 'b')?.status, 'error');
  assert.equal(db.logs.find((row) => row.id === 'b')?.error_message, 'DeviceNotRegistered');
  assert.deepEqual(db.deactivated, ['ExponentPushToken[dead]']);
  assert.equal(result.delivered, 1);
  assert.equal(result.error, 2);
  assert.ok(alerts.some((message) => /InvalidCredentials/.test(message) && /ios/i.test(message)));
});

await test('the first iOS alert fires once, not on a later day', async () => {
  const db = new MemoryDb();
  const alerts: string[] = [];
  const alert = async (message: string) => {
    alerts.push(message);
  };
  db.seedMorning({ as_of: '2026-11-12', content: content(), complete: true });
  db.logs = [
    {
      id: 'ios-1',
      user_id: 'u',
      expo_push_token: 'ExponentPushToken[ios]',
      status: 'sent',
      expo_receipt_id: 'r1',
      error_message: null,
      data: { type: 'daily_brief', platform: 'ios' },
      created_at: '2026-11-12T13:40:00.000Z',
    },
  ];
  await checkDailyBriefReceipts(supabase, {
    db,
    now: new Date('2026-11-12T14:00:00.000Z'),
    alert,
    fetchReceipts: async () => ({ r1: { status: 'ok' } }),
  });
  db.seedMorning({ as_of: '2026-11-13', content: content(), complete: true });
  db.logs.push({
    id: 'ios-2',
    user_id: 'u',
    expo_push_token: 'ExponentPushToken[ios]',
    status: 'sent',
    expo_receipt_id: 'r2',
    error_message: null,
    data: { type: 'daily_brief', platform: 'ios' },
    created_at: '2026-11-13T13:40:00.000Z',
  });
  await checkDailyBriefReceipts(supabase, {
    db,
    now: new Date('2026-11-13T14:00:00.000Z'),
    alert,
    fetchReceipts: async () => ({ r2: { status: 'ok' } }),
  });
  const firsts = alerts.filter((message) => message.startsWith('FIRST iOS BRIEF PUSH'));
  assert.deepEqual(firsts, ['FIRST iOS BRIEF PUSH: delivered']);
});

await test('GET /latest is 404 when empty and strips promptVersion', async () => {
  resetBriefPublicRateLimitForTests();
  const db = new MemoryDb();
  const app = new Hono();
  registerPublicBriefRoutes(app, {
    db: () => db,
    userFromAuthHeader: async () => null,
    now: () => new Date('2026-11-12T14:00:00.000Z'),
  });
  const empty = await app.request('/latest');
  assert.equal(empty.status, 404);
  assert.deepEqual(await empty.json(), { error: 'no_brief' });

  db.seedMorning({ as_of: '2026-11-12', content: content(), complete: true });
  const found = await app.request('/latest');
  assert.equal(found.status, 200);
  assert.equal(found.headers.get('cache-control'), 'public, max-age=300');
  const body = (await found.json()) as {
    isToday: boolean;
    content: { date_label: string };
  };
  const encoded = JSON.stringify(body);
  assert.equal(encoded.includes('promptVersion'), false);
  assert.equal(encoded.includes('secret-prompt'), false);
  assert.equal(encoded.includes('schema_version'), false);
  assert.equal(encoded.includes('data_stale'), false);
  assert.equal(body.isToday, true);
  assert.equal(body.content.date_label, 'Thursday, November 12, 2026');
});

await test('receipt helper requests Expo in chunks of 300', async () => {
  const original = globalThis.fetch;
  const sizes: number[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { ids: string[] };
    sizes.push(body.ids.length);
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }) as typeof fetch;
  try {
    await fetchExpoPushReceipts(Array.from({ length: 301 }, (_, index) => `id-${index}`));
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(sizes, [300, 1]);
});

await test('/send dryRun and testEmail publish nothing; a push throw does not stop the email', async () => {
  const route = await import('../../../routes/dailyBrief.js');
  const brief = content();
  const published: string[] = [];
  const pushes: string[] = [];
  let batches = 0;
  let testsSent = 0;
  const previousFlag = process.env.BRIEF_PUSH_ENABLED;
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-cron';
  process.env.BRIEF_PUSH_ENABLED = 'true';
  route.setDailyBriefSendHooksForTests({
    loadArtifact: async () => ({
      id: 'art',
      date_label: brief.date_label,
      generated_at: new Date().toISOString(),
      data_stale: false,
      artifact: brief,
      received_at: new Date().toISOString(),
    }),
    prepare: async () => ({
      content: brief,
      gradedLines: [],
      qa: { status: 'skipped', fixes: 0, blocks: 0, warns: 0 },
    }),
    loadWeekAhead: async () => ({ rows: [] }),
    publish: async () => {
      published.push('publish');
      return { status: 'stored', asOf: '2026-11-12', complete: true, missing: 0 };
    },
    push: async () => {
      pushes.push('push');
      throw new Error('push blew up');
    },
    fetchRecipients: async () => [
      { id: 'u', email: 'a@example.com', unsubscribe_token: '00000000-0000-4000-8000-000000000001' },
    ],
    sendBatch: async () => {
      batches += 1;
    },
    sendTest: async () => {
      testsSent += 1;
      return { ok: true };
    },
  });
  const headers = { 'x-cron-secret': 'test-cron' };
  try {
    const dry = await route.internalDailyBriefRoute.request('/send?dryRun=1', {
      method: 'POST',
      headers,
    });
    const dryBody = (await dry.json()) as { dryRun?: boolean };
    assert.equal(dry.status, 200);
    assert.equal(dryBody.dryRun, true);
    assert.deepEqual(published, []);
    assert.deepEqual(pushes, []);

    const preview = await route.internalDailyBriefRoute.request('/send?testEmail=a@example.com', {
      method: 'POST',
      headers,
    });
    assert.equal(preview.status, 200);
    assert.equal(testsSent, 1);
    assert.deepEqual(published, []);
    assert.deepEqual(pushes, []);

    const real = await route.internalDailyBriefRoute.request('/send', { method: 'POST', headers });
    const realBody = (await real.json()) as {
      success?: boolean;
      status?: string;
      push?: string;
    };
    assert.equal(real.status, 200);
    assert.equal(realBody.success, true);
    assert.equal(realBody.status, 'sending');
    assert.equal(realBody.push, 'started');
    assert.equal(batches, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(pushes, ['push']);
    assert.deepEqual(published, ['publish']);
  } finally {
    route.setDailyBriefSendHooksForTests(null);
    if (previousFlag === undefined) delete process.env.BRIEF_PUSH_ENABLED;
    else process.env.BRIEF_PUSH_ENABLED = previousFlag;
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});

await test('publish stores the gated brief and leaves an existing claim alone', async () => {
  const db = new MemoryDb();
  db.seedMorning({
    as_of: '2026-11-12',
    content: content(),
    complete: true,
    push_claimed_at: '2026-11-12T13:31:00.000Z',
  });
  const result = await publishGatedBrief(db, content({ preheader: 'A revised lead.' }));
  assert.equal(result.status, 'stored');
  assert.equal(result.asOf, '2026-11-12');
  assert.equal(db.published.get('2026-11-12')?.push_claimed_at, '2026-11-12T13:31:00.000Z');
  assert.equal(db.published.get('2026-11-12')?.content.preheader, 'A revised lead.');
});

console.log(`\n${passed} brief push tests passed`);
