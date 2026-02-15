import { Hono } from 'hono';
import Stripe from 'stripe';
import { supabaseAdmin, getUserFromToken } from '../lib/supabase.js';
const subscriptionRoute = new Hono();

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
// Use test price when using test key (avoids "live object with test key" error)
const isTestKey = stripeSecretKey?.startsWith('sk_test_');
const stripePriceId = (isTestKey && process.env.STRIPE_PRICE_ID_TEST)
  ? process.env.STRIPE_PRICE_ID_TEST
  : process.env.STRIPE_PRICE_ID;

if (!stripeSecretKey) {
  console.warn('⚠️  STRIPE_SECRET_KEY not set. Stripe features will not work.');
}
if (stripeSecretKey && isTestKey && !stripePriceId) {
  console.warn('⚠️  Using test Stripe key but STRIPE_PRICE_ID_TEST is not set. Set it to a price ID from Stripe Dashboard (Test mode) or checkout will fail.');
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  // Stripe's TS types require the latest API version literal.
  // Using type assertion since TS types may not be updated for newer API versions
  apiVersion: '2025-12-15.clover' as any,
  typescript: true,
}) : null;

// GET /api/subscription/status - Get user's subscription status
subscriptionRoute.get('/status', async (c) => {
  console.log('[SUBSCRIPTION] Route hit - /status');
  console.log('[SUBSCRIPTION] Request details:', {
    method: c.req.method,
    path: c.req.path,
    url: c.req.url,
    hasAuth: !!c.req.header('Authorization')
  });
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: 'Missing authorization token',
      }, 401);
    }
    
    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    
    if (!userId) {
      return c.json({
        success: false,
        error: 'Invalid authorization token',
      }, 401);
    }

    // Get subscription from Supabase
    const { data: subscription, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching subscription:', error);
      return c.json({
        success: false,
        error: 'Failed to fetch subscription',
      }, 500);
    }

    if (!subscription) {
      return c.json({
        success: true,
        isActive: false,
      });
    }

    // If DB says not active, try to sync from Stripe (fixes missed webhooks)
    // Falls back to email lookup if stripe_customer_id is missing
    let resolvedSubscription = subscription;
    if (stripe && subscription.status !== 'active') {
      try {
        let stripeCustomerId = subscription.stripe_customer_id;

        // If no stripe_customer_id stored, look up customer by email
        if (!stripeCustomerId) {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('email')
            .eq('id', userId)
            .single();

          if (profile?.email) {
            const customers = await stripe.customers.list({
              email: profile.email,
              limit: 1,
            });
            if (customers.data.length > 0) {
              stripeCustomerId = customers.data[0].id;
              console.log(`[SUBSCRIPTION] Found Stripe customer by email lookup: ${stripeCustomerId}`);
            }
          }
        }

        if (stripeCustomerId) {
          const stripeSubs = await stripe.subscriptions.list({
            customer: stripeCustomerId,
            status: 'active',
            limit: 1,
          });

          if (stripeSubs.data.length > 0) {
            const sub = stripeSubs.data[0];
            const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
            await supabaseAdmin
              .from('subscriptions')
              .upsert({
                user_id: userId,
                stripe_subscription_id: sub.id,
                stripe_customer_id: customerId,
                status: 'active',
                platform: 'web',
                current_period_start: new Date((sub.current_period_start ?? 0) * 1000).toISOString(),
                current_period_end: new Date((sub.current_period_end ?? 0) * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id' });
            await supabaseAdmin
              .from('profiles')
              .update({ is_pro: true })
              .eq('id', userId);
            resolvedSubscription = {
              ...subscription,
              status: 'active',
              stripe_subscription_id: sub.id,
              stripe_customer_id: customerId,
              current_period_start: new Date((sub.current_period_start ?? 0) * 1000).toISOString(),
              current_period_end: new Date((sub.current_period_end ?? 0) * 1000).toISOString(),
            };
            console.log(`[SUBSCRIPTION] Synced paid status from Stripe for user ${userId}`);
          } else {
            console.log(`[SUBSCRIPTION] No active Stripe subs for customer ${stripeCustomerId} (user ${userId})`);
          }
        } else {
          console.log(`[SUBSCRIPTION] No Stripe customer found for user ${userId}`);
        }
      } catch (syncErr) {
        console.error('[SUBSCRIPTION] Stripe sync failed (continuing with DB state):', syncErr);
      }
    }

    // Check if subscription is active
    const now = new Date();
    const periodEnd = resolvedSubscription.current_period_end 
      ? new Date(resolvedSubscription.current_period_end) 
      : resolvedSubscription.expires_at 
        ? new Date(resolvedSubscription.expires_at) 
        : null;
    
    // For test mode Stripe keys, skip the period end check (test subscriptions may have past dates)
    let isActive = resolvedSubscription.status === 'active';
    if (!isTestKey || resolvedSubscription.platform !== 'web') {
      isActive = isActive && (!periodEnd || periodEnd > now);
    }

    return c.json({
      success: true,
      isActive,
      expiresAt: resolvedSubscription.current_period_end || resolvedSubscription.expires_at || undefined,
      currentPeriodStart: resolvedSubscription.current_period_start || undefined,
      currentPeriodEnd: resolvedSubscription.current_period_end || undefined,
      platform: resolvedSubscription.platform,
    });

  } catch (error) {
    console.error('Get subscription status error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

// POST /api/subscription/create-checkout - Create Stripe checkout session
subscriptionRoute.post('/create-checkout', async (c) => {
  try {
    if (!stripe) {
      return c.json({
        success: false,
        error: 'Stripe not configured',
      }, 500);
    }

    if (!stripePriceId) {
      return c.json({
        success: false,
        error: 'Stripe price ID not configured',
      }, 500);
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: 'Missing authorization token',
      }, 401);
    }
    
    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    
    if (!userId) {
      return c.json({
        success: false,
        error: 'Invalid authorization token',
      }, 401);
    }

    // Get user email for Stripe customer
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (!profile?.email) {
      return c.json({
        success: false,
        error: 'User email not found',
      }, 404);
    }

    // Get or create Stripe customer
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    let customerId = subscription?.stripe_customer_id;

    if (!customerId) {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: profile.email,
        metadata: {
          userId: userId,
        },
      });
      customerId = customer.id;

      // Save customer ID to subscription record (use select-then-update since UNIQUE constraint missing)
      const { data: existing } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (existing) {
        await supabaseAdmin
          .from('subscriptions')
          .update({
            stripe_customer_id: customerId,
            platform: 'web',
            status: 'free',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
      } else {
        await supabaseAdmin
          .from('subscriptions')
          .insert({
            user_id: userId,
            stripe_customer_id: customerId,
            platform: 'web',
            status: 'free',
          });
      }
    }

    // Get the base URL for redirects
    const origin = c.req.header('Origin') || c.req.header('Referer') || 'http://localhost:19006';
    const baseUrl = origin.replace(/\/$/, ''); // Remove trailing slash

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${baseUrl}/premium?success=true`,
      cancel_url: `${baseUrl}/premium?canceled=true`,
      metadata: {
        userId: userId,
      },
      subscription_data: {
        metadata: {
          userId: userId,
        },
      },
    });

    const checkoutUrl = session.url;
    if (!checkoutUrl || typeof checkoutUrl !== 'string') {
      console.error('[SUBSCRIPTION] Stripe returned no checkout URL for session:', session.id);
      return c.json({
        success: false,
        error: 'Checkout session has no URL',
      }, 500);
    }

    return c.json({
      success: true,
      checkoutUrl,
    });

  } catch (error: any) {
    console.error('Create checkout error:', error);
    console.error('[SUBSCRIPTION] Stripe raw error:', { code: error?.code, message: error?.message });
    const msg = error?.message ?? '';
    const isTestLiveMismatch =
      error?.code === 'resource_missing' ||
      (typeof msg === 'string' && msg.includes('live mode') && msg.includes('test mode'));
    const errorMessage = isTestLiveMismatch
      ? 'Stripe test/live mismatch: use a test price ID (from Stripe Dashboard in Test mode) with your test secret key.'
      : (error instanceof Error ? error.message : 'Internal server error');
    return c.json({
      success: false,
      error: errorMessage,
    }, 500);
  }
});

// POST /api/subscription/webhook - Handle Stripe webhooks
// Stripe sends to the URL configured in Dashboard (Developers → Webhooks). That URL must
// be reachable by Stripe and this server must have STRIPE_WEBHOOK_SECRET set for that endpoint.
// For local testing: use "stripe listen --forward-to localhost:4000/api/subscription/webhook"
// and put the CLI's whsec_ in .env; otherwise Stripe will only call your production URL.
subscriptionRoute.post('/webhook', async (c) => {
  try {
    if (!stripe || !stripeWebhookSecret) {
      console.error('[WEBHOOK] Rejected: STRIPE_WEBHOOK_SECRET (or Stripe) not configured on this server');
      return c.json({
        success: false,
        error: 'Stripe webhook not configured',
      }, 500);
    }

    // Get raw body for webhook signature verification (must be raw, not parsed)
    const body = await c.req.text();
    const signature = c.req.header('stripe-signature');

    if (!signature) {
      console.error('[WEBHOOK] Rejected: missing stripe-signature header');
      return c.json({
        success: false,
        error: 'Missing stripe-signature header',
      }, 400);
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, stripeWebhookSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WEBHOOK] Signature verification failed:', msg);
      // "No signatures found matching the payload" = wrong secret or body was modified (e.g. wrong endpoint's secret)
      return c.json({
        success: false,
        error: 'Invalid signature',
        detail: process.env.NODE_ENV === 'development' ? msg : undefined,
      }, 400);
    }

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;

        if (!userId) {
          console.error('No userId in checkout session metadata');
          break;
        }

        // Get subscription details
        const subscriptionId = typeof session.subscription === 'string' 
          ? session.subscription 
          : session.subscription?.id;

        if (!subscriptionId) {
          console.error('No subscription ID in checkout session');
          break;
        }

        const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as any;
        const customerId = typeof subscription.customer === 'string' 
          ? subscription.customer 
          : subscription.customer.id;

        // Update subscription in Supabase
        await supabaseAdmin
          .from('subscriptions')
          .upsert({
            user_id: userId,
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            status: subscription.status === 'active' ? 'active' : 'free',
            platform: 'web',
            current_period_start: new Date(((subscription as any).current_period_start ?? 0) * 1000).toISOString(),
            current_period_end: new Date(((subscription as any).current_period_end ?? 0) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });

        // Update profiles.is_pro
        await supabaseAdmin
          .from('profiles')
          .update({ is_pro: subscription.status === 'active' })
          .eq('id', userId);

        console.log(`Subscription activated for user ${userId}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.error('No userId in subscription metadata');
          break;
        }

        const customerId = typeof subscription.customer === 'string' 
          ? subscription.customer 
          : subscription.customer.id;

        // Determine status
        let status: 'active' | 'cancelled' | 'expired' = 'active';
        if (subscription.status === 'canceled' || subscription.cancel_at_period_end) {
          status = 'cancelled';
        } else if (subscription.status === 'unpaid' || subscription.status === 'past_due') {
          status = 'expired';
        }

        // Update subscription in Supabase
        await supabaseAdmin
          .from('subscriptions')
          .upsert({
            user_id: userId,
            stripe_subscription_id: subscription.id,
            stripe_customer_id: customerId,
            status,
            platform: 'web',
            current_period_start: new Date(((subscription as any).current_period_start ?? 0) * 1000).toISOString(),
            current_period_end: new Date(((subscription as any).current_period_end ?? 0) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });

        // Update profiles.is_pro
        await supabaseAdmin
          .from('profiles')
          .update({ is_pro: status === 'active' })
          .eq('id', userId);

        console.log(`Subscription updated for user ${userId}: ${status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.error('No userId in subscription metadata');
          break;
        }

        // Update subscription status to expired
        await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'expired',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);

        // Update profiles.is_pro
        await supabaseAdmin
          .from('profiles')
          .update({ is_pro: false })
          .eq('id', userId);

        console.log(`Subscription deleted for user ${userId}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return c.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

// POST /api/subscription/customer-portal - Create Stripe Customer Portal session
subscriptionRoute.post('/customer-portal', async (c) => {
  try {
    if (!stripe) {
      return c.json({
        success: false,
        error: 'Stripe not configured',
      }, 500);
    }

    // Get authenticated user from Authorization header
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: 'Missing or invalid authorization header',
      }, 401);
    }
    
    const token = authHeader.slice(7);
    const userId = await getUserFromToken(token);
    
    if (!userId) {
      return c.json({
        success: false,
        error: 'Unauthorized',
      }, 401);
    }

    // Get user's Stripe customer ID from subscriptions table
    const { data: subscription, error } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (error || !subscription?.stripe_customer_id) {
      return c.json({
        success: false,
        error: 'No subscription found',
      }, 404);
    }

    // Get return URL from request or default
    const origin = c.req.header('Origin') || c.req.header('Referer') || 'http://localhost:8081';
    const baseUrl = origin.replace(/\/$/, '');
    const returnUrl = `${baseUrl}/premium`;

    // Create Customer Portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: returnUrl,
    });

    return c.json({
      success: true,
      url: session.url,
    });

  } catch (error) {
    console.error('Customer portal error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});

export default subscriptionRoute;
