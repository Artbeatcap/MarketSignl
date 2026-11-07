/**
 * Generate a brief from the served Atlas prompt, run the QA gate, print the result.
 * Never sends email and never writes to the database.
 *
 *   npx tsx scripts/brief-generate-dryrun.ts --asOf 2026-11-05 --edition close
 *
 * FACTS come from Massive bars for asOf. HEADLINES come from our Massive news
 * feed for that session. Reference notes are not read.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/backend/.env') });

type BriefDraft = import('../apps/backend/src/lib/briefQaGate.js').BriefDraft;
type QaIssue = import('../apps/backend/src/lib/briefQaGate.js').QaIssue;

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : fallback;
}

async function main(): Promise<void> {
const { BRIEF_QA_MODEL, buildAtlasPromptFor, callModel, parseModelJson, regenerateDraft } = await import(
  '../apps/backend/src/lib/briefQaLive.js'
);
const { resolveGatedDraft } = await import('../apps/backend/src/lib/briefQaGate.js');
const { addDaysISO } = await import('../apps/backend/src/lib/weekAhead.js');

const asOf = arg('asOf', '2026-11-05');
const edition = arg('edition', 'close') === 'morning' ? 'morning' : 'close';
const movers = arg('movers', 'AMD,NVDA')
  .split(',')
  .map((ticker) => ticker.trim().toUpperCase())
  .filter(Boolean);

const OUTPUT_SHAPE =
  'You are Atlas, writing the ChartSignl ' +
  (edition === 'close' ? 'close' : 'morning') +
  ' email brief. Follow every rule in the user message. Return JSON only: ' +
  '{"opening_bias": "one paragraph", "move_paragraphs": ["one paragraph per move, 2 or 3 total"], ' +
  '"level_calls": [{"ticker": "SPY", "level": 0, "condition": "hold|reclaim|break|close_above|close_below", "horizonSessions": 1}]}';

const built = await buildAtlasPromptFor({
  edition,
  asOf,
  movers,
  newsFrom: `${asOf}T09:00:00Z`,
  newsTo: `${addDaysISO(asOf, 1)}T05:00:00Z`,
  gradePrior: 'replay',
});

console.log('brief generation dry run (not sent, nothing persisted)');
console.log(`asOf: ${asOf}  edition: ${edition}  promptVersion: ${built.promptVersion}`);
console.log(`model: ${BRIEF_QA_MODEL} (the gate model; Options Plunge may use a different one)`);
console.log(
  built.priorNote
    ? `PRIOR CALLS: not loaded — ${built.priorNote}`
    : `PRIOR CALLS: ${built.facts.priorLevels.length} call(s) from the 7 days before ${asOf}, regraded as of ${asOf}`
);
console.log(`bars missing: ${built.missingTickers.length ? built.missingTickers.join(', ') : 'none'}`);
console.log('');
const factsBlock = built.prompt.slice(built.prompt.indexOf('FACTS'), built.prompt.indexOf('PRIOR CALLS'));
console.log(factsBlock.trim());
console.log('');
console.log(`HEADLINES (${built.headlines.length}, our news feed):`);
built.headlines.forEach((item, index) => {
  console.log(`- [H${index + 1}] [${item.publishedAt ?? 'no time'}] ${item.headline}`);
  if (item.summary) console.log(`      ${item.summary}`);
});
console.log('');

const raw = await callModel(OUTPUT_SHAPE, built.prompt, { maxTokens: 1200, timeoutMs: 45000 });
const parsed = parseModelJson(raw) as { opening_bias?: string; move_paragraphs?: string[]; level_calls?: unknown[] } | null;
if (!parsed) {
  console.log('MODEL OUTPUT WAS NOT JSON — stopping. Raw output:');
  console.log(raw);
  process.exit(1);
}
const paragraphs = Array.isArray(parsed.move_paragraphs) ? parsed.move_paragraphs.filter((p) => typeof p === 'string') : [];
const draft: BriefDraft = {
  fields: {
    opening_bias: parsed.opening_bias ?? '',
    session_setup_html: paragraphs.join('\n\n'),
  },
  headlines: built.headlines,
};

console.log('MODEL DRAFT (before the gate)');
console.log('Opening Bias:');
console.log(draft.fields.opening_bias);
console.log('');
console.log('Move paragraphs:');
console.log(draft.fields.session_setup_html);
console.log('');

let rewrites = 0;
const resolved = await resolveGatedDraft({
  draft,
  facts: built.facts,
  regenerate: async (next: BriefDraft, issues: QaIssue[]) => {
    rewrites += 1;
    console.log(`REWRITE ${rewrites} requested for: ${[...new Set(issues.map((issue) => `${issue.field}:${issue.code}`))].join(', ')}`);
    return regenerateDraft(next, built.facts, issues);
  },
  alert: async (subject: string, body: string) => {
    console.log(`ADMIN ALERT (printed, not emailed): ${subject}`);
    console.log(body);
  },
});

console.log('');
console.log('GATE');
console.log(`status: ${resolved.status}  rewrites: ${rewrites}  prose sends: ${resolved.sendProse ? 'yes' : 'no'}`);
for (const issue of resolved.result?.issues ?? []) console.log(`- ${issue.severity} ${issue.field ?? ''} ${issue.code}: ${issue.message}`);
console.log('');

const finalBias = resolved.draft.fields.opening_bias ?? '';
const finalMoves = resolved.draft.fields.session_setup_html ?? '';
console.log('FINAL Opening Bias:');
console.log(finalBias);
console.log('');
console.log('FINAL move paragraphs:');
console.log(finalMoves);
console.log('');

const finalText = `${finalBias}\n${finalMoves}`;
const normalized = factsBlock.replace(/\u2212/g, '-');
const numbers = [...finalText.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) => match[0]);
const untraced = [...new Set(numbers)].filter((token) => !normalized.includes(token));
console.log(`numbers in final prose: ${numbers.length}`);
console.log(`numbers not found verbatim in FACTS: ${untraced.length ? untraced.join(', ') : 'none'}`);
const hype = finalText.match(/\b(historic|bloodbath|carnage|crushed|ripping|insane)\b/gi) ?? [];
console.log(`hype words: ${hype.length ? hype.join(', ') : 'none'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
