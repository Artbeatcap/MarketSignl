/**
 * Explicit FMP earnings-calendar adapter.
 *
 * Field names are mapped here — not inline at the call site — so a provider
 * rename fails a unit test against a captured response instead of silently
 * emptying the section. Handles the documented v3 camelCase shape and the
 * Stable `/stable/earnings-calendar` shape (`lastUpdated`, no `time` field).
 * Missing or non-bmo/amc timing maps to `unknown` — do not guess.
 */

export type EarningsSession = 'bmo' | 'amc' | 'unknown';

export interface EarningsCalendarRow {
  ticker: string;
  reportDate: string;
  session: EarningsSession;
  isConfirmed: boolean;
  updatedFromDate: string | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  fiscalPeriod: string | null;
  companyName: string | null;
  fetchedAt: string;
}

export function mapFmpSession(time: unknown): EarningsSession {
  const t = String(time ?? '')
    .trim()
    .toLowerCase();
  if (t === 'bmo') return 'bmo';
  if (t === 'amc') return 'amc';
  return 'unknown';
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asIsoDate(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Q2 FY2027 from a fiscalDateEnding like 2026-07-31. */
export function fiscalPeriodFromEnding(ending: string | null): string | null {
  if (!ending) return null;
  const m = ending.match(/^(\d{4})-(\d{2})/);
  if (!m) return ending;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || !month) return ending;
  return `Q${Math.ceil(month / 3)} FY${year}`;
}

function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] != null && raw[key] !== '') return raw[key];
  }
  return undefined;
}

export function adaptFmpEarningsItem(
  raw: unknown,
  fetchedAt: string
): EarningsCalendarRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const ticker = asString(pick(row, 'symbol', 'ticker', 'symbolTicker'))?.toUpperCase();
  const reportDate = asIsoDate(pick(row, 'date', 'reportDate', 'earningsDate', 'dateEarning'));
  if (!ticker || !reportDate) return null;

  const ending = asIsoDate(pick(row, 'fiscalDateEnding', 'fiscal_date_ending', 'fiscalPeriodEnding'));
  const company = asString(pick(row, 'companyName', 'company_name', 'name'));

  return {
    ticker,
    reportDate,
    session: mapFmpSession(pick(row, 'time', 'session', 'hour')),
    isConfirmed: false,
    updatedFromDate: asIsoDate(pick(row, 'updatedFromDate', 'updated_from_date', 'lastUpdated')),
    epsEstimate: asNumber(pick(row, 'epsEstimated', 'eps_estimated', 'epsEstimate')),
    revenueEstimate: asNumber(pick(row, 'revenueEstimated', 'revenue_estimated', 'revenueEstimate')),
    fiscalPeriod: fiscalPeriodFromEnding(ending),
    companyName: company,
    fetchedAt,
  };
}

export function adaptFmpEarningsCalendar(
  payload: unknown,
  fetchedAt: string = new Date().toISOString()
): EarningsCalendarRow[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : payload && typeof payload === 'object' && Array.isArray((payload as { results?: unknown }).results)
        ? (payload as { results: unknown[] }).results
        : [];

  const out: EarningsCalendarRow[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const row = adaptFmpEarningsItem(item, fetchedAt);
    if (!row) continue;
    const key = `${row.ticker}|${row.reportDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Confirmed-calendar join keys. v4 shape is not stable across plans. */
export function adaptFmpConfirmedKeys(payload: unknown): Set<string> {
  const list = Array.isArray(payload) ? payload : [];
  const keys = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const ticker = asString(pick(row, 'symbol', 'ticker'))?.toUpperCase();
    const date = asIsoDate(pick(row, 'date', 'reportDate', 'earningsDate'));
    if (ticker && date) keys.add(`${ticker}|${date}`);
  }
  return keys;
}
