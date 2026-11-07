/**
 * Every percentage in a brief is computed here. The model never does arithmetic.
 */
import { addDaysISO, etDateISO } from './weekAhead.js';
import type { PriorLevel } from './briefLevels.js';

export type BriefEdition = 'morning' | 'close' | 'weekly';

export interface IntradayFact {
  low: number;
  /** (low / prevClose - 1) * 100, rounded to 2 dp. */
  lowPct: number;
  high: number;
  /** (high / prevClose - 1) * 100, rounded to 2 dp. */
  highPct: number;
}

export interface RankedMove {
  ticker: string;
  changePct: number;
}

export interface FactsRank {
  best: RankedMove[];
  worst: RankedMove[];
}

/** Contrast ETFs the "why" prose is allowed to quote. Always fetched with the indexes. */
export const CONTRAST_TICKERS = ['SMH', 'SOXX', 'XLK', 'XLE', 'XLU', 'XLP', 'TLT', 'HYG', 'IBIT', 'USO'] as const;

export interface TickerFact {
  close: number;
  prevClose: number;
  /** (close / prevClose - 1) * 100, rounded to 2 dp. Computed in this module. */
  changePct: number;
  /** close - prevClose, rounded to 2 dp. */
  changeAbs: number;
  /** Null when the bar did not carry it. Never filled from another field. */
  high: number | null;
  low: number | null;
  open: number | null;
  /** True when the bar lacked h or l. Intraday claims about this ticker are removed. */
  ohlcMissing: boolean;
  /** Full-session volume. Omitted from FACTS while volumeIsPartial is true. */
  volume: number;
  volumeIsPartial: boolean;
  /** Morning edition only: last trade versus the prior close. */
  premarketPct?: number;
  premarketPrice?: number;
  /** Session extremes, so "at the low it was down X%" can be checked. Null when ohlcMissing. */
  intraday: IntradayFact | null;
}

export interface WeeklyFact {
  weekOpen: number;
  weekClose: number;
  weekHigh: number;
  weekLow: number;
  changePct: number;
}

export interface BriefFacts {
  /** Session the brief describes, YYYY-MM-DD. Must be a trading day. */
  asOf: string;
  edition: BriefEdition;
  generatedAt: string;
  tickers: Record<string, TickerFact>;
  weekly?: Record<string, WeeklyFact>;
  priorLevels: PriorLevel[];
  calendar: { date: string; time: string; name: string; importance: 'high' | 'medium' | 'low' }[];
  /** Best and worst 3 tickers by changePct. Computed here, never by the model. */
  rank?: FactsRank;
}

export interface TickerBarInput {
  close: number;
  prevClose: number;
  high?: number | null;
  low?: number | null;
  open?: number | null;
  volume: number;
  volumeIsPartial?: boolean;
  premarketPrice?: number;
}

const MINUS = '\u2212';
const MASSIVE_BASE = process.env.MASSIVE_BASE_URL?.trim() || 'https://api.massive.com';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function present(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function buildTickerFact(input: TickerBarInput): TickerFact {
  const high = present(input.high);
  const low = present(input.low);
  const ohlcMissing = high == null || low == null;
  const fact: TickerFact = {
    close: input.close,
    prevClose: input.prevClose,
    changePct: input.prevClose ? round2((input.close / input.prevClose - 1) * 100) : 0,
    changeAbs: round2(input.close - input.prevClose),
    high,
    low,
    open: present(input.open),
    ohlcMissing,
    volume: input.volume,
    volumeIsPartial: input.volumeIsPartial ?? false,
    intraday: null,
  };
  if (input.premarketPrice != null && input.prevClose) {
    fact.premarketPrice = input.premarketPrice;
    fact.premarketPct = round2((input.premarketPrice / input.prevClose - 1) * 100);
  }
  if (!ohlcMissing && high != null && low != null && input.prevClose) {
    fact.intraday = {
      low,
      high,
      lowPct: round2((low / input.prevClose - 1) * 100),
      highPct: round2((high / input.prevClose - 1) * 100),
    };
  }
  return fact;
}

/**
 * Best and worst by the change this module already computed. The two lists
 * never share a ticker. Under 6 tickers there is only one of each.
 */
export function rankTickers(tickers: Record<string, TickerFact>): FactsRank {
  const sorted = Object.entries(tickers)
    .map(([ticker, fact]) => ({ ticker, changePct: fact.changePct }))
    .sort((a, b) => b.changePct - a.changePct);
  if (sorted.length < 2) return { best: sorted.slice(0, 1), worst: [] };
  const size = sorted.length < 6 ? 1 : 3;
  return {
    best: sorted.slice(0, size),
    worst: sorted.slice(-size).reverse(),
  };
}

export function formatFactPx(n: number): string {
  return round2(n).toFixed(2);
}

export function formatPct(n: number): string {
  const body = Math.abs(round2(n)).toFixed(2);
  if (n < 0) return `${MINUS}${body}%`;
  if (n > 0) return `+${body}%`;
  return `${body}%`;
}

function formatSignedPlain(n: number): string {
  const body = Math.abs(round2(n)).toFixed(2);
  if (n < 0) return `${MINUS}${body}`;
  if (n > 0) return `+${body}`;
  return body;
}

/** One FACTS line. Volume is left out until the session is complete. */
export function formatFactsLine(ticker: string, fact: TickerFact): string {
  let line =
    `${ticker} close ${formatFactPx(fact.close)}, prev ${formatFactPx(fact.prevClose)}, ` +
    `change ${formatPct(fact.changePct)} (${formatSignedPlain(fact.changeAbs)})`;
  if (fact.high != null && fact.low != null) {
    line += `, range ${formatFactPx(fact.low)}\u2013${formatFactPx(fact.high)}`;
  }
  if (!fact.volumeIsPartial && fact.volume > 0) {
    line += `, volume ${Math.round(fact.volume).toLocaleString('en-US')}`;
  }
  if (fact.premarketPrice != null && fact.premarketPct != null) {
    line += `, premarket ${formatFactPx(fact.premarketPrice)} (${formatPct(fact.premarketPct)})`;
  }
  if (fact.intraday) {
    line +=
      `, intraday low ${formatFactPx(fact.intraday.low)} (${formatPct(fact.intraday.lowPct)})` +
      `, high ${formatFactPx(fact.intraday.high)} (${formatPct(fact.intraday.highPct)})`;
  } else if (fact.ohlcMissing) {
    line += ', intraday n/a';
  }
  return line;
}

export function formatRankLine(rank: FactsRank): string {
  const side = (rows: RankedMove[]) =>
    rows.length ? rows.map((row) => `${row.ticker} ${formatPct(row.changePct)}`).join(', ') : '(none)';
  return `RANK best: ${side(rank.best)} | worst: ${side(rank.worst)}`;
}

function etMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * Official-close guard. On the session's own calendar day, today's bar is
 * partial until 4:15 PM ET and, after that, until it matches the snapshot
 * day close. A later calendar day means that session has already closed.
 */
export function volumeIsPartial(args: {
  lastBarClose: number;
  prevDayClose?: number;
  dayClose?: number;
  now: Date;
  sessionDate: string;
}): boolean {
  const today = etDateISO(args.now);
  if (args.sessionDate < today) return false;
  if (args.sessionDate > today) return true;

  const settled = etMinutes(args.now) >= 16 * 60 + 15;
  const reference = settled ? args.dayClose : args.prevDayClose;
  if (reference == null) return !settled;
  return Math.abs(args.lastBarClose - reference) > 0.01;
}

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function barDate(epochMs: number): string {
  const date = new Date(epochMs);
  if (date.getUTCHours() === 0) return date.toISOString().slice(0, 10);
  return etDateISO(date);
}

function massiveKey(): string | null {
  return process.env.MASSIVE_API_KEY?.trim() || process.env.POLYGON_API_KEY?.trim() || null;
}

export async function fetchDailyBars(ticker: string, from: string, to: string): Promise<DailyBar[]> {
  const key = massiveKey();
  if (!key) throw new Error('MASSIVE_API_KEY is not configured');
  const url =
    `${MASSIVE_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/` +
    `${from}/${to}?adjusted=true&sort=asc&limit=50&apiKey=${encodeURIComponent(key)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`${ticker} bars HTTP ${resp.status}`);
  const json = (await resp.json()) as {
    results?: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>;
  };
  return (json.results ?? []).map((bar) => ({
    date: barDate(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }));
}

export async function fetchSnapshot(ticker: string): Promise<{
  prevDayClose?: number;
  dayClose?: number;
  lastTrade?: number;
} | null> {
  const key = massiveKey();
  if (!key) return null;
  const url =
    `${MASSIVE_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/` +
    `${encodeURIComponent(ticker)}?apiKey=${encodeURIComponent(key)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) return null;
  const json = (await resp.json()) as {
    ticker?: { day?: { c?: number }; prevDay?: { c?: number }; lastTrade?: { p?: number } };
  };
  return {
    prevDayClose: json.ticker?.prevDay?.c,
    dayClose: json.ticker?.day?.c,
    lastTrade: json.ticker?.lastTrade?.p,
  };
}

export async function loadFactsPack(args: {
  asOf: string;
  edition: BriefEdition;
  tickers: string[];
  now?: Date;
}): Promise<BriefFacts> {
  const now = args.now ?? new Date();
  const from = addDaysISO(args.asOf, -12);
  const weekly: Record<string, WeeklyFact> = {};
  const tickers: Record<string, TickerFact> = {};

  await Promise.all(
    args.tickers.map(async (ticker) => {
      try {
        const [bars, snap] = await Promise.all([
          fetchDailyBars(ticker, from, args.asOf),
          fetchSnapshot(ticker),
        ]);
        const session = bars.filter((bar) => bar.date <= args.asOf);
        const last = session[session.length - 1];
        const prev = session[session.length - 2];
        if (!last || !prev) return;
        tickers[ticker] = buildTickerFact({
          close: last.close,
          prevClose: prev.close,
          high: last.high,
          low: last.low,
          open: last.open,
          volume: last.volume,
          volumeIsPartial: volumeIsPartial({
            lastBarClose: last.close,
            prevDayClose: snap?.prevDayClose,
            dayClose: snap?.dayClose,
            now,
            sessionDate: last.date,
          }),
          premarketPrice: args.edition === 'morning' ? snap?.lastTrade : undefined,
        });
        if (args.edition === 'weekly' && session.length >= 2) {
          const week = session.slice(-5);
          const weekOpen = week[0].open;
          const weekClose = week[week.length - 1].close;
          weekly[ticker] = {
            weekOpen,
            weekClose,
            weekHigh: Math.max(...week.map((bar) => bar.high)),
            weekLow: Math.min(...week.map((bar) => bar.low)),
            changePct: weekOpen ? round2((weekClose / weekOpen - 1) * 100) : 0,
          };
        }
      } catch (err) {
        console.warn(
          `[brief_qa] facts ${ticker}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  if (!tickers.SPY) throw new Error('SPY facts unavailable');

  return {
    asOf: args.asOf,
    edition: args.edition,
    generatedAt: now.toISOString(),
    tickers,
    ...(args.edition === 'weekly' ? { weekly } : {}),
    priorLevels: [],
    calendar: [],
    rank: rankTickers(tickers),
  };
}
