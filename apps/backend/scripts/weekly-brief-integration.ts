/**
 * Integration checks against live Supabase + local API (requires apps/backend/.env).
 * Run with backend dev server on :4000:
 *   npx tsx watch src/index.ts   (in apps/backend)
 *   npx tsx scripts/weekly-brief-integration.ts
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const API = process.env.API_URL?.replace('https://api.chartsignl.com', 'http://localhost:4000')
  ?? 'http://localhost:4000';
const ingestSecret = process.env.WEEKLY_CONTENT_INGEST_SECRET;
const cronSecret = process.env.CRON_SECRET;

async function main() {
  if (!ingestSecret || !cronSecret) {
    console.log('Skipping integration: WEEKLY_CONTENT_INGEST_SECRET or CRON_SECRET not in .env');
    console.log('Add them to apps/backend/.env to run full ingest → dryRun path.');
    return;
  }

  const sample = readFileSync(resolve(__dirname, '../fixtures/weekly_content_sample.json'), 'utf-8');

  const ingestRes = await fetch(`${API}/api/internal/weekly-brief/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ingest-secret': ingestSecret,
    },
    body: sample,
  });
  const ingestBody = await ingestRes.json();
  if (!ingestRes.ok || !ingestBody.success) {
    throw new Error(`Ingest failed (${ingestRes.status}): ${JSON.stringify(ingestBody)}`);
  }
  console.log('✓ POST /ingest stored artifact', ingestBody.id);

  const dryRes = await fetch(`${API}/api/internal/weekly-brief/send?dryRun=1`, {
    method: 'POST',
    headers: { 'x-cron-secret': cronSecret },
  });
  const dryBody = await dryRes.json();
  if (!dryRes.ok || !dryBody.success || !dryBody.html) {
    throw new Error(`dryRun failed (${dryRes.status}): ${JSON.stringify(dryBody)}`);
  }
  console.log('✓ POST /send?dryRun=1 returned HTML', dryBody.htmlPath);
  console.log('  Subject:', dryBody.subject);

  // Stale skip: ingest stale artifact and confirm send is blocked
  const stale = JSON.parse(sample);
  stale.data_stale = true;
  stale.week_label = stale.week_label + ' (stale test)';
  await fetch(`${API}/api/internal/weekly-brief/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ingest-secret': ingestSecret,
    },
    body: JSON.stringify(stale),
  });

  const skipRes = await fetch(`${API}/api/internal/weekly-brief/send`, {
    method: 'POST',
    headers: { 'x-cron-secret': cronSecret },
  });
  const skipBody = await skipRes.json();
  if (skipRes.status !== 409 || !skipBody.skipped) {
    throw new Error(`Expected stale skip 409, got ${skipRes.status}: ${JSON.stringify(skipBody)}`);
  }
  console.log('✓ Freshness guard blocked send for stale artifact:', skipBody.error);

  console.log('\nIntegration checks passed (testEmail/unsubscribe require manual verification).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
