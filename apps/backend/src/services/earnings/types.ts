/**
 * Shared earnings-calendar contract. Selection/scoring stays in weekAhead —
 * these rows are what providers emit into the cache.
 */

export type EarningsSession = 'bmo' | 'amc' | 'unknown';
export type EarningsSource = 'finnhub' | 'fmp' | 'alphavantage' | 'news';
export type EarningsConfidence = 'reported' | 'projected' | 'inferred';
export type DateStatus = 'confirmed' | 'projected';

export interface EarningsRow {
  ticker: string;
  date: string;
  session: EarningsSession;
  epsEstimate: number | null;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  source: EarningsSource;
  confidence: EarningsConfidence;
  companyName?: string | null;
  revenueEstimate?: number | null;
  fetchedAt?: string;
}

export interface ResolvedEarningsRow extends EarningsRow {
  sessionSource: EarningsSource;
  dateStatus: DateStatus | null;
}

export interface EarningsProvider {
  readonly source: EarningsSource;
  fetchCalendar(from: string, to: string): Promise<EarningsRow[]>;
}

/** Do not guess. Only bmo/amc count; "" and dmh map to unknown. */
export function mapHourToSession(hour: unknown): EarningsSession {
  const t = String(hour ?? '')
    .trim()
    .toLowerCase();
  if (t === 'bmo') return 'bmo';
  if (t === 'amc') return 'amc';
  return 'unknown';
}

export function sessionQuality(session: EarningsSession): number {
  return session === 'unknown' ? 0 : 1;
}

const MONTH_TO_QUARTER: Record<number, 1 | 2 | 3 | 4> = {
  1: 1,
  2: 1,
  3: 1,
  4: 2,
  5: 2,
  6: 2,
  7: 3,
  8: 3,
  9: 3,
  10: 4,
  11: 4,
  12: 4,
};

export function fiscalPeriodFromEnding(ending: string | null | undefined): {
  fiscalYear: number | null;
  fiscalPeriod: string | null;
} {
  if (!ending) return { fiscalYear: null, fiscalPeriod: null };
  const m = ending.match(/^(\d{4})-(\d{2})/);
  if (!m) return { fiscalYear: null, fiscalPeriod: null };
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || !month) return { fiscalYear: null, fiscalPeriod: null };
  return { fiscalYear: year, fiscalPeriod: `Q${MONTH_TO_QUARTER[month]}` };
}

export function normalizeFiscal(input: {
  label?: string | null;
  year?: number | null;
  quarter?: number | null;
  ending?: string | null;
}): { fiscalYear: number | null; fiscalPeriod: string | null } {
  if (input.year && input.quarter && input.quarter >= 1 && input.quarter <= 4) {
    return { fiscalYear: input.year, fiscalPeriod: `Q${input.quarter}` };
  }
  const label = (input.label || '').trim().toUpperCase();
  const fromLabel = label.match(/^Q([1-4])(?:\s+FY\s*(\d{4}))?/);
  if (fromLabel) {
    return {
      fiscalYear: fromLabel[2] ? Number(fromLabel[2]) : input.year ?? null,
      fiscalPeriod: `Q${fromLabel[1]}`,
    };
  }
  return fiscalPeriodFromEnding(input.ending);
}

export function mergeKey(row: Pick<EarningsRow, 'ticker' | 'date' | 'fiscalYear' | 'fiscalPeriod'>): string {
  if (row.fiscalYear != null && row.fiscalPeriod) {
    return `${row.ticker}|${row.fiscalYear}|${row.fiscalPeriod}`;
  }
  return `${row.ticker}|${row.date}`;
}
