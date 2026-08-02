# Mobile Push Verification — same-day, market-independent

Two artifacts that isolate the alert delivery chain so you can prove the mobile
pipe **today** (markets closed, no live price needed).

| Link | What must work | Tested by |
|------|----------------|-----------|
| 2 | A push token is stored in `push_tokens` | both |
| 3 | Expo → APNs/FCM actually delivers to the device | `POST /api/test-alert` (with receipts) |
| 1 | A *crossed* alert row drives that delivery | `scripts/test-alert-trigger.ts` (price injected) |

Trigger *detection from live prices* (cron fetch + compare) is the lowest-risk
link left for market hours — plain arithmetic.

---

## 1. Files

- [`apps/backend/src/routes/test-alert.ts`](../apps/backend/src/routes/test-alert.ts) — mounted at `/api/test-alert`
- [`apps/backend/scripts/test-alert-trigger.ts`](../apps/backend/scripts/test-alert-trigger.ts)

---

## 2. Delivery test (Links 2 + 3)

Get your Supabase access token (from the app session), then:

```bash
curl -X POST https://api.chartsignl.com/api/test-alert \
  -H "Authorization: Bearer <your-access-token>"
```

Read the JSON:

- `link2_tokenRegistered: false` → no token. Enable notifications in the **native
  app on a real device**, then retry. Simulators never receive push.
- `expoAccepted > 0` **and** every `receipts[*].status === 'ok'` → **pipe works.**
- Any `receipts[*].status === 'error'` → read `details.error`:
  - `DeviceNotRegistered` → stale token; re-open the app to re-register.
  - `MismatchSenderId` → **FCM (Android) misconfigured** in your Expo project.
  - `InvalidCredentials` → **APNs key (iOS) misconfigured** in EAS.

## 3. Trigger harness (Link 1)

From `apps/backend`, with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env`:

```bash
npx tsx scripts/test-alert-trigger.ts you@email.com SPY 650
```

Inserts a guaranteed-crossed support alert (`crosses_below`, `last_known_price=700`,
`level_price=675.69`, injected price `650`), runs the **real** `checkPriceAlerts()`
with `injectedPrices`, then cleans up (use `--keep` to retain the row).

---

## 4. Risk checklist

- **Real device only.** iOS Simulator never receives push.
- **Credentials, not tokens, are the usual failure.** Receipts in step 2 surface this.
- **`notification_sent` dedup.** Triggered alerts won't re-fire; use a fresh test alert.
- **Web/desktop** requires Phase 1 (Web Push) — separate from this mobile track.

---

## 5. iOS (TestFlight)

No Firebase on iOS. Push needs an **APNs auth key** in EAS and a **production** build on a **physical iPhone**.

### Setup

1. Apple Developer → App ID `com.optionsplungellc.chartsignl` → enable **Push Notifications**.
2. Apple Developer → **Keys** → create APNs key → download `.p8` (one-time).
3. From `apps/mobile`:
   ```powershell
   .\scripts\setup-ios-push.ps1
   ```
   Or manually:
   ```powershell
   npx eas credentials --platform ios   # production profile → upload .p8
   npx eas build --platform ios --profile production --non-interactive
   npx eas submit --platform ios --profile production --latest --non-interactive
   ```
4. Install from **TestFlight** (simulator never receives push).

`app.config.ts` uses `expo-notifications` with `mode: "production"` so `aps-environment` matches TestFlight.

### iOS verification

Same Tests A and B as Android. On iPhone after login:

1. **Push probe** (Profile) → expect `TOKEN=ExponentPushToken[...]`, `register HTTP=200`.
2. **Test A** → `link2_tokenRegistered: true`, receipts all `"ok"`.
3. **Test B** → `notification_sent: true` on device.

Confirm `push_tokens` has a row with `platform: 'ios'` (can coexist with Android).

### iOS-specific failures

| Receipt / probe error | Fix |
|-----------------------|-----|
| `InvalidCredentials` | Upload APNs `.p8` to EAS production profile |
| TOKEN ok, no notification | DND/Focus, reinstall latest TestFlight build, re-open app |
| Probe: permission denied | Settings → ChartSignl → Notifications → Allow |
