# ChartSignl Deployment Guide

This document describes how to deploy the ChartSignl backend and web app to production.

## Overview

- **Backend**: Node.js API in Docker, built from repo root, runs on port 4000.
- **Web app**: Expo (React Native Web) static build, served from `/srv/chartsignl-web`.
- **Server**: VPS (e.g. `root@167.88.43.61`). Code lives at `/root/ChartSignl`.

## Prerequisites

- **Local**: Node.js, npm, SSH access to the server. On Windows: `rsync` (or WSL with rsync) preferred; scripts fall back to tar/scp if rsync is missing.
- **Server**: Docker, Docker Compose, Nginx, `.env` at repo root with required variables.

## Quick Deploy (Full: Backend + Web)

### Windows (PowerShell)

From the project root:

```powershell
.\deploy-production.ps1
```

This script:

1. Syncs repo (excluding `node_modules`, `.git`, `dist`, etc.) to the server.
2. On the server: runs `docker-compose up -d --build` in `apps/backend/deploy`.
3. Builds the web app locally with `EXPO_PUBLIC_API_URL=https://api.chartsignl.com`, then syncs `apps/mobile/dist` to `/srv/chartsignl-web`.

### Linux / macOS (Bash)

From the project root:

```bash
./deploy-production.sh
```

Same steps as above. Ensure `apps/mobile/.env` exists with required `EXPO_PUBLIC_*` variables before running.

## Web-Only Deploy

To update only the web frontend (no backend sync or rebuild):

```powershell
.\deploy-web.ps1
```

This builds the Expo web app from `apps/mobile` and deploys `dist` to `/srv/chartsignl-web`. Uses rsync or tar/scp; on Windows can use WSL for rsync/ssh.

## Server Paths and Env

| Item        | Path / value |
|------------|--------------|
| Repo on server | `/root/ChartSignl` |
| Web app root   | `/srv/chartsignl-web` |
| Backend deploy | `/root/ChartSignl/apps/backend/deploy` |
| Server .env    | `/root/ChartSignl/.env` (loaded by deploy script) |

Backend Docker Compose loads env from `../../../.env` (repo root) when running from `apps/backend/deploy`.

## Backend Deploy (Docker)

- **Compose file**: `apps/backend/deploy/docker-compose.yml`
- **Context**: Repo root (Dockerfile path: `apps/backend/Dockerfile`)
- **Service**: `chartsignl-api`, port 4000, health check on `/health`

Required env vars (in repo root `.env` or in `environment` in compose):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `CORS_ORIGINS` (includes `https://app.chartsignl.com`, `https://chartsignl.com`, `https://www.chartsignl.com`, plus local dev origins)

Optional (social content pipeline: `POST /api/social/generate`): `ANTHROPIC_API_KEY`, `SOCIAL_API_SECRET`. The endpoint requires the `x-social-key` header to match `SOCIAL_API_SECRET`; both are already in the compose `environment` block.

Optional (weekly + daily brief email): `SENDGRID_API_KEY`, `WEEKLY_CONTENT_INGEST_SECRET` (shared ingest secret for both briefs), `WEEKLY_BRIEF_FROM`, `DAILY_BRIEF_FROM`, `ALERT_WEBHOOK_URL`, `API_URL`. Before production sends, authenticate `chartsignl.com` in SendGrid (SPF/DKIM) and verify senders `weekly@chartsignl.com` and `daily@chartsignl.com`.

Apply the brief migrations before first use:

```bash
# Run in Supabase SQL editor or via CLI:
#   supabase/migrations/20250627120000_weekly_brief.sql
#   supabase/migrations/20260810120000_daily_brief.sql
```

### Weekly Brief cron (Sunday 6:00 PM ET)

Production uses **n8n** for the weekly send (same pattern as **Push notification - Price Alert Checker**). Options Plunge publishes content via ingest; n8n triggers send on Sunday evening.

#### n8n: Weekly Brief send workflow

Create manually in the n8n UI at `https://n8n.chartsignl.com`, modeled on the existing price-checker workflow:

| Node | Setting |
|------|---------|
| **Schedule Trigger** | Weekly, **Sunday 6:00 PM**, timezone `America/New_York` |
| **HTTP Request** | `POST http://chartsignl-api:4000/api/internal/weekly-brief/send` |

Use the **internal Docker hostname** (`chartsignl-api:4000`), not the public `api.chartsignl.com` URL — same as the price-checker workflow.

**Headers** (inline keypair, matching the price-checker workflow):

- `x-cron-secret`: value from VPS (see [Retrieve CRON_SECRET](#retrieve-cron_secret-on-the-vps) below)
- `Content-Type`: `application/json`

No request body. No market-hours Code node (unlike the price checker).

**Suggested workflow name:** `ChartSignl Weekly Brief Send`

**Activation order:**

1. Create the workflow **inactive**
2. Complete the [pre-flight tests](#pre-flight-tests-before-activating-schedule) below
3. Activate only after a successful `testEmail` or `dryRun`

#### Retrieve CRON_SECRET on the VPS

The send endpoint authenticates with `x-cron-secret`, which must match `CRON_SECRET` in the API container. Retrieve it from your infrastructure (not from n8n itself).

**Primary (file on disk):**

```bash
ssh root@167.88.43.61 "grep '^CRON_SECRET=' /root/ChartSignl/.env"
```

Copy the value after `=`. This is the same secret the API container loads via compose (`CRON_SECRET=${CRON_SECRET:-}` in `apps/backend/deploy/docker-compose.yml`).

**Fallback (if missing from `.env`):**

```bash
ssh root@167.88.43.61 "docker exec chartsignl-api printenv CRON_SECRET"
```

**Do not commit** the secret to git. Paste only into the n8n HTTP Request header (or n8n credential store if you prefer that pattern).

`WEEKLY_CONTENT_INGEST_SECRET` is a **different** secret — used only for `POST /api/internal/weekly-brief/ingest`, not the send workflow.

#### Pre-flight tests (before activating schedule)

1. **Ingest content** (weekly, from Options Plunge or manual curl with `WEEKLY_CONTENT_INGEST_SECRET`):
   - Fixture: `apps/backend/fixtures/weekly_content_sample.json`
   - Verify in Supabase: `SELECT COUNT(*) FROM weekly_brief_content;` should be > 0
2. **Dry run** — `POST .../send?dryRun=1` with `x-cron-secret` (returns HTML, no emails)
3. **Test send** — `POST .../send?testEmail=you@example.com` (single inbox)
4. **Full send** — manual `POST .../send` once; confirm `recipientCount` in the JSON response and `[weekly-brief] Batch complete` in API logs
5. **Activate** the n8n schedule

**Expected failures:**

- `401` — wrong or missing `x-cron-secret` (check n8n header vs `/root/ChartSignl/.env`)
- `409 skipped` — no artifact, `data_stale=true`, or artifact older than 8 days
- `409 No recipients` — no opted-in verified users

If `ALERT_WEBHOOK_URL` is set, the API posts to that webhook on skip/failure.

#### Secret rotation (CRON_SECRET)

When rotating `CRON_SECRET`, update **both**:

1. `/root/ChartSignl/.env` on the VPS
2. n8n HTTP Request header (or credential) in **all** cron workflows:
   - Push notification - Price Alert Checker
   - ChartSignl Weekly Brief Send

Then restart the API container so it picks up the new env:

```bash
cd /root/ChartSignl/apps/backend/deploy && docker-compose up -d
```

Rotating only one side causes `401 Unauthorized` on the affected workflows.

#### curl reference (debugging)

After Options Plunge publishes the artifact (via `POST /api/internal/weekly-brief/ingest`), send on Sunday evening:

```bash
curl -X POST "https://api.chartsignl.com/api/internal/weekly-brief/send" \
  -H "x-cron-secret: $CRON_SECRET"
```

Preview HTML without sending:

```bash
curl -X POST "https://api.chartsignl.com/api/internal/weekly-brief/send?dryRun=1" \
  -H "x-cron-secret: $CRON_SECRET"
```

Test send to one address:

```bash
curl -X POST "https://api.chartsignl.com/api/internal/weekly-brief/send?testEmail=you@example.com" \
  -H "x-cron-secret: $CRON_SECRET"
```

Ingest from Options Plunge (shared secret):

```bash
curl -X POST "https://api.chartsignl.com/api/internal/weekly-brief/ingest" \
  -H "Content-Type: application/json" \
  -H "x-ingest-secret: $WEEKLY_CONTENT_INGEST_SECRET" \
  -d @apps/backend/fixtures/weekly_content_sample.json
```

The freshness guard skips send if no artifact exists, `data_stale=true`, or `generated_at` is older than 8 days.

### Daily / Morning Brief cron (weekdays 8:30 AM ET)

Same pattern as weekly: Options Plunge builds the daily brief at **8:00 AM ET** (`market-brief-scheduler.service` → `tasks.py` → `send_market_brief_to_subscribers`), then `daily_content_publisher.py` POSTs a neutral artifact to ChartSignl ingest. n8n triggers ChartSignl send **after** that ingest. ChartSignl does **not** re-fetch market APIs.

**OP env (server-backup):**

| Var | Purpose |
|-----|---------|
| `CHARTSIGNL_DAILY_INGEST_URL` | Default `https://api.chartsignl.com/api/internal/daily-brief/ingest` |
| `WEEKLY_CONTENT_INGEST_SECRET` | Shared `x-ingest-secret` (same as weekly) |
| `DAILY_CONTENT_INGEST_SECRET` | Optional override for daily only |

After a successful OP daily **build** (`send_market_brief_to_subscribers` in the live `market-brief-scheduler` service, or `send_daily_brief.py` when run directly), Options Plunge calls `publish_daily_content(context)` (non-fatal). Dry-run of `send_daily_brief.py` logs `ChartSignl contract keys: …` without POSTing.

#### n8n: Morning Brief send workflow

| Node | Setting |
|------|---------|
| **Schedule Trigger** | Weekdays (Mon–Fri), **8:30 AM**, timezone `America/New_York` |
| **HTTP Request** | `POST http://chartsignl-api:4000/api/internal/daily-brief/send` |

**Headers:** `x-cron-secret` (same `CRON_SECRET` as weekly / price checker), `Content-Type: application/json`.

**Suggested workflow name:** `ChartSignl Morning Brief Send`

**Activation order:** inactive → ingest fixture or live OP publish → `dryRun=1` → `testEmail=` → activate.

When rotating `CRON_SECRET`, also update this workflow alongside Weekly Brief and Price Alert Checker.

#### Pre-flight (daily)

1. Apply `20260810120000_daily_brief.sql` (adds `daily_brief_content`, `profiles.daily_brief_opt_in` mirrored from weekly opt-in, `get_daily_brief_recipients`)
2. Ingest: `POST /api/internal/daily-brief/ingest` with `x-ingest-secret` + `apps/backend/fixtures/daily_content_sample.json`
3. Dry run: `POST .../daily-brief/send?dryRun=1`
4. Test: `POST .../daily-brief/send?testEmail=you@example.com`
5. Activate n8n schedule **after** OP daily publisher is deploying and ingesting

Freshness: skip if no artifact, `data_stale=true`, or older than **36 hours**.

```bash
curl -X POST "https://api.chartsignl.com/api/internal/daily-brief/send" \
  -H "x-cron-secret: $CRON_SECRET"

curl -X POST "https://api.chartsignl.com/api/internal/daily-brief/send?dryRun=1" \
  -H "x-cron-secret: $CRON_SECRET"

curl -X POST "https://api.chartsignl.com/api/internal/daily-brief/ingest" \
  -H "Content-Type: application/json" \
  -H "x-ingest-secret: $WEEKLY_CONTENT_INGEST_SECRET" \
  -d @apps/backend/fixtures/daily_content_sample.json
```

Local acceptance (no APIs):

```bash
npx tsx apps/backend/scripts/weekly-brief-acceptance.ts
npx tsx apps/backend/scripts/daily-brief-acceptance.ts
# HTML: apps/backend/tmp/weekly-brief-dryrun.html
#       apps/backend/tmp/daily-brief-dryrun.html
```

### Forward calendar (earnings + macro)

Earnings dates are cached nightly into `earnings_calendar` from layered providers (Finnhub → FMP → Alpha Vantage, then Massive news gap-fill). The 8:30 send **reads the cache and never calls a vendor**. FMP Stable `/stable/earnings-calendar` is optional (legacy `/api/v3/earning_calendar` 403s on keys issued after ~Aug 2025). Macro dates live in the curated `macro_calendar` table (seeded from official BLS / BEA / FOMC / ISM / Census / UMich schedules — not from a first-Friday rule).

Apply `supabase/migrations/20260831154500_week_ahead_calendar.sql` before the first live send.

**n8n: Earnings calendar refresh** (after the close, before the 12:10 AM restart)

| Node | Setting |
|------|---------|
| **Schedule Trigger** | Daily, **9:00 PM**, timezone `America/New_York` |
| **HTTP Request** | `POST http://chartsignl-api:4000/api/internal/daily-brief/refresh-calendar` |

Headers: `x-cron-secret`, `Content-Type: application/json`. Optional: `FMP_API_KEY`, `FINNHUB_API_KEY`, `ALPHAVANTAGE_API_KEY`. News gap-fill uses `MASSIVE_API_KEY`.

Optional in-process backup: set `ENABLE_CALENDAR_CRON=true`.

Options Plunge can pull the Atlas `THIS WEEK` block (no FMP call) via:

```bash
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://api.chartsignl.com/api/internal/daily-brief/week-ahead"
```

If `max(event_date)` on `macro_calendar` falls inside 30 days, the send path logs at `error` and pages `ALERT_WEBHOOK_URL` — seed the next quarter from the published schedules.

To rebuild/restart on the server:

```bash
cd /root/ChartSignl/apps/backend/deploy
# optional: ensure ../../../.env exists and is loaded
docker-compose down
docker-compose up -d --build
```

## Nginx

Configs live in `apps/backend/deploy/`:

- **API**: `nginx-api.conf` → e.g. `/etc/nginx/sites-available/charts-api.conf` (api.chartsignl.com → proxy to `127.0.0.1:4000`).
- **Web**: `nginx-web.conf` → e.g. `/etc/nginx/sites-available/chartsignl-web` (chartsignl.com, www, app.chartsignl.com; root `/srv/chartsignl-web`; SPA + static SEO pages like `/privacy`, `/terms`).

Update server names and SSL paths to match your domains and certs, then enable sites and reload Nginx.

## Building the Web App Locally

From repo root:

```bash
cd apps/mobile
npm install   # if needed
# Set API URL for production
# PowerShell:
$env:EXPO_PUBLIC_API_URL = "https://api.chartsignl.com"
npm run build:web
# Bash:
# ensure EXPO_PUBLIC_API_URL in .env or export
npm run build:web
```

Output is in `apps/mobile/dist`. Static SEO HTML from `apps/mobile/static/` (e.g. `privacy.html`, `terms.html`) is copied into `dist` by the deploy scripts.

## First-Time / Manual Server Setup

For a fresh VPS, `apps/backend/deploy/deploy.sh` is an example of:

1. Installing Docker, Docker Compose, Nginx, certbot.
2. Creating app and web directories.
3. Creating a sample `.env` and running Docker Compose from `apps/backend/deploy`.
4. Copying Nginx configs and suggesting certbot for SSL.

Adjust paths and domain names in that script and in the Nginx configs to match this guide (e.g. `/root/ChartSignl`, `/srv/chartsignl-web`, api.chartsignl.com, www.chartsignl.com, app.chartsignl.com).

## Scripts Summary

| Script | Purpose |
|--------|--------|
| `deploy-production.ps1` | Full deploy (backend + web) from Windows |
| `deploy-production.sh`  | Full deploy (backend + web) from Bash |
| `deploy.ps1`            | Full deploy using tar/scp (no rsync) |
| `deploy-web.ps1`        | Web-only deploy from Windows |
| `apps/backend/deploy/deploy.sh` | Example one-time server setup (run on VPS) |

## Domains and URLs

- **API**: https://api.chartsignl.com (Nginx → backend:4000)
- **Web**: https://www.chartsignl.com, https://app.chartsignl.com; https://chartsignl.com redirects to https://www.chartsignl.com

Ensure `CORS_ORIGINS` and Nginx server_name / SSL certs match these (or your own) domains.

## Android release builds (signed APK/AAB)

Release builds use a production keystore. The keystore file and passwords must **never** be committed.

### One-time: generate the release keystore

From the project root, in PowerShell. If `keytool` is not on your PATH (e.g. you use Android Studio’s JDK), use the full path to `keytool.exe`:

```powershell
cd android\app
# If keytool is not recognized, use Android Studio's bundled JDK (adjust path if your install differs):
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -storetype PKCS12 -keystore chartsignl-release.keystore -alias chartsignl -keyalg RSA -keysize 2048 -validity 10000
# Or, if Java/JDK is on PATH:
# keytool -genkeypair -v -storetype PKCS12 -keystore chartsignl-release.keystore -alias chartsignl -keyalg RSA -keysize 2048 -validity 10000
```

Store the keystore file in `android/app/` (it is gitignored). **Back up the keystore and passwords securely.** Losing them prevents publishing updates under the same app signing key (e.g. Google Play).

### Building a release APK/AAB

**If Gradle reports "JAVA_HOME is not set":** point it at Android Studio's bundled JDK (adjust path if your install differs):

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

**If Gradle reports "No matching toolchains found for requested specification: {languageVersion=17}":** the build requires **JDK 17** specifically. Android Studio's bundled JBR is often **Java 21**; that won't satisfy the request. Do the following:

1. Install **JDK 17** (e.g. [Eclipse Temurin 17](https://adoptium.net/temurin/releases/?version=17&os=windows&arch=x64) — use the `.msi` and ensure "Set JAVA_HOME" is checked, or note the install path).
2. Point `JAVA_HOME` at that JDK 17 (if not set by the installer). Example if Temurin 17 is in the default location:
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot"
   ```
   Verify: `& "$env:JAVA_HOME\bin\java.exe" -version` should show **version "17"**.
3. Stop the Gradle daemon: `.\gradlew --stop`
4. From the `android` folder run `.\gradlew bundleRelease` again.

Alternatively, in `android/gradle.properties` uncomment and set `org.gradle.java.home` to your JDK 17 path (see the comment in that file).

**Monorepo (JS bundle in AAB):** Dependencies live in the repo root `node_modules`; `apps/mobile/node_modules` may be empty. Before your first Android release build (or if you see "Metro can't find dependencies" or an AAB without JS):

1. From the **project root**: `npm install` then `npm run ensure-mobile-deps`. This links or populates `apps/mobile/node_modules` so Metro and the bundle step resolve packages.
2. Metro is configured to resolve from the root `node_modules` first; Gradle runs Node from the repo root so the JS bundle is included in the AAB.

Set these environment variables (e.g. in your shell or CI secrets) before running the release build:

| Variable | Description |
|----------|-------------|
| `CHARTSIGNL_RELEASE_STORE_PASSWORD` | Keystore password |
| `CHARTSIGNL_RELEASE_KEY_ALIAS` | Key alias (default `chartsignl` if unset) |
| `CHARTSIGNL_RELEASE_KEY_PASSWORD` | Key password |

**Production AAB (for Google Play):** use `bundleRelease`. From the project root in PowerShell:

```powershell
npm run ensure-mobile-deps
$env:CHARTSIGNL_RELEASE_STORE_PASSWORD = "your-store-password"
$env:CHARTSIGNL_RELEASE_KEY_PASSWORD = "your-key-password"
# optional if not 'chartsignl':
# $env:CHARTSIGNL_RELEASE_KEY_ALIAS = "chartsignl"
cd android
.\gradlew clean
.\gradlew bundleRelease
```

Expected output ends with something like `BUILD SUCCESSFUL in 2m 30s`. The AAB is at:

`android/app/build/outputs/bundle/release/app-release.aab`

**Signed APK (e.g. for sideloading):** use `.\gradlew assembleRelease` instead of `clean` + `bundleRelease`. The APK is under `android/app/build/outputs/apk/release/`.

If the build fails, run `.\gradlew bundleRelease --stacktrace` and use the stack trace to diagnose (or share it when asking for help).

If these env vars are not set, the release build falls back to the debug keystore so the project still builds (e.g. for devs or CI without the release keystore).
