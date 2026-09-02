import { adaptFmpEarningsCalendar } from '../../../lib/fmpEarningsAdapter.js';
import {
  normalizeFiscal,
  type EarningsProvider,
  type EarningsRow,
  type EarningsSource,
} from '../types.js';

const FMP_STABLE = 'https://financialmodelingprep.com/stable/earnings-calendar';
const FMP_V3 = 'https://financialmodelingprep.com/api/v3/earning_calendar';

export function adaptFmpToEarningsRows(
  payload: unknown,
  fetchedAt: string = new Date().toISOString()
): EarningsRow[] {
  return adaptFmpEarningsCalendar(payload, fetchedAt).map((row) => {
    const fiscal = normalizeFiscal({ label: row.fiscalPeriod });
    return {
      ticker: row.ticker,
      date: row.reportDate,
      session: row.session,
      epsEstimate: row.epsEstimate,
      fiscalYear: fiscal.fiscalYear,
      fiscalPeriod: fiscal.fiscalPeriod,
      source: 'fmp' as const,
      confidence: 'reported' as const,
      companyName: row.companyName,
      revenueEstimate: row.revenueEstimate,
      fetchedAt: row.fetchedAt,
    };
  });
}

export function createFmpProvider(opts?: {
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): EarningsProvider | null {
  const apiKey = (opts?.apiKey ?? process.env.FMP_API_KEY)?.trim() || null;
  if (!apiKey) return null;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const source: EarningsSource = 'fmp';

  return {
    source,
    async fetchCalendar(from: string, to: string): Promise<EarningsRow[]> {
      const qs = `from=${from}&to=${to}&apikey=${encodeURIComponent(apiKey)}`;
      const stableResp = await fetchImpl(`${FMP_STABLE}?${qs}`);
      if (stableResp.ok) {
        return adaptFmpToEarningsRows(await stableResp.json());
      }
      const v3Resp = await fetchImpl(`${FMP_V3}?${qs}`);
      if (v3Resp.ok) {
        return adaptFmpToEarningsRows(await v3Resp.json());
      }
      throw new Error(`HTTP ${stableResp.status} ${FMP_STABLE} then HTTP ${v3Resp.status} ${FMP_V3}`);
    },
  };
}
