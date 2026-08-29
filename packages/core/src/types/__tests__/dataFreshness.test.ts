/**
 * Data freshness classification tests.
 * Run: npx tsx packages/core/src/types/__tests__/dataFreshness.test.ts
 */
import assert from 'node:assert/strict';
import {
  deriveStatus,
  formatAsOf,
  freshnessLabel,
  isRegularHours,
  STALE_GRACE_MINUTES,
} from '../dataFreshness.ts';

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

const DELAY_15 = { delayMinutes: 15 as const };

// Tuesday 25 Aug 2026 is in EDT (UTC-4).
const TUE_1045_ET = Date.parse('2026-08-25T14:45:00.000Z'); // 10:45 AM ET
const TUE_1030_ASOF = '2026-08-25T14:30:00.000Z'; // 10:30 AM ET
const TUE_0915_ASOF = '2026-08-25T13:15:00.000Z'; // 09:15 AM ET
const TUE_1044_ASOF = '2026-08-25T14:44:00.000Z'; // 10:44 AM ET
const TUE_2000_ET = Date.parse('2026-08-26T00:00:00.000Z'); // 8:00 PM ET
const TUE_1600_ASOF = '2026-08-25T20:00:00.000Z'; // 4:00 PM ET
const SAT_NOON_ET = Date.parse('2026-08-29T16:00:00.000Z');

test("Tuesday 10:45 ET, asOf 10:30 ET, delay 15 → 'delayed'", () => {
  assert.equal(
    deriveStatus({ asOf: TUE_1030_ASOF, ...DELAY_15 }, TUE_1045_ET),
    'delayed',
  );
});

test("Tuesday 10:45 ET, asOf 09:15 ET, delay 15 → 'stale'", () => {
  const ageMin = (TUE_1045_ET - Date.parse(TUE_0915_ASOF)) / 60_000;
  assert.ok(ageMin > 15 + STALE_GRACE_MINUTES);
  assert.equal(
    deriveStatus({ asOf: TUE_0915_ASOF, ...DELAY_15 }, TUE_1045_ET),
    'stale',
  );
});

test("Tuesday 20:00 ET, asOf 16:00 ET, delay 15 → 'closed' (not stale)", () => {
  assert.equal(
    deriveStatus({ asOf: TUE_1600_ASOF, ...DELAY_15 }, TUE_2000_ET),
    'closed',
  );
  assert.notEqual(
    deriveStatus({ asOf: TUE_1600_ASOF, ...DELAY_15 }, TUE_2000_ET),
    'stale',
  );
});

test("Saturday any time → 'closed'", () => {
  assert.equal(
    deriveStatus({ asOf: TUE_1600_ASOF, ...DELAY_15 }, SAT_NOON_ET),
    'closed',
  );
  assert.equal(isRegularHours(SAT_NOON_ET), false);
});

test("delay 0, market open, fresh → 'live'", () => {
  assert.equal(
    deriveStatus({ asOf: TUE_1044_ASOF, delayMinutes: 0 }, TUE_1045_ET),
    'live',
  );
});

test("Malformed asOf → 'stale', never a throw", () => {
  assert.equal(deriveStatus({ asOf: 'not-a-date', ...DELAY_15 }, TUE_1045_ET), 'stale');
  assert.equal(deriveStatus({ asOf: '', ...DELAY_15 }, TUE_1045_ET), 'stale');
  assert.doesNotThrow(() => freshnessLabel({
    asOf: 'garbage',
    delayMinutes: 15,
    isDelayed: true,
    source: 'Polygon.io',
  }, TUE_1045_ET));
});

test('formatAsOf across a DST boundary (first Sunday in November) returns a correct ET time', () => {
  // 31 Oct 2026 20:00 UTC = 4:00 PM EDT (UTC-4). DST still in effect.
  const beforeFallback = formatAsOf('2026-10-31T20:00:00.000Z', TUE_1045_ET);
  assert.match(beforeFallback, /4:00\sPM/);

  // After 2:00 AM ET on 1 Nov 2026, US is EST (UTC-5).
  // 1 Nov 2026 20:00 UTC = 3:00 PM EST.
  const afterFallback = formatAsOf('2026-11-01T20:00:00.000Z', TUE_1045_ET);
  assert.match(afterFallback, /3:00\sPM/);
});

test('formatAsOf same-day omits the date; other days include month and day', () => {
  const sameDay = formatAsOf(TUE_1030_ASOF, TUE_1045_ET);
  assert.equal(sameDay, '10:30 AM ET');
  const otherDay = formatAsOf(TUE_1600_ASOF, SAT_NOON_ET);
  assert.match(otherDay, /Aug 25/);
  assert.match(otherDay, /4:00\sPM ET/);
});

test('marketOpen: false forces closed even during weekday session hours', () => {
  assert.equal(
    deriveStatus({ asOf: TUE_1030_ASOF, ...DELAY_15, marketOpen: false }, TUE_1045_ET),
    'closed',
  );
});

test('marketOpen: true uses age, not isRegularHours (holiday override the other way)', () => {
  assert.equal(
    deriveStatus({ asOf: TUE_1600_ASOF, ...DELAY_15, marketOpen: true }, TUE_2000_ET),
    'stale',
  );
});

test('historical freshnessLabel never says delayed; it shows the stored asOf', () => {
  const label = freshnessLabel(
    {
      asOf: TUE_1600_ASOF,
      delayMinutes: 15,
      isDelayed: true,
      source: 'Polygon.io',
    },
    SAT_NOON_ET,
    { historical: true },
  );
  assert.match(label.short, /As of/);
  assert.match(label.short, /Aug 25/);
  assert.equal(label.tone, 'neutral');
  assert.equal(label.short.includes('15-min'), false);
});

console.log(`\n${passed} tests passed`);
