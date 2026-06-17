/**
 * Smoke test: sign in with TEST_EMAIL / TEST_PASSWORD from apps/backend/.env
 * and call POST /api/predict. Optional — skips if creds missing.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/backend/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const API_URL = process.env.API_URL || 'http://localhost:4000';

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    console.log('SKIP predict test: SUPABASE_URL or anon key not set');
    process.exit(0);
  }
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    console.log('SKIP predict test: set TEST_EMAIL and TEST_PASSWORD in apps/backend/.env to run full E2E');
    process.exit(0);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
  const { data: auth, error: signInError } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (signInError || !auth.session?.access_token) {
    console.error('FAIL sign-in:', signInError?.message || 'no session');
    process.exit(1);
  }

  const mdRes = await fetch(`${API_URL}/api/market-data/AAPL?interval=3mo`);
  const md = await mdRes.json();
  if (!md.data?.length) {
    console.error('FAIL market data:', md);
    process.exit(1);
  }

  const predictRes = await fetch(`${API_URL}/api/predict`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.session.access_token}`,
    },
    body: JSON.stringify({
      symbol: 'AAPL',
      interval: '3mo',
      data: md.data,
    }),
  });

  const body = await predictRes.json();
  if (!predictRes.ok || !body.success) {
    console.error('FAIL predict:', predictRes.status, body);
    process.exit(1);
  }

  console.log('OK predict:', {
    headline: body.prediction?.headline,
    expectedChangePct: body.prediction?.expectedChangePct,
    confidence: body.prediction?.confidence,
    pathPoints: body.prediction?.projectedPath?.length,
    predictionId: body.predictionId,
  });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
