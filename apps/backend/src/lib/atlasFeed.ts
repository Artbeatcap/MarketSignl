import { breadthPromptLine, type BreadthRegime } from './breadth.js';
import type { BriefMoverRow } from './indexDrivers.js';
import {
  ATLAS_CALENDAR_OUTPUT_RULES,
  ATLAS_HARD_RULE,
  buildThisWeekBlock,
  type CalendarRow,
} from './weekAhead.js';

export interface DriverPromptRow {
  ticker: string;
  pct: string;
  headlineWindow?: 'premarket' | 'prior_session';
  why: string;
}

/**
 * Atlas context for index drivers and breadth.
 *
 * Product decision, enforced here: the block carries catalyst text and the
 * percentage move, never basis points, never a weight, never a concentration
 * ratio. A model that never sees the number cannot print the number.
 */
export function buildMarketDriversBlock(
  drivers: Array<DriverPromptRow | BriefMoverRow>,
  regime: BreadthRegime | string = 'unknown'
): string {
  const lines = drivers
    .filter((d) => ('window' in d ? d.window === 'index_driver' : true))
    .map((d) => {
      const window =
        'headlineWindow' in d && d.headlineWindow === 'prior_session' ? 'yesterday' : 'premarket';
      return `- ${d.ticker} ${d.pct} ${window} — ${d.why}`;
    });

  const driverBlock = [
    'INDEX DRIVERS (largest contributors to the S&P move, most significant first):',
    ...(lines.length ? lines : ['- (no single name is driving the index)']),
  ].join('\n');

  const breadthLine = breadthPromptLine(regime);
  return breadthLine ? `${driverBlock}\n\n${breadthLine}` : driverBlock;
}

export { ATLAS_HARD_RULE, ATLAS_CALENDAR_OUTPUT_RULES, buildThisWeekBlock };

/**
 * INDEX DRIVERS, then THIS WEEK, then (optional) headlines.
 * Gate figures never enter this string.
 */
export function buildAtlasMarketContext(opts: {
  drivers: Array<DriverPromptRow | BriefMoverRow>;
  regime?: BreadthRegime | string;
  calendar?: CalendarRow[];
  headlines?: string;
}): string {
  const parts = [buildMarketDriversBlock(opts.drivers, opts.regime ?? 'unknown')];
  const week = buildThisWeekBlock(opts.calendar ?? []);
  if (week) parts.push(week);
  return opts.headlines ? `${parts.join('\n\n')}\n\n${opts.headlines}` : parts.join('\n\n');
}
