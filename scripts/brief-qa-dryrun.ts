/**
 * Replay a saved brief through the QA gate. Does not send email.
 *
 *   npx tsx scripts/brief-qa-dryrun.ts --asOf 2026-11-05 --edition close
 *
 * Percentages are computed from the saved bars. A required bar that is missing
 * is reported, never filled in. Rewrites call the model when OPENAI_API_KEY is set.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/backend/.env') });

type BriefFacts = import('../apps/backend/src/lib/briefFacts.js').BriefFacts;
type TickerFact = import('../apps/backend/src/lib/briefFacts.js').TickerFact;
type BriefDraft = import('../apps/backend/src/lib/briefQaGate.js').BriefDraft;
type QaIssue = import('../apps/backend/src/lib/briefQaGate.js').QaIssue;

const REQUIRED = ['SPY', 'QQQ', 'AMD', 'NVDA', 'SMH', 'XLP', 'TLT'];

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : fallback;
}

async function main(): Promise<void> {
const { buildTickerFact, formatFactsLine, formatRankLine, rankTickers, volumeIsPartial } = await import(
  '../apps/backend/src/lib/briefFacts.js'
);
const { resolveGatedDraft, runBriefQa } = await import('../apps/backend/src/lib/briefQaGate.js');
const { regenerateDraft } = await import('../apps/backend/src/lib/briefQaLive.js');

const asOf = arg('asOf', '2026-11-05');
const editionArg = arg('edition', 'close');
if (editionArg !== 'morning' && editionArg !== 'close' && editionArg !== 'weekly') {
  console.error('edition must be morning, close, or weekly');
  process.exit(1);
}
const edition = editionArg;

type Bar = { open?: number; high?: number; low?: number; close: number; prevClose: number; volume: number };
const raw = JSON.parse(
  readFileSync(resolve(__dirname, '../apps/backend/fixtures/2026-11-05-close-bars.json'), 'utf-8')
) as Record<string, Bar | string>;
const prose = readFileSync(resolve(__dirname, '../apps/backend/fixtures/2026-11-05-afternoon.txt'), 'utf-8');

const now = new Date();
const tickers: Record<string, TickerFact> = {};
for (const [ticker, bar] of Object.entries(raw)) {
  if (ticker.startsWith('_') || typeof bar === 'string') continue;
  const partial = volumeIsPartial({
    lastBarClose: bar.close,
    prevDayClose: bar.prevClose,
    dayClose: bar.close,
    now,
    sessionDate: asOf,
  });
  tickers[ticker] = buildTickerFact({ ...bar, volume: Math.round(bar.volume), volumeIsPartial: partial });
}
const missing = REQUIRED.filter((ticker) => !tickers[ticker]);

const facts: BriefFacts = {
  asOf,
  edition,
  generatedAt: now.toISOString(),
  tickers,
  priorLevels: [],
  calendar: [],
  rank: rankTickers(tickers),
};

console.log('brief_qa dry run (not sent)');
console.log(`asOf: ${asOf}  edition: ${edition}  send: not performed`);
console.log('');
console.log('FACTS (computed from bars):');
for (const [ticker, fact] of Object.entries(tickers)) console.log(`  ${formatFactsLine(ticker, fact)}`);
console.log(`  ${formatRankLine(facts.rank ?? rankTickers(tickers))}`);
console.log(`  required bars missing: ${missing.length ? missing.join(', ') : 'none'}`);
console.log('  IWM, DIA: not in this fixture (not required for this replay)');
const partialFlags = Object.entries(tickers).filter(([, fact]) => fact.volumeIsPartial).map(([ticker]) => ticker);
console.log(`  partial-session tickers: ${partialFlags.length ? partialFlags.join(', ') : 'none (session is past the official close)'}`);
console.log('');

const first = runBriefQa({ fields: { opening_bias: prose } }, facts);
console.log('FIRST PASS');
console.log(`status: ${first.status}`);
console.log(`dropped fields: ${first.droppedFields.length ? first.droppedFields.join(', ') : 'none'}`);
for (const issue of first.issues) console.log(`- ${issue.severity} ${issue.code}: ${issue.message}`);
console.log('');

let rewriteCount = 0;
const resolved = await resolveGatedDraft({
  draft: { fields: { opening_bias: prose } },
  facts,
  regenerate: async (draft: BriefDraft, issues: QaIssue[]) => {
    rewriteCount += 1;
    console.log(`REWRITE ${rewriteCount} requested for: ${[...new Set(issues.map((issue) => issue.code))].join(', ')}`);
    const next = await regenerateDraft(draft, facts, issues);
    console.log('model returned:');
    console.log(next.fields.opening_bias);
    console.log('');
    return next;
  },
  alert: async (subject: string, body: string) => {
    console.log(`ADMIN ALERT (printed, not emailed): ${subject}`);
    console.log(body);
    console.log('');
  },
});

console.log('FINAL');
console.log(`status: ${resolved.status}`);
console.log(`rewrites requested: ${rewriteCount}`);
console.log(`prose sends: ${resolved.sendProse ? 'yes' : 'no — short fallback brief'}`);
for (const issue of resolved.result?.issues ?? []) console.log(`- ${issue.severity} ${issue.code}: ${issue.message}`);
console.log('');
console.log(resolved.sendProse ? 'opening bias that would send:' : 'opening bias withheld:');
console.log(resolved.draft.fields.opening_bias);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
