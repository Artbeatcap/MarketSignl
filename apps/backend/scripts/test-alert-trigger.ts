// Link-1 harness — crossed alert row drives real checkPriceAlerts() send path
// with injected prices (market-independent).
//
// Usage (from apps/backend):
//   npx tsx scripts/test-alert-trigger.ts you@email.com SPY 650
//   npx tsx scripts/test-alert-trigger.ts <userId> SPY 650 --keep

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkPriceAlerts, isValidExpoPushToken } from '../src/services/pushNotificationService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in apps/backend/.env');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

async function resolveUserId(arg: string): Promise<string | null> {
  if (/^[0-9a-f-]{36}$/i.test(arg)) return arg;
  const { data } = await admin.from('profiles').select('id').eq('email', arg).single();
  return data?.id ?? null;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--keep');
  const keep = process.argv.includes('--keep');
  const [userArg, symbol = 'SPY', priceArg = '650'] = args;
  const injectedPrice = Number(priceArg);

  if (!userArg || !Number.isFinite(injectedPrice)) {
    console.error(
      'Usage: npx tsx scripts/test-alert-trigger.ts <userEmailOrId> [symbol] [price] [--keep]'
    );
    process.exit(1);
  }

  const userId = await resolveUserId(userArg);
  if (!userId) {
    console.error(`No user found for "${userArg}".`);
    process.exit(1);
  }
  console.log(`User: ${userId}`);

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId)
    .eq('is_active', true);

  const expoTokens = (tokens ?? [])
    .map((t) => t.expo_push_token)
    .filter((t): t is string => typeof t === 'string' && isValidExpoPushToken(t));

  if (expoTokens.length === 0) {
    console.error(
      'No active Expo token. Enable notifications in the native app (real device) first.'
    );
    process.exit(1);
  }
  console.log(`Active Expo tokens: ${expoTokens.length}`);

  const sym = symbol.toUpperCase();
  const levelPrice = 675.69;
  const lastKnownPrice = 700;

  const { data: inserted, error: insErr } = await admin
    .from('price_alerts')
    .insert({
      user_id: userId,
      symbol: sym,
      level_price: levelPrice,
      level_type: 'support',
      direction: 'crosses_below',
      status: 'active',
      last_known_price: lastKnownPrice,
      notification_sent: false,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (insErr) {
    console.error(`Insert into price_alerts failed: ${insErr.message}`);
    process.exit(1);
  }

  const alertId = inserted.id as string;
  console.log(
    `Test alert ${alertId}: ${sym} crosses_below support @ $${levelPrice} ` +
      `(last_known_price=${lastKnownPrice}, injected=${injectedPrice})`
  );

  const result = await checkPriceAlerts(admin, {
    injectedPrices: { [sym]: injectedPrice },
    userIdFilter: userId,
  });

  console.log('checkPriceAlerts result:', JSON.stringify(result, null, 2));

  const { data: alertAfter } = await admin
    .from('price_alerts')
    .select('status, notification_sent, triggered_at, triggered_price')
    .eq('id', alertId)
    .single();

  console.log('Alert after run:', alertAfter);

  if (!keep) {
    await admin.from('price_alerts').delete().eq('id', alertId);
    console.log('Cleaned up test alert.');
  } else {
    console.log(`Kept test alert ${alertId} (--keep).`);
  }

  if (result.triggered > 0 && result.notificationsSent > 0) {
    console.log('\n✅ DB alert → device path works. Check your phone.');
  } else if (result.triggered > 0 && result.notificationsSent === 0) {
    console.log(
      '\n⚠️  Alert crossed but notification_sent=0 — token or Expo credential issue.'
    );
  } else {
    console.log('\n⚠️  Alert did not cross — check level_price / last_known_price / injected price.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
