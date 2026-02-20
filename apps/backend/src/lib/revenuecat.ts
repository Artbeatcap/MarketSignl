/**
 * RevenueCat webhook types and helpers.
 * See: https://www.revenuecat.com/docs/webhooks
 */

import { supabaseAdmin } from './supabase.js';

// --- Event types from RevenueCat ---
export type RevenueCatEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'PRODUCT_CHANGE'
  | 'CANCELLATION'
  | 'EXPIRATION'
  | 'BILLING_ISSUE';

export type RevenueCatStore = 'PLAY_STORE' | 'APP_STORE';
export type RevenueCatEnvironment = 'SANDBOX' | 'PRODUCTION';

export interface RevenueCatWebhookEventPayload {
  api_version?: string;
  event: {
    type: RevenueCatEventType;
    app_user_id: string;
    product_id?: string;
    purchased_at_ms?: number;
    expiration_at_ms?: number;
    store?: RevenueCatStore;
    is_trial_period?: boolean;
    original_transaction_id?: string;
    environment?: RevenueCatEnvironment;
    original_purchase_date_ms?: number;
    cancellation_date_ms?: number;
    billing_issues_detected_at_ms?: number;
    [key: string]: unknown;
  };
}

export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'grace_period' | 'free';
export type SubscriptionStore = 'play_store' | 'app_store';

/** Map RevenueCat event type + context to our subscription status */
export function eventTypeToStatus(
  eventType: RevenueCatEventType,
  _event: RevenueCatWebhookEventPayload['event']
): SubscriptionStatus {
  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
      return 'active';
    case 'CANCELLATION':
      // Still active until expiration
      return 'active';
    case 'EXPIRATION':
      return 'expired';
    case 'BILLING_ISSUE':
      return 'grace_period';
    default:
      return 'active';
  }
}

/** Map RevenueCat store to our enum */
export function mapStore(store?: RevenueCatStore): SubscriptionStore | null {
  if (!store) return null;
  if (store === 'PLAY_STORE') return 'play_store';
  if (store === 'APP_STORE') return 'app_store';
  return null;
}

/** Map RevenueCat platform to our subscriptions.platform */
export function mapPlatform(store?: RevenueCatStore): 'ios' | 'android' | null {
  if (!store) return null;
  if (store === 'APP_STORE') return 'ios';
  if (store === 'PLAY_STORE') return 'android';
  return null;
}

/** Validate minimal webhook event structure */
export function isValidEventBody(body: unknown): body is RevenueCatWebhookEventPayload {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (!b.event || typeof b.event !== 'object') return false;
  const e = b.event as Record<string, unknown>;
  return typeof e.type === 'string' && typeof e.app_user_id === 'string';
}

/** Log webhook event for debugging (no PII in production logs if needed) */
export function logWebhookEvent(event: RevenueCatWebhookEventPayload): void {
  const e = event.event;
  console.log('[RevenueCat Webhook]', {
    type: e.type,
    app_user_id: e.app_user_id?.substring(0, 8) + '…',
    product_id: e.product_id,
    store: e.store,
    environment: e.environment,
    purchased_at_ms: e.purchased_at_ms,
    expiration_at_ms: e.expiration_at_ms,
  });
}

/** Centralized error handling with logging */
export function handleError(error: unknown, context: { event?: RevenueCatWebhookEventPayload; message?: string }): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error('[RevenueCat Webhook Error]', context.message ?? err.message, {
    eventType: context.event?.event?.type,
    app_user_id: context.event?.event?.app_user_id?.substring(0, 8) + '…',
    stack: err.stack,
  });
}

/** Idempotency: we use upsert on user_id so duplicate events just overwrite. */
export async function updateSubscriptionStatus(
  revenuecatUserId: string,
  status: SubscriptionStatus,
  eventData: RevenueCatWebhookEventPayload['event']
): Promise<{ success: boolean; error?: string }> {
  const productId = eventData.product_id ?? null;
  const purchasedAtMs = eventData.purchased_at_ms ?? eventData.original_purchase_date_ms;
  const expirationAtMs = eventData.expiration_at_ms;
  const originalPurchaseDateMs = eventData.original_purchase_date_ms ?? purchasedAtMs;
  const store = mapStore(eventData.store ?? undefined);
  const platform = mapPlatform(eventData.store ?? undefined);
  const isSandbox = eventData.environment === 'SANDBOX';
  const cancellationDateMs = eventData.cancellation_date_ms ?? null;
  const billingIssuesDetectedAtMs = eventData.billing_issues_detected_at_ms ?? null;

  // app_user_id is typically the Supabase user UUID when you set it in the app
  const userId = revenuecatUserId;

  const row = {
    user_id: userId,
    revenuecat_subscriber_id: revenuecatUserId,
    status,
    product_id: productId,
    platform: platform ?? 'android', // fallback for unknown store
    current_period_start: purchasedAtMs ? new Date(purchasedAtMs).toISOString() : null,
    current_period_end: expirationAtMs ? new Date(expirationAtMs).toISOString() : null,
    expires_at: expirationAtMs ? new Date(expirationAtMs).toISOString() : null,
    purchase_date: purchasedAtMs ? new Date(purchasedAtMs).toISOString() : null,
    original_purchase_date: originalPurchaseDateMs ? new Date(originalPurchaseDateMs).toISOString() : null,
    store,
    is_sandbox: isSandbox,
    cancellation_date: cancellationDateMs ? new Date(cancellationDateMs).toISOString() : null,
    billing_issues_detected_at: billingIssuesDetectedAtMs ? new Date(billingIssuesDetectedAtMs).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from('subscriptions').upsert(row, {
    onConflict: 'user_id',
  });

  if (error) {
    handleError(error, { event: { event: eventData }, message: 'Supabase upsert failed' });
    return { success: false, error: error.message };
  }

  // Sync profiles.is_pro for consistent UX
  const isPro = status === 'active';
  await supabaseAdmin.from('profiles').update({ is_pro: isPro }).eq('id', userId);

  return { success: true };
}
