const DEFAULT_BASE = 'https://api.massive.com';
export const MIN_BARS = 220;
/** Last bar must be within this many calendar days (weekends/holidays). */
export const MAX_STALE_DAYS = 5;

/**
 * @param {object} opts
 * @param {string} opts.ticker
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.apiKey]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {Date} [opts.now]
 */
export async function fetchDailyBars({
  ticker,
  baseUrl = process.env.MASSIVE_BASE_URL || DEFAULT_BASE,
  apiKey = process.env.MASSIVE_API_KEY || '',
  fetchImpl = globalThis.fetch,
  now = new Date(),
}) {
  const step = 'fetch_bars';
  if (!apiKey) {
    const err = new Error('MASSIVE_API_KEY missing');
    err.step = step;
    throw err;
  }

  const symbol = String(ticker).toUpperCase();
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 420);

  const from = formatYmd(start);
  const to = formatYmd(end);
  const root = String(baseUrl || '').replace(/\/$/, '');
  const url =
    `${root}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(apiKey)}`;

  let response;
  try {
    response = await fetchImpl(url);
  } catch (e) {
    const err = new Error(e?.message || String(e));
    err.step = step;
    throw err;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`HTTP ${response.status} ${text.slice(0, 200)}`);
    err.step = step;
    throw err;
  }

  const json = await response.json();
  const results = json?.results;
  if (!Array.isArray(results) || results.length === 0) {
    const err = new Error('empty bars');
    err.step = step;
    throw err;
  }

  const bars = results.map((b) => ({
    date: msToNyDate(b.t),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v ?? 0,
    t: b.t,
  }));

  validateBars(bars, now);
  return bars;
}

/**
 * @param {{ date: string, t?: number }[]} bars
 * @param {Date} now
 */
export function validateBars(bars, now = new Date()) {
  if (!bars?.length) {
    const err = new Error('empty bars');
    err.step = 'validate_bars';
    throw err;
  }
  if (bars.length < MIN_BARS) {
    const err = new Error(`bar count < ${MIN_BARS} (${bars.length})`);
    err.step = 'validate_bars';
    throw err;
  }

  const last = bars[bars.length - 1];
  const lastMs = last.t ?? Date.parse(`${last.date}T21:00:00Z`);
  const ageDays = (now.getTime() - lastMs) / (1000 * 60 * 60 * 24);
  if (ageDays > MAX_STALE_DAYS) {
    const err = new Error(
      `freshness fail: last bar ${last.date} is ${ageDays.toFixed(1)} days old (max ${MAX_STALE_DAYS})`,
    );
    err.step = 'freshness';
    throw err;
  }
  return true;
}

function formatYmd(d) {
  return d.toISOString().slice(0, 10);
}

/** Session date in America/New_York from epoch ms. */
export function msToNyDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}
