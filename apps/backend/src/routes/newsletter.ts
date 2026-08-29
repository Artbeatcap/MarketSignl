import { Hono } from 'hono';
import { getUserFromToken } from '../lib/supabase.js';
import {
  getSubscriberByToken,
  getSubscriptionForUser,
  resubscribeByToken,
  setSubscriptionForUser,
  subscribePublic,
  unsubscribeByToken,
} from '../lib/newsletter.js';
import {
  consumeNewsletterRateLimit,
} from '../lib/newsletterRateLimit.js';
import {
  maskEmail,
  renderResubscribeConfirmPage,
  renderResubscribedPage,
  renderUnsubscribeConfirmPage,
  renderUnsubscribedPage,
} from '../lib/newsletterPages.js';
import { sendNewsletter } from '../lib/newsletterSend.js';
import {
  parseResendWebhookPayload,
  verifyResendWebhookSignature,
} from '../lib/newsletterWebhook.js';
import { recordDeliveryEvent } from '../lib/newsletter.js';
import { getPublicApiUrl } from '../lib/newsletterSend.js';

const newsletterRoute = new Hono();

const IDENTICAL_OK = { ok: true as const };

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return c.req.header('x-real-ip') || 'unknown';
}

function unsubscribeActionUrl(token: string, action?: 'resubscribe'): string {
  const base = `${getPublicApiUrl()}/api/newsletter/unsubscribe`;
  const params = new URLSearchParams({ token });
  if (action) params.set('action', action);
  return `${base}?${params.toString()}`;
}

async function requireUser(
  c: {
    req: { header: (name: string) => string | undefined };
    json: (body: unknown, status?: number) => Response;
  }
): Promise<string | Response> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing authorization token' }, 401);
  }
  const userId = await getUserFromToken(authHeader.slice(7));
  if (!userId) {
    return c.json({ success: false, error: 'Invalid authorization token' }, 401);
  }
  return userId;
}

async function readUnsubscribeRequest(c: {
  req: {
    query: (name: string) => string | undefined;
    header: (name: string) => string | undefined;
    parseBody: () => Promise<Record<string, unknown>>;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  };
}): Promise<{ token: string; action: string; oneClick: boolean }> {
  const queryToken = c.req.query('token') ?? '';
  const queryAction = c.req.query('action') ?? '';
  const contentType = (c.req.header('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      token: String(body.token || queryToken),
      action: String(body.action || queryAction),
      oneClick: false,
    };
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const body = await c.req.parseBody();
    return {
      token: String(body.token || queryToken || ''),
      action: String(body.action || queryAction || ''),
      oneClick: String(body['List-Unsubscribe'] || '') === 'One-Click',
    };
  }

  const raw = await c.req.text();
  const params = new URLSearchParams(raw);
  return {
    token: params.get('token') || queryToken,
    action: params.get('action') || queryAction,
    oneClick: params.get('List-Unsubscribe') === 'One-Click' || raw.trim() === 'List-Unsubscribe=One-Click',
  };
}

newsletterRoute.post('/subscribe', async (c) => {
  const limit = consumeNewsletterRateLimit(clientIp(c));
  if (!limit.allowed) {
    return c.json(IDENTICAL_OK, 429);
  }

  let body: {
    email?: string;
    source?: string;
    website?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid_email' }, 400);
  }

  const source =
    body.source === 'landing_footer' || body.source === 'landing_hero'
      ? body.source
      : null;
  if (!source) {
    return c.json({ ok: false, error: 'invalid_email' }, 400);
  }

  const result = await subscribePublic({
    email: body.email ?? '',
    source,
    website: body.website,
    ip: clientIp(c),
    userAgent: c.req.header('user-agent'),
  });

  if (result === 'invalid') {
    return c.json({ ok: false, error: 'invalid_email' }, 400);
  }

  return c.json(IDENTICAL_OK, 200);
});

newsletterRoute.get('/unsubscribe', async (c) => {
  const token = c.req.query('token') ?? '';
  const action = c.req.query('action') ?? '';
  const subscriber = await getSubscriberByToken(token);

  if (action === 'resubscribe') {
    if (!subscriber) {
      return c.html(
        renderUnsubscribeConfirmPage({
          actionUrl: unsubscribeActionUrl(token),
          token,
          valid: false,
        }),
        200
      );
    }
    return c.html(
      renderResubscribeConfirmPage({
        actionUrl: unsubscribeActionUrl(token, 'resubscribe'),
      }),
      200
    );
  }

  return c.html(
    renderUnsubscribeConfirmPage({
      actionUrl: unsubscribeActionUrl(token),
      token,
      maskedEmail: subscriber ? maskEmail(subscriber.email) : undefined,
      valid: !!subscriber,
    }),
    200
  );
});

newsletterRoute.post('/unsubscribe', async (c) => {
  const { token, action, oneClick } = await readUnsubscribeRequest(c);

  if (action === 'resubscribe') {
    const result = await resubscribeByToken(token);
    if (!result.ok) {
      return c.html(
        renderUnsubscribeConfirmPage({
          actionUrl: unsubscribeActionUrl(token),
          token,
          valid: false,
        }),
        200
      );
    }
    return c.html(renderResubscribedPage(), 200);
  }

  const result = await unsubscribeByToken(
    token,
    oneClick ? 'one_click' : 'email_link'
  );

  return c.html(
    renderUnsubscribedPage({
      resubscribeUrl: unsubscribeActionUrl(token, 'resubscribe'),
      maskedEmail: result.email ? maskEmail(result.email) : undefined,
    }),
    200
  );
});

newsletterRoute.post('/send', async (c) => {
  const secret = process.env.NEWSLETTER_API_SECRET;
  if (!secret) {
    return c.json({ success: false, error: 'Newsletter API not configured' }, 503);
  }
  if (c.req.header('x-newsletter-key') !== secret) {
    return c.json({ success: false, error: 'unauthorized' }, 401);
  }

  let body: { sendKey?: string; subject?: string; html?: string; text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  if (!body.sendKey || !body.subject || !body.html) {
    return c.json(
      { success: false, error: 'sendKey, subject, and html are required' },
      400
    );
  }

  try {
    const result = await sendNewsletter({
      sendKey: body.sendKey,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });
    return c.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed';
    console.error('[newsletter] send error:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

newsletterRoute.post('/webhook/resend', async (c) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const payload = await c.req.text();
  const verified = verifyResendWebhookSignature({
    payload,
    secret: secret || '',
    svixId: c.req.header('svix-id'),
    svixTimestamp: c.req.header('svix-timestamp'),
    svixSignature: c.req.header('svix-signature'),
  });

  if (!secret || !verified) {
    console.warn('[newsletter] unverified webhook rejected');
    return c.json({ error: 'unauthorized' }, 401);
  }

  const event = parseResendWebhookPayload(payload);
  if (!event?.type) {
    return c.json({ received: true });
  }

  const recipients = event.data?.to ?? [];
  if (event.type === 'email.complained') {
    for (const email of recipients) {
      await recordDeliveryEvent(email, 'complained');
    }
  } else if (event.type === 'email.bounced') {
    const bounceType = event.data?.bounce?.type;
    for (const email of recipients) {
      await recordDeliveryEvent(email, 'bounced', bounceType);
    }
  }

  return c.json({ received: true });
});

export const userNewsletterHandlers = {
  async get(c: {
    req: { header: (name: string) => string | undefined };
    json: (body: unknown, status?: number) => Response;
  }) {
    const userId = await requireUser(c);
    if (typeof userId !== 'string') return userId;
    const result = await getSubscriptionForUser(userId);
    return c.json({ success: true, subscribed: result.subscribed, status: result.status });
  },

  async put(c: {
    req: {
      header: (name: string) => string | undefined;
      json: () => Promise<unknown>;
    };
    json: (body: unknown, status?: number) => Response;
  }) {
    const userId = await requireUser(c);
    if (typeof userId !== 'string') return userId;

    let body: { subscribed?: unknown };
    try {
      body = (await c.req.json()) as { subscribed?: unknown };
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    if (typeof body.subscribed !== 'boolean') {
      return c.json({ success: false, error: 'subscribed must be a boolean' }, 400);
    }

    const result = await setSubscriptionForUser(userId, body.subscribed);
    return c.json({ success: true, subscribed: result.status === 'subscribed', status: result.status });
  },
};

export default newsletterRoute;
export { requireUser };
