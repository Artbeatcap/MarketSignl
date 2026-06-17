// Push notifications: Expo send + price checks + auto-alerts from analysis.
// Massive API usage aligned with apps/backend/src/routes/marketData.ts

import type { SupabaseClient } from '@supabase/supabase-js';

const MASSIVE_BASE_URL = 'https://api.massive.com';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ============================================================================
// TYPES
// ============================================================================

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  categoryId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface PriceAlert {
  id: string;
  user_id: string;
  symbol: string;
  level_price: number;
  level_type: 'support' | 'resistance';
  level_strength: string | null;
  level_description: string | null;
  direction: 'crosses_above' | 'crosses_below' | 'either';
  status: string;
  last_known_price: number | null;
  expires_at: string;
}

interface PushToken {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: string;
  is_active: boolean;
}

/** Service-role client (no generated DB types in this package). */
export type SupabaseAdminClient = SupabaseClient;

// ============================================================================
// EXPO PUSH API
// ============================================================================

export async function sendExpoPushNotifications(
  messages: ExpoPushMessage[]
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const allTickets: ExpoPushTicket[] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        console.error(
          `[PUSH] Expo API error: ${response.status} ${response.statusText}`
        );
        allTickets.push(
          ...batch.map(() => ({
            status: 'error' as const,
            message: `HTTP ${response.status}`,
          }))
        );
        continue;
      }

      const result = (await response.json()) as { data?: ExpoPushTicket[] };
      const tickets: ExpoPushTicket[] = result.data || [];
      allTickets.push(...tickets);
    } catch (error) {
      console.error('[PUSH] Failed to send batch:', error);
      allTickets.push(
        ...batch.map(() => ({
          status: 'error' as const,
          message: String(error),
        }))
      );
    }
  }

  return allTickets;
}

export function isValidExpoPushToken(token: string): boolean {
  return (
    typeof token === 'string' &&
    (token.startsWith('ExponentPushToken[') ||
      token.startsWith('ExpoPushToken['))
  );
}

// ============================================================================
// NOTIFICATION BUILDERS
// ============================================================================

export function buildAlertNotification(
  token: string,
  alert: PriceAlert,
  currentPrice: number
): ExpoPushMessage {
  const crossed = currentPrice > alert.level_price ? 'above' : 'below';
  const levelLabel =
    alert.level_type === 'support' ? 'support' : 'resistance';
  const emoji = alert.level_type === 'resistance' ? '\u25B2' : '\u25BC';

  const priceFormatted = formatPrice(currentPrice);
  const levelFormatted = formatPrice(alert.level_price);
  const strengthPart = alert.level_strength
    ? `${alert.level_strength} `
    : '';

  return {
    to: token,
    title: `${emoji} ${alert.symbol} crossed ${levelLabel} at $${levelFormatted}`,
    body: `${alert.symbol} is now at $${priceFormatted}, trading ${crossed} the ${strengthPart}${levelLabel} level. ${alert.level_description || ''}`.trim(),
    data: {
      type: 'price_alert',
      alertId: alert.id,
      symbol: alert.symbol,
      levelPrice: alert.level_price,
      currentPrice,
      levelType: alert.level_type,
    },
    sound: 'default',
    priority: 'high',
    channelId: 'price-alerts',
  };
}

function formatPrice(price: number): string {
  if (price >= 1) {
    return price.toFixed(2);
  }
  return price.toPrecision(4);
}

// ============================================================================
// PRICE MONITORING
// ============================================================================

export async function checkPriceAlerts(
  supabase: SupabaseAdminClient
): Promise<{
  checked: number;
  triggered: number;
  notificationsSent: number;
  errors: string[];
}> {
  const result = {
    checked: 0,
    triggered: 0,
    notificationsSent: 0,
    errors: [] as string[],
  };

  try {
    const { data: alerts, error: alertsError } = await supabase
      .from('price_alerts')
      .select('*')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('symbol');

    if (alertsError) {
      result.errors.push(`Failed to fetch alerts: ${alertsError.message}`);
      return result;
    }

    if (!alerts || alerts.length === 0) {
      return result;
    }

    const symbols = [...new Set((alerts as PriceAlert[]).map((a) => a.symbol))];
    result.checked = alerts.length;

    const prices = await fetchCurrentPrices(symbols);

    if (Object.keys(prices).length === 0) {
      result.errors.push('Failed to fetch any prices');
      return result;
    }

    const triggeredAlerts: { alert: PriceAlert; currentPrice: number }[] = [];

    for (const alert of alerts as PriceAlert[]) {
      const currentPrice = prices[alert.symbol.toUpperCase()];
      if (currentPrice === undefined) continue;

      const previousPrice = alert.last_known_price;
      const crossed = hasCrossed(
        alert.level_price,
        previousPrice,
        currentPrice,
        alert.direction
      );

      if (crossed) {
        triggeredAlerts.push({ alert, currentPrice });
      }

      await supabase
        .from('price_alerts')
        .update({
          last_known_price: currentPrice,
          last_checked_at: new Date().toISOString(),
        })
        .eq('id', alert.id);
    }

    result.triggered = triggeredAlerts.length;

    if (triggeredAlerts.length > 0) {
      const sent = await sendTriggeredAlertNotifications(
        supabase,
        triggeredAlerts
      );
      result.notificationsSent = sent;
    }

    const { error: rpcError } = await supabase.rpc('expire_stale_alerts');
    if (rpcError) {
      result.errors.push(`expire_stale_alerts: ${rpcError.message}`);
    }
  } catch (error) {
    result.errors.push(`Unexpected error: ${String(error)}`);
  }

  console.log(
    `[PUSH] Check complete: ${result.checked} checked, ${result.triggered} triggered, ${result.notificationsSent} sent`
  );
  return result;
}

function hasCrossed(
  levelPrice: number,
  previousPrice: number | null,
  currentPrice: number,
  direction: 'crosses_above' | 'crosses_below' | 'either'
): boolean {
  if (previousPrice === null) {
    return false;
  }

  const wasBelow = previousPrice < levelPrice;
  const wasAbove = previousPrice > levelPrice;
  const isBelow = currentPrice < levelPrice;
  const isAbove = currentPrice > levelPrice;

  switch (direction) {
    case 'crosses_above':
      return wasBelow && isAbove;
    case 'crosses_below':
      return wasAbove && isBelow;
    case 'either':
      return (wasBelow && isAbove) || (wasAbove && isBelow);
    default:
      return false;
  }
}

async function sendTriggeredAlertNotifications(
  supabase: SupabaseAdminClient,
  triggeredAlerts: { alert: PriceAlert; currentPrice: number }[]
): Promise<number> {
  let sent = 0;

  const byUser = new Map<
    string,
    { alert: PriceAlert; currentPrice: number }[]
  >();
  for (const item of triggeredAlerts) {
    const existing = byUser.get(item.alert.user_id) || [];
    existing.push(item);
    byUser.set(item.alert.user_id, existing);
  }

  for (const [userId, userAlerts] of byUser) {
    const { data: profile } = await supabase
      .from('profiles')
      .select(
        'push_notifications_enabled, timezone, quiet_hours_start, quiet_hours_end'
      )
      .eq('id', userId)
      .single();

    if (profile && profile.push_notifications_enabled === false) {
      for (const { alert, currentPrice } of userAlerts) {
        await markAlertTriggered(supabase, alert.id, currentPrice, false);
      }
      continue;
    }

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!tokens || tokens.length === 0) {
      for (const { alert, currentPrice } of userAlerts) {
        await markAlertTriggered(supabase, alert.id, currentPrice, false);
      }
      continue;
    }

    const messages: ExpoPushMessage[] = [];
    const messageAlertMap: {
      alert: PriceAlert;
      currentPrice: number;
      token: string;
    }[] = [];

    for (const { alert, currentPrice } of userAlerts) {
      for (const tokenRow of tokens as PushToken[]) {
        if (!isValidExpoPushToken(tokenRow.expo_push_token)) continue;
        const msg = buildAlertNotification(
          tokenRow.expo_push_token,
          alert,
          currentPrice
        );
        messages.push(msg);
        messageAlertMap.push({
          alert,
          currentPrice,
          token: tokenRow.expo_push_token,
        });
      }
    }

    if (messages.length === 0) {
      for (const { alert, currentPrice } of userAlerts) {
        await markAlertTriggered(supabase, alert.id, currentPrice, false);
      }
      continue;
    }

    const tickets = await sendExpoPushNotifications(messages);

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const { alert, token } = messageAlertMap[i];
      const msg = messages[i];

      await supabase.from('notification_log').insert({
        user_id: userId,
        alert_id: alert.id,
        expo_push_token: token,
        title: msg.title,
        body: msg.body,
        data: msg.data as Record<string, unknown>,
        expo_receipt_id: ticket.id || null,
        status: ticket.status === 'ok' ? 'sent' : 'failed',
        error_message: ticket.message || null,
      });

      if (ticket.status === 'ok') {
        sent++;
      }

      if (
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
      ) {
        await supabase
          .from('push_tokens')
          .update({ is_active: false })
          .eq('expo_push_token', token);
      }
    }

    for (const { alert, currentPrice } of userAlerts) {
      await markAlertTriggered(supabase, alert.id, currentPrice, true);
    }
  }

  return sent;
}

async function markAlertTriggered(
  supabase: SupabaseAdminClient,
  alertId: string,
  triggeredPrice: number,
  notificationSent: boolean
): Promise<void> {
  await supabase
    .from('price_alerts')
    .update({
      status: 'triggered',
      triggered_at: new Date().toISOString(),
      triggered_price: triggeredPrice,
      notification_sent: notificationSent,
    })
    .eq('id', alertId);
}

// ============================================================================
// MASSIVE: latest price via recent 1-minute aggregates (same API as marketData)
// ============================================================================

async function fetchCurrentPrices(
  symbols: string[]
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  const apiKey = process.env.MASSIVE_API_KEY?.trim();

  if (!apiKey) {
    console.error('[PUSH] MASSIVE_API_KEY not set');
    return prices;
  }

  const end = Date.now();
  const start = end - 15 * 60 * 1000;

  const CONCURRENCY = 8;

  async function fetchOne(sym: string): Promise<void> {
    const upper = sym.toUpperCase();
    const url = `${MASSIVE_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(upper)}/range/1/minute/${start}/${end}?adjusted=true&sort=desc&limit=1&apiKey=${apiKey}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[PUSH] Massive aggs error for ${upper}: ${response.status}`);
        return;
      }
      const json = (await response.json()) as {
        status?: string;
        results?: { c?: number }[];
      };
      if (json.status === 'ERROR' || json.status === 'NOT_FOUND') {
        return;
      }
      const bar = json.results?.[0];
      if (bar && typeof bar.c === 'number' && Number.isFinite(bar.c)) {
        prices[upper] = bar.c;
      }
    } catch (e) {
      console.error(`[PUSH] Massive fetch failed for ${upper}:`, e);
    }
  }

  const queue = [...new Set(symbols.map((s) => s.toUpperCase()))];
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const chunk = queue.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(fetchOne));
  }

  return prices;
}

// ============================================================================
// AUTO-CREATE ALERTS FROM ANALYSIS
// ============================================================================

export async function createAlertsFromAnalysis(
  supabase: SupabaseAdminClient,
  userId: string,
  analysisId: string,
  symbol: string,
  currentPrice: number,
  supportLevels: { price: number; strength: string; description: string }[],
  resistanceLevels: { price: number; strength: string; description: string }[]
): Promise<number> {
  const eligibleSupport = supportLevels
    .filter((l) => l.strength === 'strong' || l.strength === 'medium')
    .slice(0, 3);

  const eligibleResistance = resistanceLevels
    .filter((l) => l.strength === 'strong' || l.strength === 'medium')
    .slice(0, 3);

  const sym = symbol.toUpperCase();

  const alertRows = [
    ...eligibleSupport.map((level) => ({
      user_id: userId,
      analysis_id: analysisId,
      symbol: sym,
      level_price: level.price,
      level_type: 'support' as const,
      level_strength: level.strength as 'strong' | 'medium' | 'weak',
      level_description: level.description,
      direction: 'crosses_below' as const,
      status: 'active' as const,
      last_known_price: currentPrice,
      expires_at: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
    })),
    ...eligibleResistance.map((level) => ({
      user_id: userId,
      analysis_id: analysisId,
      symbol: sym,
      level_price: level.price,
      level_type: 'resistance' as const,
      level_strength: level.strength as 'strong' | 'medium' | 'weak',
      level_description: level.description,
      direction: 'crosses_above' as const,
      status: 'active' as const,
      last_known_price: currentPrice,
      expires_at: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
    })),
  ];

  if (alertRows.length === 0) return 0;

  await supabase
    .from('price_alerts')
    .update({ status: 'disabled' })
    .eq('user_id', userId)
    .eq('symbol', sym)
    .eq('status', 'active');

  const { data, error } = await supabase
    .from('price_alerts')
    .insert(alertRows)
    .select('id');

  if (error) {
    console.error('[PUSH] Failed to create alerts:', error.message);
    return 0;
  }

  const created = data?.length || 0;
  console.log(
    `[PUSH] Created ${created} alerts for ${sym} (analysis ${analysisId})`
  );
  return created;
}
