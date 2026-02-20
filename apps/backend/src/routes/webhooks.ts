import { Hono } from 'hono';
import {
  type RevenueCatWebhookEventPayload,
  type RevenueCatEventType,
  isValidEventBody,
  logWebhookEvent,
  handleError,
  eventTypeToStatus,
  updateSubscriptionStatus,
} from '../lib/revenuecat.js';

const HANDLED_EVENT_TYPES: RevenueCatEventType[] = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
];

function verifyRevenueCatWebhook(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return false;
  const auth = c.req.header('Authorization');
  if (!auth) return false;
  // Support "Bearer <secret>" or raw "<secret>"
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
  return token === secret && token.length > 0;
}

const webhooksRoute = new Hono();

/** GET /webhooks/revenuecat/test - for connectivity/testing (no auth required) */
webhooksRoute.get('/revenuecat/test', (c) => {
  return c.json({
    ok: true,
    message: 'RevenueCat webhook endpoint is reachable',
    env_configured: !!process.env.REVENUECAT_WEBHOOK_SECRET,
    timestamp: new Date().toISOString(),
  });
});

/** POST /webhooks/revenuecat - RevenueCat webhook handler */
webhooksRoute.post('/revenuecat', async (c) => {
  if (!verifyRevenueCatWebhook(c)) {
    console.warn('[RevenueCat Webhook] Unauthorized or missing REVENUECAT_WEBHOOK_SECRET');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    console.warn('[RevenueCat Webhook] Invalid JSON body');
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!isValidEventBody(body)) {
    console.warn('[RevenueCat Webhook] Invalid event structure', { hasEvent: !!(body as any)?.event, hasType: !!(body as any)?.event?.type, hasAppUserId: !!(body as any)?.event?.app_user_id });
    return c.json({ error: 'Invalid event structure' }, 400);
  }

  const event = body as RevenueCatWebhookEventPayload;
  logWebhookEvent(event);

  const eventType = event.event.type as RevenueCatEventType;
  if (!HANDLED_EVENT_TYPES.includes(eventType)) {
    console.log('[RevenueCat Webhook] Ignoring unhandled event type:', eventType);
    return c.json({ received: true });
  }

  try {
    const status = eventTypeToStatus(eventType, event.event);
    const result = await updateSubscriptionStatus(event.event.app_user_id, status, event.event);

    if (!result.success) {
      handleError(new Error(result.error), { event, message: 'updateSubscriptionStatus failed' });
      return c.json({ error: 'Database update failed' }, 500);
    }

    return c.json({ received: true });
  } catch (err) {
    handleError(err, { event, message: 'Webhook processing failed' });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default webhooksRoute;
