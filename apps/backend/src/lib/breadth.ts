export type BreadthRegime = 'narrow' | 'mixed' | 'broad' | 'offset' | 'unknown';

export interface BreadthRead {
  regime: BreadthRegime;
  /** INTERNAL ONLY — logging and tests. Must never reach the template or the prompt. */
  concentrationRatio: number | null;
  /** INTERNAL ONLY — SPY minus RSP, in bps. Weight-table-independent cross-check. */
  equalWeightSpreadBps: number | null;
}

/** Below this the index move is noise and any ratio against it is meaningless. */
const MIN_INDEX_MOVE_BPS = 10;

/**
 * Two independent measures, deliberately:
 *  - concentrationRatio: signed sum of top-3 driver bps / index move bps.
 *    Precise, but depends entirely on the weight table being right.
 *  - equalWeightSpreadBps: SPY% - RSP% in bps. Needs no weights at all.
 *    Positive means the cap-weighted index outran the equal-weighted one,
 *    i.e. the mega-caps carried it.
 * When they disagree, we say nothing rather than guess.
 */
export function classifyBreadth(
  top3DriverBps: number[],
  indexChangePct: number,
  spyChangePct: number,
  rspChangePct: number
): BreadthRead {
  const indexBps = indexChangePct * 100;
  const spreadBps = (spyChangePct - rspChangePct) * 100;

  // Guard: a near-flat index makes the denominator explode. SPY +2bps with
  // NVDA at +50bps is not "2500% concentration", it is a day with no move to
  // attribute. This guard is the single most important line in the file.
  if (Math.abs(indexBps) < MIN_INDEX_MOVE_BPS) {
    return { regime: 'unknown', concentrationRatio: null, equalWeightSpreadBps: spreadBps };
  }

  const sumTop3 = top3DriverBps.reduce((a, b) => a + b, 0);
  const ratio = sumTop3 / indexBps;

  // Drivers pushing against the tape: a handful of heavyweights up while the
  // index is down (or vice versa). Not concentration — the opposite story,
  // and a genuinely useful one.
  if (ratio < -0.15) {
    return { regime: 'offset', concentrationRatio: ratio, equalWeightSpreadBps: spreadBps };
  }

  const sameSign = Math.sign(spreadBps) === Math.sign(indexBps);
  const confirmsNarrow = sameSign && Math.abs(spreadBps) >= 25;
  const confirmsBroad = Math.abs(spreadBps) <= 10;

  if (ratio >= 0.6 && confirmsNarrow) {
    return { regime: 'narrow', concentrationRatio: ratio, equalWeightSpreadBps: spreadBps };
  }
  if (ratio <= 0.3 && confirmsBroad) {
    return { regime: 'broad', concentrationRatio: ratio, equalWeightSpreadBps: spreadBps };
  }
  // One measure says narrow/broad, the other doesn't confirm. Don't guess.
  return { regime: 'mixed', concentrationRatio: ratio, equalWeightSpreadBps: spreadBps };
}

/**
 * The label and nothing else. `unknown` yields an empty string: an absent
 * line produces silence, whereas the word invites the model to write about
 * uncertainty it was not asked to discuss.
 */
export function breadthPromptLine(regime: BreadthRegime | string): string {
  if (!regime || regime === 'unknown') return '';
  return `MARKET BREADTH: ${regime}`;
}
