import assert from 'node:assert/strict';
import { resolveEarningsRows } from '../resolve.js';
import type { EarningsRow } from '../types.js';

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

function row(partial: Partial<EarningsRow> & Pick<EarningsRow, 'ticker' | 'date' | 'source'>): EarningsRow {
  return {
    session: 'unknown',
    epsEstimate: null,
    fiscalYear: 2026,
    fiscalPeriod: 'Q3',
    confidence: partial.source === 'news' ? 'inferred' : 'reported',
    ...partial,
  };
}

test('conflicting dates: Finnhub wins over FMP for the same fiscal period', () => {
  const merged = resolveEarningsRows([
    [row({ ticker: 'AVGO', date: '2026-09-04', source: 'finnhub', session: 'amc' })],
    [row({ ticker: 'AVGO', date: '2026-09-02', source: 'fmp', session: 'unknown' })],
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].date, '2026-09-04');
  assert.equal(merged[0].source, 'finnhub');
  assert.equal(merged[0].session, 'amc');
  assert.equal(merged[0].sessionSource, 'finnhub');
});

test('one provider down: remaining rows still resolve', () => {
  const merged = resolveEarningsRows([
    [],
    [row({ ticker: 'DELL', date: '2026-09-01', source: 'fmp', session: 'amc', fiscalYear: null, fiscalPeriod: null })],
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].ticker, 'DELL');
  assert.equal(merged[0].source, 'fmp');
  assert.equal(merged[0].session, 'amc');
});

test('session-only fill: higher-precedence unknown date keeps FMP amc', () => {
  const merged = resolveEarningsRows([
    [row({ ticker: 'AVGO', date: '2026-09-02', source: 'finnhub', session: 'unknown' })],
    [row({ ticker: 'AVGO', date: '2026-09-02', source: 'fmp', session: 'amc' })],
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'finnhub');
  assert.equal(merged[0].date, '2026-09-02');
  assert.equal(merged[0].session, 'amc');
  assert.equal(merged[0].sessionSource, 'fmp');
});

test('news never overrides a provider row in the same cluster', () => {
  const merged = resolveEarningsRows([
    [row({ ticker: 'AVGO', date: '2026-09-04', source: 'finnhub', session: 'amc' })],
    [row({ ticker: 'AVGO', date: '2026-09-02', source: 'news', session: 'unknown', confidence: 'inferred', fiscalYear: null, fiscalPeriod: null })],
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'finnhub');
  assert.equal(merged[0].date, '2026-09-04');
  assert.equal(merged[0].confidence, 'reported');
});

test('news fills when no provider row exists for that ticker', () => {
  const merged = resolveEarningsRows([
    [row({ ticker: 'DELL', date: '2026-09-01', source: 'fmp', session: 'amc' })],
    [row({ ticker: 'AVGO', date: '2026-09-02', source: 'news', session: 'unknown', confidence: 'inferred', fiscalYear: null, fiscalPeriod: null })],
  ]);
  const avgo = merged.find((r) => r.ticker === 'AVGO');
  assert.ok(avgo);
  assert.equal(avgo.source, 'news');
  assert.equal(avgo.confidence, 'inferred');
  assert.equal(avgo.dateStatus, 'projected');
});

console.log(`\n${passed} tests passed`);
