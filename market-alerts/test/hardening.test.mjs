import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runStructureAlert, createRunStore, RUN_STATUS } from '../src/pipeline.mjs';
import { slackPreflight, REQUIRED_SLACK_SCOPES } from '../src/slackPreflight.mjs';
import { requireHealthcheckUrl, healthcheckFailUrl, pingHealthcheckForStatus } from '../src/healthcheck.mjs';
import { assertAmericaNewYork } from '../src/timezone.mjs';
import { sweepStaleRunning, STALE_ERROR, findStaleRunning } from '../src/staleRuns.mjs';
import { FAILURE_PREFIX } from '../src/errors.mjs';

function okSlackApi() {
  return async (method) => {
    if (method === 'auth.test') return { ok: true, user_id: 'B1', team: 'T1' };
    if (method === 'conversations.open') return { ok: true, channel: { id: 'D1' } };
    if (method === 'conversations.info') return { ok: true, channel: { id: 'C1' } };
    return { ok: false, error: 'unknown_method' };
  };
}

describe('slack preflight', () => {
  it('fails on auth.test ok:false', async () => {
    await assert.rejects(
      () =>
        slackPreflight({
          channel: 'U123',
          slackApi: async () => ({ ok: false, error: 'invalid_auth' }),
        }),
      /invalid_auth/,
    );
  });

  it('fails on conversations.info ok:false', async () => {
    await assert.rejects(
      () =>
        slackPreflight({
          channel: 'C_BAD',
          slackApi: async (method) => {
            if (method === 'auth.test') return { ok: true };
            return { ok: false, error: 'channel_not_found' };
          },
        }),
      /channel_not_found/,
    );
  });

  it('opens DM for user ids', async () => {
    const calls = [];
    await slackPreflight({
      channel: 'U123ABC',
      slackApi: async (method, body) => {
        calls.push({ method, body });
        if (method === 'auth.test') return { ok: true };
        return { ok: true, channel: { id: 'D9' } };
      },
    });
    assert.equal(calls[1].method, 'conversations.open');
    assert.ok(REQUIRED_SLACK_SCOPES.dmUserId.includes('im:write'));
  });
});

describe('HEALTHCHECK_URL required', () => {
  it('throws when missing', () => {
    assert.throws(() => requireHealthcheckUrl(''), /HEALTHCHECK_URL missing/);
    assert.throws(() => requireHealthcheckUrl(null), /HEALTHCHECK_URL missing/);
  });

  it('builds /fail URL', () => {
    assert.equal(healthcheckFailUrl('https://hc.example/abc'), 'https://hc.example/abc/fail');
  });

  it('pipeline fails at startup when HEALTHCHECK_URL missing', async () => {
    const { run, error } = await runStructureAlert({
      tickers: ['SPY'],
      executionId: 'no-hc',
      slackChannel: 'U1',
      timezone: 'America/New_York',
      healthcheckUrl: '',
      slackApi: okSlackApi(),
      postSlack: async () => ({ ok: true, ts: '1' }),
      fetchBars: async () => {
        throw new Error('should not fetch');
      },
    });
    assert.equal(run, null);
    assert.match(error, /HEALTHCHECK_URL/);
  });
});

describe('timezone', () => {
  it('accepts America/New_York', () => {
    assert.equal(assertAmericaNewYork('America/New_York'), 'America/New_York');
  });

  it('rejects mismatch', () => {
    assert.throws(() => assertAmericaNewYork('UTC'), /timezone mismatch/);
  });
});

describe('stale-run sweeper', () => {
  it('marks running rows older than 30m as failed and alerts once each', async () => {
    const store = createRunStore();
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    store.insert({
      status: RUN_STATUS.RUNNING,
      n8n_execution_id: 'old-1',
      run_at: old,
      started_at: old,
      alert_count: 0,
      tickers: [],
      error: null,
      notify_error: null,
      slack_ts: null,
      finished_at: null,
    });
    store.insert({
      status: RUN_STATUS.RUNNING,
      n8n_execution_id: 'fresh-1',
      run_at: fresh,
      started_at: fresh,
      alert_count: 0,
      tickers: [],
      error: null,
      notify_error: null,
      slack_ts: null,
      finished_at: null,
    });

    const posts = [];
    const updated = await sweepStaleRunning({
      store,
      slackChannel: 'U1',
      postSlack: async (text, channel) => {
        posts.push({ text, channel });
        return { ok: true, ts: '1' };
      },
    });

    assert.equal(updated.length, 1);
    assert.equal(updated[0].status, 'failed');
    assert.equal(updated[0].error, STALE_ERROR);
    assert.equal(posts.length, 1);
    assert.ok(posts[0].text.startsWith(FAILURE_PREFIX));
    assert.equal(store.all().filter((r) => r.status === 'running').length, 1);
  });

  it('findStaleRunning respects cutoff', () => {
    const now = new Date('2026-11-03T20:00:00Z');
    const rows = [
      { id: 'a', status: 'running', run_at: '2026-11-03T19:00:00Z' },
      { id: 'b', status: 'running', run_at: '2026-11-03T19:45:00Z' },
      { id: 'c', status: 'ok', run_at: '2026-11-03T18:00:00Z' },
    ];
    const stale = findStaleRunning(rows, { now, maxAgeMinutes: 30 });
    assert.deepEqual(
      stale.map((r) => r.id),
      ['a'],
    );
  });
});

describe('preflight ok:false fails the run', () => {
  it('marks failed with Slack error before data fetch', async () => {
    let fetched = false;
    const pings = [];
    const { run, error } = await runStructureAlert({
      tickers: ['SPY'],
      executionId: 'preflight-fail',
      slackChannel: 'C_BAD',
      timezone: 'America/New_York',
      healthcheckUrl: 'https://hc.example/uuid',
      slackApi: async (method) => {
        if (method === 'auth.test') return { ok: true };
        return { ok: false, error: 'channel_not_found' };
      },
      postSlack: async () => ({ ok: true, ts: '9' }),
      pingHealthcheck: async (url) => {
        pings.push(url);
      },
      fetchBars: async () => {
        fetched = true;
        return [];
      },
    });

    assert.equal(fetched, false);
    assert.equal(run.status, RUN_STATUS.FAILED);
    assert.match(run.error, /channel_not_found|slack_preflight/);
    assert.match(error, /channel_not_found/);
    assert.ok(pings.some((u) => u.endsWith('/fail')));
  });
});

describe('healthcheck ping routing', () => {
  it('pings success URL on ok and /fail on failed status', async () => {
    const seen = [];
    const ping = async (url) => {
      seen.push(url);
    };
    await pingHealthcheckForStatus(ping, 'https://hc.example/x', 'ok');
    await pingHealthcheckForStatus(ping, 'https://hc.example/x', 'failed');
    assert.deepEqual(seen, ['https://hc.example/x', 'https://hc.example/x/fail']);
  });
});
