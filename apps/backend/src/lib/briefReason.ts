/**
 * Reason matching and send checks for the morning brief.
 * A card may only explain its own ticker, and a listicle is not a catalyst.
 */

export const NO_CATALYST = 'No confirmed catalyst in our feed';

export const TEMPLATE_TITLE =
  /Compared to Estimates|Key Metrics|feature highlights|Is It a Buy|Better Buy|\bvs\.|Stock Market News for|^\d+ .*Stocks|What's Going on With|What's Wrong With|Here's Why|Should You Buy/i;

const EVENT_WORDS =
  /\b(resign|steps down|ceo|cfo|guidance|outlook|cuts|raises|downgrade|upgrade|acquire|merger|recall|probe|lawsuit|offering|fda|contract|results|misses|beats)\b/i;

const UP_WORDS = /\b(rise|rises|rising|rose|surge|surged|soar|soared|jump|jumped|gains?|rall(?:y|ies|ied))\b/i;
const DOWN_WORDS = /\b(fall|fell|falls|drop|dropped|sink|sank|slide|slid|plunge|plunged|tumble|tumbled)\b/i;

const FORBIDDEN_ABSENCE = /no company news explains it|no headline — flow-driven|flow-driven/i;

export interface ReasonArticle {
  title: string;
  description?: string;
  url?: string;
  tickers: string[];
  publishedUtc?: string;
}

export interface ReasonScore {
  article: ReasonArticle;
  score: number;
}

export function qualifiesReason(
  article: ReasonArticle,
  ticker: string,
  dir: 'up' | 'down'
): number {
  const title = article.title || '';
  if (!title.trim() || TEMPLATE_TITLE.test(title)) return 0;
  let score = 0;
  const symbol = ticker.toUpperCase();
  if (titleMentionsTicker(title, symbol)) score += 3;
  if (EVENT_WORDS.test(title)) score += 3;
  if ((article.tickers?.length ?? 0) > 0 && article.tickers.length <= 2) score += 2;
  if (article.publishedUtc) score += 2;
  if (dir === 'down' && UP_WORDS.test(title) && !DOWN_WORDS.test(title)) score -= 5;
  if (dir === 'up' && DOWN_WORDS.test(title) && !UP_WORDS.test(title)) score -= 5;
  if (isNameRoundup(title) && !title.startsWith(symbol)) score -= 5;
  return score;
}

function titleMentionsTicker(title: string, ticker: string): boolean {
  if (ticker === 'NVDA' && /\bNvidia\b/i.test(title)) return true;
  if (ticker === 'NBIS' && /\bNebius\b/i.test(title)) return true;
  return new RegExp(`\\b${ticker}\\b`, 'i').test(title);
}

export function isNameRoundup(title: string): boolean {
  if (/\bhighlights?\b/i.test(title)) return true;
  return /[A-Z][A-Za-z0-9.&'-]{1,}(?:\s+[A-Z][A-Za-z0-9.&'-]{1,})?\s*,\s*[A-Z][A-Za-z0-9.&'-]{1,}(?:\s+[A-Z][A-Za-z0-9.&'-]{1,})?(?:\s*,\s*(?:and\s+)?[A-Z]|\s+and\s+[A-Z])/.test(
    title
  );
}

/** Highest score at or above 5. Template titles never qualify. */
export function pickQualifiedReason(
  articles: ReasonArticle[],
  ticker: string,
  dir: 'up' | 'down'
): ReasonScore | null {
  const ranked = articles
    .map((article) => ({ article, score: qualifiesReason(article, ticker, dir) }))
    .filter((row) => row.score >= 5 && !TEMPLATE_TITLE.test(row.article.title))
    .sort((a, b) => b.score - a.score);
  return ranked[0] ?? null;
}

export interface CardCheck {
  ticker: string;
  pct: string;
  why: string;
}

/** A cashtag or percentage that is not this card's own ticker blocks the card. */
export function repairCard(card: CardCheck): { why: string; blocked: boolean; code?: 'card_ticker_mismatch' } {
  const others = [...card.why.matchAll(/\$([A-Z]{1,5})\b/g)]
    .map((match) => match[1])
    .filter((ticker) => ticker !== card.ticker.toUpperCase());
  if (!others.length) return { why: replaceForbidden(card.why), blocked: false };
  const reason = replaceForbidden(card.why).includes(NO_CATALYST) ? NO_CATALYST : NO_CATALYST;
  return {
    why: `${card.ticker.toUpperCase()} ${card.pct}. ${reason}`,
    blocked: true,
    code: 'card_ticker_mismatch',
  };
}

export function findForbiddenAbsence(text: string): boolean {
  return FORBIDDEN_ABSENCE.test(text);
}

export function replaceForbidden(text: string): string {
  return text
    .replace(/No company news explains it\.?/gi, NO_CATALYST)
    .replace(/No headline — flow-driven/gi, NO_CATALYST);
}

export function checkTopStory(opening: string, ticker: string, movedAtLeast3: boolean, hasReason: boolean): boolean {
  if (!movedAtLeast3 || !hasReason) return false;
  return !new RegExp(`\\$?${ticker}\\b`, 'i').test(opening);
}

/** True when the printed words name the other window. */
export function windowMismatch(text: string, value: number, actual: 'yesterday' | 'premarket'): boolean {
  const printed = Math.abs(value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const body = text.replace(/−/g, '-');
  const hasValue = body.includes(String(value)) || body.includes(printed) || body.includes(Math.abs(value).toFixed(2));
  if (!hasValue) return false;
  const saysYesterday = /yesterday/i.test(body);
  const saysPremarket = /premarket|overnight/i.test(body);
  if (actual === 'premarket' && saysYesterday && !saysPremarket) return true;
  if (actual === 'yesterday' && saysPremarket && !saysYesterday) return true;
  return false;
}

/** "moved with X, which fell" is false when this ticker rose. */
export function movedWithOpposite(text: string, tickerRose: boolean): boolean {
  if (!/moved with|in line with/i.test(text)) return false;
  const groupFell = /which fell|which dropped|which sank/i.test(text);
  const groupRose = /which rose|which gained|which rallied/i.test(text);
  if (tickerRose && groupFell) return true;
  if (!tickerRose && groupRose) return true;
  return false;
}

export function foreignLevels(text: string, allowed: number[]): number[] {
  const found = [...text.matchAll(/\b(\d{3}\.\d{2})\b/g)].map((match) => Number(match[1]));
  return found.filter((level) => !allowed.some((ok) => Math.abs(ok - level) < 0.011));
}

export function showEarningsBadge(asOf: string, reportDate: string | null): boolean {
  if (!reportDate) return false;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const reportMs = Date.parse(`${reportDate}T00:00:00Z`);
  if (Number.isNaN(asOfMs) || Number.isNaN(reportMs)) return false;
  return Math.abs(reportMs - asOfMs) <= 3 * 24 * 60 * 60 * 1000;
}

export interface MoverRow {
  ticker: string;
  pct: string;
  dir: 'up' | 'down';
  why: string;
  window?: 'index_driver' | 'premarket' | 'prior_session';
}

export function explainableMovers<T extends MoverRow>(rows: T[]): { rows: T[]; unexplainedExtreme: string[] } {
  const unexplainedExtreme: string[] = [];
  const kept: T[] = [];
  for (const row of rows) {
    const magnitude = Math.abs(Number(row.pct.replace(/[+%]/g, '')));
    if (row.window === 'premarket' && magnitude < 2) continue;
    const confirmed = row.why.trim().length > 0 && !findForbiddenAbsence(row.why) && row.why.trim() !== NO_CATALYST;
    if (magnitude >= 20 && !confirmed) {
      unexplainedExtreme.push(row.ticker);
      continue;
    }
    kept.push({ ...row, why: replaceForbidden(row.why) });
  }
  return { rows: kept, unexplainedExtreme };
}

export interface HeadlineRow {
  headline: string;
  summary?: string;
  url?: string;
}

export function cleanHeadlines(rows: HeadlineRow[]): HeadlineRow[] {
  const out: HeadlineRow[] = [];
  for (const row of rows) {
    const title = (row.headline || '').trim();
    if (!title || TEMPLATE_TITLE.test(title) || isNameRoundup(title)) continue;
    if (!row.url) continue;
    const summary = sentenceSummary(row.summary || '');
    out.push({ headline: title, summary, url: row.url });
  }
  return out;
}

function sentenceSummary(text: string): string {
  const body = text.replace(/\s+/g, ' ').trim();
  if (!body) return '';
  const end = body.search(/[.!?](\s|$)/);
  if (end === -1) return '';
  return body.slice(0, end + 1);
}
