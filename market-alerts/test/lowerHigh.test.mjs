import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLowerHighs } from '../src/lowerHigh.mjs';
import { validateBars, MIN_BARS } from '../src/fetchBars.mjs';
import { setupDedupeKey } from '../src/runs.mjs';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spy-daily.json');

describe('detectLowerHighs', () => {
  it('rejects bar count < 220', () => {
    assert.throws(() => detectLowerHighs('SPY', Array(10).fill({ date: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1 })), /bar count/);
  });

  it('finds setups in synthetic fixture when present', () => {
    if (!existsSync(fixturePath)) {
      console.warn('skip: no fixture yet');
      return;
    }
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    if (fixture.source !== 'synthetic') {
      // Live SPY may have zero latest signals — still must not throw
      assert.doesNotThrow(() => detectLowerHighs('SPY', fixture.bars, { onlyLatest: false }));
      return;
    }
    const all = detectLowerHighs('SPY', fixture.bars, { onlyLatest: false });
    assert.ok(all.length >= 1);
    const key = setupDedupeKey(all[0]);
    assert.match(key, /^SPY\|/);
  });
});

describe('validateBars', () => {
  it('flags freshness failures', () => {
    const bars = Array.from({ length: MIN_BARS }, (_, i) => ({
      date: '2020-01-02',
      open: 1,
      high: 2,
      low: 0.5,
      close: 1,
      t: Date.parse('2020-01-02T21:00:00Z') + i * 86400000,
    }));
    assert.throws(() => validateBars(bars, new Date('2026-11-03')), /freshness fail/);
  });
});
