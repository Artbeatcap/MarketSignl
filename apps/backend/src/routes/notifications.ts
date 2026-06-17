// Push notification registration, alerts CRUD, cron price check.
// Mount: app.route('/api/notifications', notificationRoutes)

import { Hono } from 'hono';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
import {
  isValidExpoPushToken,
  checkPriceAlerts,
} from '../services/pushNotificationService.js';

const notificationRoutes = new Hono();

async function getUserId(c: { req: { header: (name: string) => string | undefined } }): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return getUserFromToken(token);
}

// POST /register-token
notificationRoutes.post('/register-token', async (c) => {
  const userId = await getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let body: { token?: string; platform?: string; deviceId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const { token, platform, deviceId } = body;

  if (!token || !isValidExpoPushToken(token)) {
    return c.json(
      { success: false, error: 'Invalid Expo push token' },
      400
    );
  }

  if (!platform || !['ios', 'android'].includes(platform)) {
    return c.json(
      { success: false, error: 'Platform must be ios or android' },
      400
    );
  }

  const { data, error } = await supabaseAdmin
    .from('push_tokens')
    .upsert(
      {
        user_id: userId,
        expo_push_token: token,
        platform,
        device_id: deviceId || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,expo_push_token' }
    )
    .select('id')
    .single();

  if (error) {
    console.error('[PUSH] Token registration error:', error.message);
    return c.json(
      { success: false, error: 'Failed to register token' },
      500
    );
  }

  return c.json({ success: true, tokenId: data?.id });
});

// DELETE /unregister-token
notificationRoutes.delete('/unregister-token', async (c) => {
  const userId = await getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let body: { token?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const { token } = body;
  if (!token) {
    return c.json({ success: false, error: 'Token required' }, 400);
  }

  await supabaseAdmin
    .from('push_tokens')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('expo_push_token', token);

  return c.json({ success: true });
});

// GET /alerts
notificationRoutes.get('/alerts', async (c) => {
  const userId = await getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const status = c.req.query('status');

  let query = supabaseAdmin
    .from('price_alerts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ success: false, error: error.message }, 500);
  }

  return c.json({ success: true, alerts: data });
});

// POST /alerts
notificationRoutes.post('/alerts', async (c) => {
  const userId = await getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let body: {
    symbol?: string;
    levelPrice?: number;
    levelType?: string;
    direction?: string;
    levelDescription?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const { symbol, levelPrice, levelType, direction, levelDescription } = body;

  if (!symbol || levelPrice == null || !levelType) {
    return c.json(
      {
        success: false,
        error: 'symbol, levelPrice, and levelType are required',
      },
      400
    );
  }

  if (levelType !== 'support' && levelType !== 'resistance') {
    return c.json(
      { success: false, error: 'levelType must be support or resistance' },
      400
    );
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_pro')
    .eq('id', userId)
    .single();

  const { count } = await supabaseAdmin
    .from('price_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'active');

  const limit = profile?.is_pro ? 50 : 5;
  if ((count || 0) >= limit) {
    return c.json(
      {
        success: false,
        error: `Alert limit reached (${limit}). ${profile?.is_pro ? '' : 'Upgrade to Pro for more alerts.'}`,
      },
      429
    );
  }

  const dir =
    direction === 'crosses_above' ||
    direction === 'crosses_below' ||
    direction === 'either'
      ? direction
      : 'either';

  const { data, error } = await supabaseAdmin
    .from('price_alerts')
    .insert({
      user_id: userId,
      symbol: symbol.toUpperCase(),
      level_price: levelPrice,
      level_type: levelType,
      level_description: levelDescription || null,
      direction: dir,
      status: 'active',
      expires_at: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[PUSH] Create alert error:', error.message);
    return c.json({ success: false, error: 'Failed to create alert' }, 500);
  }

  return c.json({ success: true, alert: data });
});

// DELETE /alerts/:id
notificationRoutes.delete('/alerts/:id', async (c) => {
  const userId = await getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const alertId = c.req.param('id');
  const { error } = await supabaseAdmin
    .from('price_alerts')
    .update({ status: 'disabled' })
    .eq('id', alertId)
    .eq('user_id', userId);

  if (error) {
    return c.json({ success: false, error: error.message }, 500);
  }

  return c.json({ success: true });
});

// PUT /alerts/:id
notificationRoutes.put('/alerts/:id', async (c) => {
  const userId = await getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let body: { status?: 'active' | 'disabled' };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const status = body.status;
  if (status !== 'active' && status !== 'disabled') {
    return c.json(
      { success: false, error: 'status must be active or disabled' },
      400
    );
  }

  const { data, error } = await supabaseAdmin
    .from('price_alerts')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', c.req.param('id'))
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();

  if (error) {
    return c.json({ success: false, error: error.message }, 500);
  }

  if (!data) {
    return c.json({ success: false, error: 'Alert not found' }, 404);
  }

  return c.json({ success: true, alert: data });
});

// PUT /preferences
notificationRoutes.put('/preferences', async (c) => {
  const userId = await getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let body: {
    pushEnabled?: boolean;
    soundEnabled?: boolean;
    timezone?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const updates: Record<string, unknown> = {};
  if (body.pushEnabled !== undefined) {
    updates.push_notifications_enabled = body.pushEnabled;
  }
  if (body.soundEnabled !== undefined) {
    updates.alert_sound_enabled = body.soundEnabled;
  }
  if (body.timezone) {
    updates.timezone = body.timezone;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ success: false, error: 'No updates provided' }, 400);
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  if (error) {
    return c.json({ success: false, error: error.message }, 500);
  }

  return c.json({ success: true });
});

// POST /check-prices (n8n cron)
notificationRoutes.post('/check-prices', async (c) => {
  const cronSecret = c.req.header('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || cronSecret !== expectedSecret) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const result = await checkPriceAlerts(supabaseAdmin);
  return c.json({ success: true, ...result });
});

// GET /history
notificationRoutes.get('/history', async (c) => {
  const userId = await getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const limit = Math.min(Number(c.req.query('limit') || 20), 50);
  const offset = Number(c.req.query('offset') || 0);

  const { data, error } = await supabaseAdmin
    .from('notification_log')
    .select('id, title, body, data, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return c.json({ success: false, error: error.message }, 500);
  }

  return c.json({ success: true, notifications: data });
});

export default notificationRoutes;
