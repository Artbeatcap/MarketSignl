import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeCues,
  formatStamp,
  providerJsonToPlainText,
  slugify,
  vttToPlainText,
} from '../lib/vtt.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('vtt', () => {
  it('drops duplicate caption lines and keeps timestamps about every 30 seconds', () => {
    const text = vttToPlainText(fixture('sample.vtt'));
    assert.equal(text.split('Hello there').length - 1, 1);
    assert.match(text, /^\[0:00:00\] Hello there/);
    assert.match(text, /Second line/);
    assert.match(text, /\[0:00:31\] After thirty seconds/);
    assert.match(text, /\[0:01:05\] One minute five/);
    assert.doesNotMatch(text, /\[0:00:10\]/);
  });

  it('parses minute:second VTT cues used by podcast transcripts', () => {
    const text = vttToPlainText('WEBVTT\n\n00:00.751 --> 00:03.112\nHello\n\n00:40.000 --> 00:42.000\nLater\n');
    assert.match(text, /^\[0:00:00\] Hello/);
    assert.match(text, /\[0:00:40\] Later/);
  });

  it('parses a Supadata provider JSON sample', () => {
    const text = providerJsonToPlainText(fixture('provider-supadata.json'));
    assert.equal(text.split('Hello there').length - 1, 1);
    assert.match(text, /\[0:00:00\] Hello there/);
    assert.match(text, /Second line/);
    assert.match(text, /\[0:00:31\] After thirty seconds/);
  });

  it('parses a TranscriptAPI provider JSON sample', () => {
    const text = providerJsonToPlainText(fixture('provider-transcriptapi.json'));
    assert.match(text, /\[0:00:00\] Hello there/);
    assert.match(text, /\[0:00:40\] Next point/);
    assert.equal(text.split('Hello there').length - 1, 1);
  });

  it('treats an empty provider payload as no transcript', () => {
    assert.equal(providerJsonToPlainText({ content: [] }), '');
    assert.equal(providerJsonToPlainText({ transcript: [] }), '');
    assert.equal(providerJsonToPlainText({ jobId: 'abc' }), '');
  });

  it('slugifies titles', () => {
    assert.equal(slugify('These Sectors Are Setting Up!'), 'these-sectors-are-setting-up');
  });

  it('formats stamps as h:mm:ss', () => {
    assert.equal(formatStamp(0), '[0:00:00]');
    assert.equal(formatStamp(65), '[0:01:05]');
    assert.equal(formatStamp(3661), '[1:01:01]');
  });

  it('dedupes only consecutive repeats', () => {
    const cues = dedupeCues([
      { start: 0, text: 'Same' },
      { start: 2, text: 'Same' },
      { start: 40, text: 'Other' },
      { start: 70, text: 'Same' },
    ]);
    assert.deepEqual(cues.map((cue) => cue.text), ['Same', 'Other', 'Same']);
  });
});
