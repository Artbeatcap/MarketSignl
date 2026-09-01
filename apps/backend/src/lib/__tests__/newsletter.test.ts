/**
 * Newsletter lifecycle / consent tests.
 * These encode the non-negotiables. Run:
 *   npx tsx apps/backend/src/lib/__tests__/newsletter.test.ts
 */
import './setupEnv.js';

import assert from 'node:assert/strict';
import {
  getActiveSubscribers,
  getSubscriptionForUser,
  processSendGridEvents,
  recordDeliveryEvent,
  resubscribeByToken,
  setNewsletterStoreForTests,
  setSubscriptionForUser,
  subscribePublic,
  type NewsletterStore,
  type Subscriber,
  type SubscriberStatus,
  type SubscriberSource,
} from '../newsletter.js';
import {
  assertPerRecipientUnsubscribeTokens,
  buildPersonalizations,
  prepareSharedContent,
  sendNewsletter,
  type SendLedger,
} from '../newsletterSend.js';
import {
  jsonRoundTripChangesBytes,
  setSendGridWebhookVerifierForTests,
  verifySendGridWebhookSignature,
} from '../newsletterWebhook.js';
import { resetNewsletterRateLimitForTests } from '../newsletterRateLimit.js';
import newsletterRoute from '../../routes/newsletter.js';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

class MemoryStore implements NewsletterStore {
  rows = new Map<string, Subscriber>();
  profileEmails = new Map<string, string>();
  claimedEvents = new Set<string>();

  private key(email: string) {
    return email.toLowerCase();
  }

  async findByEmail(email: string) {
    return this.rows.get(this.key(email)) ?? null;
  }

  async findByUserId(userId: string) {
    return [...this.rows.values()].find((row) => row.user_id === userId) ?? null;
  }

  async findByToken(token: string) {
    return [...this.rows.values()].find((row) => row.unsubscribe_token === token) ?? null;
  }

  async insertSubscriber(row: {
    email: string;
    user_id?: string | null;
    status: SubscriberStatus;
    source: SubscriberSource;
    consent_ip?: string | null;
    consent_user_agent?: string | null;
  }) {
    const email = row.email.toLowerCase();
    if (this.rows.has(email)) return 'conflict' as const;
    const subscriber: Subscriber = {
      id: crypto.randomUUID(),
      email,
      user_id: row.user_id ?? null,
      status: row.status,
      source: row.source,
      unsubscribe_token: Buffer.from(crypto.randomUUID() + crypto.randomUUID())
        .toString('hex')
        .slice(0, 64),
      unsubscribed_at:
        row.status === 'unsubscribed' ? new Date().toISOString() : null,
      bounce_count: 0,
    };
    this.rows.set(email, subscriber);
    return subscriber;
  }

  async updateSubscriber(id: string, patch: Record<string, unknown>) {
    const current = [...this.rows.values()].find((row) => row.id === id);
    if (!current) return null;
    const next: Subscriber = {
      ...current,
      ...patch,
      email: String(patch.email ?? current.email).toLowerCase(),
    };
    this.rows.delete(this.key(current.email));
    this.rows.set(this.key(next.email), next);
    return next;
  }

  async listActive() {
    return [...this.rows.values()].filter((row) => row.status === 'subscribed');
  }

  async getProfileEmail(userId: string) {
    return this.profileEmails.get(userId) ?? null;
  }

  async claimWebhookEvent(sgEventId: string) {
    if (this.claimedEvents.has(sgEventId)) return false;
    this.claimedEvents.add(sgEventId);
    return true;
  }

  seed(row: Partial<Subscriber> & { email: string; status: SubscriberStatus; source: SubscriberSource }) {
    const email = row.email.toLowerCase();
    const subscriber: Subscriber = {
      id: row.id ?? crypto.randomUUID(),
      email,
      user_id: row.user_id ?? null,
      status: row.status,
      source: row.source,
      unsubscribe_token: row.unsubscribe_token ?? Buffer.from(crypto.randomUUID()).toString('hex'),
      unsubscribed_at: row.unsubscribed_at ?? null,
      bounce_count: row.bounce_count ?? 0,
    };
    this.rows.set(email, subscriber);
    return subscriber;
  }
}

/**
 * Mirrors public.auto_subscribe_new_profile(): insert, and on email conflict
 * only update user_id when the existing row is still subscribed.
 */
async function applySignupTrigger(store: MemoryStore, email: string, userId: string) {
  const existing = await store.findByEmail(email);
  if (!existing) {
    await store.insertSubscriber({
      email,
      user_id: userId,
      status: 'subscribed',
      source: 'app_signup',
    });
    return;
  }
  if (existing.status === 'subscribed') {
    await store.updateSubscriber(existing.id, { user_id: userId });
  }
}

class MemoryLedger implements SendLedger {
  sends = new Map<string, { id: string; subject: string }>();
  recipients: Array<{ sendId: string; subscriberId: string }> = [];
  delivered: string[] = [];

  async beginSend(sendKey: string, subject: string) {
    if (this.sends.has(sendKey)) return { skipped: true as const };
    const id = crypto.randomUUID();
    this.sends.set(sendKey, { id, subject });
    return { sendId: id };
  }
  async markEligible() {}
  async recordRecipient(row: { sendId: string; subscriberId: string }) {
    this.recipients.push({ sendId: row.sendId, subscriberId: row.subscriberId });
  }
  async bumpDelivered(subscriberId: string) {
    this.delivered.push(subscriberId);
  }
  async completeSend() {}
}

let store: MemoryStore;

function reset() {
  store = new MemoryStore();
  setNewsletterStoreForTests(store);
  setSendGridWebhookVerifierForTests(null);
  resetNewsletterRateLimitForTests();
}

async function run() {
  reset();
  await test('1. unsubscribed row is not revived when a profile is created with that email', async () => {
    store.seed({
      email: 'once@example.com',
      status: 'unsubscribed',
      source: 'landing_hero',
    });
    await applySignupTrigger(store, 'once@example.com', 'user-1');
    const row = await store.findByEmail('once@example.com');
    assert.equal(row?.status, 'unsubscribed');
    assert.equal(row?.user_id, null);
  });

  reset();
  await test('2. complained row is not revived by subscribePublic or app-signup trigger', async () => {
    store.seed({
      email: 'spam@example.com',
      status: 'complained',
      source: 'landing_hero',
    });
    const publicResult = await subscribePublic({
      email: 'spam@example.com',
      source: 'landing_hero',
    });
    assert.equal(publicResult, 'suppressed');
    await applySignupTrigger(store, 'spam@example.com', 'user-2');
    const row = await store.findByEmail('spam@example.com');
    assert.equal(row?.status, 'complained');
  });

  reset();
  await test('3. setSubscriptionForUser(true) does revive an unsubscribed row', async () => {
    store.profileEmails.set('user-3', 'back@example.com');
    store.seed({
      email: 'back@example.com',
      user_id: 'user-3',
      status: 'unsubscribed',
      source: 'landing_hero',
      unsubscribed_at: new Date().toISOString(),
    });
    const result = await setSubscriptionForUser('user-3', true);
    assert.equal(result.status, 'subscribed');
    const row = await store.findByEmail('back@example.com');
    assert.equal(row?.status, 'subscribed');
  });

  reset();
  await test('4. Foo@Example.com and foo@example.com produce exactly one row (citext)', async () => {
    await subscribePublic({ email: 'Foo@Example.com', source: 'landing_hero' });
    await subscribePublic({ email: 'foo@example.com', source: 'landing_footer' });
    assert.equal(store.rows.size, 1);
    assert.equal([...store.rows.keys()][0], 'foo@example.com');
  });

  reset();
  await test('5. POST /subscribe returns a byte-identical body and status for new and existing', async () => {
    const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.10' };
    const created = await newsletterRoute.request('/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'new@example.com', source: 'landing_hero' }),
    });
    const existing = await newsletterRoute.request('/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'new@example.com', source: 'landing_hero' }),
    });
    assert.equal(created.status, 200);
    assert.equal(existing.status, 200);
    const createdBody = Buffer.from(await created.arrayBuffer());
    const existingBody = Buffer.from(await existing.arrayBuffer());
    assert.equal(createdBody.equals(existingBody), true);
    assert.equal(createdBody.toString(), '{"ok":true}');
  });

  reset();
  await test('6. GET /unsubscribe leaves status unchanged; POST changes it', async () => {
    const row = store.seed({
      email: 'prefetch@example.com',
      status: 'subscribed',
      source: 'landing_hero',
      unsubscribe_token: 'a'.repeat(64),
    });
    const getRes = await newsletterRoute.request(
      `/unsubscribe?token=${row.unsubscribe_token}`
    );
    assert.equal(getRes.status, 200);
    assert.equal((await store.findByEmail('prefetch@example.com'))?.status, 'subscribed');

    const postRes = await newsletterRoute.request(
      `/unsubscribe?token=${row.unsubscribe_token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' }
    );
    assert.equal(postRes.status, 200);
    assert.equal((await store.findByEmail('prefetch@example.com'))?.status, 'unsubscribed');
  });

  reset();
  await test('7. POST /unsubscribe with List-Unsubscribe=One-Click and no CSRF succeeds', async () => {
    const row = store.seed({
      email: 'oneclick@example.com',
      status: 'subscribed',
      source: 'landing_hero',
      unsubscribe_token: 'b'.repeat(64),
    });
    const res = await newsletterRoute.request(
      `/unsubscribe?token=${row.unsubscribe_token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }
    );
    assert.equal(res.status, 200);
    assert.equal((await store.findByEmail('oneclick@example.com'))?.status, 'unsubscribed');
  });

  reset();
  await test('8. two sends with the same sendKey deliver exactly one set of emails', async () => {
    store.seed({
      email: 'once-send@example.com',
      status: 'subscribed',
      source: 'landing_hero',
      unsubscribe_token: 'c'.repeat(64),
    });
    const ledger = new MemoryLedger();
    let chunkCalls = 0;
    const deps = {
      ledger,
      sendChunk: async () => {
        chunkCalls += 1;
        return { ok: true, messageId: 'msg-1' };
      },
    };
    const first = await sendNewsletter(
      { sendKey: 'daily-brief-2026-08-31', subject: 'Brief', html: '<p>Hi</p>' },
      deps
    );
    const second = await sendNewsletter(
      { sendKey: 'daily-brief-2026-08-31', subject: 'Brief', html: '<p>Hi</p>' },
      deps
    );
    assert.equal(first.skipped, undefined);
    assert.equal(second.skipped, true);
    assert.equal(chunkCalls, 1);
    assert.equal(ledger.recipients.length, 1);
  });

  reset();
  await test('9. getActiveSubscribers excludes every non-subscribed status', async () => {
    store.seed({ email: 'a@example.com', status: 'subscribed', source: 'landing_hero' });
    store.seed({ email: 'b@example.com', status: 'unsubscribed', source: 'landing_hero' });
    store.seed({ email: 'c@example.com', status: 'bounced', source: 'landing_hero' });
    store.seed({ email: 'd@example.com', status: 'complained', source: 'landing_hero' });
    store.seed({ email: 'e@example.com', status: 'pending', source: 'landing_hero' });
    const active = await getActiveSubscribers();
    assert.equal(active.length, 1);
    assert.equal(active[0].email, 'a@example.com');
  });

  reset();
  await test('10. two subscribers in the same request get different List-Unsubscribe tokens', async () => {
    const a = store.seed({
      email: 'a@example.com',
      status: 'subscribed',
      source: 'landing_hero',
      unsubscribe_token: 'token-aaa',
    });
    const b = store.seed({
      email: 'b@example.com',
      status: 'subscribed',
      source: 'landing_hero',
      unsubscribe_token: 'token-bbb',
    });
    const personalizations = buildPersonalizations([a, b]);
    assert.notEqual(
      personalizations[0].headers['List-Unsubscribe'],
      personalizations[1].headers['List-Unsubscribe']
    );
    assert.ok(personalizations[0].headers['List-Unsubscribe'].includes('token-aaa'));
    assert.ok(personalizations[1].headers['List-Unsubscribe'].includes('token-bbb'));
    assert.equal(personalizations[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.notEqual(
      personalizations[0].substitutions.unsubscribe_url,
      personalizations[1].substitutions.unsubscribe_url
    );
    const html = prepareSharedContent('<p>{{unsubscribe_url}}</p>');
    assert.equal(html.includes('token-aaa'), false);
    assert.ok(html.includes('{{unsubscribe_url}}'));
    assertPerRecipientUnsubscribeTokens(personalizations);
  });

  reset();
  await test('11. an unverified webhook payload is rejected without mutating any row', async () => {
    store.seed({
      email: 'keep@example.com',
      status: 'subscribed',
      source: 'landing_hero',
    });
    const res = await newsletterRoute.request('/webhook/sendgrid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { email: 'keep@example.com', event: 'spamreport', sg_event_id: 'evt-unverified' },
      ]),
    });
    assert.equal(res.status, 401);
    assert.equal((await store.findByEmail('keep@example.com'))?.status, 'subscribed');
  });

  reset();
  await test('verified spamreport webhook marks the row permanently complained', async () => {
    store.seed({
      email: 'complain@example.com',
      status: 'subscribed',
      source: 'landing_hero',
    });
    setSendGridWebhookVerifierForTests(() => true);
    const payload = JSON.stringify([
      { email: 'complain@example.com', event: 'spamreport', sg_event_id: 'evt-complaint' },
    ]);
    const res = await newsletterRoute.request('/webhook/sendgrid', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Signature': 'test-sig',
        'X-Twilio-Email-Event-Webhook-Timestamp': '1',
      },
      body: payload,
    });
    assert.equal(res.status, 200);
    assert.equal((await store.findByEmail('complain@example.com'))?.status, 'complained');
    const revived = await subscribePublic({
      email: 'complain@example.com',
      source: 'landing_footer',
    });
    assert.equal(revived, 'suppressed');
  });

  reset();
  await test('12. signature verification runs against the raw body; parse+stringify must fail', async () => {
    const raw = '[\n  {"email":"keep@example.com","event":"spamreport"}\n]';
    assert.equal(jsonRoundTripChangesBytes(raw), true);
    setSendGridWebhookVerifierForTests((_key, payload) => payload === raw);
    assert.equal(
      verifySendGridWebhookSignature('key', raw, 'sig', '1'),
      true
    );
    const roundTripped = JSON.stringify(JSON.parse(raw));
    assert.notEqual(roundTripped, raw);
    assert.equal(
      verifySendGridWebhookSignature('key', roundTripped, 'sig', '1'),
      false
    );
  });

  reset();
  await test('13. the same sg_event_id delivered twice produces one state change', async () => {
    store.seed({
      email: 'dup@example.com',
      status: 'subscribed',
      source: 'landing_hero',
      bounce_count: 0,
    });
    const events = [
      {
        email: 'dup@example.com',
        event: 'bounce',
        type: 'blocked',
        sg_event_id: 'evt-dup-1',
      },
    ];
    await processSendGridEvents(events);
    await processSendGridEvents(events);
    const row = await store.findByEmail('dup@example.com');
    assert.equal(row?.bounce_count, 1);
    assert.equal(row?.status, 'subscribed');
  });

  reset();
  await test('14. dropped Bounced Address reconciles subscribed to bounced and warns', async () => {
    store.seed({
      email: 'drift@example.com',
      status: 'subscribed',
      source: 'landing_hero',
    });
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(String(args[0]));
    };
    try {
      await processSendGridEvents([
        {
          email: 'drift@example.com',
          event: 'dropped',
          reason: 'Bounced Address',
          sg_event_id: 'evt-dropped-1',
        },
      ]);
    } finally {
      console.warn = orig;
    }
    assert.equal((await store.findByEmail('drift@example.com'))?.status, 'bounced');
    assert.ok(warns.some((line) => line.includes('sendgrid_suppression_drift')));
  });

  reset();
  await test('GET unsubscribe for a valid token does not include a mutating link in a GET', async () => {
    const row = store.seed({
      email: 'art@gmail.com',
      status: 'subscribed',
      source: 'landing_hero',
      unsubscribe_token: 'd'.repeat(64),
    });
    const res = await newsletterRoute.request(`/unsubscribe?token=${row.unsubscribe_token}`);
    const html = await res.text();
    assert.ok(html.includes('a•••@gmail.com'));
    assert.ok(html.includes('method="POST"'));
    assert.equal(html.includes('method="GET"'), false);
  });

  reset();
  await test('token resubscribe is refused for complained rows', async () => {
    const row = store.seed({
      email: 'nope@example.com',
      status: 'complained',
      source: 'landing_hero',
      unsubscribe_token: 'e'.repeat(64),
    });
    const result = await resubscribeByToken(row.unsubscribe_token);
    assert.equal(result.ok, false);
    assert.equal((await store.findByEmail('nope@example.com'))?.status, 'complained');
  });

  reset();
  await test('soft bounces increment; the third marks bounced', async () => {
    store.seed({
      email: 'soft@example.com',
      status: 'subscribed',
      source: 'landing_hero',
      bounce_count: 0,
    });
    await recordDeliveryEvent('soft@example.com', 'bounced', 'Temporary');
    await recordDeliveryEvent('soft@example.com', 'bounced', 'Temporary');
    assert.equal((await store.findByEmail('soft@example.com'))?.status, 'subscribed');
    await recordDeliveryEvent('soft@example.com', 'bounced', 'Temporary');
    assert.equal((await store.findByEmail('soft@example.com'))?.status, 'bounced');
  });

  reset();
  await test('honeypot writes nothing and still looks like success at HTTP', async () => {
    const res = await newsletterRoute.request('/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.20',
      },
      body: JSON.stringify({
        email: 'bot@example.com',
        source: 'landing_hero',
        website: 'https://spam.test',
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '{"ok":true}');
    assert.equal(store.rows.size, 0);
  });

  reset();
  await test('malformed address is the only 400 from /subscribe', async () => {
    const res = await newsletterRoute.request('/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.30',
      },
      body: JSON.stringify({ email: 'not-an-email', source: 'landing_hero' }),
    });
    assert.equal(res.status, 400);
  });

  reset();
  await test('settings GET reports unsubscribed as subscribed=false', async () => {
    store.profileEmails.set('user-9', 'off@example.com');
    store.seed({
      email: 'off@example.com',
      user_id: 'user-9',
      status: 'unsubscribed',
      source: 'settings_toggle',
    });
    const result = await getSubscriptionForUser('user-9');
    assert.equal(result.subscribed, false);
  });

  console.log(`\n${passed} tests passed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
