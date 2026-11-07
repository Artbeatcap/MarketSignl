import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLowerHighMessage, assertSlackOk } from '../src/formatMessage.mjs';
import { formatFailureMessage, buildFailedRunFields, FAILURE_PREFIX } from '../src/errors.mjs';

describe('formatLowerHighMessage', () => {
  it('is numbers-first, under 120 words, and has no raw < characters', () => {
    const msg = formatLowerHighMessage({
      ticker: 'spy',
      h1Date: '2026-10-28',
      h1Price: 512.4,
      retestDate: '2026-10-31',
      retestHigh: 518.2,
      retestLow: 514.0,
      close: 511.1,
      invalidationAway: 2.3,
      invalidationAtr: 0.8,
      priceVsEma65: 'below',
      priceVsEma200: 'above',
      fiveDayPct: -1.4,
      gapsAbove: [520.1, 528.0],
    });
    assert.match(msg, /^\*LOWER HIGH CONFIRMED: SPY\*/);
    assert.equal(msg.includes('<'), false);
    assert.match(msg, /below retest low/);
    assert.match(msg, /Price below EMA65/);
    assert.match(msg, /UNTESTED RULE/);
    assert.ok(msg.trim().split(/\s+/).length <= 120);
  });
});

describe('assertSlackOk', () => {
  it('treats HTTP 200 ok:false as failure', () => {
    assert.throws(
      () => assertSlackOk({ status: 200, body: { ok: false, error: 'channel_not_found' } }),
      /channel_not_found/,
    );
  });

  it('returns ts when ok', () => {
    assert.equal(assertSlackOk({ ok: true, ts: '123.456' }), '123.456');
  });
});

describe('failure fields', () => {
  it('keeps root error separate from notify_error', () => {
    const fields = buildFailedRunFields({
      step: 'fetch_bars',
      error: new Error('HTTP 500 boom'),
      notifyError: new Error('channel_not_found'),
    });
    assert.equal(fields.status, 'failed');
    assert.match(fields.error, /^fetch_bars:/);
    assert.match(fields.error, /HTTP 500/);
    assert.equal(fields.notify_error, 'channel_not_found');
    assert.equal(formatFailureMessage('fetch_bars', 'boom').startsWith(FAILURE_PREFIX), true);
  });
});
