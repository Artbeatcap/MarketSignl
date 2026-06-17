# Android Release Signing

The previous release signing material was exposed in git history. Treat the
old keystore and passwords as compromised.

## Rotate Credentials

1. In Google Play Console, confirm whether the exposed keystore is the upload
   key or the app signing key.
2. If it is the upload key, generate a new upload key and request/upload the
   replacement certificate in Play Console.
3. If it is the app signing key, request an app signing key upgrade/reset
   through Play App Signing support. If Play cannot rotate it, plan a package
   name migration.
4. Store the rotated keystore and passwords only in EAS/CI secrets and local
   ignored files.

Local release signing uses:

- `apps/mobile/secrets/chartsignl-release.keystore`
- `apps/mobile/secrets/.env.signing`

CI/EAS release signing should set equivalent environment variables:

- `CHARTSIGNL_RELEASE_STORE_FILE`
- `CHARTSIGNL_RELEASE_KEY_ALIAS`
- `CHARTSIGNL_RELEASE_STORE_PASSWORD`
- `CHARTSIGNL_RELEASE_KEY_PASSWORD`

## Local Setup

Run from `apps/mobile`:

```sh
npm run setup-signing
npm run prebuild:android
npm run verify-prebuild
```

`gradle.properties` must not contain release signing values. The Gradle build
resolves signing values at build time from environment variables first, then
from `secrets/.env.signing`.

## History Purge Runbook

Only run this after key rotation is complete and the team has agreed to rewrite
shared history.

```sh
git filter-repo \
  --path apps/mobile/android/app/chartsignl-release.keystore \
  --path apps/mobile/chartsignl-release.keystore \
  --path chartsignl-release.keystore \
  --invert-paths
```

Then remove leaked password lines from rewritten history with a replacement
rules file:

```txt
regex:CHARTSIGNL_RELEASE_STORE_PASSWORD=.*==>CHARTSIGNL_RELEASE_STORE_PASSWORD=
regex:CHARTSIGNL_RELEASE_KEY_PASSWORD=.*==>CHARTSIGNL_RELEASE_KEY_PASSWORD=
```

```sh
git filter-repo --replace-text replacements.txt
```

Verify before any force-push:

```sh
git log --all -- "*chartsignl-release.keystore"
git grep -n "CHARTSIGNL_RELEASE_.*PASSWORD" $(git rev-list --all)
git ls-files "*.keystore" "*.jks" "*.p12" "*.pfx"
```

After verification, coordinate the required force-push and have every
collaborator reclone or hard-reset their local copy.
