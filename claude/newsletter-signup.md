# Free Newsletter Signup — implemented

The Cursor prompt for this feature lives in the conversation that produced it. Implementation is in the repo:

- `supabase/newsletter_migration.sql` — list, send ledger, auto-subscribe trigger
- `supabase/newsletter_trigger_test.sql` — SQL proof that signup does not revive opt-outs
- `apps/backend/src/lib/newsletter.ts` — only writer of subscriber state
- `apps/backend/src/lib/newsletterSend.ts` — Resend batch, per-recipient `List-Unsubscribe`
- `apps/backend/src/routes/newsletter.ts` — public subscribe / GET-confirm + POST-unsubscribe / send / webhook
- `apps/backend/src/lib/__tests__/newsletter.test.ts` — the state-machine tests
- Landing capture is on `apps/mobile/static/landing.html` (`www.chartsignl.com`), not the Expo splash

Run tests: `npm run test:newsletter --prefix apps/backend`
