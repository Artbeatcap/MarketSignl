/**
 * Hard rules shared by the backend Atlas prompt and the n8n brief template.
 * The model may only cite numbers that code has already computed.
 */
import { createHash } from 'crypto';

const CORE_RULES = [
  'Use only numbers that appear in FACTS. Do not compute, round differently, or restate a change with a different value. If a number is not in FACTS, do not write it.',
  'Every level you give must include a condition and a timeframe: "a daily close above 212", not "212 is resistance".',
  'HEADLINES are numbered [H1], [H2] and so on. A sentence that gives a cause, or says when news landed, ends with the tag of the headline it comes from, like [H3]. Every name in that sentence must appear in that headline. A clock time must be one the headline states, or the headline\'s own time written as when it was reported ("a 4:55 PM ET report"), never as when the event happened. The same goes for "before the open", "after the close" and similar: they must match the headline\'s time. If no headline explains a move, write "No confirmed catalyst in our feed." Do not write "No company news explains it" or "flow-driven". Tags are removed before sending.',
  'If PRIOR CALLS is (none), start with the move. Do not mention prior calls.',
  'A sector word means its ETF in FACTS: chips SMH, energy XLE, oil USO, staples XLP, utilities XLU, tech XLK, bonds TLT, credit HYG, bitcoin IBIT. Only say a sector rose, fell, or held if its ETF did.',
  "The first sentence of the Opening Bias states how yesterday's main level played out, using the PRIOR CALLS block. Do not skip a failed call.",
  'If a level differs from the one in PRIOR CALLS for the same ticker, say why in one clause.',
  'No greetings, no sign-offs, no narration about your process, no "Comment chart".',
  'Return level_calls as [{ticker, level, condition, horizonSessions}]. The support/resistance card already uses the levels object, so do not put this array there.',
  'Return an optional scenarios array of 2–3 named, condition-based scenarios. Do not forecast a number for a scheduled macro event.',
].join('\n');

/** Word for word. Teaches the shape. It is not a source of facts for a live brief. */
export const EXPLAIN_THE_MOVE = `**How to explain a move.** Every paragraph about a move follows this order, one short sentence per step:
1. **What happened**: the fact, with a number from FACTS.
2. **Why**: the cause, taken from HEADLINES, with *when* it landed ("before the open", "after the 2 PM decision"). If no headline explains the move, write "No confirmed catalyst in our feed." Never invent a cause, and never say the move was flow-driven.
3. **How it travels**: the one-link chain from the cause to the price ("fewer data-center approvals → less hyperscaler spending → lower chip revenue"). Keep it to one chain, two links at most.
4. **The contrast**: what did *not* move, or moved the other way, using the RANK line in FACTS ("Apple fell 1.7% while the chip ETF fell 11%"). The contrast is the proof the cause is real.
5. **What decides next**: a level with a condition and a timeframe, or the next scheduled event from THIS WEEK.

**Voice:** plain words; one idea per sentence; at most 20 words per sentence. No hype words (historic, bloodbath, carnage, crushed, ripping, insane). Say what is not known yet ("not confirmed", "too early to tell"). No forecasts for scheduled events. Do not address the reader as "guys" or "you need to".

**Accountability:** the Opening Bias starts with how yesterday's main call played out (PRIOR CALLS), in one sentence, including a failed call.`;

export const EXAMPLE_CLOSE = `One company took the hit, not the whole market. XIDX fell 1.2%, but XCHP dropped 14.0%.
XCHP said before the open that its largest customer, Northwind, will delay orders by two quarters [H2].
The chain is short: delayed orders mean lower revenue next quarter for XCHP and its suppliers.
Bonds did not move; XBND rose 0.1%, so this was a company problem, not a rates scare.
What decides next is XCHP's 88 close: a daily close back above 92 says the selling is done.`;

export const EXAMPLE_MORNING = `Yesterday's call held: XIDX stayed above 210, with an overnight low of 210.40.
XCHP is up 3.1% before the open. No confirmed catalyst in our feed; its group is lifting together.
A bounce without news is usually positioning, so the test is the jobs report at 8:30 [H1].
Watch XIDX 212: holding it through the first hour keeps the bounce; losing it puts 210 back in play.`;

const EXAMPLE_NOTE =
  'The examples use made-up tickers, companies, causes, and numbers. They show the shape only. Never use their causes, levels, or numbers in a brief.';

export const ATLAS_FACTS_RULES = [
  CORE_RULES,
  '',
  EXPLAIN_THE_MOVE,
  '',
  'EXAMPLE (close edition, a day with a selloff led by one company):',
  EXAMPLE_CLOSE,
  '',
  'EXAMPLE (morning edition, the next day):',
  EXAMPLE_MORNING,
  '',
  EXAMPLE_NOTE,
].join('\n');

/** Stable across the day. Facts change; this hash changes only when the rules change. */
export const PROMPT_VERSION = createHash('sha256').update(ATLAS_FACTS_RULES).digest('hex').slice(0, 12);

export function exampleSentences(): string[] {
  return [EXAMPLE_CLOSE, EXAMPLE_MORNING].flatMap((block) =>
    block
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0)
  );
}
