import {
  mapHourToSession,
  normalizeFiscal,
  type EarningsProvider,
  type EarningsRow,
  type EarningsSource,
} from '../types.js';
import { parseCsv } from '../csv.js';

const AV_URL = 'https://www.alphavantage.co/query';

export function adaptAlphaVantageCsv(
  csv: string,
  from: string,
  to: string,
  fetchedAt: string = new Date().toISOString()
): EarningsRow[] {
  const records = parseCsv(csv);
  const out: EarningsRow[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const ticker = (rec.symbol || rec.ticker || '').trim().toUpperCase();
    const date = (rec.reportDate || rec.report_date || '').slice(0, 10);
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date < from || date > to) continue;
    const key = `${ticker}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fiscal = normalizeFiscal({ ending: rec.fiscalDateEnding || rec.fiscal_date_ending });
    const eps = rec.estimate === '' || rec.estimate == null ? null : Number(rec.estimate);
    out.push({
      ticker,
      date,
      session: mapHourToSession(rec.time || rec.hour || rec.session),
      epsEstimate: Number.isFinite(eps as number) ? eps : null,
      fiscalYear: fiscal.fiscalYear,
      fiscalPeriod: fiscal.fiscalPeriod,
      source: 'alphavantage',
      confidence: 'reported',
      companyName: rec.name || null,
      fetchedAt,
    });
  }
  return out;
}

export function createAlphaVantageProvider(opts?: {
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): EarningsProvider | null {
  const apiKey = (opts?.apiKey ?? process.env.ALPHAVANTAGE_API_KEY)?.trim() || null;
  if (!apiKey) return null;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const source: EarningsSource = 'alphavantage';

  return {
    source,
    async fetchCalendar(from: string, to: string): Promise<EarningsRow[]> {
      const url =
        `${AV_URL}?function=EARNINGS_CALENDAR&horizon=3month&apikey=${encodeURIComponent(apiKey)}`;
      const resp = await fetchImpl(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${AV_URL}`);
      }
      const text = await resp.text();
      if (text.trim().startsWith('{')) {
        throw new Error('Alpha Vantage returned JSON instead of CSV (rate limit or invalid key)');
      }
      return adaptAlphaVantageCsv(text, from, to);
    },
  };
}
