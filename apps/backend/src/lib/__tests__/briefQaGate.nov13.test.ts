/**
 * Nov 13, 2026 morning-brief defects.
 * Run: npm test -w backend -- briefQaGate
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NO_CATALYST,
  checkTopStory,
  cleanHeadlines,
  explainableMovers,
  findForbiddenAbsence,
  foreignLevels,
  movedWithOpposite,
  pickQualifiedReason,
  repairCard,
  showEarningsBadge,
  windowMismatch,
  type ReasonArticle,
} from '../briefReason.js';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const fixture = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/2026-11-13-morning/news.json'), 'utf8')
) as {
  nvda: ReasonArticle[];
  nbis: ReasonArticle[];
};

await test('an NVDA card that quotes NBIS is blocked and rewritten', () => {
  const repaired = repairCard({
    ticker: 'NVDA',
    pct: '-4.34%',
    why: '$NBIS fell 16.84% yesterday. No company news explains it.',
  });
  assert.equal(repaired.blocked, true);
  assert.equal(repaired.code, 'card_ticker_mismatch');
  assert.equal(repaired.why.includes('$NBIS'), false);
  assert.equal(repaired.why.includes('16.84'), false);
  assert.ok(repaired.why.includes('NVDA'));
  assert.ok(repaired.why.includes(NO_CATALYST));
});

await test('claims that no news exists are rejected', () => {
  assert.equal(findForbiddenAbsence('No company news explains it'), true);
  assert.equal(findForbiddenAbsence('No headline — flow-driven'), true);
  assert.equal(findForbiddenAbsence(NO_CATALYST), false);
});

await test('the matcher prefers the resignation and the outlook cut', () => {
  const nvda = pickQualifiedReason(fixture.nvda, 'NVDA', 'down');
  assert.ok(nvda);
  assert.match(nvda.article.title, /Cracked/);
  const nbis = pickQualifiedReason(fixture.nbis, 'NBIS', 'down');
  assert.ok(nbis);
  assert.match(nbis.article.title, /Lowering 2026 Outlook/);
  const template = pickQualifiedReason(
    fixture.nvda.filter((article) => /Key Metrics/.test(article.title)),
    'CBRS',
    'up'
  );
  assert.equal(template, null);
});

await test('an opening that omits a 3% index driver is blocked', () => {
  assert.equal(
    checkTopStory('$AVGO is the story this morning. Broadcom carried the tape.', 'NVDA', true, true),
    true
  );
  assert.equal(checkTopStory('$NVDA fell after the CEO resigned.', 'NVDA', true, true), false);
});

await test('AVGO on Nov 13 does not get an earnings badge', () => {
  assert.equal(showEarningsBadge('2026-11-13', '2026-12-09'), false);
  assert.equal(showEarningsBadge('2026-11-13', null), false);
});

await test('calling a premarket print yesterday is a window mismatch', () => {
  assert.equal(windowMismatch('SPY fell 0.35% yesterday', -0.35, 'premarket'), true);
  assert.equal(windowMismatch('SPY fell 0.35% yesterday', -0.35, 'yesterday'), false);
});

await test('a rising ticker did not move with a group that fell', () => {
  assert.equal(
    movedWithOpposite('it moved with the chip group SMH, which fell 1.03%', true),
    true
  );
});

await test('a prose level outside the card set is blocked', () => {
  const foreign = foreignLevels('Watch 763.04 and the range lows.', [752.85, 748.57, 762.22, 767.31]);
  assert.deepEqual(foreign, [763.04]);
});

await test('a 0.53% premarket row and an unexplained 50% drop are omitted', () => {
  const result = explainableMovers([
    { ticker: 'MOD', pct: '-0.53%', dir: 'down', why: 'No headline — flow-driven', window: 'premarket' },
    { ticker: 'ADIG', pct: '-49.85%', dir: 'down', why: 'No headline — flow-driven', window: 'prior_session' },
    { ticker: 'NBIS', pct: '-16.84%', dir: 'down', why: 'Nebius lowered its 2026 outlook.', window: 'prior_session' },
  ]);
  assert.deepEqual(result.rows.map((row) => row.ticker), ['NBIS']);
  assert.deepEqual(result.unexplainedExtreme, ['ADIG']);
});

await test('headlines keep a linked title and a full sentence', () => {
  const cleaned = cleanHeadlines([
    { headline: '', summary: 'nothing', url: 'https://example.com/a' },
    { headline: 'Compared to Estimates, Cerebras Q3 Earnings: A Look at Key Metrics', summary: 'x', url: 'https://example.com/b' },
    {
      headline: 'Nvidia CEO resigns',
      summary: 'Jensen Huang resigned on Thursday. The rest was cut mid wo',
      url: 'https://example.com/c',
    },
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].headline, 'Nvidia CEO resigns');
  assert.equal(cleaned[0].summary, 'Jensen Huang resigned on Thursday.');
  assert.ok(cleaned[0].url);
});

console.log(`\n${passed} nov13 tests passed`);
