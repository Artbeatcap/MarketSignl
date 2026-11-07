import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAILURE_PREFIX,
  redactError,
  formatFailureMessage,
  buildFailedRunFields,
} from '../src/errors.mjs';

describe('errors', () => {
  it('formats failure prefix with step', () => {
    const msg = formatFailureMessage('fetch_bars', new Error('HTTP 404'));
    assert.ok(msg.startsWith(FAILURE_PREFIX));
    assert.match(msg, /fetch_bars/);
    assert.match(msg, /HTTP 404/);
  });

  it('redacts slack bot tokens', () => {
    const out = redactError('token xoxb-1234567890-abcdefghijklmnop failed');
    assert.doesNotMatch(out, /xoxb-/);
    assert.match(out, /REDACTED/);
  });

  it('keeps root error separate from notify_error', () => {
    const fields = buildFailedRunFields({
      step: 'fetch_bars',
      error: 'empty bars',
      notifyError: 'channel_not_found',
    });
    assert.equal(fields.status, 'failed');
    assert.match(fields.error, /fetch_bars/);
    assert.match(fields.error, /empty bars/);
    assert.equal(fields.notify_error, 'channel_not_found');
  });
});
