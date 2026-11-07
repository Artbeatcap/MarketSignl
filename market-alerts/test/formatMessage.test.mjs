import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLowerHighMessage, assertSlackOk } from '../src/formatMessage.mjs';

const sample = {
  ticker: 'spy',
  h1Date: '2026-10-28',
  h1Price: 512.4,
  retestDate: '2026-10-31',
  retestHigh: 518.2,
  retestLow: 514.0,
  close: 511.1,
  invalidationAway: 1.3,
  invalidationAtr: 0.8,
  priceVsEma65: 'below',
  priceVsEma200: 'above',
  fiveDayPct: -1.4,
  gapsAbove: [520.1, 528.0],
};

describe('formatLowerHighMessage', () => {
  it('is numbers-first mrkdwn without raw angle brackets', () => {
    const text = formatLowerHighMessage(sample);
    assert.match(text, /^\*LOWER HIGH CONFIRMED: SPY\*/);
    assert.doesNotMatch(text, /</);
    assert.match(text, /below retest low/);
    assert.match(text, /Price below EMA65/);
    assert.match(text, /Price above EMA200/);
    assert.match(text, /UNTESTED RULE/);
    assert.ok(text.split(/\s+/).length <= 120);
  });
});

describe('assertSlackOk', () => {
  it('accepts ok:true and returns ts', () => {
    assert.equal(assertSlackOk({ ok: true, ts: '123.456' }), '123.456');
  });

  it('treats HTTP 200 ok:false as failure', () => {
    assert.throws(
      () => assertSlackOk({ status: 200, body: { ok: false, error: 'channel_not_found' } }),
      /channel_not_found/,
    );
  });
});
