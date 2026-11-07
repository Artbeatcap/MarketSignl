/** Failure Slack copy always starts with this prefix. */
export const FAILURE_PREFIX = 'STRUCTURE ALERT FAILED - ';

const SECRET_PATTERNS = [
  /\b(?:xox[baprs]-|xapp-)[A-Za-z0-9-]+/g,
  /\bBearer\s+[A-Za-z0-9._\-]+/gi,
  /\bapi[_-]?key[=:]\s*[A-Za-z0-9._\-]+/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

/**
 * Strip tokens/secrets and truncate for Slack / DB storage.
 * @param {unknown} err
 * @param {number} [maxLen=500]
 */
export function redactError(err, maxLen = 500) {
  let text;
  if (err == null) text = 'unknown error';
  else if (typeof err === 'string') text = err;
  else if (err instanceof Error) text = err.message || String(err);
  else if (typeof err === 'object' && err.error) text = String(err.error);
  else {
    try {
      text = JSON.stringify(err);
    } catch {
      text = String(err);
    }
  }

  for (const re of SECRET_PATTERNS) {
    text = text.replace(re, '[REDACTED]');
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxLen) text = `${text.slice(0, maxLen - 1)}…`;
  return text;
}

/**
 * @param {string} step
 * @param {unknown} err
 */
export function formatFailureMessage(step, err) {
  const safeStep = String(step || 'unknown').trim() || 'unknown';
  return `${FAILURE_PREFIX}${safeStep}: ${redactError(err)}`;
}

/**
 * Keep root cause in `error`; Slack notify failure goes in `notify_error`.
 * @param {{ step: string, error: unknown, notifyError?: unknown }} args
 */
export function buildFailedRunFields({ step, error, notifyError }) {
  const fields = {
    status: 'failed',
    error: `${step}: ${redactError(error)}`,
    notify_error: null,
  };
  if (notifyError != null) {
    fields.notify_error = redactError(notifyError);
  }
  return fields;
}
