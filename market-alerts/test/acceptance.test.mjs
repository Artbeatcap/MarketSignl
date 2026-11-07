import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayRange, backtestSummary } from '../src/acceptance.mjs';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spy-daily.json');

describe('acceptance outputs', () => {
  it('replays Oct 26–30 2026 with H1/R/trigger or reason', () => {
    assert.ok(existsSync(fixturePath), 'run fetch-fixture first');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const rows = replayRange(fixture.ticker || 'SPY', fixture.bars, {
      from: '2026-10-26',
      to: '2026-10-30',
    });
    assert.ok(rows.length >= 4);
    for (const row of rows) {
      assert.ok(row.date);
      if (row.trigger) {
        assert.ok(row.h1?.date);
        assert.ok(row.r?.date);
        assert.equal(row.reason, null);
      } else {
        assert.ok(typeof row.reason === 'string' && row.reason.length > 0);
      }
    }
  });

  it('backtest summary exposes fires and forward stats', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const summary = backtestSummary(fixture.ticker || 'SPY', fixture.bars);
    assert.ok(summary.fires >= 1);
    assert.ok('d1' in summary.mean && 'd5' in summary.mean && 'd10' in summary.mean);
    assert.ok('d1' in summary.median);
    assert.ok(summary.pctHitH1BeforeMinus1Atr == null || summary.pctHitH1BeforeMinus1Atr >= 0);
  });
});
