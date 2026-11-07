import { formatFailureMessage, buildFailedRunFields, redactError } from './errors.mjs';
import { formatLowerHighMessage, assertSlackOk } from './formatMessage.mjs';
import {
  RUN_STATUS,
  buildRunningRow,
  buildOkRow,
  createRunStore,
} from './runs.mjs';

/**
 * Delivery orchestrator with injectable Slack + run store.
 * Ensures Slack-down never looks like a quiet success.
 *
 * @param {object} deps
 * @param {{ postMessage: (channel: string, text: string) => Promise<{ ok: boolean, error?: string, ts?: string }> }} deps.slack
 * @param {ReturnType<typeof createRunStore>} [deps.runs]
 * @param {string} deps.channel
 * @param {(url: string) => Promise<void>} [deps.pingHealthcheck]
 * @param {string} [deps.healthcheckUrl]
 */
export function createDelivery(deps) {
  const runs = deps.runs ?? createRunStore();
  let failureNotifyAttempted = false;

  return {
    runs,

    startRun({ executionId, tickers }) {
      return runs.insert(buildRunningRow({ executionId, tickers }));
    },

    /**
     * Post alert messages (or skip Slack when zero setups), then mark ok.
     * Healthcheck ping is best-effort and only after ok.
     */
    async completeSuccess({ runId, setups }) {
      const tickers = [...new Set(setups.map((s) => s.ticker))];
      let slackTs = null;

      if (setups.length > 0) {
        const texts = setups.map((s) => formatLowerHighMessage(s));
        // One Slack message per setup; keep first ts
        for (const text of texts) {
          const res = await deps.slack.postMessage(deps.channel, text);
          try {
            const ts = assertSlackOk(res);
            if (!slackTs) slackTs = ts;
          } catch (e) {
            // Persist failed here; rethrow so caller does not mark ok.
            const failed = await this.fail({
              runId,
              step: e.step || 'slack_post',
              error: e,
            });
            e.failedRun = failed;
            e.alreadyFailed = true;
            throw e;
          }
        }
      }

      const ok = buildOkRow({
        alertCount: setups.length,
        slackTs,
        tickers,
      });
      const row = runs.update(runId, ok);

      if (deps.healthcheckUrl && deps.pingHealthcheck) {
        try {
          await deps.pingHealthcheck(deps.healthcheckUrl);
        } catch {
          // best-effort: do not flip ok → failed
        }
      }
      return row;
    },

    /**
     * Pipeline failure: one Slack failure notify, then write failed row.
     * If Slack notify fails, root error stays; notify_error is appended.
     */
    async fail({ runId, step, error }) {
      const root = buildFailedRunFields({ step, error });
      let notifyError = null;

      if (!failureNotifyAttempted) {
        failureNotifyAttempted = true;
        const text = formatFailureMessage(step, error);
        try {
          const res = await deps.slack.postMessage(deps.channel, text);
          assertSlackOk(res);
        } catch (notifyErr) {
          notifyError = notifyErr;
          root.notify_error = redactError(notifyErr);
        }
      }

      const patch = {
        ...root,
        finished_at: new Date().toISOString(),
      };
      if (notifyError) patch.notify_error = redactError(notifyError);

      // Always persist failed — even when Slack itself is down.
      return runs.update(runId, patch);
    },

    /** Error Trigger path for leftover running rows. */
    markCrashFailed(executionId, error, step = 'error_trigger') {
      return runs.updateRunningByExecution(executionId, {
        status: RUN_STATUS.FAILED,
        error: `${step}: ${redactError(error)}`,
        finished_at: new Date().toISOString(),
      });
    },
  };
}

export { createRunStore, RUN_STATUS };
