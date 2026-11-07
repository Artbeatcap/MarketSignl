import { RUN_STATUS } from './runs.mjs';
import { formatFailureMessage } from './errors.mjs';

export const STALE_RUNNING_MINUTES = 30;
export const STALE_ERROR = 'stale running row (likely crash)';

/**
 * Find running rows whose run_at (or started_at) is older than threshold.
 * @param {object[]} rows
 * @param {{ now?: Date, maxAgeMinutes?: number }} [opts]
 */
export function findStaleRunning(rows, { now = new Date(), maxAgeMinutes = STALE_RUNNING_MINUTES } = {}) {
  const cutoff = now.getTime() - maxAgeMinutes * 60 * 1000;
  return (rows || []).filter((r) => {
    if (r.status !== RUN_STATUS.RUNNING) return false;
    const ts = r.run_at || r.started_at;
    if (!ts) return false;
    const t = Date.parse(ts);
    return Number.isFinite(t) && t < cutoff;
  });
}

/**
 * Mark stale running rows failed and alert once per row.
 *
 * @param {object} opts
 * @param {{ all: () => object[], update: (id: string, patch: object) => object }} opts.store
 * @param {(text: string, channel: string) => Promise<{ok?:boolean}>} [opts.postSlack]
 * @param {string} [opts.slackChannel]
 * @param {Date} [opts.now]
 */
export async function sweepStaleRunning({
  store,
  postSlack,
  slackChannel,
  now = new Date(),
  maxAgeMinutes = STALE_RUNNING_MINUTES,
}) {
  const stale = findStaleRunning(store.all(), { now, maxAgeMinutes });
  /** @type {object[]} */
  const updated = [];

  for (const row of stale) {
    const patch = {
      status: RUN_STATUS.FAILED,
      error: STALE_ERROR,
      finished_at: now.toISOString(),
    };
    const next = store.update(row.id, patch);
    updated.push(next);

    if (postSlack && slackChannel) {
      const text = formatFailureMessage('stale_sweeper', STALE_ERROR);
      try {
        await postSlack(`${text} run_id=${row.id}`, slackChannel);
      } catch {
        // still marked failed; notify best-effort
      }
    }
  }

  return updated;
}
