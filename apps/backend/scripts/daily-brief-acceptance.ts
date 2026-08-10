/**
 * Local acceptance checks for daily brief pipeline (no Supabase/SendGrid required).
 * Run: npx tsx apps/backend/scripts/daily-brief-acceptance.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseDailyContent } from '../src/services/dailyBrief/validate.js';
import { checkArtifactFreshness } from '../src/services/dailyBrief/freshness.js';
import {
  buildPreheader,
  buildSubject,
  renderDailyBriefEmail,
} from '../src/services/dailyBrief/renderEmail.js';
import type { StoredDailyBrief } from '../src/services/dailyBrief/types.js';
import { ZodError } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../fixtures/daily_content_sample.json');
const outPath = resolve(__dirname, '../tmp/daily-brief-dryrun.html');

const raw = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const content = parseDailyContent(raw);

console.log('✓ Sample artifact validates');

try {
  parseDailyContent({ ...raw, schema_version: 2 });
  console.error('✗ Bad schema_version should be rejected');
  process.exit(1);
} catch (err) {
  if (!(err instanceof ZodError)) throw err;
  console.log('✓ Ingest shape rejects bad schema_version');
}

try {
  parseDailyContent({ ...raw, tape: [] });
  console.error('✗ Empty tape should be rejected');
  process.exit(1);
} catch (err) {
  if (!(err instanceof ZodError)) throw err;
  console.log('✓ Ingest shape rejects empty tape');
}

const stored: StoredDailyBrief = {
  id: 'test-id',
  date_label: content.date_label,
  generated_at: content.generated_at,
  data_stale: content.data_stale,
  artifact: content,
  received_at: new Date().toISOString(),
};

const fresh = checkArtifactFreshness(stored);
if (!fresh.ok) {
  console.error('✗ Fresh sample should be sendable:', fresh.reason);
  process.exit(1);
}
console.log('✓ Freshness guard passes for sample artifact (ET timestamp)');

const staleStored: StoredDailyBrief = {
  ...stored,
  data_stale: true,
};
const staleCheck = checkArtifactFreshness(staleStored);
if (staleCheck.ok) {
  console.error('✗ Stale artifact should be rejected');
  process.exit(1);
}
console.log('✓ Freshness guard rejects data_stale=true');

const html = renderDailyBriefEmail({
  content,
  preheader: buildPreheader(content),
  unsubscribeUrl: 'https://api.chartsignl.com/api/daily-brief/unsubscribe?token=preview',
});

const checks = [
  ['ChartSignl · Morning Brief', 'brand kicker'],
  ['Pull these levels up on live charts', 'CTA copy'],
  ['#14B8A6', 'teal accent'],
  ['#10B981', 'support color'],
  ['#EF4444', 'resistance color'],
  [content.sections.opening_bias.slice(0, 40), 'opening bias verbatim'],
  ['Sector Scorecard', 'sector section'],
  ['$548.20', 'SPY price verbatim'],
  ['+0.18%', 'SPY pct formatted'],
  ['—', 'VIX null pct dash'],
  ['SPY 545 is the line', 'key level note verbatim'],
  ['Markets This Morning', 'hero headline'],
  ['Options Plunge', 'must NOT contain OP brand'],
];

for (const [needle, label] of checks) {
  if (label.startsWith('must NOT')) {
    if (html.includes(needle)) {
      console.error(`✗ HTML unexpectedly contains ${label}: "${needle}"`);
      process.exit(1);
    }
    continue;
  }
  if (!html.includes(needle)) {
    console.error(`✗ HTML missing ${label}: "${needle}"`);
    process.exit(1);
  }
}
console.log('✓ Rendered HTML contains expected ChartSignl branding and verbatim content');

mkdirSync(resolve(__dirname, '../tmp'), { recursive: true });
writeFileSync(outPath, html, 'utf-8');
console.log(`✓ Dry-run HTML written to ${outPath}`);
console.log(`✓ Subject: ${buildSubject(content)}`);
console.log(`✓ Preheader: ${buildPreheader(content).slice(0, 80)}…`);
console.log('\nAll local daily acceptance checks passed.');
