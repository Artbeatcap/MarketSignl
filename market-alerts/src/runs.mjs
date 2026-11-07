/** Allowed status values for structure_alert_runs. */
export const RUN_STATUS = Object.freeze({
  RUNNING: 'running',
  OK: 'ok',
  FAILED: 'failed',
});

/**
 * Unique key for a fired lower-high setup so re-runs do not re-post.
 * @param {{ ticker: string, h1Date: string, retestDate: string }} setup
 */
export function setupDedupeKey(setup) {
  const ticker = String(setup.ticker || '').toUpperCase();
  return `${ticker}|${setup.h1Date}|${setup.retestDate}`;
}

/**
 * Insert payload when a run starts. Status is running until Slack ok:true.
 * @param {{ executionId: string|number|null, tickers?: string[] }} args
 */
export function buildRunningRow({ executionId, tickers = [] }) {
  const now = new Date().toISOString();
  return {
    status: RUN_STATUS.RUNNING,
    n8n_execution_id: executionId == null ? null : String(executionId),
    alert_count: 0,
    tickers,
    error: null,
    notify_error: null,
    slack_ts: null,
    run_at: now,
    started_at: now,
    finished_at: null,
  };
}

/**
 * Final ok row — only after Slack delivery succeeded (or zero alerts, no Slack needed).
 * @param {{ alertCount: number, slackTs?: string|null, tickers?: string[] }} args
 */
export function buildOkRow({ alertCount, slackTs = null, tickers = [] }) {
  return {
    status: RUN_STATUS.OK,
    alert_count: alertCount,
    tickers,
    error: null,
    notify_error: null,
    slack_ts: slackTs,
    finished_at: new Date().toISOString(),
  };
}

/**
 * Error Trigger / crash path: flip leftover running rows to failed.
 * @param {{ executionId: string, step?: string, error: unknown, notifyError?: unknown }} args
 */
export function buildCrashFailedUpdate({ executionId, step = 'error_trigger', error, notifyError }) {
  /** lazy import avoided — keep redact inline-compatible via string trim */
  const raw = error instanceof Error ? error.message : String(error ?? 'unknown error');
  const safe = raw.replace(/\b(?:xox[baprs]-|xapp-)[A-Za-z0-9-]+/g, '[REDACTED]').slice(0, 500);
  const patch = {
    status: RUN_STATUS.FAILED,
    error: `${step}: ${safe}`,
    finished_at: new Date().toISOString(),
    notify_error: null,
  };
  if (notifyError != null) {
    const n = notifyError instanceof Error ? notifyError.message : String(notifyError);
    patch.notify_error = n.replace(/\b(?:xox[baprs]-|xapp-)[A-Za-z0-9-]+/g, '[REDACTED]').slice(0, 500);
  }
  return {
    match: {
      n8n_execution_id: String(executionId),
      status: RUN_STATUS.RUNNING,
    },
    patch,
  };
}

/**
 * In-memory run store used by unit tests and local dry-runs.
 */
export function createRunStore() {
  /** @type {Map<string, object>} */
  const byId = new Map();
  let seq = 0;

  return {
    insert(row) {
      const id = `run_${++seq}`;
      const full = { id, ...row };
      byId.set(id, full);
      return full;
    },
    update(id, patch) {
      const cur = byId.get(id);
      if (!cur) throw new Error(`run not found: ${id}`);
      const next = { ...cur, ...patch };
      byId.set(id, next);
      return next;
    },
    updateRunningByExecution(executionId, patch) {
      const hits = [];
      for (const [id, row] of byId) {
        if (row.n8n_execution_id === String(executionId) && row.status === RUN_STATUS.RUNNING) {
          const next = { ...row, ...patch };
          byId.set(id, next);
          hits.push(next);
        }
      }
      return hits;
    },
    get(id) {
      return byId.get(id) ?? null;
    },
    all() {
      return [...byId.values()];
    },
  };
}
