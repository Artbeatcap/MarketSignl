import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DRIVE_FOLDER_NAME,
  FAILURE_PREFIX,
  PROVIDERS,
  YT_DLP_VERSION,
  applyProviderResult,
  applyYtDlp,
  channelIdFromListResponse,
  creditWarningNeeded,
  documentBody,
  documentName,
  formatDateEt,
  formatFailureDm,
  dropAlreadyNotified,
  healthUrlFor,
  interpretProviderHttp,
  isTooShortForDuration,
  pickPrivateFolder,
  prepareSave,
  providerOrder,
  readbackFailure,
  sqlLiteral,
  summarizeRun,
  supadataStartupFailure,
  transcriptApiCredentialMissing,
  TRANSCRIPTAPI_SKIPPED,
  configPresence,
  readTranscriptConfig,
  missingAlertChannelQuery,
  upsertTranscriptQuery,
  discoveryFailure,
  parseDiscoveryLines,
  publishInstantFromWatch,
  selectDiscoveredVideos,
  youtubeDiscoveryCommand,
  ytDlpCommand,
} from '../lib/run.js';

describe('run decisions', () => {
  it('names the doc from the publish date in America/New_York', () => {
    const name = documentName({
      slug: 'mike-jones-investing',
      publishedAt: '2026-11-04T15:00:00.000Z',
      title: 'These Sectors Are Setting Up For Big Moves!',
    });
    assert.equal(name, 'mike-jones-investing 2026-11-04 These Sectors Are Setting Up For Big Moves!');
    assert.equal(formatDateEt('2026-10-27T02:15:21.000Z'), '2026-10-26');
  });

  it('puts the required header lines ahead of the transcript', () => {
    const body = documentBody({
      source: 'market-mondays',
      title: 'Episode',
      publishedAt: '2026-10-27T02:15:21.000Z',
      url: 'https://example.com/a.mp3',
      durationSeconds: 7350,
      method: 'feed_vtt',
      text: '[0:00:00] Hello',
    });
    const lines = body.split('\n');
    assert.deepEqual(lines.slice(0, 7), [
      'source: market-mondays',
      'title: Episode',
      'publish date: 2026-10-26',
      'url: https://example.com/a.mp3',
      'duration: 2:02:30',
      'method: feed_vtt',
      'auto-generated captions, speakers not labeled',
    ]);
  });

  it('counts a short transcript of a long video as a failure before any Drive write', () => {
    assert.equal(isTooShortForDuration({ chars: 1999, durationSeconds: 601 }), true);
    assert.equal(isTooShortForDuration({ chars: 2000, durationSeconds: 601 }), false);
    assert.equal(isTooShortForDuration({ chars: 100, durationSeconds: 600 }), false);
    const prepared = prepareSave({
      slug: 'mike-jones-investing',
      itemId: 'jzpi6KNr0Dg',
      title: 'Too short',
      publishedAt: '2026-11-04T15:00:00.000Z',
      url: 'https://www.youtube.com/watch?v=jzpi6KNr0Dg',
      durationSeconds: 1200,
      method: 'provider_primary',
      text: 'only a little text',
      attempts: [],
      folderId: 'folder',
    });
    assert.equal(prepared.status, 'failed');
    assert.equal(prepared.multipartBody, undefined);
  });

  it('tries the other provider when the primary errors or is empty', () => {
    const order = providerOrder('supadata');
    assert.deepEqual(order, { primary: 'supadata', secondary: 'transcriptapi' });
    assert.equal(PROVIDERS.supadata.url, 'https://api.supadata.ai/v1/transcript');
    assert.equal(PROVIDERS.supadata.header, 'x-api-key');
    assert.equal(PROVIDERS.transcriptapi.url, 'https://transcriptapi.com/api/v2/youtube/transcript');
    assert.equal(PROVIDERS.transcriptapi.header, 'Authorization');
    assert.deepEqual(PROVIDERS.supadata.query('https://www.youtube.com/watch?v=jzpi6KNr0Dg'), {
      url: 'https://www.youtube.com/watch?v=jzpi6KNr0Dg',
      lang: 'en',
      text: 'false',
      mode: 'native',
    });

    const failed = applyProviderResult(
      { attempts: [], credits: 0 },
      { which: 'provider_primary', provider: 'supadata', statusCode: 401, body: { error: 'bad key' }, headers: {} },
    );
    assert.equal(failed.needsAnother, true);
    assert.equal(failed.attempts[0].method, 'provider_primary');

    const sample = JSON.parse(readFileSync(new URL('./fixtures/provider-transcriptapi.json', import.meta.url), 'utf8'));
    const saved = applyProviderResult(failed, {
      which: 'provider_secondary',
      provider: 'transcriptapi',
      statusCode: 200,
      body: sample,
      headers: {},
    });
    assert.equal(saved.needsAnother, false);
    assert.equal(saved.method, 'provider_secondary');
    assert.equal(saved.credits, 1);
    assert.match(saved.text, /Next point/);
  });

  it('counts Supadata credits from x-billable-requests and TranscriptAPI failures as free', () => {
    const billed = interpretProviderHttp({
      provider: 'supadata',
      statusCode: 206,
      body: { error: 'transcript-unavailable' },
      headers: { 'x-billable-requests': '1' },
    });
    assert.equal(billed.ok, false);
    assert.equal(billed.credits, 1);
    const free = interpretProviderHttp({
      provider: 'transcriptapi',
      statusCode: 404,
      body: { error: 'not found' },
      headers: {},
    });
    assert.equal(free.credits, 0);
    const summary = summarizeRun({
      outcomes: [
        { status: 'saved', credits: 1, slug: 'a' },
        { status: 'failed', credits: 2, slug: 'b', title: 'second', attempts: [{ method: 'provider_primary', error: 'HTTP 500' }] },
      ],
    });
    assert.equal(summary.credits, 3);
  });

  it('keeps every yt-dlp error when all methods fail', () => {
    const item = applyYtDlp(
      {
        attempts: [
          { method: 'provider_primary', error: 'HTTP 401 bad key' },
          { method: 'provider_secondary', error: 'HTTP 401 bad key' },
        ],
      },
      { ok: false, text: '', error: 'ERROR: Sign in to confirm you’re not a bot' },
    );
    assert.equal(item.status, 'failed');
    assert.match(item.error, /provider_primary/);
    assert.match(item.error, /provider_secondary/);
    assert.match(item.error, /yt_dlp/);
    assert.match(item.error, /Sign in to confirm/);
    const command = ytDlpCommand('jzpi6KNr0Dg');
    assert.match(command.command, /--skip-download/);
    assert.match(command.command, /--write-auto-subs/);
    assert.match(command.command, /--sub-langs en/);
    assert.match(command.command, /--sub-format vtt/);
    assert.equal(YT_DLP_VERSION, '2026.10.26');
    assert.throws(() => ytDlpCommand('not a video'), /invalid video id/);
    const commandText = youtubeDiscoveryCommand('UCzksXiC-Ju-DTIZmMiaOVfQ');
    assert.match(commandText, /--flat-playlist/);
    assert.match(commandText, /--playlist-end 5/);
    assert.ok(commandText.includes("%(id)s|%(title)s|%(duration)s"));
    assert.match(commandText, /\/channel\/UCzksXiC-Ju-DTIZmMiaOVfQ\/videos/);
    assert.throws(() => youtubeDiscoveryCommand('nope'), /invalid channel id/);
    const lines = parseDiscoveryLines([
      'jzpi6KNr0Dg|A long one|988',
      'shortvideo1|Too short|90',
      'threeMinVid|Exactly three|180',
    ].join('\n'));
    assert.deepEqual(selectDiscoveredVideos(lines).map((video) => video.itemId), ['jzpi6KNr0Dg', 'threeMinVid']);
    assert.equal(
      formatFailureDm([discoveryFailure('lance-b', 'zero videos')]),
      'TRANSCRIPT FETCH FAILED - discovery: lance-b: zero videos',
    );
    assert.equal(publishInstantFromWatch('"publishDate":{"simpleText":"Nov 4, 2026"}'), '2026-11-04T17:00:00.000Z');
    assert.equal(formatDateEt('2026-11-04T17:00:00.000Z'), '2026-11-04');
  });

  it('refuses to guess a channel id', () => {
    assert.throws(
      () => channelIdFromListResponse({ items: [] }),
      /refusing to guess/,
    );
    assert.throws(
      () => channelIdFromListResponse({ items: [{ id: 'nope' }, { id: 'UCNeBCizpA1NbX7A9_ia6jYg' }] }),
      /refusing to guess/,
    );
    assert.equal(
      channelIdFromListResponse({ items: [{ id: 'UCNeBCizpA1NbX7A9_ia6jYg' }] }),
      'UCNeBCizpA1NbX7A9_ia6jYg',
    );
  });

  it('sends the seven-day podcast notice once and leaves a waiting episode quiet', () => {
    const noticed = summarizeRun({
      outcomes: [{
        status: 'failed',
        slug: 'market-mondays',
        title: 'Is the AI Bubble Bursting?',
        error: 'no transcript after 7 days: Is the AI Bubble Bursting?',
        noticeOnce: true,
        attempts: [],
        credits: 0,
      }],
    });
    assert.equal(noticed.ok, false);
    assert.equal(
      noticed.dm,
      'TRANSCRIPT FETCH FAILED - market-mondays: no transcript after 7 days: Is the AI Bubble Bursting?',
    );
    const waiting = summarizeRun({
      outcomes: [{ status: 'waiting', slug: 'market-mondays', title: 'Is the AI Bubble Bursting?', credits: 0 }],
    });
    assert.equal(waiting.ok, true);
    assert.equal(waiting.waiting, 1);
    assert.equal(waiting.dm, '');
    assert.deepEqual(
      dropAlreadyNotified([{ itemId: 'a' }, { itemId: 'b' }], ['a']).map((item) => item.itemId),
      ['b'],
    );
  });

  it('sends one failure DM that names every method', () => {
    const summary = summarizeRun({
      outcomes: [
        {
          slug: 'mike-jones-investing',
          title: 'These Sectors Are Setting Up For Big Moves!',
          status: 'failed',
          credits: 0,
          attempts: [
            { method: 'provider_primary', error: 'HTTP 401' },
            { method: 'provider_secondary', error: 'empty transcript' },
            { method: 'yt_dlp', error: 'ERROR: blocked' },
          ],
        },
      ],
      sourceFailures: [],
      limit: 100,
    });
    assert.equal(summary.ok, false);
    assert.equal(summary.failed, 1);
    assert.ok(summary.dm.startsWith(FAILURE_PREFIX));
    assert.match(summary.dm, /mike-jones-investing: These Sectors/);
    assert.match(summary.dm, /provider_primary: HTTP 401/);
    assert.match(summary.dm, /yt_dlp: ERROR: blocked/);
    assert.equal(formatFailureDm([]), '');
  });

  it('warns once at 80% of the monthly limit and pings /fail only on failure', () => {
    assert.equal(creditWarningNeeded({ creditsUsed: 79, limit: 100, alreadyWarned: false }), false);
    assert.equal(creditWarningNeeded({ creditsUsed: 80, limit: 100, alreadyWarned: false }), true);
    assert.equal(creditWarningNeeded({ creditsUsed: 100, limit: 100, alreadyWarned: true }), false);
    assert.equal(healthUrlFor('https://hc.example/uuid', true), 'https://hc.example/uuid');
    assert.equal(healthUrlFor('https://hc.example/uuid/', false), 'https://hc.example/uuid/fail');
  });

  it('accepts only an unshared folder and a readable doc', () => {
    assert.equal(DRIVE_FOLDER_NAME, 'Trading Transcripts');
    assert.equal(pickPrivateFolder([{ id: 'shared', shared: true }, { id: 'mine', shared: false }]), 'mine');
    assert.equal(pickPrivateFolder([{ id: 'shared', shared: true }]), null);
    assert.equal(readbackFailure({ id: '1', name: 'Doc', mimeType: 'application/vnd.google-apps.document', trashed: false, parents: ['folder'] }, { name: 'Doc', folderId: 'folder' }), null);
    assert.match(readbackFailure({ id: '1', trashed: true }, {}), /trashed/);
    assert.match(readbackFailure(null, {}), /missing id/);
  });

  it('escapes quotes in SQL values', () => {
    const sql = upsertTranscriptQuery({
      slug: 'mike-jones-investing',
      itemId: "it's",
      title: "O'Hare",
      publishedAt: '2026-11-04T15:00:00.000Z',
      status: 'saved',
      method: 'feed_vtt',
      driveFileId: 'file',
      chars: 120000,
      error: null,
    });
    assert.match(sql, /it''s/);
    assert.match(sql, /O''Hare/);
    assert.equal(sqlLiteral("a'b"), "'a''b'");
  });

  it('treats a second run with nothing new as success and no DM', () => {
    const summary = summarizeRun({ outcomes: [], sourceFailures: [], limit: 100 });
    assert.equal(summary.ok, true);
    assert.equal(summary.saved, 0);
    assert.equal(summary.dm, '');
    assert.equal(summary.transcriptApiNote, '');
  });

  it('skips an empty TranscriptAPI credential and still fails a missing Supadata key', () => {
    assert.equal(transcriptApiCredentialMissing({
      error: { message: 'Credentials not found for httpHeaderAuth' },
    }), true);
    assert.equal(transcriptApiCredentialMissing({ statusCode: 401, body: { error: 'bad key' } }), false);
    const summary = summarizeRun({
      outcomes: [{ status: 'saved', transcriptApiSkipped: true, credits: 0 }],
      sourceFailures: [],
      limit: 100,
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.transcriptApiNote, TRANSCRIPTAPI_SKIPPED);
    assert.equal(supadataStartupFailure({ errorText: 'Credentials not found' }), 'Supadata API Key missing');
    assert.equal(supadataStartupFailure({ statusCode: 401 }), 'Supadata API Key rejected');
    assert.equal(supadataStartupFailure({ statusCode: 400 }), null);
    assert.throws(() => healthUrlFor(''), /HEALTHCHECK_TRANSCRIPTS_URL missing/);
    const env = {
      TRANSCRIPT_TIMEZONE: 'America/New_York',
      TRANSCRIPT_PROVIDER: 'supadata',
      MONTHLY_TRANSCRIPT_LIMIT: '100',
      SLACK_ALERT_CHANNEL: 'U0AM7HAMB09',
      HEALTHCHECK_TRANSCRIPTS_URL: 'https://example.invalid/secret',
    };
    const ready = readTranscriptConfig(env, 'America/New_York');
    assert.equal(ready.ok, true);
    assert.deepEqual(configPresence(env), {
      TRANSCRIPT_TIMEZONE: true,
      TRANSCRIPT_PROVIDER: true,
      MONTHLY_TRANSCRIPT_LIMIT: true,
      SLACK_ALERT_CHANNEL: true,
      HEALTHCHECK_TRANSCRIPTS_URL: true,
    });
    const noHealth = readTranscriptConfig({ ...env, HEALTHCHECK_TRANSCRIPTS_URL: '' });
    assert.equal(noHealth.dm, 'TRANSCRIPT FETCH FAILED - missing config: HEALTHCHECK_TRANSCRIPTS_URL');
    const noChannel = readTranscriptConfig({ ...env, SLACK_ALERT_CHANNEL: '  ' });
    assert.equal(noChannel.noAlertChannel, true);
    assert.match(missingAlertChannelQuery('exec-1'), /no alert channel/);
    assert.doesNotMatch(missingAlertChannelQuery('exec-1'), /HEALTHCHECK/);
  });
});
