// ============================================================================
// GrowthHub365 Webhook Integration
// ============================================================================
// File: apps/backend/src/lib/growthhub.ts
//
// Sends events to GrowthHub365 (HighLevel) to trigger workflows.
// Uses the "Inbound Webhook" trigger in GH365 workflows.
//
// SETUP IN GROWTHHUB365:
// 1. Go to Automation → Workflows → Create Workflow
// 2. Set trigger to "Inbound Webhook"
// 3. Copy the webhook URL it generates
// 4. Paste that URL into your .env as GROWTHHUB_WEBHOOK_URL
// ============================================================================

const GROWTHHUB_WEBHOOK_URL = process.env.GROWTHHUB_WEBHOOK_URL || '';

interface GrowthHubEvent {
  event: 'first_analysis' | 'hit_paywall' | 'subscription_activated' | 'churning';
  email: string;
  firstName?: string;
  tags: string[];
  pipelineStage?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Fire a webhook to GrowthHub365.
 * Non-blocking — logs errors but never throws (won't break the user's analysis flow).
 */
export async function sendGrowthHubEvent(event: GrowthHubEvent): Promise<void> {
  if (!GROWTHHUB_WEBHOOK_URL) {
    console.log('[GrowthHub] No webhook URL configured, skipping event:', event.event);
    return;
  }

  try {
    const payload = {
      // GrowthHub/HighLevel expects these contact fields
      email: event.email,
      first_name: event.firstName || '',
      // Custom fields — these map to GH365 custom fields or workflow variables
      event_type: event.event,
      tags: event.tags.join(','),
      pipeline_stage: event.pipelineStage || '',
      timestamp: new Date().toISOString(),
      ...event.metadata,
    };

    console.log('[GrowthHub] Sending event:', event.event, 'for:', event.email);

    const response = await fetch(GROWTHHUB_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('[GrowthHub] Webhook failed:', response.status, await response.text());
    } else {
      console.log('[GrowthHub] Event sent successfully:', event.event);
    }
  } catch (error) {
    // Never throw — webhook failure should not break the user's experience
    console.error('[GrowthHub] Webhook error (non-fatal):', error);
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS — call these from your routes
// ============================================================================

/**
 * Call when a user completes their FIRST ever analysis.
 * Triggers: "Activated" pipeline stage, activation email sequence.
 */
export async function notifyFirstAnalysis(email: string, symbol: string): Promise<void> {
  await sendGrowthHubEvent({
    event: 'first_analysis',
    email,
    tags: ['activated', `first_symbol_${symbol.toLowerCase()}`],
    pipelineStage: 'Activated',
    metadata: {
      first_analysis_symbol: symbol,
    },
  });
}

/**
 * Call when a free user hits the weekly analysis limit (3/3 used).
 * Triggers: "Hit Paywall" pipeline stage, conversion email sequence.
 */
export async function notifyPaywallHit(email: string, analysesUsed: number): Promise<void> {
  await sendGrowthHubEvent({
    event: 'hit_paywall',
    email,
    tags: ['hit_paywall'],
    pipelineStage: 'Hit Paywall',
    metadata: {
      analyses_used: analysesUsed,
    },
  });
}

/**
 * Call when a user subscribes to Pro (Stripe or RevenueCat).
 * Triggers: "Paid" pipeline stage, welcome/onboarding sequence.
 */
export async function notifySubscription(email: string, platform: string): Promise<void> {
  await sendGrowthHubEvent({
    event: 'subscription_activated',
    email,
    tags: ['paid', `platform_${platform}`],
    pipelineStage: 'Paid',
    metadata: {
      subscription_platform: platform,
    },
  });
}

