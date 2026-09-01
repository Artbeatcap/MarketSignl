# Free Newsletter Signup — implemented (SendGrid)

Supabase is the single source of truth for subscription state. SendGrid delivers;
do not use Marketing Campaigns, Contacts, or ASM groups.

- `supabase/newsletter_migration.sql` — list, send ledger, webhook event dedupe, auto-subscribe trigger
- `supabase/newsletter_webhook_events.sql` — additive table if the first migration already ran
- `supabase/newsletter_trigger_test.sql` — SQL proof that signup does not revive opt-outs
- `apps/backend/src/lib/newsletter.ts` — only writer of subscriber state
- `apps/backend/src/lib/newsletterSend.ts` — SendGrid `personalizations` (not `sendMultiple()`)
- `apps/backend/src/lib/newsletterWebhook.ts` — ECDSA verification against the raw body
- `apps/backend/src/routes/newsletter.ts` — public subscribe / GET-confirm + POST-unsubscribe / send / `/webhook/sendgrid`
- `apps/backend/src/lib/__tests__/newsletter.test.ts` — the state-machine tests
- Landing capture is on `apps/mobile/static/landing.html` (`www.chartsignl.com`), not the Expo splash

From address is `brief@chartsignl.com` on the authenticated root domain.
Turn off account-level Subscription Tracking in SendGrid (Settings → Tracking).
Keep click tracking off until the sending domain is warm.

Run tests: `npm run test:newsletter --prefix apps/backend`
