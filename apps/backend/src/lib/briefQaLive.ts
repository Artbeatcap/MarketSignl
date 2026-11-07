/**
 * Live wiring for the pre-send gate. Numbers come from Massive bars.
 * Reference-note text is sent only to the driver extractor, never to Atlas or the email.
 */
import cron from 'node-cron';
import type { DailyContent, HeadlineItem } from '../services/dailyBrief/types.js';
import type { WeeklyContent } from '../services/weeklyBrief/types.js';
import { supabaseAdmin } from './supabase.js';
import { addDaysISO, etDateISO, isWeekend } from './weekAhead.js';
import {
  CONTRAST_TICKERS,
  fetchDailyBars,
  formatPct,
  loadFactsPack,
  type BriefEdition,
  type BriefFacts,
  type DailyBar,
} from './briefFacts.js';
import {
  buildLevelScorecard,
  gradeLevel,
  priorCallLine,
  type LevelCondition,
  type LevelScorecard,
  type PriorLevel,
  type SessionBar,
} from './briefLevels.js';
import { PROMPT_VERSION } from './briefAtlasRules.js';
import {
  buildAtlasBriefPrompt,
  notePromptVersion,
  resolveGatedDraft,
  type BriefDraft,
  type BriefHeadline,
  type CoverageGap,
  type NewsArticle,
  type QaIssue,
  type ReferenceNote,
} from './briefQaGate.js';

const GATE_MS = 20_000;
const MASSIVE_BASE = process.env.MASSIVE_BASE_URL?.trim() || 'https://api.massive.com';
const CONDITIONS = new Set<LevelCondition>(['hold', 'reclaim', 'break', 'close_above', 'close_below']);
const STOP = new Set([
  'AM', 'PM', 'ET', 'US', 'AI', 'THE', 'AND', 'FOR', 'NOT', 'BUT', 'OR', 'IF', 'IT',
  'BE', 'AT', 'ON', 'IN', 'TO', 'OF', 'BY', 'AN', 'AS', 'IS', 'WE', 'UP', 'GDP',
  'CPI', 'PPI', 'FOMC', 'ISM', 'ETF', 'CEO', 'EPS', 'NOW', 'LOW', 'HIGH', 'OPEN',
]);

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

export interface QaSummary {
  status: string;
  fixes: number;
  blocks: number;
  warns: number;
}

export interface PreparedDaily {
  content: DailyContent;
  gradedLines: string[];
  qa: QaSummary;
}

export interface PreparedWeekly {
  content: WeeklyContent;
  scorecard: LevelScorecard | null;
  qa: QaSummary;
}

export async function prepareDailyContent(args: {
  content: DailyContent;
  edition?: 'morning' | 'close';
  notify: boolean;
  persist: boolean;
  now?: Date;
}): Promise<PreparedDaily> {
  const edition = args.edition ?? 'morning';
  const now = args.now ?? new Date();
  const original = cloneDaily(args.content);
  try {
    return await withDeadline(
      runDaily(original, edition, args.notify, args.persist, now),
      () => crashedDaily(original, edition, args.notify, now)
    );
  } catch (err) {
    console.error(`[brief_qa] ${err instanceof Error ? err.message : String(err)}`);
    return crashedDaily(original, edition, args.notify, now);
  }
}

export async function prepareWeeklyContent(args: {
  content: WeeklyContent;
  notify: boolean;
  persist: boolean;
  now?: Date;
}): Promise<PreparedWeekly> {
  const now = args.now ?? new Date();
  const original = cloneWeekly(args.content);
  try {
    return await withDeadline(
      runWeekly(original, args.notify, args.persist, now),
      () => crashedWeekly(original, args.notify, now)
    );
  } catch (err) {
    console.error(`[brief_qa] ${err instanceof Error ? err.message : String(err)}`);
    return crashedWeekly(original, args.notify, now);
  }
}

export interface AtlasPromptBuild {
  asOf: string;
  prompt: string;
  promptVersion: string;
  facts: BriefFacts;
  headlines: BriefHeadline[];
  /** Tickers that were asked for but had no usable bar. Reported, never filled in. */
  missingTickers: string[];
  /** Why PRIOR CALLS could not be loaded, when it could not. */
  priorNote?: string;
}

const HEADLINE_TICKERS = ['SPY', 'QQQ', 'SMH'];

/**
 * FACTS + RANK + PRIOR CALLS + HEADLINES + rules. `movers` are the tickers the
 * brief will name; headline tickers from our feed are added on top.
 */
export async function buildAtlasPromptFor(args: {
  edition: 'morning' | 'close';
  asOf?: string;
  movers?: string[];
  now?: Date;
  newsFrom?: string;
  newsTo?: string;
  /** 'replay' regrades the week's calls as of a past asOf. */
  gradePrior?: boolean | 'replay';
}): Promise<AtlasPromptBuild> {
  const now = args.now ?? new Date();
  const holidays = await loadHolidayDates();
  const asOf = args.asOf ?? tradingOnOrBefore(etDateISO(now), holidays);
  const news = await loadBriefHeadlines({
    from: args.newsFrom ?? new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString(),
    to: args.newsTo ?? now.toISOString(),
    tickers: [...new Set([...HEADLINE_TICKERS, ...(args.movers ?? [])])],
  });
  const wanted = [
    ...new Set([
      'SPY',
      'QQQ',
      'IWM',
      'DIA',
      ...CONTRAST_TICKERS,
      ...(args.movers ?? []).map((ticker) => ticker.toUpperCase()),
      ...news.tickers.slice(0, 8),
    ]),
  ];
  const facts = await loadFactsPack({ asOf, edition: args.edition, tickers: wanted, now });
  let priorNote: string | undefined;
  if (args.gradePrior === 'replay') {
    const replay = await replayPriorLevels(asOf);
    facts.priorLevels = replay.levels;
    priorNote = replay.error;
  } else if (args.gradePrior !== false) {
    const graded = await gradeOpenLevels(asOf, false);
    facts.priorLevels = graded.levels;
  }
  return {
    asOf,
    prompt: buildAtlasBriefPrompt(facts, news.headlines),
    promptVersion: PROMPT_VERSION,
    facts,
    headlines: news.headlines,
    missingTickers: wanted.filter((ticker) => !facts.tickers[ticker]),
    priorNote,
  };
}

/**
 * For a past date: the calls made in the 7 days before asOf, regraded against
 * bars up to asOf as if they were still open then. Never writes.
 */
async function replayPriorLevels(asOf: string): Promise<{ levels: PriorLevel[]; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('brief_levels')
    .select('*')
    .gte('brief_as_of', addDaysISO(asOf, -7))
    .lt('brief_as_of', asOf);
  if (error || !data) return { levels: [], error: `brief_levels read failed: ${error?.message ?? 'no data'}` };
  const levels: PriorLevel[] = [];
  for (const row of data) {
    const call = rowToLevel(row);
    if (!call) continue;
    const open: PriorLevel = { ...call, status: 'open', resolvedAt: undefined, evidence: undefined };
    try {
      const bars = await fetchDailyBars(open.ticker, open.briefAsOf, asOf);
      levels.push(gradeLevel(open, bars.map(toSession)));
    } catch (err) {
      return { levels: [], error: `bars for ${open.ticker}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { levels };
}

export async function buildLiveAtlasPrompt(
  edition: 'morning' | 'close',
  movers: string[] = []
): Promise<{ asOf: string; prompt: string; promptVersion: string; missingTickers: string[]; headlineCount: number }> {
  const built = await buildAtlasPromptFor({ edition, movers });
  return {
    asOf: built.asOf,
    prompt: built.prompt,
    promptVersion: built.promptVersion,
    missingTickers: built.missingTickers,
    headlineCount: built.headlines.length,
  };
}

export async function flagStalePrompt(echoed?: string): Promise<void> {
  const review = await notePromptVersion(echoed, sendAdminQaAlert);
  console.log(
    JSON.stringify({
      event: 'brief_ingest',
      promptVersion: review.promptVersion,
      echoed: echoed ?? null,
      stale: review.stale,
    })
  );
}

export async function ingestReferenceNote(body: {
  source?: unknown;
  published_date?: unknown;
  title?: unknown;
  url?: unknown;
  transcript?: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const source = typeof body.source === 'string' ? body.source.trim() : '';
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!source || !transcript) return { ok: false, error: 'source and transcript are required' };
  const { error } = await supabaseAdmin.from('reference_notes').insert({
    source,
    published_date: typeof body.published_date === 'string' ? body.published_date : null,
    title: typeof body.title === 'string' ? body.title : null,
    url: typeof body.url === 'string' ? body.url : null,
    transcript,
  });
  if (error) return { ok: false, error: error.message };
  console.log(JSON.stringify({ event: 'reference_note_ingest', source, published_date: body.published_date ?? null }));
  return { ok: true };
}

export async function sendWeeklyQaReport(now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const asOf = etDateISO(now);
  const since = addDaysISO(asOf, -7);
  const [runs, levels] = await Promise.all([
    supabaseAdmin
      .from('brief_qa_runs')
      .select('as_of, edition, status, fixes, issues, coverage_gaps, levels_graded')
      .gte('as_of', since)
      .lte('as_of', asOf),
    supabaseAdmin
      .from('brief_levels')
      .select('ticker, level, condition, status, evidence, brief_as_of, horizon_sessions')
      .gte('brief_as_of', since)
      .lte('brief_as_of', asOf),
  ]);
  if (runs.error) return { ok: false, error: runs.error.message };
  if (levels.error) return { ok: false, error: levels.error.message };

  const rows = runs.data ?? [];
  const graded = (levels.data ?? []).map(rowToLevel).filter((row): row is PriorLevel => row !== null);
  const card = buildLevelScorecard(graded);
  const decided = card.met + card.failed + card.expired;
  const hit = decided ? `${card.met}/${decided}` : 'n/a';
  const gaps = rows.flatMap((row) => (Array.isArray(row.coverage_gaps) ? row.coverage_gaps : []));
  const verified = gaps.filter((gap) => gap && typeof gap === 'object' && (gap as CoverageGap).kind === 'verified');
  const unverified = gaps.filter((gap) => gap && typeof gap === 'object' && (gap as CoverageGap).kind === 'unverified_gap');
  const blocks = rows.filter((row) => row.status === 'blocked' || row.status === 'crashed');
  const body = [
    `Week ending ${asOf}`,
    `Runs: ${rows.length}`,
    `Blocked or crashed: ${blocks.length}`,
    `Verified coverage gaps: ${verified.length}`,
    `Unverified coverage gaps: ${unverified.length}`,
    `Level hit rate: ${hit} (met/failed/expired ${card.met}/${card.failed}/${card.expired})`,
    `Style warns: ${countStyleIssues(rows)}`,
    '',
    'Unverified drivers:',
    ...unverified.map((gap) => `- ${(gap as CoverageGap).driver}`),
    '',
    'Blocked runs:',
    ...blocks.map((row) => `- ${row.as_of} ${row.edition} ${row.status}`),
  ].join('\n');
  await sendAdminQaAlert(`BRIEF QA WEEK ${asOf}`, body);
  return { ok: true };
}

export function startBriefQaSchedule(): void {
  if (process.env.ENABLE_BRIEF_QA_CRON !== 'true') {
    console.log(
      '[brief-qa] Sunday 18:00 ET summary is not scheduled in-process. POST /api/internal/brief-qa/weekly-report, or set ENABLE_BRIEF_QA_CRON=true'
    );
    return;
  }
  cron.schedule(
    '0 18 * * 0',
    () => {
      void sendWeeklyQaReport().catch((err) => {
        console.error('[brief-qa] weekly report failed', err);
      });
    },
    { timezone: 'America/New_York' }
  );
  console.log('[brief-qa] Sunday 18:00 ET summary scheduled');
}

async function runDaily(
  content: DailyContent,
  edition: 'morning' | 'close',
  notify: boolean,
  persist: boolean,
  now: Date
): Promise<PreparedDaily> {
  const holidays = await loadHolidayDates();
  const asOf = tradingOnOrBefore(parseBriefAsOf(content.date_label, now), holidays);
  let facts: BriefFacts;
  try {
    facts = await loadFactsPack({ asOf, edition, tickers: tickersIn(content), now });
  } catch (err) {
    if (!notify) {
      console.error(`[brief_qa] dry run left the draft unchanged: ${err instanceof Error ? err.message : String(err)}`);
      return { content, gradedLines: [], qa: { status: 'skipped', fixes: 0, blocks: 0, warns: 0 } };
    }
    throw err;
  }
  facts.calendar = [];
  const graded = await gradeOpenLevels(asOf, persist);
  facts.priorLevels = graded.levels;
  const notes = await noteWindow();
  const news = await loadRecentNews();
  const draft = draftFromDaily(content);
  const resolved = await resolveGatedDraft({
    draft,
    facts,
    holidays,
    now,
    noteCount36h: notes.count,
    levelsResolved: graded.resolved,
    regenerate: (next, issues) => regenerateDraft(next, facts, issues),
    alert: (subject, body) => (notify ? sendAdminQaAlert(subject, body) : Promise.resolve()),
    coverage: {
      notes: notes.notes,
      extractDrivers: extractDrivers,
      findNews: async (driver) => matchNews(driver, news),
    },
  });
  if (persist) {
    await persistRun(facts, resolved.status, resolved.result, resolved.gaps, graded.levels);
    if (resolved.sendProse) await saveLevelCalls(facts, resolved.draft);
  }
  const gradedLines = graded.levels.filter((level) => level.status !== 'open').map(priorCallLine);
  if (!resolved.sendProse) {
    return {
      content: stripDaily(content, verifiedHeadlines(resolved.draft)),
      gradedLines,
      qa: summary(resolved.status, resolved.result),
    };
  }
  const next = applyDailyDraft(content, resolved.draft);
  applyTape(next, facts);
  return { content: next, gradedLines, qa: summary(resolved.status, resolved.result) };
}

async function runWeekly(
  content: WeeklyContent,
  notify: boolean,
  persist: boolean,
  now: Date
): Promise<PreparedWeekly> {
  const holidays = await loadHolidayDates();
  const asOf = tradingOnOrBefore(parseBriefAsOf(content.week_label, now), holidays);
  let facts: BriefFacts;
  try {
    facts = await loadFactsPack({
      asOf,
      edition: 'weekly',
      tickers: tickersInWeekly(content),
      now,
    });
  } catch (err) {
    if (!notify) {
      console.error(`[brief_qa] weekly dry run left the draft unchanged: ${err instanceof Error ? err.message : String(err)}`);
      return { content, scorecard: null, qa: { status: 'skipped', fixes: 0, blocks: 0, warns: 0 } };
    }
    throw err;
  }
  const graded = await gradeOpenLevels(asOf, persist);
  facts.priorLevels = graded.levels;
  const notes = await noteWindow();
  const news = await loadRecentNews();
  const resolved = await resolveGatedDraft({
    draft: draftFromWeekly(content),
    facts,
    holidays,
    now,
    noteCount36h: notes.count,
    levelsResolved: graded.resolved,
    regenerate: (next, issues) => regenerateDraft(next, facts, issues),
    alert: (subject, body) => (notify ? sendAdminQaAlert(subject, body) : Promise.resolve()),
    coverage: {
      notes: notes.notes,
      extractDrivers: extractDrivers,
      findNews: async (driver) => matchNews(driver, news),
    },
  });
  const scorecard = await weekScorecard(asOf);
  if (persist) {
    await persistRun(facts, resolved.status, resolved.result, resolved.gaps, graded.levels);
    if (resolved.sendProse) await saveLevelCalls(facts, resolved.draft);
  }
  if (!resolved.sendProse) {
    return {
      content: stripWeekly(content),
      scorecard,
      qa: summary(resolved.status, resolved.result),
    };
  }
  const next = applyWeeklyDraft(content, resolved.draft);
  applyTape(next, facts);
  return { content: next, scorecard, qa: summary(resolved.status, resolved.result) };
}

async function crashedDaily(
  content: DailyContent,
  edition: BriefEdition,
  notify: boolean,
  now: Date
): Promise<PreparedDaily> {
  if (notify) {
    const asOf = parseBriefAsOf(content.date_label, now);
    await sendAdminQaAlert(`BRIEF QA CRASHED ${edition} ${asOf}`, 'The QA gate failed before the send. AI prose was left out.');
  }
  return {
    content: stripDaily(content, []),
    gradedLines: [],
    qa: { status: 'crashed', fixes: 0, blocks: 0, warns: 0 },
  };
}

async function crashedWeekly(content: WeeklyContent, notify: boolean, now: Date): Promise<PreparedWeekly> {
  if (notify) {
    const asOf = parseBriefAsOf(content.week_label, now);
    await sendAdminQaAlert(`BRIEF QA CRASHED weekly ${asOf}`, 'The QA gate failed before the send. AI prose was left out.');
  }
  return {
    content: stripWeekly(content),
    scorecard: null,
    qa: { status: 'crashed', fixes: 0, blocks: 0, warns: 0 },
  };
}

async function sendAdminQaAlert(subject: string, body: string): Promise<void> {
  console.error(`[brief_qa] ${subject}\n${body}`);
  const to = process.env.ADMIN_ALERT_EMAIL?.trim();
  const key = process.env.SENDGRID_API_KEY?.trim();
  if (!to || !key) return;
  const sgMail = (await import('@sendgrid/mail')).default;
  sgMail.setApiKey(key);
  await sgMail.send({
    to,
    from: process.env.DAILY_BRIEF_FROM || 'ChartSignl <daily@chartsignl.com>',
    subject,
    text: body,
  });
}

/**
 * Rewrites only the fields named in the issues. Throws when the model cannot run,
 * so the gate records `rewrite_not_run` instead of counting an unchanged draft.
 */
export async function regenerateDraft(draft: BriefDraft, facts: BriefFacts, issues: QaIssue[]): Promise<BriefDraft> {
  const prompt = buildAtlasBriefPrompt(facts, draft.headlines ?? []);
  const named = new Set(issues.map((issue) => issue.field).filter((field): field is string => !!field));
  if (!named.size) named.add('opening_bias');
  const target: Record<string, string> = {};
  for (const name of named) {
    if (name in draft.fields) target[name] = draft.fields[name];
  }
  const raw = await callModel(
    'Rewrite the named brief fields. Use only numbers that appear in FACTS. Do not compute a change. Return JSON {"fields":{...}} with the same keys only.',
    `${prompt}\n\nQA issues:\n${issues.map((issue) => `${issue.field ?? 'brief'} ${issue.code}: ${issue.message}`).join('\n')}\n\nFields to rewrite:\n${JSON.stringify(target)}`,
    { maxTokens: 900, timeoutMs: 9000 }
  );
  const parsed = parseJson(raw) as { fields?: Record<string, unknown> } | null;
  if (!parsed || typeof parsed !== 'object' || !parsed.fields || typeof parsed.fields !== 'object') {
    throw new Error('model returned no fields JSON');
  }
  const fields = { ...draft.fields };
  let changed = 0;
  for (const [key, value] of Object.entries(parsed.fields)) {
    if (typeof value === 'string' && key in target) {
      fields[key] = value;
      changed += 1;
    }
  }
  if (!changed) throw new Error('model returned none of the requested fields');
  return { fields, headlines: draft.headlines, levelCalls: draft.levelCalls };
}

async function extractDrivers(notes: ReferenceNote[]): Promise<string[]> {
  if (!notes.length) return [];
  let raw: string;
  try {
    raw = await callModel(
      'List the market DRIVERS named (events, companies, data releases), each as a 3–8 word noun phrase. No opinions, levels, or forecasts. Return JSON {"drivers":["..."]}.',
      notes.map((note) => note.transcript).join('\n\n').slice(0, 8000),
      { maxTokens: 700, timeoutMs: 6000 }
    );
  } catch (err) {
    console.warn(`[brief_qa] driver extraction did not run: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  const parsed = parseJson(raw) as { drivers?: unknown } | null;
  const drivers = Array.isArray(parsed?.drivers) ? parsed.drivers : [];
  return drivers.filter((item): item is string => typeof item === 'string');
}

/** Same model and API the social pipeline already uses. */
export const BRIEF_QA_MODEL = process.env.BRIEF_QA_MODEL?.trim() || 'claude-haiku-4-5-20251001';

export async function callModel(
  system: string,
  user: string,
  opts: { maxTokens: number; timeoutMs: number }
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: BRIEF_QA_MODEL,
      max_tokens: opts.maxTokens,
      temperature: 0,
      system: `${system}\nReturn one JSON object and nothing else.`,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`model HTTP ${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const json = (await resp.json()) as { content?: Array<{ type?: string; text?: string }> };
  const content = (json.content ?? [])
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('');
  if (!content) throw new Error('model returned an empty message');
  return content;
}

export function parseModelJson(raw: string): unknown {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function parseJson(raw: string): unknown {
  return parseModelJson(raw);
}

async function loadRecentNews(): Promise<Array<{ title: string; description: string; url?: string }>> {
  const key = process.env.MASSIVE_API_KEY?.trim() || process.env.POLYGON_API_KEY?.trim();
  if (!key) return [];
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const url =
    `${MASSIVE_BASE}/v2/reference/news?limit=25&order=desc&published_utc.gte=` +
    `${encodeURIComponent(since)}&apiKey=${encodeURIComponent(key)}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return [];
    const json = (await resp.json()) as {
      results?: Array<{ title?: string; description?: string; article_url?: string; published_utc?: string }>;
    };
    return (json.results ?? [])
      .filter((item) => !item.published_utc || item.published_utc >= since)
      .map((item) => ({
        title: item.title || '',
        description: item.description || '',
        url: item.article_url,
      }))
      .filter((item) => item.title);
  } catch {
    return [];
  }
}

const NOISE_HEADLINE =
  /\b(class action|law firm|investor alert|securities fraud|deadline|key metrics|metrics versus|reports q\d earnings|q\d earnings:)\b/i;

export interface BriefNewsWindow {
  headlines: BriefHeadline[];
  /** Tickers our feed tagged on the kept headlines, most-tagged first. */
  tickers: string[];
}

/**
 * Headlines for the HEADLINES block, from our own feed only. Pulled per market
 * ticker so the "why" has market news, not the latest press releases.
 */
export async function loadBriefHeadlines(args: {
  from: string;
  to: string;
  tickers: string[];
  limit?: number;
}): Promise<BriefNewsWindow> {
  const key = process.env.MASSIVE_API_KEY?.trim() || process.env.POLYGON_API_KEY?.trim();
  if (!key) throw new Error('MASSIVE_API_KEY is not configured');
  const seen = new Set<string>();
  const kept: Array<BriefHeadline & { tagged: string[] }> = [];
  for (const ticker of args.tickers) {
    const url =
      `${MASSIVE_BASE}/v2/reference/news?ticker=${encodeURIComponent(ticker)}&limit=10&order=desc` +
      `&published_utc.gte=${encodeURIComponent(args.from)}&published_utc.lte=${encodeURIComponent(args.to)}` +
      `&apiKey=${encodeURIComponent(key)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) throw new Error(`news ${ticker} HTTP ${resp.status}`);
    const json = (await resp.json()) as {
      results?: Array<{
        title?: string;
        description?: string;
        article_url?: string;
        published_utc?: string;
        tickers?: string[];
      }>;
    };
    for (const item of json.results ?? []) {
      const title = (item.title ?? '').trim();
      if (!title || seen.has(title) || NOISE_HEADLINE.test(title)) continue;
      seen.add(title);
      kept.push({
        headline: title,
        summary: (item.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
        url: item.article_url,
        publishedAt: item.published_utc,
        tagged: (item.tickers ?? []).map((tag) => tag.toUpperCase()),
      });
    }
  }
  kept.sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
  const top = kept.slice(0, args.limit ?? 12);
  const counts = new Map<string, number>();
  for (const item of top) {
    for (const tag of item.tagged) {
      if (/^[A-Z]{1,5}$/.test(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const tickers = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  return {
    headlines: top.map((item) => ({
      headline: item.headline,
      summary: item.summary,
      url: item.url,
      publishedAt: item.publishedAt,
      source: 'feed' as const,
    })),
    tickers,
  };
}

function matchNews(
  driver: string,
  articles: Array<{ title: string; description: string; url?: string }>
): NewsArticle | null {
  const words = driver.toLowerCase().split(/\s+/).filter((word) => word.length >= 5);
  if (!words.length) return null;
  for (const article of articles) {
    const hay = `${article.title} ${article.description}`.toLowerCase();
    const hits = words.filter((word) => hay.includes(word));
    if (hits.length >= Math.min(2, words.length)) {
      return { headline: article.title, summary: article.description, url: article.url };
    }
  }
  return null;
}

async function noteWindow(): Promise<{ notes: ReferenceNote[]; count: number | undefined }> {
  try {
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const { data, error, count } = await supabaseAdmin
      .from('reference_notes')
      .select('source, published_date, title, url, transcript', { count: 'exact' })
      .gte('ingested_at', since)
      .limit(20);
    if (error) return { notes: [], count: undefined };
    const notes = (data ?? []).map((row) => ({
      source: String(row.source ?? ''),
      published_date: row.published_date ? String(row.published_date) : null,
      title: row.title ? String(row.title) : null,
      url: row.url ? String(row.url) : null,
      transcript: String(row.transcript ?? ''),
    }));
    return { notes, count: count ?? notes.length };
  } catch {
    return { notes: [], count: undefined };
  }
}

async function gradeOpenLevels(
  asOf: string,
  persist: boolean
): Promise<{ levels: PriorLevel[]; resolved: number }> {
  try {
    const { data, error } = await supabaseAdmin.from('brief_levels').select('*').eq('status', 'open');
    if (error || !data) {
      if (error) console.warn(`[brief_qa] brief_levels read failed: ${error.message}`);
      return { levels: [], resolved: 0 };
    }
    let resolved = 0;
    const levels: PriorLevel[] = [];
    for (const row of data) {
      const call = rowToLevel(row);
      if (!call) continue;
      let graded = call;
      try {
        const bars = await fetchDailyBars(call.ticker, call.briefAsOf, asOf);
        graded = gradeLevel(call, bars.map(toSession));
      } catch (err) {
        console.warn(`[brief_qa] grade ${call.ticker}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (graded.status !== 'open') {
        resolved += 1;
        if (persist) {
          await supabaseAdmin
            .from('brief_levels')
            .update({
              status: graded.status,
              resolved_at: graded.resolvedAt ?? null,
              evidence: graded.evidence ?? null,
            })
            .eq('id', row.id);
        }
      }
      levels.push(graded);
    }
    return { levels, resolved };
  } catch (err) {
    console.warn(`[brief_qa] grade failed: ${err instanceof Error ? err.message : String(err)}`);
    return { levels: [], resolved: 0 };
  }
}

async function weekScorecard(asOf: string): Promise<LevelScorecard | null> {
  try {
    const since = addDaysISO(asOf, -7);
    const { data, error } = await supabaseAdmin
      .from('brief_levels')
      .select('ticker, level, condition, status, evidence, brief_as_of, horizon_sessions')
      .gte('brief_as_of', since)
      .lte('brief_as_of', asOf);
    if (error || !data?.length) return null;
    const rows = data.map(rowToLevel).filter((row): row is PriorLevel => row !== null && row.status !== 'open');
    if (!rows.length) return null;
    return buildLevelScorecard(rows);
  } catch {
    return null;
  }
}

async function saveLevelCalls(facts: BriefFacts, draft: BriefDraft): Promise<void> {
  const calls = draft.levelCalls ?? [];
  if (!calls.length) return;
  const rows = calls
    .filter((call) => CONDITIONS.has(call.condition))
    .map((call) => ({
      brief_as_of: facts.asOf,
      edition: facts.edition,
      ticker: call.ticker.toUpperCase(),
      level: call.level,
      condition: call.condition,
      horizon_sessions: call.horizonSessions || 1,
      status: 'open',
    }));
  if (!rows.length) return;
  const { error } = await supabaseAdmin.from('brief_levels').insert(rows);
  if (error) console.error(`[brief_qa] brief_levels insert failed: ${error.message}`);
}

async function persistRun(
  facts: BriefFacts,
  status: string,
  result: { fixes: unknown; issues: unknown } | undefined,
  gaps: CoverageGap[],
  levels: PriorLevel[]
): Promise<void> {
  const { error } = await supabaseAdmin.from('brief_qa_runs').insert({
    as_of: facts.asOf,
    edition: facts.edition,
    status,
    fixes: result?.fixes ?? [],
    issues: result?.issues ?? [],
    coverage_gaps: gaps,
    levels_graded: levels.filter((level) => level.status !== 'open'),
  });
  if (error) console.error(`[brief_qa] brief_qa_runs insert failed: ${error.message}`);
}

function rowToLevel(row: Record<string, unknown>): PriorLevel | null {
  const condition = String(row.condition ?? '');
  if (!CONDITIONS.has(condition as LevelCondition)) return null;
  const evidence = row.evidence as PriorLevel['evidence'] | null;
  return {
    ticker: String(row.ticker ?? '').toUpperCase(),
    level: Number(row.level),
    condition: condition as LevelCondition,
    horizonSessions: Number(row.horizon_sessions ?? 1),
    briefAsOf: String(row.brief_as_of ?? '').slice(0, 10),
    status: (['open', 'met', 'failed', 'expired'].includes(String(row.status))
      ? String(row.status)
      : 'open') as PriorLevel['status'],
    resolvedAt: row.resolved_at ? String(row.resolved_at).slice(0, 10) : undefined,
    evidence: evidence ?? undefined,
  };
}

function toSession(bar: DailyBar): SessionBar {
  return {
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function draftFromDaily(content: DailyContent): BriefDraft {
  const fields: Record<string, string> = {
    preheader: content.preheader ?? '',
    greeting: content.sections.greeting ?? '',
    opening_bias: content.sections.opening_bias ?? '',
    session_setup_html: content.sections.session_setup_html ?? '',
    key_level_note: content.sections.key_level_note ?? '',
    todays_watch_html: content.sections.todays_watch_html ?? '',
    biggest_risk: content.sections.biggest_risk ?? '',
    signoff: content.sections.signoff ?? '',
  };
  content.movers.forEach((mover, index) => {
    fields[`mover:${index}`] = mover.why || '';
  });
  return {
    fields,
    headlines: content.headlines,
    levelCalls: (content.level_calls ?? []).map((call) => ({
      ticker: call.ticker.toUpperCase(),
      level: call.level,
      condition: call.condition,
      horizonSessions: call.horizonSessions ?? 1,
    })),
  };
}

function draftFromWeekly(content: WeeklyContent): BriefDraft {
  const fields: Record<string, string> = {
    major_driver: content.sections.major_driver ?? '',
    week_in_review_html: content.sections.week_in_review_html ?? '',
    key_level_note: content.sections.key_level_note ?? '',
    week_ahead_html: content.sections.week_ahead_html ?? '',
    biggest_risk: content.sections.biggest_risk ?? '',
  };
  content.movers.forEach((mover, index) => {
    fields[`mover:${index}`] = mover.why || '';
  });
  return {
    fields,
    headlines: [],
    levelCalls: (content.level_calls ?? []).map((call) => ({
      ticker: call.ticker.toUpperCase(),
      level: call.level,
      condition: call.condition,
      horizonSessions: call.horizonSessions ?? 1,
    })),
  };
}

function applyDailyDraft(content: DailyContent, draft: BriefDraft): DailyContent {
  return {
    ...content,
    preheader: draft.fields.preheader ?? content.preheader,
    headlines: (draft.headlines ?? []).map(toHeadline),
    level_calls: draft.levelCalls,
    movers: content.movers.map((mover, index) => ({
      ...mover,
      why: draft.fields[`mover:${index}`] ?? mover.why,
    })),
    sections: {
      ...content.sections,
      greeting: draft.fields.greeting ?? content.sections.greeting,
      opening_bias: draft.fields.opening_bias ?? content.sections.opening_bias,
      session_setup_html: draft.fields.session_setup_html ?? content.sections.session_setup_html,
      key_level_note: draft.fields.key_level_note ?? content.sections.key_level_note,
      todays_watch_html: draft.fields.todays_watch_html ?? content.sections.todays_watch_html,
      biggest_risk: draft.fields.biggest_risk ?? content.sections.biggest_risk,
      signoff: draft.fields.signoff ?? content.sections.signoff,
    },
  };
}

function applyWeeklyDraft(content: WeeklyContent, draft: BriefDraft): WeeklyContent {
  return {
    ...content,
    level_calls: draft.levelCalls,
    movers: content.movers.map((mover, index) => ({
      ...mover,
      why: draft.fields[`mover:${index}`] ?? mover.why,
    })),
    sections: {
      ...content.sections,
      major_driver: draft.fields.major_driver ?? content.sections.major_driver,
      week_in_review_html: draft.fields.week_in_review_html ?? content.sections.week_in_review_html,
      key_level_note: draft.fields.key_level_note ?? content.sections.key_level_note,
      week_ahead_html: draft.fields.week_ahead_html ?? content.sections.week_ahead_html,
      biggest_risk: draft.fields.biggest_risk ?? content.sections.biggest_risk,
    },
  };
}

function applyTape(content: { tape: { symbol: string; price: string; pct: number | null }[]; movers: { ticker: string; pct: string; dir: 'up' | 'down'; window?: string }[] }, facts: BriefFacts): void {
  for (const row of content.tape) {
    const fact = facts.tickers[row.symbol.toUpperCase()];
    if (!fact) continue;
    const premarket = facts.edition === 'morning' && fact.premarketPrice != null && fact.premarketPct != null;
    const price = premarket ? fact.premarketPrice! : fact.close;
    const pct = premarket ? fact.premarketPct! : weeklyOrSession(facts, row.symbol, fact.changePct);
    row.price = `$${price.toFixed(2)}`;
    row.pct = pct;
  }
  for (const mover of content.movers) {
    const fact = facts.tickers[mover.ticker.toUpperCase()];
    if (!fact) continue;
    const premarket = mover.window === 'premarket' && fact.premarketPct != null;
    const pct = premarket ? fact.premarketPct! : weeklyOrSession(facts, mover.ticker, fact.changePct);
    mover.pct = formatPct(pct);
    mover.dir = pct < 0 ? 'down' : 'up';
  }
}

function weeklyOrSession(facts: BriefFacts, ticker: string, sessionPct: number): number {
  if (facts.edition !== 'weekly') return sessionPct;
  return facts.weekly?.[ticker.toUpperCase()]?.changePct ?? sessionPct;
}

function stripDaily(content: DailyContent, headlines: HeadlineItem[]): DailyContent {
  return {
    ...content,
    preheader: '',
    headlines,
    catalyst_bullets: [],
    movers: content.movers.map((mover) => ({ ...mover, why: '' })),
    sections: {
      greeting: '',
      opening_bias: '',
      session_setup_html: '',
      key_level_note: '',
      todays_watch_html: '',
      biggest_risk: '',
      signoff: '',
    },
  };
}

function stripWeekly(content: WeeklyContent): WeeklyContent {
  return {
    ...content,
    movers: content.movers.map((mover) => ({ ...mover, why: '' })),
    week_ahead_bullets: content.week_ahead_bullets.map((bullet) => ({ ...bullet, why: undefined })),
    earnings_bullets: (content.earnings_bullets ?? []).map((bullet) => ({ ...bullet, why: undefined })),
    sections: {
      major_driver: '',
      week_in_review_html: '',
      key_level_note: '',
      week_ahead_html: '',
      biggest_risk: '',
    },
  };
}

function verifiedHeadlines(draft: BriefDraft): HeadlineItem[] {
  return (draft.headlines ?? []).filter((item) => item.url).map(toHeadline);
}

function toHeadline(item: BriefHeadline): HeadlineItem {
  return { headline: item.headline, summary: item.summary ?? '', url: item.url };
}

function tickersIn(content: DailyContent): string[] {
  return collectTickers([
    ...content.tape.map((row) => row.symbol),
    ...content.movers.map((mover) => mover.ticker),
    ...Object.keys(content.levels),
  ], [
    content.sections.opening_bias,
    content.sections.session_setup_html,
    content.sections.biggest_risk,
    ...content.headlines.map((item) => item.headline),
  ].join(' '));
}

function tickersInWeekly(content: WeeklyContent): string[] {
  return collectTickers([
    ...content.tape.map((row) => row.symbol),
    ...content.movers.map((mover) => mover.ticker),
    ...Object.keys(content.levels),
  ], [content.sections.major_driver, content.sections.week_in_review_html, content.sections.biggest_risk].join(' '));
}

function collectTickers(seeds: string[], prose: string): string[] {
  const set = new Set<string>(['SPY', 'QQQ', 'IWM', 'DIA', ...CONTRAST_TICKERS]);
  for (const seed of seeds) {
    const ticker = seed.toUpperCase().trim();
    if (ticker) set.add(ticker);
  }
  const extras: string[] = [];
  for (const match of prose.matchAll(/\b([A-Z]{2,5})\b/g)) {
    if (!STOP.has(match[1]) && !set.has(match[1])) extras.push(match[1]);
  }
  for (const extra of extras.slice(0, 8)) set.add(extra);
  return [...set].filter((ticker) => ticker !== 'VIX');
}

function countStyleIssues(rows: Array<{ issues?: unknown }>): number {
  const codes = new Set([
    'missing_why',
    'missing_contrast',
    'no_condition',
    'hype_word',
    'long_sentence',
    'missing_recap',
  ]);
  let count = 0;
  for (const row of rows) {
    if (!Array.isArray(row.issues)) continue;
    for (const issue of row.issues) {
      if (issue && typeof issue === 'object' && codes.has(String((issue as { code?: string }).code))) count += 1;
    }
  }
  return count;
}

function parseBriefAsOf(label: string, now: Date): string {
  const iso = label.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const range = label.match(/([A-Za-z]+)\s+\d{1,2}\s*[\u2013-]\s*(\d{1,2}),\s*(20\d{2})/);
  if (range) {
    const month = MONTHS[range[1].toLowerCase()];
    if (month) return `${range[3]}-${pad(month)}-${pad(Number(range[2]))}`;
  }
  const single = label.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})/);
  if (single) {
    const month = MONTHS[single[1].toLowerCase()];
    if (month) return `${single[3]}-${pad(month)}-${pad(Number(single[2]))}`;
  }
  return etDateISO(now);
}

function tradingOnOrBefore(iso: string, holidays: string[]): string {
  let cursor = iso;
  for (let i = 0; i < 10; i += 1) {
    if (!isWeekend(cursor) && !holidays.includes(cursor)) return cursor;
    cursor = addDaysISO(cursor, -1);
  }
  return iso;
}

async function loadHolidayDates(): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin.from('market_holidays').select('holiday_date');
    if (error || !data) return [];
    return data.map((row) => String(row.holiday_date).slice(0, 10));
  } catch {
    return [];
  }
}

function summary(status: string, result?: { fixes: unknown[]; issues: { severity: string }[] }): QaSummary {
  return {
    status,
    fixes: result?.fixes.length ?? 0,
    blocks: result?.issues.filter((issue) => issue.severity === 'block').length ?? 0,
    warns: result?.issues.filter((issue) => issue.severity === 'warn').length ?? 0,
  };
}

function cloneDaily(content: DailyContent): DailyContent {
  return {
    ...content,
    tape: content.tape.map((row) => ({ ...row })),
    movers: content.movers.map((row) => ({ ...row })),
    headlines: content.headlines.map((row) => ({ ...row })),
    sections: { ...content.sections },
  };
}

function cloneWeekly(content: WeeklyContent): WeeklyContent {
  return {
    ...content,
    tape: content.tape.map((row) => ({ ...row })),
    movers: content.movers.map((row) => ({ ...row })),
    sections: { ...content.sections },
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

async function withDeadline<T>(work: Promise<T>, onTimeout: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let settled = false;
  const guarded = work.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (settled) {
      console.error(`[brief_qa] late failure: ${message}`);
      return new Promise<T>(() => undefined);
    }
    throw err;
  });
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      settled = true;
      void onTimeout().then(resolve);
    }, GATE_MS);
  });
  try {
    const result = await Promise.race([guarded, timeout]);
    settled = true;
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
