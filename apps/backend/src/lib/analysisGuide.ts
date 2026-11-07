import type { AnalysisGuide, MarketContext } from '@chartsignl/core';
import type { TechnicalIndicators } from './technicalCalculator.js';
import type { ScoredAnalysis, ScoredLevel } from './confluenceScorer.js';
import { INTERVAL_BAR_CONFIG } from './marketDataFetcher.js';

const TREND_LABEL: Record<TechnicalIndicators['trend']['direction'], string> = {
  strong_uptrend: 'Strong uptrend',
  uptrend: 'Uptrend',
  weak_uptrend: 'Weak uptrend',
  ranging: 'Range-bound',
  weak_downtrend: 'Weak downtrend',
  downtrend: 'Downtrend',
  strong_downtrend: 'Strong downtrend',
};

const usd = (n: number) => `$${n.toFixed(2)}`;

/** "2026-11-05" -> "Nov 5"; falls back to the raw string. */
function sessionLabel(isoDate: string): string {
  const ms = Date.parse(`${isoDate}T12:00:00Z`);
  return Number.isFinite(ms)
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(ms)
    : isoDate;
}

export function describeOverextension(overextension: TechnicalIndicators['overextension']): string {
  const atr = overextension.atrNormalizedDistance.toFixed(1);
  const where = `${atr} ATR ${overextension.direction} the 21 EMA`;
  if (overextension.status === 'normal') return `Price is ${where}, not extended.`;
  if (overextension.signalType === 'extended_in_downtrend') {
    return `Price is ${where}. Stretch alone isn't a reversal signal here; wait for a higher low.`;
  }
  if (overextension.signalType === 'context_unavailable') {
    return `Price is ${where}. Sector data couldn't be verified, so no reversal read is offered.`;
  }
  return `Price is ${where}, extended. Stretch can persist, and on its own it doesn't time a turn.`;
}

/** Sector read for symbols the semiconductor-leadership rule covers. */
export function describeMarketContext(context: MarketContext): string {
  if (context.status === 'unavailable') {
    return 'Sector filter unavailable: SMH/QQQ data could not be loaded, so dip-buy reads are withheld.';
  }
  const ratio = `SMH/QQQ ${context.smhQqqSlope20 < 0 ? 'falling' : 'rising'} over 20 sessions`;
  const smh200 = `SMH ${context.smhAbove200 ? 'above' : 'below'} its 200-day`;
  const qqq200 = `QQQ ${context.qqqAbove200 ? 'above' : 'below'} its 200-day`;
  const lead = context.regime === 'factor_breakdown'
    ? 'Semis lagging'
    : context.regime === 'risk_on' ? 'Semis leading' : 'Semis mixed';
  const extra = context.qqqDistributionDay ? '; QQQ closed near its low on heavy volume' : '';
  const consequence = context.regime === 'factor_breakdown' ? ' Dip-buy signals are suppressed until this clears.' : '';
  return `${lead}: ${ratio}, ${smh200}, ${qqq200}${extra}.${consequence} Experimental filter, daily data through ${sessionLabel(context.asOfSession)}.`;
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

function barName(interval: string): string {
  const config = INTERVAL_BAR_CONFIG[interval];
  if (!config) return 'bar';
  if (config.timespan === 'minute') return `${config.multiplier}-minute bar`;
  if (config.timespan === 'day') return 'daily close';
  if (config.timespan === 'week') return 'weekly close';
  return 'bar';
}

const pctAway = (level: ScoredLevel, price: number) => `${(Math.abs((level.price - price) / price) * 100).toFixed(1)}%`;

/** "Support: 49 historical touches + near 21 EMA + high volume node" -> "49 touches, 21 EMA, high-volume node". */
function levelBasis(description: string): string {
  const parts = description
    .replace(/^(Support|Resistance)(: | level$)/, '')
    .split(' + ')
    .map((p) => p.trim()
      .replace(/^near /, '')
      .replace(/historical touches/, 'touches')
      .replace(/high volume node/, 'high-volume node')
      .replace(/psychological level/, 'round number'))
    .filter(Boolean);
  return parts.join(', ');
}

function levelLine(level: ScoredLevel, price: number): string {
  const side = level.type === 'support' ? 'below' : 'above';
  const basis = levelBasis(level.description ?? '');
  return `${level.type === 'support' ? 'Support' : 'Resistance'} ${usd(level.price)} (${pctAway(level, price)} ${side})${basis ? `: ${basis}` : ''}`;
}

/** All levels and conditions come from the scored data, not model arithmetic. */
export function buildAnalysisGuide(
  indicators: TechnicalIndicators,
  scored: ScoredAnalysis,
  context: MarketContext | undefined,
  interval: string,
): AnalysisGuide {
  const price = indicators.currentPrice;
  const valid = (l: ScoredLevel) => Number.isFinite(l.price) && l.price > 0;
  const supports = scored.supportLevels.filter((l) => valid(l) && l.price < price).sort((a, b) => b.price - a.price);
  const resistances = scored.resistanceLevels.filter((l) => valid(l) && l.price > price).sort((a, b) => a.price - b.price);
  const [support, nextSupport] = supports;
  const [resistance, nextResistance] = resistances;
  const bar = barName(interval);

  const whatToWatch: string[] = [];
  if (support) whatToWatch.push(levelLine(support, price));
  if (resistance) whatToWatch.push(levelLine(resistance, price));
  if (!whatToWatch.length) whatToWatch.push('No nearby levels with enough confluence to anchor a plan.');

  const changes: string[] = [];
  if (support) {
    changes.push(nextSupport
      ? `A ${bar} below ${usd(support.price)} puts the next support, ${usd(nextSupport.price)} (${pctAway(nextSupport, price)} below), in play.`
      : `A ${bar} below ${usd(support.price)} leaves no scored support beneath it.`);
  }
  if (resistance) {
    changes.push(nextResistance
      ? `A ${bar} above ${usd(resistance.price)} opens the next resistance at ${usd(nextResistance.price)} (${pctAway(nextResistance, price)} above).`
      : `A ${bar} above ${usd(resistance.price)} clears the last scored resistance.`);
  }

  return {
    whatIsHappening: `${TREND_LABEL[indicators.trend.direction]}. ${describeOverextension(indicators.overextension)}`,
    ...(context ? { marketContext: describeMarketContext(context) } : {}),
    whatToWatch,
    whatWouldChange: changes.length ? changes.join(' ') : 'No clear level to define a break; wait for structure to form.',
    whenToReassess: `Reassess on the next ${bar}, or sooner on a close through either level.`,
    scoreMeaning: 'Confluence measures agreement among indicators, not the odds a trade works.',
  };
}
