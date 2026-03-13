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
