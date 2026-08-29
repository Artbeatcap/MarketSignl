/**
 * Feed timestamp extraction tests (ns vs ms trap).
 * Run: npx tsx apps/backend/src/lib/__tests__/feedFreshness.test.ts
 */
import assert from 'node:assert/strict';
import {
  freshnessFromBars,
  freshnessFromSnapshot,
  validateClientFreshness,
  FreshnessValidationError,
} from '../feedFreshness.js';

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

const MS = 1_787_875_140_000; // 2026-ish ms
const NS = MS * 1_000_000;

test('snapshot lastTrade.t nanoseconds convert to a 2026 asOf, not year 58000', () => {
  const f = freshnessFromSnapshot({ lastTrade: { t: NS } });
  assert.ok(f);
  const y = new Date(f.asOf).getUTCFullYear();
  assert.ok(y >= 2000 && y <= 2100, `year ${y}`);
});

test('bars t in milliseconds are used as-is', () => {
  const f = freshnessFromBars([{ t: MS }]);
  assert.ok(f);
  assert.equal(Date.parse(f.asOf), MS);
});

test('empty bars do not fabricate Date.now()', () => {
  assert.equal(freshnessFromBars([]), null);
});

test('validateClientFreshness rejects year-58000 garbage', () => {
  assert.throws(
    () =>
      validateClientFreshness({
        asOf: '58000-01-01T00:00:00.000Z',
        delayMinutes: 15,
        isDelayed: true,
        source: 'x',
      }),
    FreshnessValidationError,
  );
});

test('validateClientFreshness accepts a recent ISO timestamp', () => {
  const asOf = new Date(MS).toISOString();
  const f = validateClientFreshness(
    { asOf, delayMinutes: 15, isDelayed: true, source: 'Polygon.io' },
    MS + 60_000,
  );
  assert.equal(f.asOf, asOf);
});

console.log(`\n${passed} tests passed`);
