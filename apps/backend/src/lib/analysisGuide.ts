import type { AnalysisGuide, MarketContext } from '@chartsignl/core';
import type { TechnicalIndicators } from './technicalCalculator.js';
import type { ScoredAnalysis } from './confluenceScorer.js';

export function describeOverextension(overextension: TechnicalIndicators['overextension']): string {
  if (overextension.status === 'normal') return 'Price is near its 21-period average; no unusual stretch was detected.';
  if (overextension.signalType === 'extended_in_downtrend') {
    return 'Price is stretched below its 21-period average while the trend or broader context is weak. A large decline alone does not confirm a reversal.';
  }
  if (overextension.signalType === 'context_unavailable') {
    return 'Price is stretched below its 21-period average, but broader conditions could not be verified. This is not a confirmed reversal.';
  }
  return `Price is stretched ${overextension.direction} its 21-period average. It can remain stretched; distance alone does not establish the likelihood or timing of a reversal.`;
}

export function describeMarketContext(context: MarketContext): string {
  if (context.status === 'unavailable') return context.reason;
  const reading = context.regime === 'factor_breakdown'
    ? 'Semiconductors are weakening relative to the Nasdaq benchmark, alongside a longer-term break or heavy selling.'
    : context.regime === 'risk_on'
      ? 'Semiconductor leadership and the benchmark trends are supportive under this rule.'
      : 'The semiconductor and benchmark checks are mixed.';
  return `${reading} Based on daily bars through ${context.asOfSession}, before the analysis session. This experimental context rule is not a forecast or a probability of success, and does not describe every sector.`;
}

export function formatMarketContext(context: MarketContext): string {
  if (context.status === 'unavailable') return `MARKET CONTEXT\n${context.reason}\nDo not invent missing market, options, flow, or earnings information.`;
  return `MARKET CONTEXT (semiconductor leadership only; experimental rule ${context.version})
Completed session: ${context.asOfSession}. This context precedes the analysis session.
Regime: ${context.regime}
SMH/QQQ 20-session ratio slope: ${context.smhQqqSlope20.toFixed(4)}% of starting ratio per session
RSP/QQQ 20-session ratio slope: ${context.rspQqqSlope20.toFixed(4)}% of starting ratio per session
SMH above 200-session simple average: ${context.smhAbove200}
QQQ above 200-session simple average: ${context.qqqAbove200}
QQQ bottom-decile close on at least 2x prior-20-session volume: ${context.qqqDistributionDay}
Do not infer this ticker's sector membership, portfolio exposure, earnings, dealer positioning or a win probability from these benchmarks.`;
}

/** All levels and conditions are derived from the scored data, not model arithmetic. */
export function buildAnalysisGuide(indicators: TechnicalIndicators, scored: ScoredAnalysis, context: MarketContext): AnalysisGuide {
  const price = indicators.currentPrice;
  const support = scored.supportLevels.filter((l) => Number.isFinite(l.price) && l.price > 0 && l.price < price)
    .sort((a, b) => b.price - a.price)[0];
  const resistance = scored.resistanceLevels.filter((l) => Number.isFinite(l.price) && l.price > price)
    .sort((a, b) => a.price - b.price)[0];
  const whatToWatch: string[] = [];
  if (support) whatToWatch.push(`Support near $${support.price.toFixed(2)}: a calculated area below the last price where buying may appear; it can fail.`);
  if (resistance) whatToWatch.push(`Resistance near $${resistance.price.toFixed(2)}: a calculated area above the last price where advances may stall; it can break.`);
  if (!whatToWatch.length) whatToWatch.push('No usable nearby comparison levels were identified. Avoid filling that gap with an assumed target.');
  const changes = [
    support ? `a completed bar below $${support.price.toFixed(2)} would weaken the support scenario` : '',
    resistance ? `a completed bar above $${resistance.price.toFixed(2)} would challenge the resistance scenario` : '',
  ].filter(Boolean);
  return {
    whatIsHappening: `The selected chart shows ${indicators.trend.direction.replace(/_/g, ' ')}. ${describeOverextension(indicators.overextension)}`,
    marketContext: describeMarketContext(context), whatToWatch,
    whatWouldChange: changes.length ? `${changes.join('; ')}. These are conditions to review, not instructions to trade.` : 'Reassess when a clear level and a completed-bar condition can be identified.',
    whenToReassess: 'Recheck after the next completed chart bar or a close beyond a watched level. Use the data timestamp; delayed prices do not establish where the market is now.',
    scoreMeaning: 'Confluence measures agreement among indicators. It is not the probability that a trade will succeed.',
  };
}
