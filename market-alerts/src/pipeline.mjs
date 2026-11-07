import { fetchDailyBars } from './fetchBars.mjs';
import { detectLowerHighs } from './lowerHigh.mjs';
import { formatLowerHighMessage, assertSlackOk } from './formatMessage.mjs';
import { formatFailureMessage, buildFailedRunFields, redactError } from './errors.mjs';
import {
  buildRunningRow,
  buildOkRow,
  createRunStore,
  setupDedupeKey,
  RUN_STATUS,
} from './runs.mjs';
import { slackPreflight } from './slackPreflight.mjs';
import { requireHealthcheckUrl, pingHealthcheckForStatus } from './healthcheck.mjs';
import { assertAmericaNewYork } from './timezone.mjs';
import { sweepStaleRunning } from './staleRuns.mjs';

/**
 * Full structure-alert run with injectable I/O (n8n mirrors this flow).
 *
 * Order:
 *  1) timezone assert
 *  2) require HEALTHCHECK_URL
 *  3) stale-run sweeper
 *  4) insert running row
 *  5) Slack preflight (no post) — before any market data
 *  6) data / detect / deliver
 *  7) healthcheck ping ok or /fail
 */
export async function runStructureAlert(opts) {
  const {
    tickers,
    executionId,
    store = createRunStore(),
    knownKeys = new Set(),
    postSlack,
    slackApi,
    slackChannel,
    pingHealthcheck,
    healthcheckUrl,
    timezone = 'America/New_York',
    fetchBars = fetchDailyBars,
    fetchBarsOpts = {},
  } = opts;

  /** @type {object[]} */
  const alerts = [];
  let run = null;

  const failAndPing = async (step, error) => {
    const failureText = formatFailureMessage(step, error);
    let notifyError = null;
    try {
      if (postSlack && slackChannel) {
        const notifyRes = await postSlack(failureText, slackChannel);
        assertSlackOk(notifyRes);
      }
    } catch (notifyErr) {
      notifyError = notifyErr;
    }

    if (run) {
      const failed = buildFailedRunFields({ step, error, notifyError });
      store.update(run.id, { ...failed, finished_at: new Date().toISOString() });
    }

    if (pingHealthcheck && healthcheckUrl) {
      try {
        await pingHealthcheckForStatus(pingHealthcheck, healthcheckUrl, 'failed');
      } catch {
        /* best-effort */
      }
    }

    return {
      run: run ? store.get(run.id) : null,
      alerts: [],
      setups: [],
      error: redactError(error),
    };
  };

  try {
    assertAmericaNewYork(timezone);
    requireHealthcheckUrl(healthcheckUrl);

    if (!slackChannel) {
      throw Object.assign(new Error('SLACK_ALERT_CHANNEL missing'), { step: 'config' });
    }

    await sweepStaleRunning({ store, postSlack, slackChannel });

    run = store.insert(buildRunningRow({ executionId, tickers }));

    // Slack preflight — before any data work, no chat.postMessage
    if (!slackApi) {
      throw Object.assign(new Error('slackApi missing'), { step: 'slack_preflight' });
    }
    await slackPreflight({ slackApi, channel: slackChannel });

    for (const ticker of tickers) {
      const bars = await fetchBars({ ticker, ...fetchBarsOpts });
      const found = detectLowerHighs(ticker, bars, { onlyLatest: true, knownKeys });
      for (const setup of found) {
        alerts.push(setup);
        knownKeys.add(setup.key || setupDedupeKey(setup));
      }
    }

    /** @type {string[]} */
    const slackTsList = [];

    for (const setup of alerts) {
      const text = formatLowerHighMessage(setup);
      const slackRes = await postSlack(text, slackChannel);
      const ts = assertSlackOk(slackRes);
      if (ts) slackTsList.push(ts);
    }

    store.update(
      run.id,
      buildOkRow({
        alertCount: alerts.length,
        slackTs: slackTsList[0] ?? null,
        tickers,
      }),
    );

    await pingHealthcheckForStatus(pingHealthcheck, healthcheckUrl, 'ok');

    return { run: store.get(run.id), alerts, setups: alerts };
  } catch (e) {
    const step = e?.step || 'pipeline';
    // Config failures before HEALTHCHECK_URL is known still return failed
    if (step === 'config' && /HEALTHCHECK_URL/.test(String(e.message || e)) && !run) {
      return {
        run: null,
        alerts: [],
        setups: [],
        error: redactError(e),
      };
    }
    return failAndPing(step, e);
  }
}

/**
 * Error Trigger path: mark leftover running rows failed + one Slack notify + /fail ping.
 */
export async function handleErrorTrigger({
  store,
  executionId,
  error,
  postSlack,
  slackChannel,
  pingHealthcheck,
  healthcheckUrl,
  step = 'error_trigger',
}) {
  const failureText = formatFailureMessage(step, error);
  let notifyError = null;
  try {
    if (slackChannel && postSlack) {
      const res = await postSlack(failureText, slackChannel);
      assertSlackOk(res);
    }
  } catch (e) {
    notifyError = e;
  }

  const patch = {
    status: RUN_STATUS.FAILED,
    error: `${step}: ${redactError(error)}`,
    notify_error: notifyError ? redactError(notifyError) : null,
    finished_at: new Date().toISOString(),
  };
  const updated = store.updateRunningByExecution(executionId, patch);

  if (pingHealthcheck && healthcheckUrl) {
    await pingHealthcheckForStatus(pingHealthcheck, healthcheckUrl, 'failed');
  }

  return updated;
}

export { createRunStore, RUN_STATUS, createDelivery } from './delivery.mjs';
