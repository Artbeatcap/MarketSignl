/**
 * Massive /v2/reference/news gap-fill. Supplement only — inferred rows never
 * override a structured provider row. 8:30 send never calls this.
 */
import {
  mapHourToSession,
  type EarningsRow,
  type EarningsSession,
} from './types.js';

const MASSIVE_BASE_URL = process.env.MASSIVE_BASE_URL?.trim() || 'https://api.massive.com';

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const DATE_PATTERNS: RegExp[] = [
  /next\s+earnings\s+report\s+on\s+([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i,
  /(?:expected\s+to\s+)?report(?:[\s\w]{0,48})?\s+(?:results|earnings)\s+on\s+([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i,
  /earnings\s+on\s+([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i,
];

export interface NewsArticle {
  title?: string | null;
  description?: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) return null;
  return iso;
}

function resolveYear(
  month: number,
  day: number,
  yearHint: number | null,
  horizonStart: string,
  horizonEnd: string
): string | null {
  const years = yearHint
    ? [yearHint]
    : [Number(horizonStart.slice(0, 4)), Number(horizonStart.slice(0, 4)) + 1, Number(horizonStart.slice(0, 4)) - 1];
  const hits: string[] = [];
  for (const year of years) {
    const iso = toIso(year, month, day);
    if (iso && iso >= horizonStart && iso <= horizonEnd) hits.push(iso);
  }
  return hits.length === 1 ? hits[0] : hits.sort()[0] ?? null;
}

function extractSession(text: string): EarningsSession {
  if (/\b(?:after\s+the\s+(?:bell|close)|amc)\b/i.test(text)) return 'amc';
  if (/\b(?:before\s+the\s+(?:bell|open)|bmo)\b/i.test(text)) return 'bmo';
  return mapHourToSession('');
}

function mentionsSubject(text: string, ticker: string, companyName?: string | null): boolean {
  const tickerRe = new RegExp(`\\b${ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  if (tickerRe.test(text)) return true;
  const name = (companyName || '').trim();
  if (!name) return false;
  const token = name.split(/[\s,]+/)[0];
  if (token.length < 3) return false;
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

export function extractEarningsDateFromText(
  text: string,
  opts: { ticker: string; companyName?: string | null; horizonStart: string; horizonEnd: string }
): { date: string; session: EarningsSession } | null {
  if (!text || !mentionsSubject(text, opts.ticker, opts.companyName)) return null;
  for (const pattern of DATE_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;
    const month = MONTHS[m[1].replace(/\./g, '').toLowerCase()];
    const day = Number(m[2]);
    if (!month || !day) continue;
    const yearHint = m[3] ? Number(m[3]) : null;
    const date = resolveYear(month, day, yearHint, opts.horizonStart, opts.horizonEnd);
    if (!date) continue;
    return { date, session: extractSession(text) };
  }
  return null;
}

export function extractFromArticles(
  ticker: string,
  articles: NewsArticle[],
  opts: { companyName?: string | null; horizonStart: string; horizonEnd: string }
): EarningsRow | null {
  const fetchedAt = new Date().toISOString();
  for (const article of articles) {
    for (const text of [article.title, article.description]) {
      if (!text) continue;
      const hit = extractEarningsDateFromText(text, {
        ticker,
        companyName: opts.companyName,
        horizonStart: opts.horizonStart,
        horizonEnd: opts.horizonEnd,
      });
      if (!hit) continue;
      return {
        ticker: ticker.toUpperCase(),
        date: hit.date,
        session: hit.session,
        epsEstimate: null,
        fiscalYear: null,
        fiscalPeriod: null,
        source: 'news',
        confidence: 'inferred',
        companyName: opts.companyName ?? null,
        fetchedAt,
      };
    }
  }
  return null;
}

export async function fetchTickerNews(
  ticker: string,
  opts?: { apiKey?: string | null; fetchImpl?: typeof fetch; limit?: number }
): Promise<NewsArticle[]> {
  const apiKey =
    (opts?.apiKey ?? process.env.MASSIVE_API_KEY ?? process.env.POLYGON_API_KEY)?.trim() || null;
  if (!apiKey) return [];
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const limit = opts?.limit ?? 10;
  const url =
    `${MASSIVE_BASE_URL}/v2/reference/news?ticker=${encodeURIComponent(ticker)}&limit=${limit}&apiKey=${encodeURIComponent(apiKey)}`;
  const resp = await fetchImpl(url);
  if (!resp.ok) {
    console.warn(`[week-ahead] news ${ticker} HTTP ${resp.status}`);
    return [];
  }
  const json = (await resp.json()) as { results?: NewsArticle[] };
  return json.results || [];
}

/**
 * For gate tickers with no provider row in the 5-day horizon, try news.
 * Inferred rows are not emitted when a provider already covers the ticker
 * inside the horizon.
 */
export async function fillEarningsGapsFromNews(opts: {
  tickers: string[];
  names?: Map<string, string>;
  existing: Array<{ ticker: string; date: string }>;
  horizonStart: string;
  horizonEnd: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<EarningsRow[]> {
  const covered = new Set(
    opts.existing
      .filter((r) => r.date >= opts.horizonStart && r.date <= opts.horizonEnd)
      .map((r) => r.ticker.toUpperCase())
  );
  const missing = [...new Set(opts.tickers.map((t) => t.toUpperCase()))].filter((t) => !covered.has(t));
  const out: EarningsRow[] = [];
  const concurrency = 3;
  for (let i = 0; i < missing.length; i += concurrency) {
    const batch = missing.slice(i, i + concurrency);
    const rows = await Promise.all(
      batch.map(async (ticker) => {
        const articles = await fetchTickerNews(ticker, {
          apiKey: opts.apiKey,
          fetchImpl: opts.fetchImpl,
        });
        return extractFromArticles(ticker, articles, {
          companyName: opts.names?.get(ticker) ?? null,
          horizonStart: opts.horizonStart,
          horizonEnd: opts.horizonEnd,
        });
      })
    );
    for (const row of rows) {
      if (row) out.push(row);
    }
  }
  return out;
}
