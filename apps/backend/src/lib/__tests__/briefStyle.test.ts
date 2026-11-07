/**
 * Explain-the-move style checks and the prompt version stamp.
 * Run: npm test  (from apps/backend)
 */
import assert from 'node:assert/strict';
import { EXAMPLE_CLOSE, PROMPT_VERSION } from '../briefAtlasRules.js';
import { buildTickerFact, type BriefFacts } from '../briefFacts.js';
import { buildAtlasBriefPrompt, deliverGatedBrief, notePromptVersion, runBriefQa } from '../briefQaGate.js';
import { parseDailyContent } from '../../services/dailyBrief/validate.js';

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

function facts(): BriefFacts {
  return {
    asOf: '2026-11-05',
    edition: 'close',
    generatedAt: '2026-11-05T21:15:00.000Z',
    tickers: {
      SPY: buildTickerFact({
        close: 733,
        prevClose: 766.81,
        high: 765.97,
        low: 732.71,
        open: 765.97,
        volume: 1,
      }),
      QQQ: buildTickerFact({
        close: 647.05,
        prevClose: 691.95,
        high: 647.05,
        low: 647.05,
        open: 647.05,
        volume: 0,
      }),
    },
    priorLevels: [
      {
        ticker: 'SPY',
        level: 733,
        condition: 'hold',
        horizonSessions: 1,
        briefAsOf: '2026-11-04',
        status: 'met',
      },
    ],
    calendar: [],
  };
}

const LONG = 'The session stayed orderly and the tape stayed narrow while traders waited for the next print and the next level and the next open and the next hour.';

await test('style warns fire and do not block the send', () => {
  const result = runBriefQa(
    {
      fields: {
        opening_bias: [
          'SPY fell 4.41% and QQQ fell 6.49%.',
          'The move was insane.',
          LONG,
          '745 is resistance.',
        ].join('\n'),
      },
    },
    facts()
  );
  assert.equal(result.status === 'blocked', false);
  for (const code of ['missing_why', 'hype_word', 'long_sentence', 'no_condition', 'missing_recap']) {
    assert.ok(result.issues.some((issue) => issue.code === code && issue.severity === 'warn'), code);
  }
});

await test('a worked-example sentence is flagged and removed', () => {
  const leaked = EXAMPLE_CLOSE.split(/(?<=[.!?])\s+/)[0];
  const result = runBriefQa(
    {
      fields: {
        opening_bias: ['Breadth stayed narrow.', leaked, 'The open was orderly.', 'Volume was full.', 'The close was the tell.'].join('\n'),
      },
    },
    facts()
  );
  assert.ok(result.issues.some((issue) => issue.code === 'example_leak'));
  assert.equal(result.draft.fields.opening_bias.includes(leaked.replace(/[.!?]$/, '')), false);
  assert.match(result.draft.fields.opening_bias, /Breadth stayed narrow/);
});

await test('the served prompt carries the explain-the-move rules and a version', () => {
  const prompt = buildAtlasBriefPrompt(facts());
  assert.ok(prompt.includes('How to explain a move'));
  assert.ok(prompt.includes(`PROMPT_VERSION: ${PROMPT_VERSION}`));
  assert.ok(prompt.includes('RANK best:'));
  assert.equal(prompt.includes('Darius'), false);
  assert.equal(prompt.includes('42 Macro'), false);
  assert.equal(prompt.includes('Mike'), false);
});

await test('three style warns get one rewrite and the brief still sends', async () => {
  const alerts: string[] = [];
  let regenerations = 0;
  let html = '';
  const outcome = await deliverGatedBrief({
    draft: {
      fields: {
        opening_bias: ['The tape was insane.', LONG, '745 is resistance.'].join('\n'),
      },
    },
    facts: facts(),
    regenerate: async (next) => {
      regenerations += 1;
      return next;
    },
    alert: async (subject) => {
      alerts.push(subject);
    },
    renderFull: () => 'FULL PROSE',
    renderDeterministic: () => 'SHORT',
    send: async (body) => {
      html = body;
    },
  });
  assert.equal(regenerations, 1);
  assert.equal(html, 'FULL PROSE');
  assert.equal(outcome.status === 'blocked', false);
  assert.equal(alerts.some((subject) => subject.includes('BRIEF QA BLOCKED')), false);
});

await test('a stale or missing promptVersion alerts once and the artifact still parses', async () => {
  const alerts: string[] = [];
  const missing = await notePromptVersion(undefined, async (subject) => {
    alerts.push(subject);
  });
  const stale = await notePromptVersion('old-hash', async (subject) => {
    alerts.push(subject);
  });
  const current = await notePromptVersion(PROMPT_VERSION, async (subject) => {
    alerts.push(subject);
  });
  assert.equal(missing.stale, true);
  assert.equal(missing.send, true);
  assert.equal(stale.stale, true);
  assert.equal(current.stale, false);
  assert.deepEqual(alerts, ['BRIEF PROMPT STALE', 'BRIEF PROMPT STALE']);

  const body = {
    schema_version: 1,
    date_label: 'Thursday, November 5, 2026',
    generated_at: '2026-11-05T21:00:00.000Z',
    data_stale: false,
    tape: [{ symbol: 'SPY', price: '733.00', pct: -4.41 }],
    sections: { opening_bias: 'Yesterday held. SPY stayed above 733.' },
  };
  const parsed = parseDailyContent(body);
  const echoed = parseDailyContent({ ...body, promptVersion: 'old-hash' });
  assert.equal(parsed.promptVersion, undefined);
  assert.equal(echoed.promptVersion, 'old-hash');
  assert.equal(parsed.sections.opening_bias.includes('Yesterday'), true);
});

console.log(`\n${passed} style tests passed`);
