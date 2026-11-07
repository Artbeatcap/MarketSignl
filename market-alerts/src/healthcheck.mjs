/**
 * HEALTHCHECK_URL is required. Ping success URL when ok; append /fail when failed.
 * healthchecks.io accepts GET on the base UUID URL (success) and `${url}/fail`.
 */

export function requireHealthcheckUrl(url) {
  const v = String(url || '').trim();
  if (!v) {
    const err = new Error('HEALTHCHECK_URL missing');
    err.step = 'config';
    throw err;
  }
  return v.replace(/\/$/, '');
}

export function healthcheckSuccessUrl(base) {
  return requireHealthcheckUrl(base);
}

export function healthcheckFailUrl(base) {
  const root = requireHealthcheckUrl(base);
  if (root.endsWith('/fail')) return root;
  return `${root}/fail`;
}

/**
 * Best-effort ping — never throws into the caller as a pipeline failure.
 * @param {(url: string) => Promise<unknown>} ping
 * @param {string} baseUrl
 * @param {'ok'|'failed'} status
 */
export async function pingHealthcheckForStatus(ping, baseUrl, status) {
  const url = status === 'ok' ? healthcheckSuccessUrl(baseUrl) : healthcheckFailUrl(baseUrl);
  try {
    await ping(url);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, url, error: e };
  }
}
