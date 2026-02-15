# Production Stripe & Subscriptions Check (167.88.43.61)

## 1. Stripe env vars on server (checked via SSH)

| Variable | Value (masked) | Mode |
|----------|----------------|------|
| STRIPE_SECRET_KEY | sk_live_51Sr6o1... | **Live** ✓ |
| STRIPE_PRICE_ID | price_1SrAbZPN7GMa1AwYlHPzq9hO | **Live** ✓ (verified via Stripe API: `livemode: true`) |
| STRIPE_WEBHOOK_SECRET | whsec_... | Set (use Live webhook endpoint in Dashboard) |
| STRIPE_PRICE_ID_TEST | (empty) | N/A (correct for production) |

**Backend loads env from:** `/root/ChartSignl/.env`. The deploy script sources `../../../.env` before running `docker-compose`, so the running container gets these values. Verified inside container with `docker-compose exec chartsignl-api printenv | grep STRIPE`.

**Stripe API check:** Listed prices with the server’s live key; the price ID above is returned with `"livemode": true`, so key and price are in the same (live) mode.

## 2. Why you might still see "test/live mismatch"

The backend maps *any* Stripe error that has `code === 'resource_missing'` **or** message containing both "live mode" and "test mode" to the same user-facing message. So the **real** Stripe error might be different (e.g. another resource missing). To see the actual error:

- Reproduce the 500 (POST to create-checkout from chartsignl.com/premium).
- On the server run:  
  `docker-compose -f /root/ChartSignl/apps/backend/deploy/docker-compose.yml logs --tail=100 chartsignl-api`  
  and look for `Create checkout error:` or `[SUBSCRIPTION]` — the next line usually has the raw Stripe error.

If you want this in the codebase, we can add a log line in the create-checkout catch that logs `error?.code` and `error?.message` (no secrets) before returning 500.

## 3. Restart backend (to ensure env is applied)

On the server:

```bash
cd /root/ChartSignl/apps/backend/deploy
docker-compose up -d --force-recreate chartsignl-api
```

Or from your machine:

```powershell
ssh root@167.88.43.61 "cd /root/ChartSignl/apps/backend/deploy && docker-compose up -d --force-recreate chartsignl-api"
```

## 4. If you ever need to set a different live price ID

From project root (Windows):

```powershell
.\scripts\update-server-stripe-price.ps1 -LivePriceId "price_xxxxx"
```

Get the ID from: Stripe Dashboard → switch to **Live** mode → Product catalog → your product → copy the **Price ID**.

## 5. Supabase: check if your account is subscribed

- Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Table Editor**.
- Open the **subscriptions** table.
- Find the row where `user_id` = your user ID (from Auth or from your app).
- Check:
  - **status** (e.g. `active` or `free`)
  - **stripe_subscription_id** (set if Stripe subscription exists)
  - **stripe_customer_id**
  - **platform** (e.g. `web`)

If you paid but status is still `free` and `stripe_subscription_id` is null, the webhook that updates the row may not have run or may have failed. In that case check Stripe Dashboard → Developers → Webhooks → your endpoint → recent events and any failures.
