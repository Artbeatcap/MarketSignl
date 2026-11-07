/**
 * Pre-send QA. Auto-corrects an unambiguous wrong figure, blocks anything
 * ambiguous, and never lets unchecked model prose through on a crash.
 */
import { ATLAS_FACTS_RULES, PROMPT_VERSION, exampleSentences } from './briefAtlasRules.js';
import {
  CONTRAST_TICKERS,
  formatFactsLine,
  formatPct,
  formatRankLine,
  rankTickers,
  round2,
  type BriefFacts,
  type TickerFact,
} from './briefFacts.js';
import { outcomeWord, priorCallLine, type LevelCall, type PriorLevel } from './briefLevels.js';
import { isWeekend } from './weekAhead.js';

const MINUS = '\u2212';
const PCT_TOL = 0.02;
const PX_TOL = 0.01;

const STOP = new Set([
  'AM', 'PM', 'ET', 'US', 'AI', 'THE', 'AND', 'FOR', 'NOT', 'BUT', 'OR', 'IF', 'IT',
  'BE', 'AT', 'ON', 'IN', 'TO', 'OF', 'BY', 'AN', 'AS', 'IS', 'WE', 'UP', 'GDP',
  'CPI', 'PPI', 'FOMC', 'ISM', 'ETF', 'CEO', 'ATH', 'IPO', 'SEC', 'FDA', 'EPS',
  'YOY', 'NOW', 'LET', 'WAS', 'ARE', 'HAS', 'HAD', 'ITS', 'OUR', 'ALL', 'NEW',
  'LOW', 'HIGH', 'OPEN', 'CLOSE',
]);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const MON =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';

type Metric =
  | 'changePct'
  | 'changeAbs'
  | 'close'
  | 'premarketPct'
  | 'weekPct'
  | 'intradayLowPct'
  | 'intradayHighPct'
  | 'intradayEither'
  | 'volume';

const DOWN_WORD = /\b(down|fell|fall|falls|lost|lower|off|declined?|declines|dropped|drops?|slid|sank|tumbled|plunged)\b/i;
const UP_WORD = /\b(up|rose|rise|rises|gained?|gains|higher|rallied|rally|climbed|added|jumped|bounced)\b/i;
const CLAUSE_BREAK = /[,;:]|\b(?:and|but|while|whereas)\b/i;
const SOURCE_CLAUSE =
  /\b(because|following|driven by|amid|due to|on (?:news|reports?|word)|after (?:the |a |an )?(?:report|news|decision|results|earnings|announcement|election|guidance|vote|data)|trigger(?:ed|s)?|catalyst|headlines?|announced|reported|said|warned|on (?:\w+\s+){0,2}(?:risk|fears?|worries|concerns?|hopes?))\b/i;
const INFERENCE_CLAUSE = /→|\bchain\b|\bworry\b|\bthat(?: is|'s) why\b/i;
const NO_NEWS = /no\s+(?:company\s+|fresh\s+)?news\s+explains|no\s+headline|nothing\s+in\s+the\s+headlines/i;
const CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.m\.|p\.m\.|am|pm)(?![a-z])/gi;
const HEADLINE_TAG = /\s*\[H(\d+)\]/g;
/** "landed before the close": a claim about when news came out, checked against the article time. */
const NEWS_TIMING =
  /\b(?:landed|landing|reported|announced|published|posted|came out|broke|in reports?)\b(?:\s+\S+){0,3}?\s+(before the open|premarket|after the open|midday|mid-session|before the close|after the close|after hours|overnight)\b/gi;
const PROPER_OK = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'nasdaq', 'dow',
  'wall', 'street', 'yesterday', 'today',
]);
const GENERIC_WORD = new Set([
  'stock', 'stocks', 'market', 'markets', 'share', 'shares', 'today', 'investors', 'after', 'before',
  'their', 'there', 'which', 'about', 'while', 'would', 'could', 'should', 'session', 'close', 'closed',
  'points', 'trading', 'price', 'prices', 'headline', 'headlines',
]);

const SECTOR_ETF: Array<[RegExp, string[]]> = [
  [/\b(?:chips?|chipmakers?|semis|semiconductors?)\b/gi, ['SMH', 'SOXX']],
  [/\benergy\b/gi, ['XLE']],
  [/\boil\b/gi, ['USO']],
  [/\bstaples\b/gi, ['XLP']],
  [/\butilities\b/gi, ['XLU']],
  [/\btech(?:nology)?\b/gi, ['XLK']],
  [/\b(?:bonds?|treasur(?:y|ies))\b/gi, ['TLT']],
  [/\b(?:credit|high[- ]yield|junk)\b/gi, ['HYG']],
  [/\b(?:bitcoin|crypto)\b/gi, ['IBIT']],
];
/** A sector "held" or was "flat" only if its ETF moved less than this, in percent. */
const SECTOR_FLAT_PCT = 1;

const INTRADAY_TOL = 0.05;
const KEEP_RATIO = 0.6;
const STYLE_CODES = new Set([
  'missing_why',
  'missing_contrast',
  'no_condition',
  'hype_word',
  'long_sentence',
  'missing_recap',
]);
const NARRATIVE_FIELDS = new Set([
  'opening_bias',
  'body',
  'session_setup_html',
  'key_level_note',
  'todays_watch_html',
  'biggest_risk',
  'major_driver',
  'week_in_review_html',
  'week_ahead_html',
]);
const SECTOR_WORD = /\b(chips?|semis?|semiconductors?|bonds?|oil|bitcoin|crypto|staples|utilities|tech|energy)\b/i;
const INDEX_TICKERS = new Set(['SPY', 'QQQ', 'IWM', 'DIA']);
const MAX_REWRITES = 2;

export interface QaIssue {
  code: string;
  severity: 'block' | 'warn';
  message: string;
  field?: string;
}

export interface QaFix {
  code: 'number' | 'hygiene' | 'removed_sentence';
  field: string;
  from: string;
  to: string;
}

export interface CoverageGap {
  driver: string;
  kind: 'verified' | 'unverified_gap';
  headline?: string;
}

export interface BriefHeadline {
  headline: string;
  summary?: string;
  url?: string;
  /** ISO time from our news feed, so the prose can say when the news landed. */
  publishedAt?: string;
  /** Verbatim from our news feed: a source, so its numbers are not checked as model prose. */
  source?: 'feed';
}

export interface BriefDraft {
  fields: Record<string, string>;
  headlines?: BriefHeadline[];
  levelCalls?: LevelCall[];
}

export interface QaResult {
  status: 'pass' | 'fixed' | 'blocked';
  fixes: QaFix[];
  issues: QaIssue[];
  html: string;
  draft: Required<Pick<BriefDraft, 'headlines' | 'levelCalls'>> & Pick<BriefDraft, 'fields'>;
  coverageGaps: CoverageGap[];
  /** Fields that kept the first sentence and at least 60% of their sentences stay. The rest are listed here. */
  droppedFields: string[];
}

export interface ReferenceNote {
  source: string;
  published_date?: string | null;
  title?: string | null;
  url?: string | null;
  transcript: string;
}

export interface NewsArticle {
  headline: string;
  summary: string;
  url?: string;
}

interface Claim {
  start: number;
  end: number;
  ticker: string | null;
  metric: Metric;
  value: number;
  raw: string;
  approx: boolean;
  paren: boolean;
  /** Volume claims written as "125.9 million": shares per unit, and the unit text to keep. */
  scale?: number;
  unit?: string;
  /** A price written without "$" ("fell 4.41% to 733.00"). */
  bare?: boolean;
}

export interface BriefQaLog {
  event: 'brief_qa';
  asOf: string;
  edition: string;
  status: string;
  fixes: number;
  blocks: number;
  warns: number;
  coverageGaps: number;
  unverifiedGaps: number;
  levelsResolved: number;
  ms: number;
  promptVersion?: string;
  styleWarns?: number;
}

export function logBriefQa(entry: BriefQaLog): void {
  console.log(JSON.stringify(entry));
  if (entry.fixes > 3) {
    console.warn(`[brief_qa] ${entry.fixes} fixes in one brief — the prompt is drifting`);
  }
  if (entry.status === 'blocked' || entry.status === 'crashed') {
    console.error(`[brief_qa] ${entry.status} ${entry.edition} ${entry.asOf}`);
  }
}

export function buildAtlasBriefPrompt(facts: BriefFacts, headlines: BriefHeadline[] = []): string {
  const tickers = Object.keys(facts.tickers).sort(tickerOrder);
  const prior = facts.priorLevels.filter((level) => level.status !== 'open').map(priorCallLine);
  const lines = [
    `PROMPT_VERSION: ${PROMPT_VERSION}`,
    'FACTS',
    ...(tickers.length ? tickers.map((ticker) => formatFactsLine(ticker, facts.tickers[ticker])) : ['(none)']),
    formatRankLine(facts.rank ?? rankTickers(facts.tickers)),
    '',
    'PRIOR CALLS',
    ...(prior.length ? prior : ['(none)']),
    '',
    'HEADLINES',
    ...(headlines.length
      ? headlines.map(
          (item, index) =>
            `- [H${index + 1}] ${item.publishedAt ? `[${etStamp(item.publishedAt)}] ` : ''}${item.headline}${item.summary ? ` — ${item.summary}` : ''}`
        )
      : ['(none)']),
    '',
    'RULES',
    ATLAS_FACTS_RULES,
  ];
  return lines.join('\n');
}

export async function notePromptVersion(
  echoed: string | undefined,
  alert: (subject: string, body: string) => Promise<void>
): Promise<{ stale: boolean; promptVersion: string; send: true }> {
  const current = PROMPT_VERSION;
  if (echoed === current) return { stale: false, promptVersion: current, send: true };
  const body = echoed
    ? `Ingest echoed ${echoed}. Current prompt is ${current}.`
    : `Ingest omitted promptVersion. Current prompt is ${current}.`;
  console.warn(`[brief_qa] BRIEF PROMPT STALE ${body}`);
  try {
    await alert('BRIEF PROMPT STALE', body);
  } catch (err) {
    console.error(`[brief_qa] prompt-stale alert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { stale: true, promptVersion: current, send: true };
}

export function runBriefQa(
  input: BriefDraft,
  facts: BriefFacts,
  opts?: { holidays?: string[]; openLevels?: PriorLevel[] }
): QaResult {
  const fields: Record<string, string> = {};
  const fixes: QaFix[] = [];
  const issues: QaIssue[] = [];
  const droppedFields: string[] = [];
  const holidays = opts?.holidays ?? [];
  const headlines = (input.headlines ?? []).map((item) => ({ ...item }));

  const cleaned: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.fields)) {
    const next = stripHygiene(value || '');
    if (next !== value) fixes.push({ code: 'hygiene', field: name, from: value, to: next });
    cleaned[name] = next;
  }
  headlines.forEach((item, index) => {
    if (item.source === 'feed') return;
    cleaned[`headline:${index}`] = item.headline || '';
    cleaned[`headline_summary:${index}`] = item.summary || '';
  });

  const located = collectLocatedClaims(cleaned, facts);
  const dupeKeys = duplicateKeys(located);

  for (const [field, original] of Object.entries(cleaned)) {
    const salvage = salvageField(original, field, facts, holidays, dupeKeys, headlines);
    if (!original.trim()) {
      fields[field] = '';
      continue;
    }
    if (salvage.kept) {
      fields[field] = salvage.text;
      fixes.push(...salvage.fixes);
      issues.push(...salvage.issues);
      if (NARRATIVE_FIELDS.has(field)) {
        issues.push(...styleIssues(field, salvage.text, headlines, facts));
      }
      issues.push(...driftIssues(salvage.text, field, opts?.openLevels ?? facts.priorLevels));
    } else {
      fields[field] = original;
      droppedFields.push(field);
      issues.push(...salvage.issues);
      issues.push({
        code: 'field_unsaved',
        severity: 'block',
        field,
        message: `${field} kept ${salvage.keptCount} of ${salvage.total} sentences`,
      });
    }
  }

  headlines.forEach((item, index) => {
    const headline = fields[`headline:${index}`];
    const summary = fields[`headline_summary:${index}`];
    if (!droppedFields.includes(`headline:${index}`)) item.headline = headline ?? item.headline;
    if (!droppedFields.includes(`headline_summary:${index}`)) item.summary = summary ?? item.summary;
    delete fields[`headline:${index}`];
    delete fields[`headline_summary:${index}`];
  });

  const draft = {
    fields,
    headlines,
    levelCalls: input.levelCalls ?? [],
  };
  const blocked = droppedFields.length > 0;
  return {
    status: blocked ? 'blocked' : fixes.length ? 'fixed' : 'pass',
    fixes,
    issues,
    html: renderResultHtml(draft),
    draft,
    coverageGaps: [],
    droppedFields,
  };
}

export function acceptDriverPhrase(raw: string): string | null {
  const phrase = raw.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
  if (!phrase || /\d/.test(phrase) || /[!?]/.test(phrase)) return null;
  const words = phrase.split(' ');
  if (words.length < 3 || words.length > 8) return null;
  return phrase;
}

export async function applyCoverage(
  input: BriefDraft,
  facts: BriefFacts,
  deps: {
    notes: ReferenceNote[];
    extractDrivers: (notes: ReferenceNote[]) => Promise<string[]>;
    findNews: (driver: string) => Promise<NewsArticle | null>;
    regenerate?: (draft: BriefDraft, issues: QaIssue[]) => Promise<BriefDraft>;
  }
): Promise<{ draft: BriefDraft; gaps: CoverageGap[]; prompt: string; html: string }> {
  const draft: BriefDraft = {
    fields: { ...input.fields },
    headlines: (input.headlines ?? []).map((item) => ({ ...item })),
    levelCalls: input.levelCalls ?? [],
  };
  const gaps: CoverageGap[] = [];
  const raw = deps.notes.length ? await deps.extractDrivers(deps.notes) : [];
  const drivers = [...new Set(raw.map((phrase) => acceptDriverPhrase(phrase)).filter((phrase): phrase is string => !!phrase))];
  let added = false;
  const coverageIssues: QaIssue[] = [];

  for (const driver of drivers) {
    if (briefMentions(draft, driver)) continue;
    const article = await deps.findNews(driver);
    if (!article) {
      gaps.push({ driver, kind: 'unverified_gap' });
      continue;
    }
    draft.headlines = draft.headlines ?? [];
    draft.headlines.push({
      headline: article.headline,
      summary: article.summary,
      url: article.url,
      source: 'feed',
    });
    gaps.push({ driver, kind: 'verified', headline: article.headline });
    coverageIssues.push({
      code: 'coverage',
      severity: 'warn',
      message: `Add the confirmed headline: ${article.headline}`,
    });
    added = true;
  }

  let next = draft;
  if (added && deps.regenerate) {
    try {
      next = await deps.regenerate(draft, coverageIssues);
    } catch {
      next = draft;
    }
  }

  const prompt = buildAtlasBriefPrompt(facts, next.headlines ?? []);
  const html = renderResultHtml({
    fields: next.fields,
    headlines: next.headlines ?? [],
    levelCalls: next.levelCalls ?? [],
  });
  return { draft: next, gaps, prompt, html };
}

export interface ResolveArgs {
  draft: BriefDraft;
  facts: BriefFacts;
  holidays?: string[];
  now?: Date;
  noteCount36h?: number;
  levelsResolved?: number;
  regenerate: (draft: BriefDraft, issues: QaIssue[]) => Promise<BriefDraft>;
  alert: (subject: string, body: string) => Promise<void>;
  check?: (draft: BriefDraft, facts: BriefFacts) => QaResult;
  coverage?: {
    notes: ReferenceNote[];
    extractDrivers: (notes: ReferenceNote[]) => Promise<string[]>;
    findNews: (driver: string) => Promise<NewsArticle | null>;
    regenerate?: (draft: BriefDraft, issues: QaIssue[]) => Promise<BriefDraft>;
  };
}

export interface GateResolution {
  status: 'pass' | 'fixed' | 'blocked' | 'crashed';
  draft: BriefDraft;
  sendProse: boolean;
  gaps: CoverageGap[];
  result?: QaResult;
}

export async function resolveGatedDraft(args: ResolveArgs): Promise<GateResolution> {
  const started = Date.now();
  warnIfNotesSilent(args.noteCount36h, args.now ?? new Date());
  try {
    let draft = args.draft;
    let gaps: CoverageGap[] = [];
    if (args.coverage) {
      const covered = await applyCoverage(draft, args.facts, {
        ...args.coverage,
        regenerate: args.coverage.regenerate ?? args.regenerate,
      });
      draft = covered.draft;
      gaps = covered.gaps;
    }
    const check = args.check ?? ((next, facts) => runBriefQa(next, facts, { holidays: args.holidays }));
    let result = check(draft, args.facts);
    const startedWithBias = Boolean(draft.fields.opening_bias?.trim());
    const notes: QaIssue[] = [];
    let rewrites = 0;
    const rewrite = async (from: BriefDraft, issues: QaIssue[], why: string): Promise<BriefDraft | null> => {
      rewrites += 1;
      try {
        return await args.regenerate(from, issues);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[brief_qa] ${why} rewrite did not run: ${message}`);
        notes.push({ code: 'rewrite_not_run', severity: 'warn', message: `${why} rewrite did not run: ${message}` });
        return null;
      }
    };

    if (result.droppedFields.length) {
      const second = await rewrite(result.draft, result.issues, 'Sentence-loss');
      if (second) result = check(second, args.facts);
      const biasDropped =
        result.droppedFields.includes('opening_bias') ||
        (startedWithBias && !result.draft.fields.opening_bias?.trim());
      if (biasDropped) {
        result.issues.push(...notes);
        await safeAlert(
          args.alert,
          `BRIEF QA BLOCKED ${args.facts.edition} ${args.facts.asOf}`,
          formatIssues(result.issues)
        );
        logResolution(args, 'blocked', result, gaps, started);
        return { status: 'blocked', draft: result.draft, sendProse: false, gaps, result };
      }
      blankDropped(result);
    }
    if (rewrites < MAX_REWRITES && needsStyleRewrite(result.issues)) {
      const rewritten = await rewrite(
        result.draft,
        result.issues.filter((issue) => issue.severity === 'warn'),
        'Style'
      );
      if (rewritten) {
        const restyled = check(rewritten, args.facts);
        if (!restyled.droppedFields.includes('opening_bias')) {
          blankDropped(restyled);
          result = restyled;
        }
      }
    }
    result.issues.push(...notes);
    const status = result.droppedFields.length ? 'fixed' : result.status;
    logResolution(args, status, result, gaps, started);
    for (const [name, text] of Object.entries(result.draft.fields)) {
      result.draft.fields[name] = stripHeadlineTags(text);
    }
    return { status, draft: result.draft, sendProse: true, gaps, result };
  } catch (err) {
    await safeAlert(
      args.alert,
      `BRIEF QA CRASHED ${args.facts.edition} ${args.facts.asOf}`,
      err instanceof Error ? err.message : String(err)
    );
    logBriefQa({
      event: 'brief_qa',
      asOf: args.facts.asOf,
      edition: args.facts.edition,
      status: 'crashed',
      fixes: 0,
      blocks: 0,
      warns: 0,
      coverageGaps: 0,
      unverifiedGaps: 0,
      levelsResolved: args.levelsResolved ?? 0,
      ms: Date.now() - started,
    });
    return { status: 'crashed', draft: args.draft, sendProse: false, gaps: [] };
  }
}

export async function deliverGatedBrief(
  args: ResolveArgs & {
    renderFull: (draft: BriefDraft) => string;
    renderDeterministic: () => string;
    send: (html: string) => Promise<void>;
  }
): Promise<{ html: string; status: GateResolution['status'] }> {
  const resolved = await resolveGatedDraft(args);
  const html = resolved.sendProse ? args.renderFull(resolved.draft) : args.renderDeterministic();
  await args.send(html);
  return { html, status: resolved.status };
}

function logResolution(
  args: ResolveArgs,
  status: string,
  result: QaResult,
  gaps: CoverageGap[],
  started: number
): void {
  logBriefQa({
    event: 'brief_qa',
    asOf: args.facts.asOf,
    edition: args.facts.edition,
    status,
    fixes: result.fixes.length,
    blocks: result.issues.filter((issue) => issue.severity === 'block').length,
    warns: result.issues.filter((issue) => issue.severity === 'warn').length,
    coverageGaps: gaps.length,
    unverifiedGaps: gaps.filter((gap) => gap.kind === 'unverified_gap').length,
    levelsResolved: args.levelsResolved ?? 0,
    ms: Date.now() - started,
    promptVersion: PROMPT_VERSION,
    styleWarns: styleWarnCount(result.issues),
  });
}

function warnIfNotesSilent(count: number | undefined, now: Date): void {
  if (count !== 0) return;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  if (!isWeekend(day)) {
    console.warn('[brief_qa] reference_notes had 0 rows in the last 36 hours');
  }
}

async function safeAlert(
  alert: (subject: string, body: string) => Promise<void>,
  subject: string,
  body: string
): Promise<void> {
  try {
    await alert(subject, body);
  } catch (err) {
    console.error(`[brief_qa] admin alert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function blankDropped(result: QaResult): void {
  for (const name of result.droppedFields) {
    result.draft.fields[name] = '';
    const headline = /^headline(?::|_summary:)(\d+)$/.exec(name);
    if (!headline) continue;
    const item = result.draft.headlines[Number(headline[1])];
    if (!item) continue;
    if (name.startsWith('headline_summary:')) item.summary = '';
    else item.headline = '';
  }
}

/** Three style warns anywhere, or a missing why / contrast in the Opening Bias. */
function needsStyleRewrite(issues: QaIssue[]): boolean {
  if (styleWarnCount(issues) >= 3) return true;
  return issues.some(
    (issue) => issue.field === 'opening_bias' && (issue.code === 'missing_why' || issue.code === 'missing_contrast')
  );
}

function styleWarnCount(issues: QaIssue[]): number {
  return issues.filter((issue) => STYLE_CODES.has(issue.code)).length;
}

function formatIssues(issues: QaIssue[]): string {
  if (!issues.length) return '(no issues)';
  return issues.map((issue) => `${issue.severity} ${issue.code}: ${issue.message}`).join('\n');
}

function etStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)} ET`;
}

function tickerOrder(a: string, b: string): number {
  const order = ['SPY', 'QQQ', 'IWM', 'DIA'];
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b);
}

export function stripHygiene(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const rawLine of lines) {
    if (/^\s*-{3,}\s*$/.test(rawLine)) continue;
    if (/^(I'll|I will|Now I|Let me|Good\.|Excellent)\b/.test(rawLine.trim())) continue;
    const line = rawLine.replace(/comment\s+["“']?chart["”']?[^\n]*/gi, '').trim();
    if (!line) continue;
    if (/^(and|but|or|because|which|that)\s*[,.]?$/i.test(line)) continue;
    kept.push(line);
  }
  let out = kept.join('\n').trim();
  out = out.replace(
    /^\s*((hey|hi|hello)(\s+(guys|everyone|team))?[,.!]*)\s*(here is your (morning|weekly|daily|afternoon) brief[.!]*)?\s*/i,
    ''
  );
  out = out.replace(/\s*(have a (great|good) (day|one|weekend)(\s+guys)?[.!]*)\s*$/i, '');
  out = out.replace(/(^|\n|(?<=[.!?])[ \t]+)(?:there (?:are|were) )?no prior (?:calls|levels)\b[^.!?\n]*[.!?]?[ \t]*/gi, '$1');
  return out.trim();
}

function collectLocatedClaims(
  fields: Record<string, string>,
  facts: BriefFacts
): Array<Claim & { field: string }> {
  const claims: Array<Claim & { field: string }> = [];
  for (const [field, text] of Object.entries(fields)) {
    for (const sentence of splitSentences(text)) {
      claims.push(...collectClaims(sentence, facts).map((claim) => ({ ...claim, field })));
    }
  }
  return claims;
}

function salvageField(
  original: string,
  field: string,
  facts: BriefFacts,
  holidays: string[],
  dupeKeys: Set<string>,
  headlines: BriefHeadline[]
): { kept: boolean; text: string; keptCount: number; total: number; fixes: QaFix[]; issues: QaIssue[] } {
  const sentences = splitSentences(original);
  const grounded = !field.startsWith('headline');
  const verdicts = sentences.map((sentence) =>
    judgeSentence(sentence, field, facts, holidays, dupeKeys, grounded ? headlines : null)
  );
  if (!verdicts.some((verdict) => verdict.grounding === 'cited' && !verdict.remove)) {
    for (const verdict of verdicts) {
      if (verdict.grounding !== 'inference' || verdict.remove) continue;
      verdict.remove = true;
      verdict.reasons.push('ungrounded_cause');
    }
  }
  for (let i = 0; i < verdicts.length; i += 1) {
    if (!verdicts[i].remove) continue;
    let next = i + 1;
    while (next < verdicts.length && /^(That|This|It|Which)\b/i.test(verdicts[next].original)) {
      verdicts[next].remove = true;
      verdicts[next].reasons.push('depends on a removed sentence');
      next += 1;
    }
  }
  const survivors = verdicts.filter((verdict) => !verdict.remove);
  const kept = sentences.length > 0 && !verdicts[0].remove && survivors.length / sentences.length >= KEEP_RATIO;
  if (!kept) {
    const issues: QaIssue[] = [];
    for (const verdict of verdicts) {
      if (!verdict.remove) continue;
      for (const reason of verdict.reasons) {
        issues.push({
          code: reason.startsWith('depends') ? 'removed_sentence' : reason,
          severity: 'block',
          field,
          message: `${reason}: ${verdict.original}`,
        });
      }
    }
    return { kept: false, text: original, keptCount: survivors.length, total: sentences.length, fixes: [], issues };
  }
  const fixes: QaFix[] = [];
  const issues: QaIssue[] = [];
  for (const verdict of verdicts) {
    if (!verdict.remove) {
      fixes.push(...verdict.fixes);
      continue;
    }
    fixes.push({ code: 'removed_sentence', field, from: verdict.original, to: '' });
    issues.push({
      code: 'removed_sentence',
      severity: 'warn',
      field,
      message: `${verdict.reasons.join(', ')}: ${verdict.original}`,
    });
    if (verdict.reasons.includes('example_leak')) {
      issues.push({ code: 'example_leak', severity: 'warn', field, message: verdict.original });
    }
  }
  return {
    kept: true,
    text: survivors.map((verdict) => verdict.text).join('\n'),
    keptCount: survivors.length,
    total: sentences.length,
    fixes,
    issues,
  };
}

function judgeSentence(
  sentence: string,
  field: string,
  facts: BriefFacts,
  holidays: string[],
  dupeKeys: Set<string>,
  headlines: BriefHeadline[] | null
): { original: string; text: string; remove: boolean; reasons: string[]; fixes: QaFix[]; grounding: Grounding } {
  const reasons: string[] = [];
  if (isExampleSentence(sentence)) reasons.push('example_leak');
  const grounding = headlines ? groundSentence(sentence, headlines) : null;
  if (grounding === 'ungrounded') reasons.push('ungrounded_cause');
  const claims = collectClaims(sentence, facts);
  const reps: Array<{ start: number; end: number; next: string }> = [];
  for (const claim of claims) {
    const problem = claimProblem(claim, sentence, facts, dupeKeys);
    if (problem) {
      reasons.push(problem);
      continue;
    }
    if (!claim.ticker) continue;
    const fact = facts.tickers[claim.ticker];
    if (!fact) continue;
    const target = targetFor(claim, fact, facts, sentence);
    if (target == null || claim.approx) continue;
    if (!apart(claim.value, target, claimTolerance(claim))) continue;
    reps.push({ start: claim.start, end: claim.end, next: renderClaim(claim, target) });
  }
  if (dateIssues(sentence, facts.asOf, holidays, field).length) reasons.push('non_trading_date');
  if (partialIssues(sentence, facts, field).length) reasons.push('partial_data');
  if (indexPointProblem(sentence, facts) || pointsProblem(sentence, facts)) reasons.push('not_in_facts');
  if (sectorProblem(sentence, facts)) reasons.push('sector_mismatch');
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length) {
    return { original: sentence, text: sentence, remove: true, reasons: uniqueReasons, fixes: [], grounding };
  }
  const text = applyReplacements(sentence, reps);
  return {
    original: sentence,
    text,
    remove: false,
    reasons: [],
    fixes: text === sentence ? [] : lineFixes(field, sentence, text),
    grounding,
  };
}

type Grounding = 'cited' | 'inference' | 'ungrounded' | null;

/**
 * A cause has to come from HEADLINES. A tagged sentence is checked against the
 * headline it cites; an untagged one must be supported by some headline.
 * Chain and "that is why" sentences need a supported cause in the same field.
 */
function groundSentence(sentence: string, headlines: BriefHeadline[]): Grounding {
  if (NO_NEWS.test(sentence)) return null;
  const tags = [...sentence.matchAll(HEADLINE_TAG)].map((match) => Number(match[1]));
  CLOCK.lastIndex = 0;
  const needsSource = tags.length > 0 || SOURCE_CLAUSE.test(sentence) || CLOCK.test(sentence);
  if (!needsSource) return INFERENCE_CLAUSE.test(sentence) ? 'inference' : null;
  const candidates = tags.length ? tags.map((tag) => headlines[tag - 1]) : headlines;
  if (!candidates.length || candidates.some((item) => !item)) return 'ungrounded';
  return candidates.some((item) => headlineSupports(sentence, item)) ? 'cited' : 'ungrounded';
}

function headlineSupports(sentence: string, item: BriefHeadline): boolean {
  const body = stripHeadlineTags(sentence);
  const source = new Set(stems(`${item.headline} ${item.summary ?? ''}`));
  for (const match of body.matchAll(/\b[A-Z][a-z]{2,}\b/g)) {
    if ((match.index ?? 0) === 0) continue;
    const word = match[0].toLowerCase();
    if (PROPER_OK.has(word)) continue;
    if (!source.has(word.slice(0, 5))) return false;
  }
  const sourceText = `${item.headline} ${item.summary ?? ''}`;
  const stated = new Set([...sourceText.matchAll(CLOCK)].map(clockText));
  const stamp = item.publishedAt ? clockOf(etStamp(item.publishedAt)) : null;
  const asReport = /\b(report(?:ed)?|headline|article|story|published|posted)\b/i.test(body);
  for (const match of body.matchAll(CLOCK)) {
    const time = clockText(match);
    if (stated.has(time)) continue;
    if (time === stamp && asReport) continue;
    return false;
  }
  const hour = item.publishedAt ? etHour(item.publishedAt) : null;
  for (const match of body.matchAll(NEWS_TIMING)) {
    const phrase = match[1].toLowerCase();
    if (sourceText.toLowerCase().includes(phrase)) continue;
    if (hour == null || !fitsSession(phrase, hour)) return false;
  }
  const hits = new Set(
    (body.match(/[A-Za-z][A-Za-z']*/g) ?? [])
      .filter((word) => word.length >= 5 && word !== word.toUpperCase())
      .map((word) => word.toLowerCase())
      .filter((word) => !GENERIC_WORD.has(word))
      .map((word) => word.slice(0, 5))
      .filter((stem) => source.has(stem))
  );
  return hits.size >= 2;
}

function stems(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [])
    .flatMap((word) => word.split('-'))
    .filter((word) => word.length >= 3)
    .map((word) => word.slice(0, 5));
}

function etHour(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return hour + minute / 60;
}

/** Regular session is 9:30–16:00 ET. */
function fitsSession(phrase: string, hour: number): boolean {
  if (phrase === 'before the open' || phrase === 'premarket') return hour < 9.5;
  if (phrase === 'after the open' || phrase === 'midday' || phrase === 'mid-session') return hour >= 9.5 && hour < 16;
  if (phrase === 'before the close') return hour < 16;
  if (phrase === 'after the close' || phrase === 'after hours') return hour >= 16;
  if (phrase === 'overnight') return hour >= 16 || hour < 9.5;
  return false;
}

function clockText(match: RegExpMatchArray): string {
  return `${Number(match[1])}:${match[2] ?? '00'} ${match[3].replace(/\./g, '').toUpperCase()}`;
}

function clockOf(stamp: string): string | null {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)/.exec(stamp);
  return match ? `${Number(match[1])}:${match[2]} ${match[3]}` : null;
}

export function stripHeadlineTags(text: string): string {
  return text.replace(HEADLINE_TAG, '');
}

function claimProblem(claim: Claim, sentence: string, facts: BriefFacts, dupeKeys: Set<string>): string | null {
  if (!claim.ticker) return 'unknown_ticker';
  const fact = facts.tickers[claim.ticker];
  if (!fact) return 'not_in_facts';
  const target = targetFor(claim, fact, facts, sentence);
  const tol = claimTolerance(claim);
  if (claim.metric.startsWith('intraday') && !fact.intraday && (target == null || claim.metric !== 'intradayEither')) {
    return 'no_intraday_data';
  }
  if (dupeKeys.has(`${claim.ticker}|${claim.metric}`) && (target == null || apart(claim.value, target, tol))) {
    return 'duplicate_metric';
  }
  if (target == null) return 'not_in_facts';
  if (!apart(claim.value, target, tol)) return null;
  if (claim.approx) return 'not_in_facts';
  if (claim.metric.startsWith('intraday')) return 'not_in_facts';
  return null;
}

function splitSentences(text: string): string[] {
  const saved: string[] = [];
  const protect = (input: string, pattern: RegExp): string =>
    input.replace(pattern, (match) => {
      const token = `\u0001${saved.length}\u0001`;
      saved.push(match);
      return token;
    });
  let masked = text.replace(/\r\n/g, '\n');
  masked = protect(masked, /\b(?:U\.S\.|U\.K\.|a\.m\.|p\.m\.|vs\.)/gi);
  masked = protect(masked, /\d+\.\d+/g);
  return masked
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/\u0001(\d+)\u0001/g, (_match, index) => saved[Number(index)]).trim())
    .filter((part) => part.length > 0);
}

function isExampleSentence(sentence: string): boolean {
  const norm = normalizeSentence(sentence);
  return exampleSentences().some((item) => normalizeSentence(item) === norm);
}

function normalizeSentence(sentence: string): string {
  return stripHeadlineTags(sentence).replace(/\s+/g, ' ').trim().replace(/[.!?]$/, '');
}

function indexPointProblem(sentence: string, facts: BriefFacts): boolean {
  const match = sentence.match(
    /\b(S&P\s*500|Nasdaq(?:\s+Composite)?|Dow(?:\s+Jones)?)\b(?:\s+\w+){0,3}\s+(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d+)?/
  );
  if (!match) return false;
  const raw = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(raw) || (raw >= 1900 && raw <= 2100)) return false;
  const known = Object.values(facts.tickers)
    .flatMap((fact) => [fact.close, fact.high, fact.low, fact.open])
    .filter((px): px is number => px != null);
  return !known.some((px) => !apart(raw, px, 0.5));
}

/** "1,422 points" has to be a point change in FACTS, not a figure from a headline. */
function pointsProblem(sentence: string, facts: BriefFacts): boolean {
  const known = Object.values(facts.tickers).flatMap((fact) => [Math.abs(fact.changeAbs), fact.close]);
  for (const match of sentence.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*points?\b/gi)) {
    const value = Number(match[1].replace(/,/g, ''));
    if (!known.some((px) => !apart(value, px, PX_TOL))) return true;
  }
  return false;
}

/**
 * "Energy held up" has to agree with XLE, not with USO. The move verb is the
 * first one within six words after the sector word, in the same clause.
 */
function sectorProblem(sentence: string, facts: BriefFacts): boolean {
  for (const clause of stripHeadlineTags(sentence).split(/[;:(]|\b(?:but|while|whereas)\b/i)) {
    for (const [word, tickers] of SECTOR_ETF) {
      for (const match of clause.matchAll(word)) {
        const fact = tickers.map((ticker) => facts.tickers[ticker]).find(Boolean);
        if (!fact) continue;
        const after = clause
          .slice((match.index ?? 0) + match[0].length)
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 6)
          .join(' ');
        const verb = /\b(rose|gained|rallied|climbed|jumped|advanced|bounced|fell|dropped|slid|sank|tumbled|plunged|collapsed|declined|sold off|held(?: up| steady)?|steady|flat|barely moved|unchanged|did not move)\b/i.exec(
          after
        );
        if (!verb) continue;
        const premarket = facts.edition === 'morning' && /pre-?market|overnight|before the open/i.test(clause);
        const pct = premarket ? fact.premarketPct : fact.changePct;
        if (pct == null) continue;
        const move = verb[1].toLowerCase();
        if (/^(rose|gained|rallied|climbed|jumped|advanced|bounced)$/.test(move)) {
          if (!(pct > 0)) return true;
        } else if (/^(held|held up|held steady|steady|flat|barely moved|unchanged|did not move)$/.test(move)) {
          if (Math.abs(pct) >= SECTOR_FLAT_PCT) return true;
        } else if (!(pct < 0)) {
          return true;
        }
      }
    }
  }
  return false;
}

function styleIssues(field: string, text: string, headlines: BriefHeadline[], facts: BriefFacts): QaIssue[] {
  const issues: QaIssue[] = [];
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  let whyFlagged = false;
  for (const paragraph of paragraphs.length ? paragraphs : [text]) {
    if (namesLargeMove(paragraph) && !explainsCause(paragraph, headlines)) {
      whyFlagged = true;
      issues.push({
        code: 'missing_why',
        severity: 'warn',
        field,
        message: 'A move of 2% or more has no headline cause and does not say that no news explains it',
      });
    }
  }
  if (!whyFlagged && text.trim() && !splitSentences(text).some(hasCauseClause) && !explainsCause(text, headlines)) {
    issues.push({
      code: 'missing_why',
      severity: 'warn',
      field,
      message: 'The surviving sentences state figures with no cause clause',
    });
  }
  if (facts.edition === 'close' && field === 'opening_bias' && !hasContrast(text, facts)) {
    issues.push({
      code: 'missing_contrast',
      severity: 'warn',
      field,
      message: 'Close-edition Opening Bias names no second ticker or sector',
    });
  }
  for (const sentence of splitSentences(text)) {
    if (wordCount(sentence) > 20) {
      issues.push({
        code: 'long_sentence',
        severity: 'warn',
        field,
        message: `${wordCount(sentence)} words: ${sentence}`,
      });
    }
    if (hasLevel(sentence) && !/\b(close|hold|above|below|through|by)\b/i.test(sentence)) {
      issues.push({
        code: 'no_condition',
        severity: 'warn',
        field,
        message: `Level has no condition or timeframe: ${sentence}`,
      });
    }
    for (const match of sentence.matchAll(/\b(historic|bloodbath|carnage|crushed|ripping|insane)\b/gi)) {
      issues.push({
        code: 'hype_word',
        severity: 'warn',
        field,
        message: match[1],
      });
    }
  }
  if (field === 'opening_bias') {
    const prior = facts.priorLevels.filter((level) => level.status !== 'open');
    const first = splitSentences(text)[0] ?? '';
    if (prior.length && !/yesterday|\bheld\b|\bfailed\b|\bmet\b|\bexpired\b/i.test(first)) {
      issues.push({
        code: 'missing_recap',
        severity: 'warn',
        field,
        message: `Opening Bias does not start with the prior call (${prior.map(outcomeWord).join(', ')})`,
      });
    }
  }
  return issues;
}

function namesLargeMove(text: string): boolean {
  for (const match of text.matchAll(/[+\-\u2212]?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%/g)) {
    if (Number(match[1]) >= 2) return true;
  }
  return false;
}

function explainsCause(paragraph: string, headlines: BriefHeadline[]): boolean {
  if (/no\s+(company\s+|fresh\s+)?news\s+explains/i.test(paragraph)) return true;
  if (/no\s+headline/i.test(paragraph) || /nothing\s+in\s+the\s+headlines/i.test(paragraph)) return true;
  const hay = paragraph.toLowerCase();
  for (const item of headlines) {
    const words = item.headline.toLowerCase().split(/\W+/).filter((word) => word.length >= 5);
    if (!words.length) continue;
    const hits = words.filter((word) => hay.includes(word));
    if (hits.length >= Math.min(2, words.length)) return true;
  }
  return false;
}

/** The index ETFs count as one group, so "SPY and QQQ" alone is not a contrast. */
function hasContrast(text: string, facts: BriefFacts): boolean {
  const groups = new Set<string>();
  for (const match of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
    const ticker = match[1];
    if (STOP.has(ticker)) continue;
    if (!facts.tickers[ticker] && !(CONTRAST_TICKERS as readonly string[]).includes(ticker)) continue;
    groups.add(INDEX_TICKERS.has(ticker) ? 'INDEX' : ticker);
  }
  if (SECTOR_WORD.test(text)) groups.add('SECTOR');
  return groups.size >= 2;
}

function hasCauseClause(sentence: string): boolean {
  if (/\[H\d+\]/.test(sentence)) return true;
  return /\b(because|following|driven by|amid|due to|on (?:news|reports?|word)|after (?:the |a |an )?(?:report|news|decision|results|earnings|announcement|election|guidance|vote|data)|trigger(?:ed)?|explains?|reason|worry|fears?|chain|so the|that is why)\b/i.test(
    sentence
  );
}

function hasLevel(sentence: string): boolean {
  if (/\bvolume\b|\bshares\b/i.test(sentence)) return false;
  if (/%/.test(sentence) && !/\b(watch|support|resistance|level)\b/i.test(sentence)) return false;
  if (/\b(watch|support|resistance)\b/i.test(sentence) && /\d{2,5}/.test(sentence)) return true;
  return /\b\d{3,5}(?:\.\d{1,2})?\s+is\b/i.test(sentence);
}

function wordCount(sentence: string): number {
  return stripHeadlineTags(sentence).trim().split(/\s+/).filter(Boolean).length;
}

function collectClaims(text: string, facts: BriefFacts): Claim[] {
  const claims: Claim[] = [];
  const pct = /(?<approx>≈|~|about\s+)?(?:(?<sign>[+\-\u2212])\s*)?(?<num>\d{1,3}(?:\.\d{1,2})?)\s*%/gi;
  for (const match of text.matchAll(pct)) {
    const start = match.index ?? 0;
    if (isVolumeContext(text, start)) continue;
    const line = lineAt(text, start);
    const num = Number(match.groups?.num);
    if (!Number.isFinite(num)) continue;
    claims.push({
      start,
      end: start + match[0].length,
      ticker: tickerAt(text, start),
      metric: percentMetric(line, facts),
      value: signed(match.groups?.sign, num, text, start),
      raw: match[0],
      approx: Boolean(match.groups?.approx),
      paren: false,
    });
  }

  const dollars = /(?<open>\()?(?<sign>[+\-\u2212])?\$(?<num>\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)(?<close>\))?/g;
  for (const match of text.matchAll(dollars)) {
    const start = match.index ?? 0;
    if (isVolumeContext(text, start)) continue;
    const line = lineAt(text, start);
    const ticker = tickerAt(text, start);
    const fact = ticker ? facts.tickers[ticker] : undefined;
    const magnitude = Number((match.groups?.num ?? '').replace(/,/g, ''));
    if (!Number.isFinite(magnitude)) continue;
    const value = signed(match.groups?.sign, magnitude, text, start);
    const paren = Boolean(match.groups?.open);
    const metric = dollarMetric(line, paren, value, fact);
    if (!metric) continue;
    claims.push({
      start,
      end: start + match[0].length,
      ticker,
      metric,
      value,
      raw: match[0],
      approx: false,
      paren,
    });
  }

  const bareClose =
    /\b(?:fell|dropped|rose|gained|plunged|slid|climbed|rallied|sank|tumbled|jumped|declined|closed|finished|ended|settled)\b[^;,$!?]{0,25}?\bto\s+(?<num>\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)(?![\d%])/gi;
  for (const match of text.matchAll(bareClose)) {
    const raw = match.groups?.num;
    if (!raw) continue;
    const start = (match.index ?? 0) + match[0].lastIndexOf(raw);
    const ticker = tickerAt(text, start);
    const value = Number(raw.replace(/,/g, ''));
    const fact = ticker ? facts.tickers[ticker] : undefined;
    if (fact && [fact.low, fact.high, fact.open].some((px) => px != null && !apart(value, px, PX_TOL))) continue;
    claims.push({
      start,
      end: start + raw.length,
      ticker,
      metric: 'close',
      value,
      raw,
      approx: false,
      paren: false,
      bare: true,
    });
  }

  const volume =
    /\bvolume(?:\s+(?:of|was|at|hit|reached))?\s+(?<num>\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?(?=\s*(?:million|billion|[MB])\b))(?<unit>\s*(?:million|billion|[MB])\b)?|(?<num2>\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?(?=\s*(?:million|billion|[MB])\b))(?<unit2>\s*(?:million|billion|[MB])\b)?\s+shares\b/gi;
  for (const match of text.matchAll(volume)) {
    const raw = match.groups?.num ?? match.groups?.num2;
    if (!raw) continue;
    const unit = match.groups?.unit ?? match.groups?.unit2 ?? '';
    const scale = /^\s*b/i.test(unit) ? 1e9 : unit ? 1e6 : 1;
    const start = (match.index ?? 0) + match[0].indexOf(raw);
    claims.push({
      start,
      end: start + raw.length + unit.length,
      ticker: tickerAt(text, start),
      metric: 'volume',
      value: Number(raw.replace(/,/g, '')) * scale,
      raw: raw + unit,
      approx: false,
      paren: false,
      scale,
      unit,
    });
  }
  return claims;
}

function percentMetric(line: string, facts: BriefFacts): Metric {
  const kind = intradayKind(line);
  if (kind === 'low') return 'intradayLowPct';
  if (kind === 'high') return 'intradayHighPct';
  if (kind === 'either') return 'intradayEither';
  if (facts.edition === 'morning' && /pre-?market|overnight/i.test(line)) return 'premarketPct';
  if (facts.edition === 'weekly' && /\b(this week|on the week|for the week)\b/i.test(line)) return 'weekPct';
  return 'changePct';
}

function intradayKind(line: string): 'low' | 'high' | 'either' | null {
  if (/\bat the low\b|\bintraday low\b|\bsession low\b/i.test(line)) return 'low';
  if (/\bat the high\b|\bintraday high\b|\bsession high\b/i.test(line)) return 'high';
  if (/\bafter the open\b|\bfrom the open\b|\bmid-session\b|\bintraday\b/i.test(line)) return 'either';
  return null;
}

function dollarMetric(
  line: string,
  paren: boolean,
  value: number,
  fact: TickerFact | undefined
): Metric | null {
  const levelish = /\b(watch|support|resistance|hold|reclaim|break|level|above|below)\b/i.test(line);
  if (paren && /%/.test(line)) return 'changeAbs';
  if (/\b(closed at|close at|close of|settled at)\b/i.test(line)) return 'close';
  if (levelish) return null;
  if (fact && Math.abs(Math.abs(value) - Math.abs(fact.changeAbs)) + 1 < Math.abs(Math.abs(value) - fact.close)) {
    return 'changeAbs';
  }
  if (
    fact &&
    [fact.close, fact.prevClose, fact.high, fact.low, fact.open].some(
      (px) => px != null && !apart(Math.abs(value), px, PX_TOL)
    )
  ) {
    return 'close';
  }
  return 'close';
}

function targetFor(claim: Claim, fact: TickerFact, facts: BriefFacts, text: string): number | null {
  if (claim.metric === 'volume') return fact.volumeIsPartial || !(fact.volume > 0) ? null : Math.round(fact.volume);
  if (claim.metric === 'changeAbs') return fact.changeAbs;
  if (claim.metric === 'close') return fact.close;
  if (claim.metric === 'premarketPct') return fact.premarketPct ?? null;
  if (claim.metric === 'intradayLowPct') return fact.intraday?.lowPct ?? null;
  if (claim.metric === 'intradayHighPct') return fact.intraday?.highPct ?? null;
  if (claim.metric === 'intradayEither') {
    if (!apart(claim.value, fact.changePct, PCT_TOL)) return fact.changePct;
    if (fact.intraday && !apart(claim.value, fact.intraday.lowPct, INTRADAY_TOL)) return fact.intraday.lowPct;
    if (fact.intraday && !apart(claim.value, fact.intraday.highPct, INTRADAY_TOL)) return fact.intraday.highPct;
    return null;
  }
  if (claim.metric === 'weekPct') {
    return facts.weekly?.[claim.ticker ?? '']?.changePct ?? fact.changePct;
  }
  const line = lineAt(text, claim.start);
  if (facts.edition === 'morning' && /pre-?market|overnight/i.test(line) && fact.premarketPct != null) {
    return fact.premarketPct;
  }
  return fact.changePct;
}

function claimTolerance(claim: Claim): number {
  if (claim.metric !== 'volume') return tolerance(claim.metric);
  const scale = claim.scale ?? 1;
  if (scale === 1) return 0.5;
  const decimals = (claim.raw.split(/\s|[MBmb]/)[0].split('.')[1] ?? '').length;
  return (scale * 10 ** -decimals) / 2;
}

function tolerance(metric: Metric): number {
  if (metric === 'changeAbs' || metric === 'close') return PX_TOL;
  if (metric === 'intradayLowPct' || metric === 'intradayHighPct' || metric === 'intradayEither') return INTRADAY_TOL;
  return PCT_TOL;
}

function renderClaim(claim: Claim, target: number): string {
  if (claim.metric === 'volume') {
    const scale = claim.scale ?? 1;
    if (scale === 1) return Math.round(target).toLocaleString('en-US');
    const decimals = (claim.raw.split(/\s|[MBmb]/)[0].split('.')[1] ?? '').length;
    return `${(target / scale).toFixed(decimals)}${claim.unit ?? ''}`;
  }
  if (claim.metric === 'changeAbs') return formatMoney(target, claim.paren);
  if (claim.metric === 'close' && claim.bare) return round2(target).toFixed(2);
  if (claim.metric === 'close') {
    const core = `$${round2(target).toFixed(2)}`;
    return claim.paren ? `(${core})` : core;
  }
  return formatPct(target);
}

function formatMoney(n: number, paren: boolean): string {
  const body = Math.abs(round2(n)).toFixed(2);
  const core = n < 0 ? `${MINUS}$${body}` : n > 0 ? `+$${body}` : `$${body}`;
  return paren ? `(${core})` : core;
}

/** Direction comes from the clause around the number, so "TLT rose 0.21% and HYG fell" reads TLT as up. */
function signed(sign: string | undefined, magnitude: number, text: string, index: number): number {
  if (sign === '-' || sign === MINUS) return -Math.abs(magnitude);
  if (sign === '+') return Math.abs(magnitude);
  const line = lineAt(text, index);
  const local = index - (text.lastIndexOf('\n', Math.max(0, index - 1)) + 1);
  const before = line.slice(0, local).split(CLAUSE_BREAK).pop() ?? '';
  const after = line.slice(local).split(CLAUSE_BREAK)[0] ?? '';
  for (const clause of [before, after]) {
    if (DOWN_WORD.test(clause)) return -Math.abs(magnitude);
    if (UP_WORD.test(clause)) return Math.abs(magnitude);
  }
  return DOWN_WORD.test(line) ? -Math.abs(magnitude) : Math.abs(magnitude);
}

function duplicateKeys(claims: Array<Claim & { field: string }>): Set<string> {
  const groups = new Map<string, number[]>();
  for (const claim of claims) {
    if (!claim.ticker || claim.metric === 'volume') continue;
    const key = `${claim.ticker}|${claim.metric}`;
    const list = groups.get(key) ?? [];
    list.push(claim.value);
    groups.set(key, list);
  }
  const dupes = new Set<string>();
  for (const [key, values] of groups) {
    if (values.length < 2) continue;
    const tol = key.endsWith('changeAbs') || key.endsWith('close') ? PX_TOL : PCT_TOL;
    if (Math.max(...values) - Math.min(...values) > tol) dupes.add(key);
  }
  return dupes;
}

function dateIssues(text: string, asOf: string, holidays: string[], field: string): QaIssue[] {
  const issues: QaIssue[] = [];
  const seen = new Set<string>();
  const flag = (iso: string) => {
    if (!iso || seen.has(iso)) return;
    seen.add(iso);
    if (isTradingDay(iso, holidays)) return;
    issues.push({
      code: 'non_trading_date',
      severity: 'block',
      field,
      message: `${iso} is not a trading day`,
    });
  };

  const range = new RegExp(
    `\\b(${MON})\\.?\\s+(\\d{1,2})\\s*[\\u2013\\u2014-]\\s*(?:(${MON})\\.?)?\\s*(\\d{1,2})\\b`,
    'gi'
  );
  let masked = text;
  for (const match of text.matchAll(range)) {
    const month1 = MONTHS[match[1].toLowerCase().replace('.', '')];
    const month2 = match[3] ? MONTHS[match[3].toLowerCase().replace('.', '')] : month1;
    const year1 = inferYear(month1, asOf);
    const first = isoDate(year1, month1, Number(match[2]));
    const year2 = inferYear(month2, asOf);
    const second = isoDate(year2, month2, Number(match[4]));
    if (first) flag(first);
    if (second) flag(second);
    masked = masked.replace(match[0], ' ');
  }

  const single = new RegExp(`\\b(${MON})\\.?\\s+(\\d{1,2})(?:\\s*,\\s*(20\\d{2}))?\\b`, 'gi');
  for (const match of masked.matchAll(single)) {
    const month = MONTHS[match[1].toLowerCase().replace('.', '')];
    const year = match[3] ? Number(match[3]) : inferYear(month, asOf);
    const iso = isoDate(year, month, Number(match[2]));
    if (iso) flag(iso);
  }
  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    flag(`${match[1]}-${match[2]}-${match[3]}`);
  }
  return issues;
}

function partialIssues(text: string, facts: BriefFacts, field: string): QaIssue[] {
  const issues: QaIssue[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const volume = /\bvolume\b|\bshares\b/i.test(line);
    const closed = /\bclosed at\b/i.test(line);
    if (!volume && !closed) continue;
    for (const ticker of capsTickers(line)) {
      if (!facts.tickers[ticker]?.volumeIsPartial || seen.has(ticker)) continue;
      seen.add(ticker);
      issues.push({
        code: 'partial_data',
        severity: 'block',
        field,
        message: volume
          ? `${ticker} volume is from a partial session`
          : `${ticker} closed-at figure is from a partial session`,
      });
    }
  }
  return issues;
}

function driftIssues(text: string, field: string, levels: PriorLevel[]): QaIssue[] {
  const open = levels.filter((level) => level.status === 'open');
  if (!open.length) return [];
  const issues: QaIssue[] = [];
  const seen = new Set<string>();
  const watch = /\bwatch(?:ing)?\s+\$?(\d{2,5}(?:\.\d{1,2})?)\s+on\s+([A-Z]{1,5})\b/gi;
  for (const match of text.matchAll(watch)) {
    const value = Number(match[1]);
    const ticker = match[2];
    const line = lineAt(text, match.index ?? 0);
    const rows = open.filter((level) => level.ticker.toUpperCase() === ticker);
    if (!rows.length || rows.some((level) => !apart(level.level, value, PX_TOL))) continue;
    if (hasReason(line) || seen.has(ticker)) continue;
    seen.add(ticker);
    issues.push({
      code: 'level_drift',
      severity: 'warn',
      field,
      message: `${ticker} ${value} differs from open ledger ${rows.map((level) => level.level).join(', ')} without a stated reason`,
    });
  }
  return issues;
}

function hasReason(line: string): boolean {
  return /\b(because|after|since|following|given|failed|held|broke|broken|reclaimed|reclaim)\b/i.test(line);
}

function isTradingDay(iso: string, holidays: string[]): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || isWeekend(iso)) return false;
  return !holidays.includes(iso);
}

function inferYear(month: number, asOf: string): number {
  const year = Number(asOf.slice(0, 4));
  const asMonth = Number(asOf.slice(5, 7));
  if (month > asMonth + 1) return year - 1;
  return year;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!month || day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lineFixes(field: string, before: string, after: string): QaFix[] {
  if (before === after) return [];
  const left = before.split('\n');
  const right = after.split('\n');
  if (left.length === right.length) {
    const fixes: QaFix[] = [];
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) fixes.push({ code: 'number', field, from: left[i], to: right[i] });
    }
    if (fixes.length) return fixes;
  }
  return [{ code: 'number', field, from: before, to: after }];
}

function applyReplacements(
  text: string,
  reps: Array<{ start: number; end: number; next: string }>
): string {
  const sorted = [...reps].sort((a, b) => b.start - a.start);
  let out = text;
  for (const rep of sorted) {
    out = out.slice(0, rep.start) + rep.next + out.slice(rep.end);
  }
  return out;
}

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

function tickerAt(text: string, index: number): string | null {
  const line = lineAt(text, index);
  const local = index - (text.lastIndexOf('\n', Math.max(0, index - 1)) + 1);
  const before = lastTicker(line.slice(0, local));
  return before ?? lastTicker(line);
}

function lastTicker(text: string): string | null {
  const found = [...text.matchAll(/\b([A-Z]{2,5})\b/g)];
  for (let i = found.length - 1; i >= 0; i -= 1) {
    const ticker = found[i][1];
    if (!STOP.has(ticker)) return ticker;
  }
  return null;
}

function capsTickers(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
    if (!STOP.has(match[1]) && !out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

function isVolumeContext(text: string, index: number): boolean {
  return /\bvolume\b|\bshares\b/i.test(text.slice(Math.max(0, index - 40), index));
}

function apart(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) > tol + 1e-9;
}

function briefMentions(draft: BriefDraft, driver: string): boolean {
  const hay = `${Object.values(draft.fields).join('\n')} ${(draft.headlines ?? []).map((item) => item.headline).join('\n')}`.toLowerCase();
  const words = driver.toLowerCase().split(/\s+/).filter((word) => word.length >= 5);
  if (!words.length) return false;
  const hits = words.filter((word) => hay.includes(word));
  return hits.length >= Math.min(2, words.length);
}

function renderResultHtml(draft: BriefDraft): string {
  const chunks = [
    ...Object.values(draft.fields),
    ...(draft.headlines ?? []).map((item) => `${item.headline} ${item.summary ?? ''}`),
  ];
  return `<article>${chunks.map(escapeHtml).join('\n')}</article>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
