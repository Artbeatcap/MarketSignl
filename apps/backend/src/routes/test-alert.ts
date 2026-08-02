// Same-day, market-independent verification of the mobile push pipe.
// Proves Link 2 (token registered) + Link 3 (Expo → APNs/FCM delivers).
// Blast radius = authenticated user only.

import { Hono } from 'hono';
import { getUserFromToken, supabaseAdmin } from '../lib/supabase.js';
import { isValidExpoPushToken } from '../services/pushNotificationService.js';

const route = new Hono();

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';

const TEST_TITLE = 'ChartSignl test alert';
const TEST_BODY =
  'If you can see this, your push pipe works end-to-end.';

route.post('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing authorization token' }, 401);
  }

  const userId = await getUserFromToken(authHeader.slice(7));
  if (!userId) {
    return c.json({ success: false, error: 'Invalid authorization token' }, 401);
  }

  const { data: tokens, error: tokenErr } = await supabaseAdmin
    .from('push_tokens')
    .select('expo_push_token, platform, is_active, updated_at')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (tokenErr) {
    return c.json(
      { success: false, error: `push_tokens query failed: ${tokenErr.message}` },
      500
    );
  }

  const expoTokens = (tokens ?? [])
    .map((t) => t.expo_push_token)
    .filter((t): t is string => typeof t === 'string' && isValidExpoPushToken(t));

  if (expoTokens.length === 0) {
    return c.json({
      success: false,
      link2_tokenRegistered: false,
      error:
        'No active Expo push token for this user. Open the native iOS/Android app on a ' +
        'real device and allow notifications, then retry. (Simulators never receive push.)',
      rowsFound: tokens?.length ?? 0,
    });
  }

  const messages = expoTokens.map((to) => ({
    to,
    sound: 'default' as const,
    priority: 'high' as const,
    title: TEST_TITLE,
    body: TEST_BODY,
    data: {
      type: 'alert_test',
      symbol: 'SPY',
      route: '/(tabs)/analyze?symbol=SPY',
    },
    channelId: 'price-alerts',
  }));

  let tickets: Array<{
    status?: string;
    id?: string;
    message?: string;
    details?: { error?: string };
  }> = [];

  try {
    const res = await fetch(EXPO_SEND, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(messages),
    });
    const json = (await res.json()) as { data?: typeof tickets };
    tickets = json?.data ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: `Expo send failed: ${msg}` }, 502);
  }

  const ticketIds = tickets
    .filter((t) => t?.status === 'ok' && t?.id)
    .map((t) => t.id as string);

  let receipts: Record<string, unknown> = {};
  if (ticketIds.length > 0) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(EXPO_RECEIPTS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ ids: ticketIds }),
      });
      const json = (await res.json()) as { data?: Record<string, unknown> };
      receipts = json?.data ?? {};
    } catch {
      /* best-effort */
    }
  }

  try {
    await supabaseAdmin.from('notification_log').insert(
      expoTokens.map((tok) => ({
        user_id: userId,
        expo_push_token: tok,
        title: TEST_TITLE,
        body: TEST_BODY,
        data: { type: 'alert_test', symbol: 'SPY' },
        status: 'sent',
      }))
    );
  } catch {
    /* ignore log failures */
  }

  const accepted = tickets.filter((t) => t?.status === 'ok').length;
  const rejected = tickets.filter((t) => t?.status === 'error');

  return c.json({
    success: accepted > 0,
    link2_tokenRegistered: true,
    tokensTried: expoTokens.length,
    expoAccepted: accepted,
    expoRejected: rejected,
    receipts,
    interpretation:
      accepted === 0
        ? 'Expo rejected the token outright — token invalid or app/credentials misconfigured.'
        : 'Expo accepted. Read `receipts`: all "ok" = Apple/Google delivered. Any "error" ' +
          '= push-credential problem (APNs key / FCM), not alert logic.',
  });
});

export default route;
