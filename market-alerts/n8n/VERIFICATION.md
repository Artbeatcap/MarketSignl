# n8n verification (hardened)

## Credentials (not env)

1. **Slack Bot** — scopes: `chat:write`; add `im:write` for DM user IDs; add `channels:read` or `groups:read` for channel preflight.
2. **Header Auth "Massive API Key"** — used by Fetch Detect (query/header per Massive).
3. **Postgres `structure_alert_n8n`** — host/db/user/password from limited role SQL (`sql/structure_alert_role.sql`).

## n8n Variables (`$vars`)

`SLACK_ALERT_CHANNEL`, `HEALTHCHECK_URL` (required), `MASSIVE_BASE_URL`, `STRUCTURE_ALERT_TICKERS`, optional `STRUCTURE_ALERT_TIMEZONE=America/New_York`.

Do **not** set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.

## Import

1. Apply `sql/structure_alert_runs.sql` + `sql/structure_alert_role.sql`.
2. Import `structure-alert-error.json`, activate, note workflow id.
3. Import `structure-alert.json`, set Error Workflow, replace credential placeholders.
4. Confirm workflow timezone is `America/New_York` (settings + runtime assert).

## Live check

1. Temporarily set cron to `*/1 * * * *`, set `MASSIVE_BASE_URL` to a bad value.
2. Confirm Slack gets `STRUCTURE ALERT FAILED -` and healthchecks.io shows a **failure** ping.
3. Restore cron to `25 16 * * 1-5` (4:25 PM ET).

## Local

```bat
cd market-alerts
node scripts/fetch-fixture.mjs
node --test
node scripts/backtest-lower-high.mjs
```
