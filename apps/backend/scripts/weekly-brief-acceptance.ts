/**
 * Local acceptance checks for weekly brief pipeline (no Supabase/SendGrid required).
 * Run: npx tsx apps/backend/scripts/weekly-brief-acceptance.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseWeeklyContent } from '../src/services/weeklyBrief/validate.js';
import { checkArtifactFreshness } from '../src/services/weeklyBrief/freshness.js';
import {
  buildPreheader,
  buildSubject,
  renderWeeklyBriefEmail,
} from '../src/services/weeklyBrief/renderEmail.js';
import type { StoredWeeklyBrief } from '../src/services/weeklyBrief/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../fixtures/weekly_content_sample.json');
const outPath = resolve(__dirname, '../tmp/weekly-brief-dryrun.html');

const raw = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const content = parseWeeklyContent(raw);

console.log('✓ Sample artifact validates');

const stored: StoredWeeklyBrief = {
  id: 'test-id',
  week_label: content.week_label,
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
console.log('✓ Freshness guard passes for sample artifact');

const staleStored: StoredWeeklyBrief = {
  ...stored,
  data_stale: true,
};
const staleCheck = checkArtifactFreshness(staleStored);
if (staleCheck.ok) {
  console.error('✗ Stale artifact should be rejected');
  process.exit(1);
}
console.log('✓ Freshness guard rejects data_stale=true');

const html = renderWeeklyBriefEmail({
  content,
  preheader: buildPreheader(content),
  unsubscribeUrl: 'https://api.chartsignl.com/api/weekly-brief/unsubscribe?token=preview',
});

const checks = [
  ['ChartSignl · Weekly Brief', 'brand kicker'],
  ['Pull these levels up on live charts', 'CTA copy'],
  ['#14B8A6', 'teal accent'],
  [content.sections.major_driver.slice(0, 40), 'major driver verbatim'],
  ['Sector Scorecard', 'sector section'],
  ['$728.99', 'SPY price verbatim'],
  ['-2.00%', 'SPY pct formatted'],
  ['—', 'VIX null pct dash'],
  ['QQQ $700 is the line', 'key level note verbatim'],
];

for (const [needle, label] of checks) {
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
console.log('\nAll local acceptance checks passed.');
