# Production Stripe & Subscriptions Check

Use this checklist to verify a production Stripe subscription setup without
recording live credentials, server addresses, or deployment-specific paths in
the repository.

## 1. Stripe Environment Variables

| Variable | Expected value | Mode |
|----------|----------------|------|
| `STRIPE_SECRET_KEY` | `sk_live_...redacted` | Live |
| `STRIPE_PRICE_ID` | `price_...` | Live |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...redacted` | Live webhook signing secret |
| `STRIPE_PRICE_ID_TEST` | Empty or unset | Production only |

Confirm these values in the production secret store or environment management
tool. Do not paste live keys, price IDs, webhook secrets, server paths, or
verification output into committed docs.

## 2. Verify Stripe Mode Alignment

In the Stripe Dashboard, switch to Live mode and confirm that:

- The configured price ID exists in the Product catalog.
- The active webhook endpoint is a Live endpoint.
- The backend secret key, price ID, and webhook signing secret all come from
  the same Stripe mode.

## 3. Why You Might Still See "Test/Live Mismatch"

The backend maps any Stripe error with `code === 'resource_missing'` or a
message containing both "live mode" and "test mode" to the same user-facing
message. The underlying Stripe error may be a different missing resource.

To diagnose it safely:

- Reproduce the checkout failure.
- Review backend logs through the approved production logging system.
- Look for `Create checkout error:` or `[SUBSCRIPTION]`.
- Record only non-sensitive fields such as `error.code`, `error.type`, and a
  redacted `error.message`.

## 4. Restart Backend After Secret Changes

After updating production Stripe settings, restart or redeploy the backend using
the approved deployment process for the environment. Avoid committing exact
server names, IP addresses, usernames, SSH commands, or deployment paths.

## 5. Changing the Live Price ID

Get the ID from Stripe Dashboard, in Live mode, under Product catalog. Update
the production environment through the approved secret-management workflow, then
redeploy or restart the backend.

## 6. Supabase: Check Subscription State

- Go to [Supabase Dashboard](https://supabase.com/dashboard), then open your
  project's Table Editor.
- Open the `subscriptions` table.
- Find the row for the affected `user_id`.
- Check `status`, `stripe_subscription_id`, `stripe_customer_id`, and
  `platform`.

If payment succeeded but the account remains free, check the Stripe Dashboard
for recent webhook delivery failures and correlate them with redacted backend
logs.
