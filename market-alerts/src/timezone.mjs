export const EXPECTED_TIMEZONE = 'America/New_York';

/**
 * Fail the run if the workflow / runtime timezone is not America/New_York.
 * @param {string|null|undefined} timezone
 */
export function assertAmericaNewYork(timezone) {
  const tz = String(timezone || '').trim();
  if (tz !== EXPECTED_TIMEZONE) {
    const err = new Error(
      `timezone mismatch: expected ${EXPECTED_TIMEZONE}, got ${tz || '(empty)'}`,
    );
    err.step = 'timezone';
    throw err;
  }
  return tz;
}
