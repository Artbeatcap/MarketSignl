/**
 * Self-running tests for sessionBars — which bars the 1D and 5D charts show.
 * Run: npx tsx apps/backend/src/lib/__tests__/sessionBars.test.ts
 *  or: npm test sessionBars   (from apps/backend)
 */

import assert from 'node:assert/strict';
import {
  InsufficientSessionBarsError,
  isRegularSessionBar,
  selectSessionBars,
  sessionDayKey,
} from '../sessionBars.js';

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

const MIN = 60_000;

/** UTC ms for a New York wall-clock time. `offsetHours` is 5 in winter (EST), 4 in summer (EDT). */
function et(y: number, m: number, d: number, hh: number, mm: number, offsetHours: number): number {
  return Date.UTC(y, m - 1, d, hh + offsetHours, mm);
}

/** Five-minute bars 04:00-19:55 ET (premarket, regular, after-hours) for each given day. */
function fullDays(days: Array<[number, number, number]>, offsetHours: number): Array<{ timestamp: number }> {
  const bars: Array<{ timestamp: number }> = [];
  for (const [y, m, d] of days) {
    const start = et(y, m, d, 4, 0, offsetHours);
    for (let i = 0; i < 192; i++) bars.push({ timestamp: start + i * 5 * MIN });
  }
  return bars;
}

const upTo = (bars: Array<{ timestamp: number }>, nowMs: number) => bars.filter((b) => b.timestamp <= nowMs);
const visibleOf = (r: { bars: Array<{ timestamp: number }>; visibleStartIndex: number }) =>
  r.bars.slice(r.visibleStartIndex);

// Nov 2026 is EST (UTC-5). Wed 4 - Mon 9, no bars on the weekend.
const NOV: Array<[number, number, number]> = [
  [2026, 11, 4],
  [2026, 11, 5],
  [2026, 11, 6],
  [2026, 11, 9],
];
const novBars = fullDays(NOV, 5);
const OPTS = { visibleBars: 156, warmupBars: 50 };

console.log('sessionBars');

test('09:30 ET is in the session and 16:00 ET is not, in winter and in summer', () => {
  assert.equal(isRegularSessionBar(et(2026, 11, 6, 9, 30, 5)), true);
  assert.equal(isRegularSessionBar(et(2026, 11, 6, 9, 25, 5)), false);
  assert.equal(isRegularSessionBar(et(2026, 11, 6, 15, 55, 5)), true);
  assert.equal(isRegularSessionBar(et(2026, 11, 6, 16, 0, 5)), false);
  // July is EDT (UTC-4)
  assert.equal(isRegularSessionBar(et(2026, 7, 8, 9, 30, 4)), true);
  assert.equal(isRegularSessionBar(et(2026, 7, 8, 9, 25, 4)), false);
  assert.equal(isRegularSessionBar(et(2026, 7, 8, 15, 55, 4)), true);
  assert.equal(isRegularSessionBar(et(2026, 7, 8, 16, 0, 4)), false);
});

test('weekend timestamps are never in the session', () => {
  assert.equal(isRegularSessionBar(et(2026, 11, 7, 11, 0, 5)), false); // Saturday
  assert.equal(isRegularSessionBar(et(2026, 11, 8, 11, 0, 5)), false); // Sunday
});

test('Sunday noon: two full regular sessions (Thursday and Friday)', () => {
  const r = selectSessionBars(upTo(novBars, et(2026, 11, 8, 12, 0, 5)), OPTS);
  const visible = visibleOf(r);
  assert.equal(visible.length, 156);
  assert.ok(visible.every((b) => isRegularSessionBar(b.timestamp)));
  assert.deepEqual([...new Set(visible.map((b) => sessionDayKey(b.timestamp)))], ['2026-11-05', '2026-11-06']);
  assert.equal(visible[0].timestamp, et(2026, 11, 5, 9, 30, 5));
  assert.equal(visible[155].timestamp, et(2026, 11, 6, 15, 55, 5));
  assert.equal(r.visibleStartIndex, 50, 'warmup comes from the session before');
});

test('Monday 08:00 (premarket): identical bars to Sunday, premarket excluded', () => {
  const sunday = visibleOf(selectSessionBars(upTo(novBars, et(2026, 11, 8, 12, 0, 5)), OPTS));
  const monday = visibleOf(selectSessionBars(upTo(novBars, et(2026, 11, 9, 8, 0, 5)), OPTS));
  assert.deepEqual(monday, sunday);
});

test('Monday 10:00: still 156 bars, ending at the latest regular-session bar', () => {
  const visible = visibleOf(selectSessionBars(upTo(novBars, et(2026, 11, 9, 9, 59, 5)), OPTS));
  assert.equal(visible.length, 156);
  assert.equal(visible[155].timestamp, et(2026, 11, 9, 9, 55, 5));
  assert.ok(visible.every((b) => isRegularSessionBar(b.timestamp)));
});

test('a holiday in the week still gives 156 bars', () => {
  // Thanksgiving Thu Nov 26, 2026 has no bars at all.
  const bars = fullDays(
    [
      [2026, 11, 24],
      [2026, 11, 25],
      [2026, 11, 27],
    ],
    5,
  );
  const visible = visibleOf(selectSessionBars(bars, OPTS));
  assert.equal(visible.length, 156);
  assert.deepEqual([...new Set(visible.map((b) => sessionDayKey(b.timestamp)))], ['2026-11-25', '2026-11-27']);
});

test('summer (EDT) week selects the same session hours', () => {
  const bars = fullDays(
    [
      [2026, 7, 7],
      [2026, 7, 8],
      [2026, 7, 9],
    ],
    4,
  );
  const visible = visibleOf(selectSessionBars(bars, OPTS));
  assert.equal(visible.length, 156);
  assert.equal(visible[0].timestamp, et(2026, 7, 8, 9, 30, 4));
  assert.equal(visible[155].timestamp, et(2026, 7, 9, 15, 55, 4));
});

test('fewer regular-session bars than the minimum throws, with no fallback', () => {
  // Monday premarket only: 49 bars, none in the regular session.
  const premarketOnly = fullDays([[2026, 11, 9]], 5).filter((b) => b.timestamp < et(2026, 11, 9, 8, 5, 5));
  assert.ok(premarketOnly.length > 20);
  assert.throws(() => selectSessionBars(premarketOnly, OPTS), InsufficientSessionBarsError);
});

test('a short history shows what exists instead of failing', () => {
  const oneDay = fullDays([[2026, 11, 6]], 5);
  const r = selectSessionBars(oneDay, OPTS);
  assert.equal(r.bars.length, 78);
  assert.equal(r.visibleStartIndex, 0);
});

console.log(`\n${passed} passed`);
