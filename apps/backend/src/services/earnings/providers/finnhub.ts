import {
  mapHourToSession,
  normalizeFiscal,
  type EarningsProvider,
  type EarningsRow,
  type EarningsSource,
} from '../types.js';

const FINNHUB_URL = 'https://finnhub.io/api/v1/calendar/earnings';

export function adaptFinnhubPayload(
  payload: unknown,
  from: string,
  to: string,
  fetchedAt: string = new Date().toISOString()
): EarningsRow[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { earningsCalendar?: unknown }).earningsCalendar)
      ? (payload as { earningsCalendar: unknown[] }).earningsCalendar
      : [];

  const out: EarningsRow[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const ticker = String(row.symbol ?? row.ticker ?? '')
      .trim()
      .toUpperCase();
    const date = String(row.date ?? '').slice(0, 10);
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date < from || date > to) continue;
    const key = `${ticker}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const year = row.year == null || row.year === '' ? null : Number(row.year);
    const quarter = row.quarter == null || row.quarter === '' ? null : Number(row.quarter);
    const fiscal = normalizeFiscal({ year, quarter });
    const eps = row.epsEstimate == null || row.epsEstimate === '' ? null : Number(row.epsEstimate);
    const rev = row.revenueEstimate == null || row.revenueEstimate === '' ? null : Number(row.revenueEstimate);
    out.push({
      ticker,
      date,
      session: mapHourToSession(row.hour),
      epsEstimate: Number.isFinite(eps as number) ? eps : null,
      fiscalYear: fiscal.fiscalYear,
      fiscalPeriod: fiscal.fiscalPeriod,
      source: 'finnhub',
      confidence: 'reported',
      revenueEstimate: Number.isFinite(rev as number) ? rev : null,
      fetchedAt,
    });
  }
  return out;
}

export function createFinnhubProvider(opts?: {
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): EarningsProvider | null {
  const apiKey = (opts?.apiKey ?? process.env.FINNHUB_API_KEY)?.trim() || null;
  if (!apiKey) return null;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const source: EarningsSource = 'finnhub';

  return {
    source,
    async fetchCalendar(from: string, to: string): Promise<EarningsRow[]> {
      const url = `${FINNHUB_URL}?from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`;
      const resp = await fetchImpl(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${FINNHUB_URL}`);
      }
      const payload = await resp.json();
      return adaptFinnhubPayload(payload, from, to);
    },
  };
}
