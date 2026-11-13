/**
 * Render-pass enforcement. These functions are what the send route calls.
 * Run: npm test -w backend -- briefQaGate
 */
import assert from 'node:assert/strict';
import {
  appendUnreflected,
  collapseCalendar,
  guardMorningSend,
  levelNotInSet,
  priorCloseWeekday,
  rangeWithoutNumber,
  repairOpening,
  renderQa,
  runStatus,
  saveBriefRun,
  selectTopStory,
  tapeDecision,
  type LevelBookEntry,
} from '../briefRenderQa.js';
import { NO_CATALYST } from '../briefReason.js';

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

const SPY: LevelBookEntry = { S1: 752.85, S2: 748.57, R1: 762.22, R2: 767.31, priorHigh: 763.04 };
const RESIGNATION = "The AI Trade Just Cracked. Here's the Price at Which I'd Start Buying Nvidia.";

await test("Nov 13 top story is NVDA and the resignation article", () => {
  const story = selectTopStory([
    { ticker: 'AVGO', changePct: 5.54, weightPct: 2.1, catalystTitle: 'Broadcom customer concentration' },
    { ticker: 'NVDA', changePct: -4.34, weightPct: 7.5, catalystTitle: RESIGNATION },
  ]);
  assert.ok(story);
  assert.equal(story.ticker, 'NVDA');
  assert.equal(story.catalystTitle, RESIGNATION);
});

await test('an AVGO opening is repaired so the first sentence names NVDA', () => {
  const story = selectTopStory([
    { ticker: 'NVDA', changePct: -4.34, weightPct: 7.5, catalystTitle: RESIGNATION },
  ]);
  assert.ok(story);
  const opening = "$AVGO is the story this morning. Broadcom carried the index while SPY fell.";
  assert.equal(opening.includes('$NVDA'), false);
  const repaired = repairOpening(opening, story, 'Thursday');
  assert.equal(repaired.repaired, true);
  const head = repaired.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  assert.match(head, /\$NVDA/);
  assert.match(head, /4\.34%/);
  assert.ok(head.includes(RESIGNATION));
});

await test('a 3.5% drop with no catalyst states that the feed has none', () => {
  const story = selectTopStory([{ ticker: 'NVDA', changePct: -3.5, catalystTitle: null }]);
  assert.ok(story);
  const repaired = repairOpening('The tape was quiet.', story, 'Thursday');
  assert.ok(repaired.text.includes(NO_CATALYST));
  assert.match(repaired.text, /\$NVDA/);
});

await test("763.04 passes only as Thursday's high, and 753.67 fails", () => {
  assert.equal(levelNotInSet('763.04 is the intraday high from yesterday', 'SPY', SPY), false);
  assert.equal(levelNotInSet('753.67 as the first meaningful floor', 'SPY', SPY), true);
});

await test('a range with no number fails', () => {
  assert.equal(rangeWithoutNumber('opens the path toward the range top'), true);
  assert.equal(rangeWithoutNumber('the range top at 762.22'), false);
});

await test('an AVGO level with no book fails, and the ledger ignores free numbers', () => {
  assert.equal(levelNotInSet('$AVGO watch 354.72', 'AVGO', undefined), true);
});

await test("Friday's rendered defects fail the render pass", () => {
  const html = [
    '<div>Overnight / premarket change</div>',
    '<div>On the Calendar</div><div>2026-11-13 October PPI.</div>',
    '<div>On the Calendar</div>',
    '<div class="headline-title"></div><div></div>',
    '<div>high financ</div>',
    '<div>$NVDA</div><div>$NBIS fell 16.84%</div>',
    '<span>Earnings</span>',
  ].join('');
  const codes = renderQa({
    html,
    tapeCaption: 'Overnight / premarket change',
    expectedCaption: "Thursday's close",
    topStory: { ticker: 'NVDA', pct: -4.34, contribution: 30, catalystTitle: RESIGNATION, eventWord: 'resign' },
    calendarBlocks: 2,
  });
  for (const code of ['tape_label_wrong', 'calendar_blocks', 'iso_date', 'empty_row', 'truncated_text']) {
    assert.ok(codes.includes(code), code);
  }
});

await test('PPI and Fed speakers collapse, and a model row is ignored', () => {
  const rows = collapseCalendar([
    { name: 'PPI', dateLabel: 'Today', time: '8:30 AM', category: 'macro', fromFeed: true },
    { name: 'Core PPI', dateLabel: 'Today', time: '8:30 AM', category: 'macro', fromFeed: true },
    { name: 'Fed speaker: Bowman', dateLabel: 'Today', time: '9:00 AM', category: 'fed', fromFeed: true },
    { name: 'Fed speaker: Collins', dateLabel: 'Today', time: '9:40 AM', category: 'fed', fromFeed: true },
    { name: 'October retail sales', dateLabel: 'Tue Nov 17', time: '8:30 AM', category: 'macro', fromFeed: false },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'PPI and Core PPI m/m');
  assert.match(rows[1].name, /Bowman, Collins/);
});

await test('PPI after the cutoff is appended to the biggest risk', () => {
  const risk = appendUnreflected('The tape is narrow.', { name: 'PPI and Core PPI m/m', time: '8:30 AM' });
  assert.equal(risk.repaired, true);
  assert.match(risk.text, /not reflected in this brief/);
});

await test('a failed input write alerts and does not stop the send', async () => {
  const alerts: string[] = [];
  const saved = await saveBriefRun({
    asOf: '2026-11-13',
    edition: 'morning',
    payload: { ok: false },
    alert: async (subject) => {
      alerts.push(subject);
    },
    write: async () => {
      throw new Error('disk full');
    },
  });
  assert.equal(saved.ok, false);
  assert.equal(alerts[0], 'BRIEF INPUTS NOT SAVED morning 2026-11-13');
});

await test('any repair is fixed, never pass', () => {
  const guarded = guardMorningSend({
    content: {
      schema_version: 1,
      date_label: 'Friday, November 13, 2026',
      generated_at: '2026-11-13T12:15:00Z',
      data_stale: false,
      tape: [],
      sectors: [],
      movers: [],
      levels: {},
      catalyst_bullets: [],
      headlines: [],
      sections: {
        opening_bias: '$AVGO is the story this morning.',
        session_setup_html: '',
        key_level_note: 'The line that matters is 763.04.',
        todays_watch_html: '',
        biggest_risk: '',
        signoff: '',
      },
    },
    drivers: [{ ticker: 'NVDA', changePct: -4.34, weightPct: 7.5, catalystTitle: RESIGNATION }],
    levels: { SPY },
    weekday: 'Thursday',
  });
  assert.equal(guarded.status, 'fixed');
  assert.ok(guarded.repairs.includes('top_story_missing'));
  assert.equal(priorCloseWeekday('Friday, November 13, 2026'), 'Thursday');
  assert.equal(
    tapeDecision([{ premarketPct: null, changePct: -0.35 }], 'Thursday').caption,
    "Thursday's close"
  );
});

console.log(`\n${passed} render-qa tests passed`);
