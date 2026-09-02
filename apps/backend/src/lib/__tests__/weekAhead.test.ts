/**
 * Forward-calendar tests. Fixtures are the FMP v3 shape for the week of
 * 2026-08-31 — the week the brief missed DELL, PANW, AVGO, HPE, and jobs —
 * plus a captured Stable `/stable/earnings-calendar` response (no `time` field).
 * Run: npx tsx apps/backend/src/lib/__tests__/weekAhead.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  adaptFmpEarningsCalendar,
  mapFmpSession,
  type EarningsCalendarRow,
} from '../fmpEarningsAdapter.js';
import {
  ATLAS_HARD_RULE,
  MIN_CALENDAR_WEIGHT_PCT,
  buildWeekAhead,
  distinctAnalystsByTicker,
  emitWeekAheadLogs,
  formatEarningsBody,
  promptContainsGateLeak,
  qualifyCandidate,
  scoreCandidate,
  shouldDropUnconfirmed,
  slotCalendar,
  tradingHorizon,
  type CalendarCandidate,
  type MacroEvent,
  type WeekAheadLogger,
} from '../weekAhead.js';
import { buildAtlasMarketContext } from '../atlasFeed.js';
import { renderDailyBriefEmail } from '../../services/dailyBrief/renderEmail.js';
import { parseDailyContent } from '../../services/dailyBrief/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const FMP_FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, '../../../fixtures/fmp_earnings_week_2026-08-31.json'), 'utf-8')
);
const FMP_STABLE_FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, '../../../fixtures/fmp_earnings_stable_2026-09-01.json'), 'utf-8')
);
const SAMPLE = JSON.parse(
  readFileSync(resolve(__dirname, '../../../fixtures/daily_content_sample.json'), 'utf-8')
);

const FETCHED_AT = '2026-08-30T21:00:00-04:00';
const TODAY = '2026-08-31';
const NOW = new Date('2026-08-31T08:30:00-04:00');

const NAMES = new Map([
  ['DELL', 'Dell Technologies'],
  ['PANW', 'Palo Alto Networks'],
  ['AVGO', 'Broadcom'],
  ['HPE', 'Hewlett Packard Enterprise'],
  ['CRM', 'Salesforce'],
]);

const WEEK_MACROS: MacroEvent[] = [
  {
    eventDate: '2026-09-04',
    releaseTime: '08:30:00',
    title: 'August Employment Situation',
    shortTitle: 'Jobs report',
    category: 'employment',
    impact: 3,
    source: 'BLS',
    consensus: null,
    notes: 'The last major labor print before the September FOMC.',
  },
];

function adapted(): EarningsCalendarRow[] {
  return adaptFmpEarningsCalendar(FMP_FIXTURE, FETCHED_AT);
}

function htmlFor(calendar: ReturnType<typeof buildWeekAhead>['rows']): string {
  const content = parseDailyContent(SAMPLE);
  return renderDailyBriefEmail({
    content,
    unsubscribeUrl: 'https://example.com/unsub',
    calendar,
  });
}

function candidate(partial: Partial<CalendarCandidate> & Pick<CalendarCandidate, 'ticker'>): CalendarCandidate {
  const c: CalendarCandidate = {
    companyName: partial.companyName ?? '',
    reportDate: partial.reportDate ?? '2026-09-01',
    session: partial.session ?? 'amc',
    isConfirmed: partial.isConfirmed ?? true,
    weightPct: partial.weightPct ?? 0,
    distinctAnalysts: partial.distinctAnalysts ?? 0,
    reason: partial.reason ?? 'index_weight',
    score: 0,
    ticker: partial.ticker,
  };
  c.score = partial.score ?? scoreCandidate(c);
  return c;
}

test('the FMP adapter, run against the captured response, produces the expected EarningsCalendarRow[]', () => {
  const rows = adapted();
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  assert.equal(rows.length, 6);

  const dell = byTicker.get('DELL');
  assert.ok(dell);
  assert.equal(dell.reportDate, '2026-09-01');
  assert.equal(dell.session, 'amc');
  assert.equal(dell.epsEstimate, 2.38);
  assert.equal(dell.revenueEstimate, 27140000000);
  assert.equal(dell.updatedFromDate, '2026-08-18');
  assert.equal(dell.fiscalPeriod, 'Q3 FY2026');
  assert.equal(dell.isConfirmed, false);

  const crm = byTicker.get('CRM');
  assert.ok(crm);
  assert.equal(crm.session, 'unknown');
  assert.equal(mapFmpSession('--'), 'unknown');
  assert.equal(mapFmpSession('bmo'), 'bmo');
  assert.equal(mapFmpSession('AMC'), 'amc');
});

test('the FMP adapter maps a captured Stable earnings-calendar response (lastUpdated, no time → unknown)', () => {
  const rows = adaptFmpEarningsCalendar(FMP_STABLE_FIXTURE, FETCHED_AT);
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  assert.equal(rows.length, 4);

  const adbe = byTicker.get('ADBE');
  assert.ok(adbe);
  assert.equal(adbe.reportDate, '2026-09-10');
  assert.equal(adbe.session, 'unknown');
  assert.equal(adbe.epsEstimate, 6.07);
  assert.equal(adbe.revenueEstimate, 6689580000);
  assert.equal(adbe.updatedFromDate, '2026-09-01');

  assert.ok(byTicker.has('FDX'));
  assert.ok(byTicker.has('DOCU'));
  assert.ok(byTicker.has('NIO'));
  assert.ok(rows.every((r) => r.session === 'unknown'), 'Stable calendar has no time field');
});

test('renders the week of 2026-08-31, the week the brief missed', () => {
  const result = buildWeekAhead({
    now: NOW,
    todayISO: TODAY,
    holidays: [],
    macros: WEEK_MACROS,
    earnings: adapted(),
    weights: new Map([['AVGO', 2.1]]),
    demand: new Map([
      ['DELL', 31],
      ['PANW', 22],
      ['HPE', 14],
    ]),
    names: NAMES,
    calendarFetchedAt: FETCHED_AT,
    macroMaxDate: '2026-09-04',
  });
  const html = htmlFor(result.rows);
  assert.ok(html.includes('On the Calendar'));
  assert.ok(html.includes('$DELL'), 'missing DELL');
  assert.ok(html.includes('$PANW'), 'missing PANW');
  assert.ok(html.includes('$AVGO'), 'missing AVGO');
  assert.ok(html.includes('$HPE'), 'missing HPE');
  assert.ok(html.includes('August Employment Situation') || html.includes('last major labor print'), 'missing jobs report');
});

test("session: '--' from FMP maps to 'unknown', and the rendered row contains the weekday but none of before the open / after the close / bmo / amc", () => {
  const rows = adapted();
  const crm = rows.find((r) => r.ticker === 'CRM');
  assert.ok(crm);
  assert.equal(crm.session, 'unknown');
  const qualified = qualifyCandidate({
    ticker: 'CRM',
    companyName: 'Salesforce',
    reportDate: crm.reportDate,
    session: crm.session,
    isConfirmed: true,
    weightPct: 0.5,
    distinctAnalysts: 0,
  });
  assert.ok(qualified);
  const slotted = slotCalendar({
    todayISO: TODAY,
    horizon: tradingHorizon(TODAY),
    macros: [],
    earnings: [qualified],
  });
  assert.equal(slotted.length, 1);
  const html = htmlFor(slotted);
  assert.ok(html.includes('Thursday'));
  const lower = html.toLowerCase();
  assert.equal(lower.includes('before the open'), false);
  assert.equal(lower.includes('after the close'), false);
  assert.equal(html.includes('bmo'), false);
  assert.equal(html.includes('amc'), false);
});

test('an amc row for Tuesday renders text containing both Tuesday and Wednesday', () => {
  const body = formatEarningsBody({ session: 'amc', reportDate: '2026-09-01' }, 'ahead');
  assert.ok(body.includes('Tuesday'), body);
  assert.ok(body.includes('Wednesday'), body);
  const html = htmlFor(
    slotCalendar({
      todayISO: TODAY,
      horizon: tradingHorizon(TODAY),
      macros: [],
      earnings: [candidate({ ticker: 'DELL', session: 'amc', reportDate: '2026-09-01', distinctAnalysts: 31, reason: 'user_demand' })],
    })
  );
  assert.ok(html.includes('Tuesday'));
  assert.ok(html.includes('Wednesday'));
});

test("a ticker at weightPct: 2.1, distinctAnalysts: 0 clears the gate with reason: 'index_weight'", () => {
  const c = qualifyCandidate({
    ticker: 'AVGO',
    reportDate: '2026-09-02',
    session: 'amc',
    isConfirmed: true,
    weightPct: 2.1,
    distinctAnalysts: 0,
  });
  assert.ok(c);
  assert.equal(c.reason, 'index_weight');
  assert.ok(c.weightPct! >= MIN_CALENDAR_WEIGHT_PCT);
});

test("a ticker at weightPct: 0.02, distinctAnalysts: 31 clears with reason: 'user_demand'", () => {
  const c = qualifyCandidate({
    ticker: 'DELL',
    reportDate: '2026-09-01',
    session: 'amc',
    isConfirmed: true,
    weightPct: 0.02,
    distinctAnalysts: 31,
  });
  assert.ok(c);
  assert.equal(c.reason, 'user_demand');
});

test('a ticker at weightPct: 0.02, distinctAnalysts: 3 is rejected', () => {
  const c = qualifyCandidate({
    ticker: 'FOO',
    reportDate: '2026-09-01',
    session: 'amc',
    isConfirmed: true,
    weightPct: 0.02,
    distinctAnalysts: 3,
  });
  assert.equal(c, null);
});

test('one user with 40 analyses of one ticker yields distinctAnalysts: 1 and is rejected', () => {
  const rows = Array.from({ length: 40 }, () => ({ symbol: 'DELL', user_id: 'user-1' }));
  const demand = distinctAnalystsByTicker(rows);
  assert.equal(demand.get('DELL'), 1);
  const c = qualifyCandidate({
    ticker: 'DELL',
    reportDate: '2026-09-01',
    session: 'amc',
    isConfirmed: true,
    weightPct: 0.02,
    distinctAnalysts: demand.get('DELL') ?? 0,
  });
  assert.equal(c, null);
});

test('nine eligible earnings names render 4, never more; total rows never exceed 6', () => {
  const earnings = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    candidate({
      ticker: `E${i}`,
      reportDate: '2026-09-01',
      session: 'amc',
      weightPct: 2,
      distinctAnalysts: 10 + i,
      reason: 'both',
      isConfirmed: true,
    })
  );
  const rows = slotCalendar({
    todayISO: TODAY,
    horizon: tradingHorizon(TODAY),
    macros: [],
    earnings,
  });
  assert.equal(rows.filter((r) => r.kind === 'earnings').length, 4);
  assert.ok(rows.length <= 6);
});

test('two impact: 3 macro events and five earnings render both macro events, earnings trimmed', () => {
  const macros: MacroEvent[] = [
    { ...WEEK_MACROS[0], eventDate: '2026-09-04' },
    {
      eventDate: '2026-09-02',
      releaseTime: '08:30:00',
      title: 'August ADP',
      shortTitle: 'ADP',
      category: 'employment',
      impact: 3,
      source: 'ADP',
      consensus: null,
      notes: null,
    },
  ];
  const earnings = [0, 1, 2, 3, 4].map((i) =>
    candidate({
      ticker: `E${i}`,
      reportDate: '2026-09-01',
      weightPct: 2,
      distinctAnalysts: 20,
      reason: 'both',
    })
  );
  const rows = slotCalendar({
    todayISO: TODAY,
    horizon: tradingHorizon(TODAY),
    macros,
    earnings,
  });
  assert.equal(rows.filter((r) => r.kind === 'macro').length, 2);
  assert.ok(rows.filter((r) => r.kind === 'earnings').length <= 4);
  assert.ok(rows.length <= 6);
});

test('an unconfirmed date 12 days out does not render; the same date 6 days out renders with (est.)', () => {
  assert.equal(shouldDropUnconfirmed(false, '2026-09-12', '2026-08-31'), true);
  assert.equal(shouldDropUnconfirmed(false, '2026-09-06', '2026-08-31'), false);

  const far: EarningsCalendarRow = {
    ticker: 'SNOW',
    reportDate: '2026-09-12',
    session: 'amc',
    isConfirmed: false,
    updatedFromDate: null,
    epsEstimate: null,
    revenueEstimate: null,
    fiscalPeriod: null,
    companyName: 'Snowflake',
    fetchedAt: FETCHED_AT,
  };
  const weights = new Map([['SNOW', 2.1]]);
  const dropped = buildWeekAhead({
    now: NOW,
    todayISO: TODAY,
    holidays: [],
    macros: [],
    earnings: [far],
    weights,
    demand: new Map(),
    calendarFetchedAt: FETCHED_AT,
    macroMaxDate: null,
  });
  assert.equal(dropped.rows.some((r) => r.ticker === 'SNOW'), false);

  const near: EarningsCalendarRow = { ...far, reportDate: '2026-09-03' };
  const shown = buildWeekAhead({
    now: NOW,
    todayISO: TODAY,
    holidays: [],
    macros: [],
    earnings: [near],
    weights,
    demand: new Map(),
    calendarFetchedAt: FETCHED_AT,
    macroMaxDate: null,
  });
  assert.equal(shown.rows.length, 1);
  assert.equal(shown.rows[0].estimated, true);
  const html = htmlFor(shown.rows);
  assert.ok(html.includes('(est.)'));
});

test('holiday horizon: generating on 2026-09-07 (Labor Day) produces a horizon reaching 2026-09-11', () => {
  const horizon = tradingHorizon('2026-09-07', ['2026-09-07']);
  assert.ok(horizon.includes('2026-09-11'), `horizon=${horizon.join(',')}`);
  assert.equal(horizon.includes('2026-09-07'), false);
  assert.equal(horizon.includes('2026-09-10'), true);
});

test('empty candidate set omits the section; the rendered HTML contains neither On the Calendar nor Nothing', () => {
  const html = htmlFor([]);
  assert.equal(html.includes('On the Calendar'), false);
  assert.equal(html.includes('Nothing'), false);
});

test('prompt containment: THIS WEEK is present and none of distinctAnalysts, score, weightPct leak', () => {
  const result = buildWeekAhead({
    now: NOW,
    todayISO: TODAY,
    holidays: [],
    macros: WEEK_MACROS,
    earnings: adapted(),
    weights: new Map([['AVGO', 2.1]]),
    demand: new Map([
      ['DELL', 31],
      ['PANW', 22],
      ['HPE', 14],
    ]),
    names: NAMES,
    calendarFetchedAt: FETCHED_AT,
    macroMaxDate: '2026-09-04',
  });
  const prompt = buildAtlasMarketContext({
    drivers: [{ ticker: 'NVDA', pct: '+1.00%', why: 'Quiet tape.', headlineWindow: 'premarket' }],
    regime: 'mixed',
    calendar: result.rows,
  });
  assert.ok(prompt.includes('THIS WEEK'));
  assert.ok(prompt.includes('INDEX DRIVERS'));
  assert.equal(promptContainsGateLeak(prompt), null, prompt);
  assert.equal(prompt.includes('distinctAnalysts'), false);
  assert.equal(prompt.includes('weightPct'), false);
  assert.equal(/\bscore\b/.test(prompt), false);
  assert.ok(ATLAS_HARD_RULE.includes('the calendar'));
});

test('a stale cache (max fetched_at < now - 48h) still renders, and logs at warn', () => {
  const warns: string[] = [];
  const logger: WeekAheadLogger = {
    log: () => {},
    warn: (msg?: unknown) => {
      warns.push(String(msg));
    },
    error: () => {},
  };
  const staleAt = '2026-08-28T12:00:00-04:00';
  const result = buildWeekAhead({
    now: NOW,
    todayISO: TODAY,
    holidays: [],
    macros: WEEK_MACROS,
    earnings: adapted(),
    weights: new Map([['AVGO', 2.1]]),
    demand: new Map([
      ['DELL', 31],
      ['PANW', 22],
      ['HPE', 14],
    ]),
    names: NAMES,
    calendarFetchedAt: staleAt,
    macroMaxDate: '2027-01-27',
  });
  assert.equal(result.stale, true);
  assert.ok(result.rows.length > 0, 'stale cache must still render');
  emitWeekAheadLogs(result, { weekday: true, logger });
  assert.ok(
    warns.some((w) => w.includes('stale_cache') || w.includes('48')),
    `expected stale warn, got ${warns.join(' | ')}`
  );
});

console.log(`\n${passed} tests passed`);
