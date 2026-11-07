import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBars, MIN_BARS } from '../src/fetchBars.mjs';

describe('validateBars', () => {
  it('fails empty', () => {
    assert.throws(() => validateBars([]), /empty bars/);
  });

  it('fails short history', () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      t: Date.now(),
    }));
    assert.throws(() => validateBars(bars), new RegExp(`bar count < ${MIN_BARS}`));
  });

  it('fails stale last bar', () => {
    const bars = Array.from({ length: MIN_BARS }, (_, i) => ({
      date: '2020-01-01',
      t: Date.parse('2020-01-01T21:00:00Z') + i * 86400000,
    }));
    assert.throws(() => validateBars(bars, new Date('2026-11-03')), /freshness fail/);
  });
});
