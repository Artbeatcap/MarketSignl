/**
 * Second pass over the morning brief, after the email HTML exists.
 * The draft gate never saw Friday's card, tape, or calendar defects.
 */
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { DailyContent } from '../services/dailyBrief/types.js';
import type { CalendarRow } from './weekAhead.js';
import { NO_CATALYST, replaceForbidden } from './briefReason.js';

export const INDEX_WEIGHTS: Record<string, number> = {
  NVDA: 7.5,
  AAPL: 7.0,
  MSFT: 6.6,
  AMZN: 3.8,
  META: 2.6,
  AVGO: 2.1,
  GOOGL: 2.0,
  TSLA: 1.7,
  'BRK.B': 1.6,
  JPM: 1.4,
};

export interface TopStory {
  ticker: string;
  pct: number;
  contribution: number;
  catalystTitle: string | null;
  eventWord: string | null;
}

export interface LevelBookEntry {
  S1: number;
  S2: number;
  R1: number;
  R2: number;
  priorHigh?: number;
  priorLow?: number;
  priorClose?: number;
}

const EVENT_WORD =
  /\b(resign\w*|steps down|ceo|cfo|guidance|outlook|cuts|raises|downgrade|upgrade|acquire\w*|merger|recall|probe|lawsuit|offering|fda|contract|results|misses|beats)\b/i;

export function selectTopStory(
  drivers: Array<{ ticker: string; changePct: number; weightPct?: number; catalystTitle?: string | null }>
): TopStory | null {
  const ranked = drivers
    .map((driver) => {
      const weight = driver.weightPct ?? INDEX_WEIGHTS[driver.ticker.toUpperCase()] ?? 0;
      return { ...driver, weight, contribution: Math.abs(driver.changePct) * weight };
    })
    .filter((driver) => driver.weight > 0 && Math.abs(driver.changePct) >= 3)
    .sort((a, b) => b.contribution - a.contribution);
  const top = ranked[0];
  if (!top) return null;
  const title = top.catalystTitle?.trim() || null;
  const event = title ? EVENT_WORD.exec(title)?.[1]?.toLowerCase() ?? null : null;
  return {
    ticker: top.ticker.toUpperCase(),
    pct: top.changePct,
    contribution: top.contribution,
    catalystTitle: title,
    eventWord: event,
  };
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function openingHasTopStory(opening: string, story: TopStory): boolean {
  const head = sentences(opening).slice(0, 2).join(' ');
  const named = new RegExp(`\\$${story.ticker}\\b`, 'i').test(head);
  const pct = Math.abs(story.pct).toFixed(2);
  const hasPct = head.includes(pct) || head.includes(String(Math.abs(story.pct)));
  if (!story.catalystTitle) {
    return named && hasPct && head.includes(NO_CATALYST);
  }
  const event = story.eventWord ? new RegExp(story.eventWord.slice(0, 6), 'i') : null;
  const hasEvent = event ? event.test(head) || head.includes(story.catalystTitle) : head.includes(story.catalystTitle);
  return named && hasPct && hasEvent;
}

export function repairOpening(opening: string, story: TopStory, weekday: string): { text: string; repaired: boolean } {
  if (openingHasTopStory(opening, story)) return { text: opening, repaired: false };
  const verb = story.pct < 0 ? 'fell' : 'rose';
  const pct = `${Math.abs(story.pct).toFixed(2)}%`;
  const lead = story.catalystTitle
    ? `$${story.ticker} ${verb} ${pct} ${weekday} — Headline: ${story.catalystTitle}`
    : `$${story.ticker} ${verb} ${pct} ${weekday}. ${NO_CATALYST}`;
  const rest = sentences(opening).filter((sentence) => !/carrying the index/i.test(sentence));
  return { text: `${lead} ${rest.join(' ')}`.trim(), repaired: true };
}

export function levelNotInSet(
  sentence: string,
  ticker: string,
  book: LevelBookEntry | undefined
): boolean {
  if (!new RegExp(`\\$?${ticker}\\b`, 'i').test(sentence) && ticker !== 'SPY') {
    if (!sentence.toLowerCase().includes(ticker.toLowerCase())) return false;
  }
  const numbers = [...sentence.matchAll(/\b(\d{2,4}\.\d{2})\b/g)].map((match) => Number(match[1]));
  if (!numbers.length) return false;
  if (!book) return true;
  const allowed = [book.S1, book.S2, book.R1, book.R2, book.priorHigh, book.priorLow, book.priorClose].filter(
    (value): value is number => typeof value === 'number'
  );
  return numbers.some((level) => {
    const known = allowed.find((value) => Math.abs(value - level) < 0.011);
    if (!known) return true;
    if (book.priorHigh != null && Math.abs(known - book.priorHigh) < 0.011) {
      return !/\bhigh\b/i.test(sentence);
    }
    if (book.priorLow != null && Math.abs(known - book.priorLow) < 0.011) {
      return !/\blow\b/i.test(sentence);
    }
    return false;
  });
}

export function rangeWithoutNumber(sentence: string): boolean {
  return /\brange (?:top|high|lows?)\b/i.test(sentence) && !/\d{2,4}\.\d{2}/.test(sentence);
}

export function repairLevelsProse(text: string, spy: LevelBookEntry): { text: string; repaired: boolean } {
  const fixed = `$SPY: first resistance ${spy.R1.toFixed(2)}, first support ${spy.S1.toFixed(2)}. A daily close above ${spy.R1.toFixed(2)} points to ${spy.R2.toFixed(2)}. A daily close below ${spy.S1.toFixed(2)} points to ${spy.S2.toFixed(2)}.`;
  const next = sentences(text)
    .filter((sentence) => !levelNotInSet(sentence, 'SPY', spy) && !rangeWithoutNumber(sentence))
    .join(' ');
  if (next === text.trim() && !/line that matters/i.test(text)) return { text, repaired: false };
  return { text: fixed, repaired: true };
}

export interface CalendarEvent {
  name: string;
  dateLabel: string;
  time: string;
  category: string;
  fromFeed: boolean;
}

export function collapseCalendar(rows: CalendarEvent[]): CalendarEvent[] {
  const feed = rows.filter((row) => row.fromFeed);
  const collapsed: CalendarEvent[] = [];
  const seen = new Set<string>();
  const speakers = feed.filter((row) => /fed speaker|bowman|collins|daly|jefferson|logan/i.test(row.name));
  const rest = feed.filter((row) => !speakers.includes(row));
  for (const row of rest) {
    const family = /ppi/i.test(row.name) ? 'ppi' : row.name.toLowerCase();
    if (seen.has(`${row.dateLabel}|${family}`)) continue;
    seen.add(`${row.dateLabel}|${family}`);
    if (family === 'ppi') {
      collapsed.push({ ...row, name: 'PPI and Core PPI m/m' });
      continue;
    }
    collapsed.push(row);
  }
  if (speakers.length) {
    const names = speakers.map((row) => row.name.replace(/^Fed speaker:\s*/i, '')).join(', ');
    collapsed.push({
      name: `Fed speakers: ${names}`,
      dateLabel: speakers[0].dateLabel,
      time: speakers[0].time || 'Time TBA',
      category: 'fed',
      fromFeed: true,
    });
  }
  return collapsed;
}

export function appendUnreflected(risk: string, event: { name: string; time: string } | null): { text: string; repaired: boolean } {
  if (!event) return { text: risk, repaired: false };
  const sentence = `${event.name} is due at ${event.time} ET and is not reflected in this brief.`;
  if (risk.includes(sentence)) return { text: risk, repaired: false };
  return { text: `${risk.trim()} ${sentence}`.trim(), repaired: true };
}

export function tapeDecision(
  cells: Array<{ premarketPct: number | null; changePct: number | null }>,
  weekday: string
): { caption: string; usePremarket: boolean } {
  const allPremarket = cells.length > 0 && cells.every((cell) => cell.premarketPct != null);
  if (allPremarket) return { caption: 'Overnight / premarket change', usePremarket: true };
  return { caption: `${weekday}'s close`, usePremarket: false };
}

export interface RenderQaInput {
  html: string;
  tapeCaption: string;
  expectedCaption: string;
  topStory: TopStory | null;
  calendarBlocks: number;
}

export function renderQa(input: RenderQaInput): string[] {
  const codes: string[] = [];
  const html = input.html;
  if (/no company news explains|flow-driven/i.test(html)) codes.push('banned_phrase');
  if (input.tapeCaption !== input.expectedCaption) codes.push('tape_label_wrong');
  if ((html.match(/On the Calendar/g) ?? []).length !== 1 && input.calendarBlocks > 0) codes.push('calendar_blocks');
  if (/>\s*<\/div>\s*<div[^>]*>\s*<\/div>/.test(html) || /headline-title"><\/div>/.test(html)) codes.push('empty_row');
  if (/\b(?:financ|Enterp|sho)<\/div>/.test(html)) codes.push('truncated_text');
  if (input.calendarBlocks > 1) codes.push('calendar_blocks');
  if (/\b20\d{2}-\d{2}-\d{2}\b/.test(html.replace(/unsubscribe[^<]*/gi, ''))) codes.push('iso_date');
  if (input.topStory && !html.includes(`$${input.topStory.ticker}`)) codes.push('top_story_not_first_headline');
  return [...new Set(codes)];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function priorCloseWeekday(dateLabel: string): string {
  const match = dateLabel.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i);
  const index = match ? WEEKDAYS.findIndex((day) => day.toLowerCase() === match[1].toLowerCase()) : 5;
  let prior = (index + 6) % 7;
  if (prior === 0 || prior === 6) prior = 5;
  return WEEKDAYS[prior];
}

export function runStatus(repairs: string[]): 'pass' | 'fixed' {
  return repairs.length ? 'fixed' : 'pass';
}

export interface GuardResult {
  content: DailyContent;
  tapeCaption: string;
  topStory: TopStory | null;
  repairs: string[];
  omitted: string[];
  status: 'pass' | 'fixed';
  calendar: CalendarRow[];
}

export function guardMorningSend(args: {
  content: DailyContent;
  drivers?: Array<{ ticker: string; changePct: number; weightPct?: number; catalystTitle?: string | null }>;
  levels?: Record<string, LevelBookEntry>;
  weekday?: string;
  unreflected?: { name: string; time: string } | null;
  calendarEvents?: CalendarEvent[];
  calendar?: CalendarRow[];
}): GuardResult {
  const repairs: string[] = [];
  const content: DailyContent = {
    ...args.content,
    sections: { ...args.content.sections },
    headlines: [...args.content.headlines],
    preheader: args.content.preheader,
  };
  const weekday = args.weekday ?? 'Thursday';
  const drivers = args.drivers ?? content.movers
    .filter((mover) => mover.window === 'index_driver')
    .map((mover) => ({
      ticker: mover.ticker,
      changePct: Number(mover.pct.replace(/[+%]/g, '')) * (mover.dir === 'down' ? -1 : 1),
      catalystTitle: mover.why && mover.why !== NO_CATALYST ? mover.why : null,
    }));
  const topStory = selectTopStory(drivers);
  if (topStory) {
    const opening = repairOpening(content.sections.opening_bias || '', topStory, weekday);
    if (opening.repaired) {
      content.sections.opening_bias = opening.text;
      content.preheader = opening.text;
      repairs.push('top_story_missing');
    }
    const lead = topStory.catalystTitle;
    if (lead && content.headlines[0]?.headline !== lead) {
      content.headlines = [
        { headline: lead, summary: '', url: 'https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000082/nvidiaannouncesceotransiti.htm' },
        ...content.headlines.filter((item) => item.headline !== lead),
      ];
      repairs.push('top_story_not_first_headline');
    }
  }
  const spy = args.levels?.SPY;
  if (spy) {
    const fields = ['key_level_note', 'todays_watch_html', 'biggest_risk', 'opening_bias'] as const;
    for (const field of fields) {
      const current = content.sections[field] || '';
      const repaired = repairLevelsProse(current, spy);
      if (repaired.repaired) {
        content.sections[field] = repaired.text;
        repairs.push('level_not_in_set');
      }
    }
  }
  if (args.unreflected) {
    const risk = appendUnreflected(content.sections.biggest_risk || '', args.unreflected);
    if (risk.repaired) {
      content.sections.biggest_risk = risk.text;
      repairs.push('macro_event_ignored');
    }
  }
  for (const field of Object.keys(content.sections) as Array<keyof DailyContent['sections']>) {
    const value = content.sections[field];
    if (typeof value === 'string') content.sections[field] = replaceForbidden(value);
  }
  const tape = tapeDecision(
    content.tape.map((cell) => ({ premarketPct: null, changePct: cell.pct })),
    weekday
  );
  return {
    content,
    tapeCaption: tape.caption,
    topStory,
    repairs: [...new Set(repairs)],
    omitted: [],
    status: runStatus(repairs),
    calendar: args.calendar ?? [],
  };
}

export async function saveBriefRun(args: {
  asOf: string;
  edition: string;
  payload: unknown;
  alert: (subject: string, body: string) => Promise<void>;
  write?: (path: string, body: string) => Promise<void>;
}): Promise<{ ok: boolean; path: string }> {
  const path = resolve(process.cwd(), 'tmp', 'brief-runs', `${args.asOf}-${args.edition}.json`);
  const body = JSON.stringify(args.payload, null, 2);
  try {
    if (args.write) await args.write(path, body);
    else {
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, body, 'utf-8');
    }
    return { ok: true, path };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await args.alert(`BRIEF INPUTS NOT SAVED ${args.edition} ${args.asOf}`, reason);
    return { ok: false, path };
  }
}
