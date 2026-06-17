/** Quick smoke: GET /api/predictions/stats with test user creds */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/backend/.env') });

const API_URL = process.env.API_URL || 'http://localhost:4000';

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: auth } = await supabase.auth.signInWithPassword({
    email: process.env.TEST_EMAIL,
    password: process.env.TEST_PASSWORD,
  });
  if (!auth.session) throw new Error('sign-in failed');

  const listRes = await fetch(`${API_URL}/api/predictions?limit=5`, {
    headers: { Authorization: `Bearer ${auth.session.access_token}` },
  });
  const list = await listRes.json();
  console.log('list sample:', list.predictions?.[0]);

  const statsRes = await fetch(`${API_URL}/api/predictions/stats`, {
    headers: { Authorization: `Bearer ${auth.session.access_token}` },
  });
  const stats = await statsRes.json();
  if (!statsRes.ok || !stats.success) {
    console.error('FAIL stats', stats);
    process.exit(1);
  }
  console.log('OK stats:', stats.stats);
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
