/**
 * Pre-send QA gate. Fixtures are the Nov 5, 2026 close.
 * Run: pnpm --filter backend test briefQaGate
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTickerFact, formatFactsLine, rankTickers, volumeIsPartial, type BriefFacts } from '../briefFacts.js';
import { gradeLevel, type PriorLevel } from '../briefLevels.js';
import {
  applyCoverage,
  buildAtlasBriefPrompt,
  deliverGatedBrief,
  resolveGatedDraft,
  runBriefQa,
  type BriefDraft,
} from '../briefQaGate.js';

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

function nov5Facts(opts?: { partial?: boolean; prior?: PriorLevel[] }): BriefFacts {
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
        open: 765.47,
        volume: 125_897_878,
        volumeIsPartial: opts?.partial ?? false,
      }),
      QQQ: buildTickerFact({
        close: 647.05,
        prevClose: 691.95,
        high: 683.65,
        low: 647.05,
        open: 683.12,
        volume: 0,
      }),
      AMD: buildTickerFact({
        close: 404.4,
        prevClose: 488.78,
        high: 456.2,
        low: 402.1,
        open: 452.5,
        volume: 0,
      }),
      NVDA: buildTickerFact({
        close: 181.6,
        prevClose: 200.13,
        high: 196.25,
        low: 181.462,
        open: 196.07,
        volume: 0,
      }),
    },
    priorLevels: opts?.prior ?? [],
    calendar: [],
  };
}

function draft(text: string): BriefDraft {
  return { fields: { opening_bias: text } };
}

await test('SPY percent and dollar are computed and auto-corrected as one fix', () => {
  const facts = nov5Facts();
  assert.equal(facts.tickers.SPY.changePct, -4.41);
  assert.equal(facts.tickers.SPY.changeAbs, -33.81);
  const result = runBriefQa(draft('SPY closed down -4.57% (-$35.06)'), facts);
  assert.equal(result.status, 'fixed');
  assert.equal(result.draft.fields.opening_bias, 'SPY closed down \u22124.41% (\u2212$33.81)');
  assert.equal(result.fixes.length, 1, JSON.stringify(result.fixes));
});

await test('QQQ percent is corrected to the facts-pack value', () => {
  const facts = nov5Facts();
  assert.equal(facts.tickers.QQQ.changePct, -6.49);
  const result = runBriefQa(draft('QQQ closed -6.68%'), facts);
  assert.equal(result.status, 'fixed');
  assert.equal(result.draft.fields.opening_bias, 'QQQ closed \u22126.49%');
});

await test('two AMD percentages for the same move are blocked', () => {
  const result = runBriefQa(
    draft('AMD fell -17.1% after the open and finished AMD -17.26% on the day.'),
    nov5Facts()
  );
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some((issue) => issue.code === 'duplicate_metric'));
  assert.ok(result.draft.fields.opening_bias.includes('-17.1%'));
  assert.ok(result.draft.fields.opening_bias.includes('-17.26%'));
});

await test('a weekend date range is blocked', () => {
  const result = runBriefQa(
    draft('Support established over Oct 31\u2013Nov 1 and then gave way.'),
    nov5Facts()
  );
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some((issue) => issue.code === 'non_trading_date'));
});

await test('partial-session volume is blocked, and the close guard matches 4:15 ET', () => {
  const beforeClose = volumeIsPartial({
    lastBarClose: 733,
    prevDayClose: 766.81,
    dayClose: 733,
    now: new Date('2026-11-05T20:00:00Z'),
    sessionDate: '2026-11-05',
  });
  const afterClose = volumeIsPartial({
    lastBarClose: 733,
    prevDayClose: 766.81,
    dayClose: 733,
    now: new Date('2026-11-05T21:30:00Z'),
    sessionDate: '2026-11-05',
  });
  assert.equal(beforeClose, true);
  assert.equal(afterClose, false);

  const result = runBriefQa(
    draft('SPY volume 125,897,878 crossed the tape before the bell.'),
    nov5Facts({ partial: true })
  );
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some((issue) => issue.code === 'partial_data'));
});

await test('narration, a rule line, and Comment chart are stripped', () => {
  const result = runBriefQa(
    draft(
      [
        'Now I have everything I need. Here is the full structured output:',
        'Breadth stayed narrow.',
        '---',
        'Comment "chart" below to get the levels.',
      ].join('\n')
    ),
    nov5Facts()
  );
  assert.equal(result.draft.fields.opening_bias, 'Breadth stayed narrow.');
  assert.notEqual(result.status, 'blocked');
});

await test('Nov 5 hold and close-above calls grade against the Nov 6 bar', () => {
  const bar = { date: '2026-11-06', open: 736, high: 740.1, low: 734.58, close: 735.29 };
  const held = gradeLevel(
    {
      ticker: 'SPY',
      level: 733,
      condition: 'hold',
      horizonSessions: 1,
      briefAsOf: '2026-11-05',
      status: 'open',
    },
    [bar]
  );
  const missed = gradeLevel(
    {
      ticker: 'SPY',
      level: 745,
      condition: 'close_above',
      horizonSessions: 1,
      briefAsOf: '2026-11-05',
      status: 'open',
    },
    [bar]
  );
  assert.equal(held.status, 'met');
  assert.equal(held.evidence?.low, 734.58);
  assert.equal(missed.status, 'failed');
  assert.equal(missed.evidence?.close, 735.29);
});

await test('a QQQ level that moves from 640 to 650 without a reason warns', () => {
  const prior: PriorLevel = {
    ticker: 'QQQ',
    level: 640,
    condition: 'hold',
    horizonSessions: 1,
    briefAsOf: '2026-11-04',
    status: 'open',
  };
  const result = runBriefQa(draft('watch 650 on QQQ'), nov5Facts({ prior: [prior] }));
  assert.equal(result.status, 'pass');
  assert.ok(result.issues.some((issue) => issue.code === 'level_drift' && issue.severity === 'warn'));
});

await test('reference notes never reach the Atlas prompt or the html', async () => {
  const facts = nov5Facts();
  const notes = [
    {
      source: '42 Macro',
      title: 'Mike',
      url: 'https://example.invalid/note',
      transcript: 'Darius and Mike see 710 as the line. 42 Macro agrees.',
    },
  ];
  const covered = await applyCoverage(draft('Breadth stayed narrow.'), facts, {
    notes,
    extractDrivers: async (rows) => [rows[0].transcript, 'Darius sees 710', '42 Macro weekly', 'Mike calls it'],
    findNews: async () => null,
  });
  const forbidden = ['Darius', '42 Macro', 'Mike', '710'];
  for (const token of forbidden) {
    assert.equal(covered.prompt.includes(token), false, token);
    assert.equal(covered.html.includes(token), false, token);
  }
  assert.equal(covered.prompt, buildAtlasBriefPrompt(facts, covered.draft.headlines ?? []));
});

await test('a confirmed news article is cited, and an unconfirmed driver stays a gap', async () => {
  const facts = nov5Facts();
  const notes = [
    {
      source: 'desk',
      title: 'overnight',
      transcript: 'The Micron Taiwan plant pause was the driver nobody used.',
    },
  ];
  let regenerations = 0;
  const matched = await applyCoverage(draft('Breadth stayed narrow.'), facts, {
    notes,
    extractDrivers: async () => ['Micron Taiwan plant pause'],
    findNews: async () => ({
      headline: 'Micron pauses Taiwan fab',
      summary: 'Construction at the plant stopped.',
      url: 'https://news.example/micron',
    }),
    regenerate: async (next) => {
      regenerations += 1;
      return next;
    },
  });
  assert.equal(regenerations, 1);
  assert.ok(matched.draft.headlines?.some((item) => item.headline === 'Micron pauses Taiwan fab'));
  assert.ok(matched.prompt.includes('Micron pauses Taiwan fab'));
  assert.equal(matched.prompt.includes('nobody used'), false);

  let missedRegens = 0;
  const missed = await applyCoverage(draft('Breadth stayed narrow.'), facts, {
    notes,
    extractDrivers: async () => ['Micron Taiwan plant pause'],
    findNews: async () => null,
    regenerate: async (next) => {
      missedRegens += 1;
      return next;
    },
  });
  assert.equal(missedRegens, 0);
  assert.ok(missed.gaps.some((gap) => gap.kind === 'unverified_gap'));
  assert.equal(missed.prompt, buildAtlasBriefPrompt(facts));
  assert.equal(missed.prompt.includes('Micron'), false);
});

await test('a draft that stays blocked sends deterministic sections and one admin alert', async () => {
  const facts = nov5Facts();
  const blocked = draft('AMD fell -17.1% and then AMD finished -17.26%.');
  const alerts: string[] = [];
  const sent: string[] = [];
  let regenerations = 0;
  let fullRenders = 0;
  const outcome = await deliverGatedBrief({
    draft: blocked,
    facts,
    regenerate: async (next) => {
      regenerations += 1;
      return next;
    },
    alert: async (subject) => {
      alerts.push(subject);
    },
    renderFull: () => {
      fullRenders += 1;
      return 'AI PROSE AMD fell -17.1%';
    },
    renderDeterministic: () => 'DETERMINISTIC movers calendar levels',
    send: async (html) => {
      sent.push(html);
    },
  });
  assert.equal(regenerations, 1);
  assert.equal(fullRenders, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], 'DETERMINISTIC movers calendar levels');
  assert.equal(sent[0].includes('-17.1'), false);
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].includes('BRIEF QA BLOCKED'));
  assert.equal(outcome.status, 'blocked');
});

await test('a gate crash sends the fallback and a CRASHED alert, never the AI prose', async () => {
  const facts = nov5Facts();
  const secret = 'UNCHECKED AI PROSE xyzzy';
  const alerts: string[] = [];
  const sent: string[] = [];
  const outcome = await deliverGatedBrief({
    draft: draft(secret),
    facts,
    check: () => {
      throw new Error('qa exploded');
    },
    regenerate: async (next) => next,
    alert: async (subject) => {
      alerts.push(subject);
    },
    renderFull: () => secret,
    renderDeterministic: () => 'DETERMINISTIC ONLY',
    send: async (html) => {
      sent.push(html);
    },
  });
  assert.equal(outcome.status, 'crashed');
  assert.equal(sent.length, 1);
  assert.equal(sent[0], 'DETERMINISTIC ONLY');
  assert.equal(sent[0].includes(secret), false);
  assert.equal(sent[0].includes('xyzzy'), false);
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].includes('BRIEF QA CRASHED'));
});

const NOV5_VERBATIM = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/2026-11-05-afternoon.txt'),
  'utf8'
);

await test('the verbatim Nov 5 fixture is not "fixed" on the first pass', () => {
  assert.ok(NOV5_VERBATIM.includes('SPY closed down -4.57% (-$35.06) as the tape broke.'));
  const result = runBriefQa({ fields: { opening_bias: NOV5_VERBATIM } }, nov5Facts());
  assert.notEqual(result.status, 'fixed');
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.droppedFields, ['opening_bias']);
  assert.ok(result.issues.some((issue) => issue.code === 'field_unsaved' && issue.message.includes('3 of 6')));
  for (const code of ['duplicate_metric', 'not_in_facts', 'non_trading_date']) {
    assert.ok(result.issues.some((issue) => issue.code === code), code);
  }
});

await test('the verbatim Nov 5 Opening Bias is rewritten once, and shorter only if the rewrite fails too', async () => {
  const facts = nov5Facts();
  const calls: string[][] = [];
  const alerts: string[] = [];
  const resolved = await resolveGatedDraft({
    draft: { fields: { opening_bias: NOV5_VERBATIM } },
    facts,
    regenerate: async (next, issues) => {
      calls.push(issues.map((issue) => issue.code));
      return next;
    },
    alert: async (subject) => {
      alerts.push(subject);
    },
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('field_unsaved'));
  assert.equal(resolved.status, 'blocked');
  assert.equal(resolved.sendProse, false);
  assert.deepEqual(alerts, ['BRIEF QA BLOCKED close 2026-11-05']);
});

await test('a ticker with no high or low never prints an intraday line equal to its close', () => {
  const fact = buildTickerFact({ close: 647.05, prevClose: 691.95, volume: 0 });
  assert.equal(fact.ohlcMissing, true);
  assert.equal(fact.intraday, null);
  assert.equal(fact.high, null);
  assert.equal(fact.low, null);
  const line = formatFactsLine('QQQ', fact);
  assert.equal(line.includes('range'), false);
  assert.equal(line.includes('intraday low'), false);
  assert.equal(line.includes('high 647.05'), false);
  assert.ok(line.includes('intraday n/a'));

  const facts = nov5Facts();
  facts.tickers.QQQ = fact;
  const result = runBriefQa(
    draft('QQQ closed down -6.49%. QQQ was down 6.49% at the low. Breadth stayed narrow.'),
    facts
  );
  assert.ok(result.issues.some((issue) => issue.message.startsWith('no_intraday_data')));
  assert.equal(result.draft.fields.opening_bias.includes('at the low'), false);
});

await test('RANK lists never share a ticker, and under 6 tickers show one of each', () => {
  const four = rankTickers(nov5Facts().tickers);
  assert.equal(four.best.length, 1);
  assert.equal(four.worst.length, 1);
  assert.equal(four.best[0].ticker, 'SPY');
  assert.equal(four.worst[0].ticker, 'AMD');

  const seven = nov5Facts().tickers;
  seven.SMH = buildTickerFact({ close: 447.73, prevClose: 504.27, high: 483.93, low: 445.59, open: 482.14, volume: 0 });
  seven.XLP = buildTickerFact({ close: 91.25, prevClose: 91.94, high: 93.4, low: 91.22, open: 92.94, volume: 0 });
  seven.TLT = buildTickerFact({ close: 81.93, prevClose: 81.76, high: 82.21, low: 81.54, open: 81.545, volume: 0 });
  const rank = rankTickers(seven);
  const best = rank.best.map((row) => row.ticker);
  const worst = rank.worst.map((row) => row.ticker);
  assert.deepEqual(best, ['TLT', 'XLP', 'SPY']);
  assert.deepEqual(worst, ['AMD', 'SMH', 'NVDA']);
  assert.equal(best.some((ticker) => worst.includes(ticker)), false);
});

await test('an Opening Bias with only SPY and QQQ has no contrast and gets one rewrite', async () => {
  const facts = nov5Facts();
  const only = runBriefQa(draft('SPY fell 4.41% and QQQ fell 6.49% on the AI selloff news.'), facts);
  assert.ok(only.issues.some((issue) => issue.code === 'missing_contrast'));
  let regenerations = 0;
  await resolveGatedDraft({
    draft: draft('SPY fell 4.41% and QQQ fell 6.49% on the AI selloff news.'),
    facts,
    regenerate: async (next) => {
      regenerations += 1;
      return next;
    },
    alert: async () => undefined,
  });
  assert.equal(regenerations, 1);

  const contrast = runBriefQa(
    draft('SPY fell 4.41% on the AI selloff news, while AMD fell 17.26% and chips led lower.'),
    facts
  );
  assert.equal(contrast.issues.some((issue) => issue.code === 'missing_contrast'), false);
});

await test('surviving sentences that are only figures count as missing_why', () => {
  const result = runBriefQa(draft('The tape broke.\nThe Nasdaq led lower.\nSPY volume 125,897,878.'), nov5Facts());
  assert.ok(result.issues.some((issue) => issue.code === 'missing_why' && issue.field === 'opening_bias'));
});

await test('a rewrite that cannot run keeps the written brief and reports the miss', async () => {
  const alerts: string[] = [];
  const resolved = await resolveGatedDraft({
    draft: { fields: { opening_bias: NOV5_VERBATIM } },
    facts: nov5Facts(),
    regenerate: async () => {
      throw new Error('ANTHROPIC_API_KEY is not set');
    },
    alert: async (subject, body) => {
      alerts.push(`${subject}\n${body}`);
    },
  });
  assert.equal(resolved.status, 'rewrite_missed');
  assert.equal(resolved.sendProse, true);
  assert.equal(resolved.draft.fields.opening_bias, NOV5_VERBATIM);
  assert.ok(resolved.result?.issues.some((issue) => issue.code === 'rewrite_not_run'));
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].includes('BRIEF QA REWRITE MISSED'));
  assert.ok(alerts[0].includes('rewrite did not run: ANTHROPIC_API_KEY is not set'));
});

await test('a from-peak drawdown does not knock out the premarket sentence', () => {
  const facts = nov5Facts();
  facts.edition = 'morning';
  facts.tickers.NVDA = buildTickerFact({
    close: 181.6,
    prevClose: 200,
    high: 196,
    low: 181,
    open: 196,
    volume: 0,
    premarketPrice: 185,
  });
  const text = [
    'The Indexes are in the red this morning with $NVDA leading the damage — down over 7% in premarket after falling roughly 30% from its October peak.',
    'This is not a rotation story.',
    'It is a name-specific confidence break tied to AI valuation compression across the sector.',
    'SPY and QQQ are both opening lower and the tone is risk-off.',
  ].join(' ');
  const result = runBriefQa(draft(text), facts);
  assert.equal(result.droppedFields.includes('opening_bias'), false);
  const bias = result.draft.fields.opening_bias;
  assert.ok(bias.includes('over 7%'));
  assert.ok(bias.includes('roughly 30% from its October peak'));
  assert.ok(bias.includes('This is not a rotation story.'));
});

await test('a That-sentence that follows a removed sentence is removed with it', () => {
  const result = runBriefQa(
    draft(
      [
        'SPY closed down -4.41%.',
        'The SOX fell ≈9% from the mid-session print.',
        'That is the worst day since the spring.',
        'QQQ closed down -6.49%.',
        'The tape broke.',
      ].join('\n')
    ),
    nov5Facts()
  );
  const bias = result.draft.fields.opening_bias;
  assert.equal(result.status, 'fixed');
  assert.equal(bias.includes('≈9%'), false);
  assert.equal(bias.includes('worst day'), false);
  assert.match(bias, /SPY closed down/);
  assert.match(bias, /QQQ closed down/);
});

await test('a field under 60% is rewritten once, then dropped, and the rest still sends', async () => {
  const facts = nov5Facts();
  let regenerations = 0;
  let fieldRewrites = 0;
  let sent = '';
  const outcome = await deliverGatedBrief({
    draft: {
      fields: {
        opening_bias: 'Breadth stayed narrow. The open was orderly.',
        session_setup_html: [
          'AMD fell -17.1% after the open.',
          'That move was the whole story.',
          'The SOX fell ≈9% from the mid-session print.',
          'Support established over Oct 31\u2013Nov 1.',
          'Breadth stayed narrow.',
        ].join(' '),
      },
    },
    facts,
    regenerate: async (next, issues) => {
      regenerations += 1;
      if (issues.some((issue) => issue.code === 'field_unsaved')) fieldRewrites += 1;
      return next;
    },
    alert: async () => {
      throw new Error('style or sentence loss must not block the brief');
    },
    renderFull: (next) => {
      sent = `${next.fields.opening_bias}||${next.fields.session_setup_html}`;
      return sent;
    },
    renderDeterministic: () => 'SHORT',
    send: async () => undefined,
  });
  assert.equal(fieldRewrites, 1);
  assert.ok(regenerations <= 2);
  assert.equal(outcome.status === 'blocked', false);
  assert.match(sent, /Breadth stayed narrow/);
  assert.equal(sent.endsWith('||'), true);
  assert.equal(sent.includes('-17.1%'), false);
  assert.equal(sent.includes('SHORT'), false);
});

await test('an intraday low passes within 0.05 and is removed when it does not match', () => {
  const matched = nov5Facts();
  matched.tickers.AMD = buildTickerFact({
    close: 404.4,
    prevClose: 488.78,
    high: 430,
    low: 488.78 * 0.82,
    open: 430,
    volume: 0,
  });
  const ok = runBriefQa(draft('AMD was down 18% at the low.'), matched);
  assert.equal(ok.status === 'blocked', false);
  assert.match(ok.draft.fields.opening_bias, /18%/);
  assert.equal(ok.droppedFields.includes('opening_bias'), false);

  const missed = runBriefQa(
    draft('AMD closed down -17.26%. AMD was down 18% at the low. Breadth stayed narrow.'),
    nov5Facts()
  );
  assert.equal(missed.status, 'fixed');
  assert.match(missed.draft.fields.opening_bias, /-17\.26%/);
  assert.equal(missed.draft.fields.opening_bias.includes('18%'), false);
  assert.equal(missed.droppedFields.length, 0);
});

const NOV5_FEED = {
  headline: 'Stock Market Today, Nov. 5: Nasdaq Suffers Worst Day in 18 Months as AI Trade Comes Under Fire',
  url: 'https://example.com/nov5',
  publishedAt: '2026-11-05T21:55:02Z',
  source: 'feed' as const,
};

await test('a cause no headline supports is removed; a cited cause stays and its tag never sends', async () => {
  let sent = '';
  const outcome = await deliverGatedBrief({
    draft: {
      fields: {
        opening_bias: [
          'SPY fell 4.41% and QQQ fell 6.49%, while AMD dropped 17.26%.',
          'The trigger was political: Democratic governors campaigned on pausing data-center construction.',
          'The Nasdaq had its worst day in 18 months as the AI trade came under fire [H1].',
          'Breadth stayed narrow.',
          'SPY needs a daily close above 740 to calm this down.',
        ].join('\n'),
      },
      headlines: [NOV5_FEED],
    },
    facts: nov5Facts(),
    regenerate: async (next) => next,
    alert: async () => undefined,
    renderFull: (next) => next.fields.opening_bias,
    renderDeterministic: () => 'SHORT',
    send: async (html) => {
      sent = html;
    },
  });
  assert.equal(outcome.status, 'fixed');
  assert.equal(sent.includes('Democratic'), false);
  assert.match(sent, /worst day in 18 months/);
  assert.equal(sent.includes('[H1]'), false);
});

await test('a clock time must be stated in the headline or written as when it was reported', () => {
  const lines = (clause: string) =>
    [
      'SPY fell 4.41% and QQQ fell 6.49%, while AMD dropped 17.26%.',
      `The Nasdaq had its worst day in 18 months as the AI trade came under fire${clause} [H1].`,
      'Breadth stayed narrow.',
      'SPY needs a daily close above 740 to calm this down.',
    ].join('\n');
  const run = (clause: string) => runBriefQa({ ...draft(lines(clause)), headlines: [NOV5_FEED] }, nov5Facts());
  const ungrounded = (result: ReturnType<typeof runBriefQa>) =>
    result.issues.some((issue) => issue.message.startsWith('ungrounded_cause'));

  const wrongTime = run(' at 10:00 PM ET, per a report');
  assert.ok(ungrounded(wrongTime));
  assert.equal(wrongTime.draft.fields.opening_bias.includes('10:00 PM'), false);

  const asEventTime = run(' at 4:55 PM ET');
  assert.ok(ungrounded(asEventTime));

  const asReportTime = run(', per a 4:55 PM ET report');
  assert.match(asReportTime.draft.fields.opening_bias, /4:55 PM ET report/);
  assert.equal(ungrounded(asReportTime), false);

  assert.ok(ungrounded(run(', landing in reports before the close')));
  assert.equal(ungrounded(run(', landing in reports after the close')), false);
});

await test('a sector word has to agree with its own ETF', () => {
  const facts = nov5Facts();
  facts.tickers.XLE = buildTickerFact({ close: 61.63, prevClose: 63.52, high: 64.54, low: 61.63, open: 63.5, volume: 0 });
  facts.tickers.XLP = buildTickerFact({ close: 91.25, prevClose: 91.94, high: 93.4, low: 91.22, open: 92.94, volume: 0 });
  facts.tickers.USO = buildTickerFact({ close: 148.21, prevClose: 145.41, high: 148.93, low: 145.81, open: 146, volume: 0 });
  const result = runBriefQa(
    draft(
      [
        'SPY fell 4.41% and QQQ fell 6.49%, while AMD dropped 17.26%.',
        'Energy and staples held up (USO +1.93%, XLP −0.75%).',
        'Staples held up while oil rose.',
        'Breadth stayed narrow.',
        'SPY needs a daily close above 740 to calm this down.',
      ].join('\n')
    ),
    facts
  );
  assert.equal(result.draft.fields.opening_bias.includes('Energy'), false);
  assert.ok(result.issues.some((issue) => issue.message.startsWith('sector_mismatch')));
  assert.match(result.draft.fields.opening_bias, /Staples held up while oil rose\./);
});

await test('a point figure that is not a change in FACTS is removed', () => {
  const result = runBriefQa(
    draft(
      [
        'SPY fell 4.41% and QQQ fell 6.49%, while AMD dropped 17.26%.',
        'The Nasdaq Composite set a new single-session point-loss record with 1,422 points down.',
        'SPY lost 33.81 points.',
        'Breadth stayed narrow.',
        'SPY needs a daily close above 740 to calm this down.',
      ].join('\n')
    ),
    nov5Facts()
  );
  assert.equal(result.draft.fields.opening_bias.includes('1,422'), false);
  assert.match(result.draft.fields.opening_bias, /SPY lost 33\.81 points\./);
});

await test('"No prior calls" narration is stripped, and the next sentence becomes the first', () => {
  const result = runBriefQa(draft('No prior calls to review. SPY fell 4.41%.\nBreadth stayed narrow.'), nov5Facts());
  assert.equal(result.draft.fields.opening_bias, 'SPY fell 4.41%.\nBreadth stayed narrow.');
  assert.ok(result.fixes.some((fix) => fix.code === 'hygiene'));
});

await test('a chain sentence with no supported cause in its field is removed', () => {
  const result = runBriefQa(
    {
      ...draft(
        [
          'SPY fell 4.41% and QQQ fell 6.49%, while AMD dropped 17.26%.',
          'The chain runs: fewer approvals → less hyperscaler capex → lower chip revenue.',
          'Breadth stayed narrow.',
          'SPY needs a daily close above 740 to calm this down.',
        ].join('\n')
      ),
      headlines: [NOV5_FEED],
    },
    nov5Facts()
  );
  assert.equal(result.draft.fields.opening_bias.includes('chain'), false);
  assert.match(result.draft.fields.opening_bias, /Breadth stayed narrow/);
});

await test('feed headlines are sources and are not number-checked; model headlines still are', () => {
  const feed = { headline: 'The Nasdaq Plunges 5%. What the Data Center Crash Means for Investors', source: 'feed' as const };
  const result = runBriefQa(
    { ...draft('SPY fell 4.41%.'), headlines: [feed, { headline: 'The Nasdaq Plunges 5%.' }] },
    nov5Facts()
  );
  assert.equal(result.draft.headlines[0].headline, feed.headline);
  assert.equal(result.issues.some((issue) => issue.field === 'headline:0'), false);
  assert.ok(result.issues.some((issue) => issue.field === 'headline:1'));
});

await test('direction comes from the number\'s own clause, and the space before it is kept', () => {
  const facts = nov5Facts();
  facts.tickers.TLT = buildTickerFact({ close: 81.93, prevClose: 81.76, high: 82.21, low: 81.54, open: 81.545, volume: 0 });
  facts.tickers.HYG = buildTickerFact({ close: 77.28, prevClose: 77.52, high: 77.47, low: 77.11, open: 77.4, volume: 0 });
  const text = 'TLT rose 0.21% to 81.93 and HYG fell 0.31% to 77.28.';
  const result = runBriefQa(draft(text), facts);
  assert.equal(result.draft.fields.opening_bias, text);
  assert.equal(result.fixes.length, 0);
});

await test('a closing price written without "$" is checked against FACTS', () => {
  const wrong = runBriefQa(draft('SPY fell 4.41% to 732.00, and QQQ plunged 6.49% to 647.05.'), nov5Facts());
  assert.equal(wrong.draft.fields.opening_bias, 'SPY fell 4.41% to 733.00, and QQQ plunged 6.49% to 647.05.');
  assert.equal(wrong.fixes.length, 1);
  const low = runBriefQa(draft('SPY dropped to 732.71 at the low.'), nov5Facts());
  assert.equal(low.draft.fields.opening_bias, 'SPY dropped to 732.71 at the low.');
});

await test('volume figures are checked against FACTS', () => {
  const wrong = runBriefQa(draft('SPY volume 125,892,777. Breadth stayed narrow.'), nov5Facts());
  assert.match(wrong.draft.fields.opening_bias, /SPY volume 125,897,878\./);
  assert.ok(wrong.fixes.some((fix) => fix.code === 'number'));
  const rounded = runBriefQa(draft('SPY traded 125.9 million shares.'), nov5Facts());
  assert.equal(rounded.fixes.length, 0);
  const off = runBriefQa(draft('SPY traded 131.2 million shares.'), nov5Facts());
  assert.match(off.draft.fields.opening_bias, /125\.9 million shares/);
});

console.log(`\n${passed} tests passed`);
