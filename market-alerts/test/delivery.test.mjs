import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDelivery, createRunStore, RUN_STATUS } from '../src/delivery.mjs';
import { runStructureAlert, handleErrorTrigger } from '../src/pipeline.mjs';
import { FAILURE_PREFIX } from '../src/errors.mjs';
import { detectLowerHighs } from '../src/lowerHigh.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '../fixtures/spy-daily.json');

function mockSlack(handler) {
  const posts = [];
  return {
    posts,
    postSlack: async (text, channel) => {
      posts.push({ channel, text });
      return handler({ channel, text, index: posts.length - 1 });
    },
  };
}

function okSlackApi() {
  return async (method) => {
    if (method === 'auth.test') return { ok: true, user_id: 'B1' };
    if (method === 'conversations.open') return { ok: true, channel: { id: 'D1' } };
    if (method === 'conversations.info') return { ok: true, channel: { id: 'C1' } };
    return { ok: false, error: 'unknown_method' };
  };
}

async function loadFixtureBars() {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  return fixture.bars;
}

const baseOpts = {
  timezone: 'America/New_York',
  healthcheckUrl: 'https://hc.example/uuid',
  slackApi: okSlackApi(),
};

describe('delivery failure model', () => {
  it('1) bad MASSIVE_BASE_URL → STRUCTURE ALERT FAILED message + failed row', async () => {
    const slack = mockSlack(async () => ({ ok: true, ts: '1.1' }));
    const pings = [];
    const { run } = await runStructureAlert({
      ...baseOpts,
      tickers: ['SPY'],
      executionId: 'exec-bad-url',
      slackChannel: 'U123',
      postSlack: slack.postSlack,
      pingHealthcheck: async (url) => {
        pings.push(url);
      },
      fetchBars: async () => {
        const err = new Error('fetch failed');
        err.step = 'fetch_bars';
        throw err;
      },
    });

    assert.equal(run.status, RUN_STATUS.FAILED);
    assert.match(run.error, /fetch_bars/);
    assert.ok(slack.posts.some((p) => p.text.startsWith(FAILURE_PREFIX)));
    assert.ok(pings.some((u) => u.endsWith('/fail')));
  });

  it('2) bad SLACK_ALERT_CHANNEL → failed row with channel_not_found', async () => {
    const bars = await loadFixtureBars();
    const all = detectLowerHighs('SPY', bars, { onlyLatest: false });
    assert.ok(all.length >= 1, 'fixture must contain at least one historical setup');

    const slack = mockSlack(async () => ({ ok: false, error: 'channel_not_found' }));
    const store = createRunStore();
    const delivery = createDelivery({
      slack: {
        postMessage: async (channel, text) => slack.postSlack(text, channel),
      },
      channel: 'BAD_CHANNEL',
      runs: store,
    });
    const run = delivery.startRun({ executionId: 'exec-bad-channel', tickers: ['SPY'] });
    try {
      await delivery.completeSuccess({ runId: run.id, setups: [all[all.length - 1]] });
      assert.fail('expected slack failure');
    } catch (e) {
      assert.match(String(e.message), /channel_not_found/);
    }
    const failed = store.get(run.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /channel_not_found/);
  });

  it('3) restored values → ok row + success healthcheck ping', async () => {
    const bars = await loadFixtureBars();
    const slack = mockSlack(async () => ({ ok: true, ts: '99.1' }));
    const pings = [];
    const { run, setups } = await runStructureAlert({
      ...baseOpts,
      tickers: ['SPY'],
      executionId: 'exec-ok',
      slackChannel: 'U123',
      postSlack: slack.postSlack,
      pingHealthcheck: async (url) => {
        pings.push(url);
      },
      fetchBars: async () => bars,
    });

    assert.equal(run.status, RUN_STATUS.OK);
    assert.equal(run.alert_count, setups.length);
    if (setups.length > 0) {
      assert.equal(run.slack_ts, '99.1');
      assert.ok(slack.posts.some((p) => p.text.includes('LOWER HIGH CONFIRMED')));
    }
    assert.deepEqual(pings, ['https://hc.example/uuid']);
  });

  it('Slack notify failure still records failed with root error + notify_error', async () => {
    const slack = mockSlack(async () => ({ ok: false, error: 'fatal_error' }));
    const delivery = createDelivery({
      slack: {
        postMessage: async (channel, text) => slack.postSlack(text, channel),
      },
      channel: 'U123',
      runs: createRunStore(),
    });
    const run = delivery.startRun({ executionId: 'x', tickers: ['SPY'] });
    const failed = await delivery.fail({
      runId: run.id,
      step: 'validate_bars',
      error: 'bar count < 220',
    });
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /validate_bars/);
    assert.match(failed.notify_error, /fatal_error/);
  });

  it('Error Trigger marks leftover running rows failed and pings /fail', async () => {
    const store = createRunStore();
    store.insert({
      status: RUN_STATUS.RUNNING,
      n8n_execution_id: 'crash-1',
      alert_count: 0,
      tickers: ['SPY'],
      error: null,
      notify_error: null,
      slack_ts: null,
      run_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      finished_at: null,
    });
    const slack = mockSlack(async () => ({ ok: true, ts: '1' }));
    const pings = [];
    const updated = await handleErrorTrigger({
      store,
      executionId: 'crash-1',
      error: new Error('node crashed'),
      postSlack: slack.postSlack,
      slackChannel: 'U1',
      healthcheckUrl: 'https://hc.example/uuid',
      pingHealthcheck: async (url) => {
        pings.push(url);
      },
    });
    assert.equal(updated.length, 1);
    assert.equal(updated[0].status, 'failed');
    assert.match(updated[0].error, /error_trigger/);
    assert.ok(slack.posts[0].text.startsWith(FAILURE_PREFIX));
    assert.ok(pings[0].endsWith('/fail'));
  });
});
