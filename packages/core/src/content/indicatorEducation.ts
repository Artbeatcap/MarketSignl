/**
 * indicatorEducation.ts
 * ---------------------------------------------------------------------------
 * Plain-English explanations for every number Atlas puts on screen.
 *
 * Lives in @chartsignl/core so backend, mobile and web all read the same copy.
 * Export from packages/core/src/index.ts:
 *
 *   export * from './content/indicatorEducation';
 *
 * WRITING RULES (keep these if you edit the copy)
 * -----------------------------------------------
 *  1. Explain what the number MEANS before how it is CALCULATED. Most users
 *     never need the formula.
 *  2. Never promise a price outcome. "Often acts as" / "tends to", never
 *     "will bounce". These are descriptions of past behaviour, not forecasts.
 *  3. Every entry has a `caution` - the specific way beginners misuse it.
 *     This is the highest-value field in the file. A user who reads only the
 *     caution is better off than one who reads only the definition.
 *  4. Sixth-grade reading level. No jargon inside a jargon definition.
 *  5. Keep `short` under ~90 chars so it fits a collapsed row.
 */

export type EducationCategory =
  | 'score'
  | 'level'
  | 'trend'
  | 'volatility'
  | 'momentum'
  | 'volume'
  | 'trade';

export interface EducationEntry {
  /** Stable key used by InfoButton. Never rename - persisted in analytics. */
  id: string;
  title: string;
  category: EducationCategory;
  /** One-liner shown in the sheet header and in the end-of-analysis list. */
  short: string;
  /** What the thing actually is. 2-3 sentences max. */
  what: string;
  /** Why a trader would look at it. Ties it to a decision. */
  why: string;
  /** Concrete read-it-like-this bullets. */
  howToRead: string[];
  /** The specific beginner mistake. Required on every entry. */
  caution: string;
  /** Optional deeper note for intermediate/advanced users. */
  advanced?: string;
  /** Other entries worth opening next. */
  related?: string[];
}

// ===========================================================================
// Confluence scoring - the thing users ask about most
// ===========================================================================

/** Aligned with ANALYSIS_CONFIG.STRENGTH_THRESHOLDS (strong 60 / medium 40). */
export const CONFLUENCE_BANDS = [
  {
    min: 60,
    max: 100,
    label: 'Strong',
    meaning:
      'Several independent methods point at this same price. Historically these are the levels price reacts to most clearly.',
  },
  {
    min: 40,
    max: 59,
    label: 'Medium',
    meaning:
      'Two or three methods agree. Worth watching, but expect price to cut through it more often than a strong level.',
  },
  {
    min: 0,
    max: 39,
    label: 'Weak',
    meaning:
      'Mostly one method flagging this price. Treat it as a rough reference, not a decision point.',
  },
] as const;

// ===========================================================================
// Entries
// ===========================================================================

export const INDICATOR_EDUCATION: Record<string, EducationEntry> = {
  // -------------------------------------------------------------------
  confluence: {
    id: 'confluence',
    title: 'Confluence %',
    category: 'score',
    short: 'How many independent methods agree that this price matters.',
    what:
      'Atlas checks a price against several unrelated techniques — moving averages, Fibonacci retracements, where heavy volume traded, and recent swing highs and lows. The confluence percentage is how strongly those methods agree on that one price.',
    why:
      'A price that only one method flags is easy to explain away. A price that four unrelated methods land on is one a lot of other traders are also watching — and that shared attention is what tends to make a level behave like a level.',
    howToRead: [
      '60% and above — strong. Several methods agree.',
      '40% to 59% — medium. A couple of methods agree.',
      'Below 40% — weak. Treat it as a rough reference.',
      'The factor chips under each level show you exactly which methods agreed.',
    ],
    caution:
      'Confluence is not a probability that price will reverse there. A 90% level is not a 90% chance of a bounce — it means the evidence is unusually concentrated at that price. Strong levels break all the time, especially on heavy news.',
    advanced:
      'Score is capped at 100 and factors are unioned, not summed, so three overlapping Fibonacci levels do not triple-count. Levels within a fraction of an ATR of each other are merged into one before scoring.',
    related: ['relevance', 'supportLevel', 'resistanceLevel'],
  },

  // -------------------------------------------------------------------
  relevance: {
    id: 'relevance',
    title: 'Distance from price',
    category: 'score',
    short: 'How close a level is, measured in average daily moves rather than dollars.',
    what:
      'Every level shows how far it sits from the current price, measured in ATR — the size of a typical move for this stock. A level "2 ATR away" is roughly two normal moves away.',
    why:
      'Dollars are misleading. $5 away is nothing on a stock that swings $12 a day and enormous on one that swings 40 cents. Measuring in ATR makes distance comparable across every stock and every timeframe.',
    howToRead: [
      'Under 1 ATR — in play. Price could reach it in a normal session.',
      '1 to 3 ATR — nearby. Realistic over the next several sessions.',
      'Beyond that — real levels, but not decisions for today.',
      'Atlas lowers a level\'s ranking as distance grows, so the top levels are the ones actually in reach.',
    ],
    caution:
      'A far-away level is not a wrong level. It just is not actionable yet. Do not plan an entry around a level five normal moves away and expect it to matter this week.',
    related: ['atr', 'confluence'],
  },

  // -------------------------------------------------------------------
  supportLevel: {
    id: 'supportLevel',
    title: 'Support',
    category: 'level',
    short: 'A price below the current one where buyers have shown up before.',
    what:
      'Support is a price under the current price where buying interest has previously been strong enough to slow or stop a decline.',
    why:
      'Traders use support to decide where a fall might pause, and as a reference point for where they would admit a trade idea was wrong.',
    howToRead: [
      'Support sits below current price. Always.',
      'Think of it as a zone, not a line — Atlas shows a band around each level.',
      'The more times price has reacted there, the more attention it has.',
      'Once support breaks, it often starts acting as resistance instead.',
    ],
    caution:
      'Support is not a floor. It is a place where buyers showed up before, which is a very different claim from where buyers will show up next. Levels break, and the ones everyone is watching sometimes break hardest.',
    related: ['resistanceLevel', 'confluence', 'relevance'],
  },

  // -------------------------------------------------------------------
  resistanceLevel: {
    id: 'resistanceLevel',
    title: 'Resistance',
    category: 'level',
    short: 'A price above the current one where sellers have shown up before.',
    what:
      'Resistance is a price above the current price where selling interest has previously been strong enough to slow or stop an advance.',
    why:
      'It is a natural place to watch for a stall, and a common reference for where traders take profits.',
    howToRead: [
      'Resistance sits above current price. Always.',
      'Treat it as a zone, not an exact number.',
      'Old highs and heavy-volume prices are common sources.',
      'Once resistance breaks, it often starts acting as support.',
    ],
    caution:
      'A stock pressing into resistance is not automatically a short. Strong trends push through resistance repeatedly — that is what makes them trends.',
    related: ['supportLevel', 'confluence'],
  },

  // -------------------------------------------------------------------
  ema: {
    id: 'ema',
    title: 'EMA (Exponential Moving Average)',
    category: 'trend',
    short: 'A running average of price that reacts faster to recent bars.',
    what:
      'A moving average smooths price into a single line. The exponential version weights recent bars more heavily, so it turns faster than a simple average. Atlas uses the 9, 21, 65, 100 and 200.',
    why:
      'The averages answer one question quickly: which direction has price been leaning, and over what horizon? Short averages describe the last few sessions; long ones describe the last several months.',
    howToRead: [
      '9 and 21 — short-term direction.',
      '65 and 100 — the intermediate trend.',
      '200 — the long-term trend most institutions watch.',
      'Price above an average means it is above its own recent norm on that horizon.',
    ],
    caution:
      'Moving averages are calculated from prices that already happened. They describe what has been true, not what comes next, and they whipsaw badly when a stock goes sideways.',
    advanced:
      'ChartSignl uses a 65 EMA rather than the more common 50 in the analysis pipeline. The chart overlay separately displays 9/21/50.',
    related: ['emaAlignment', 'trend'],
  },

  // -------------------------------------------------------------------
  emaAlignment: {
    id: 'emaAlignment',
    title: 'EMA alignment',
    category: 'trend',
    short: 'Whether the moving averages are stacked in trend order.',
    what:
      'Alignment describes the order of the averages. When they stack shortest-to-longest going down from price, every horizon agrees the stock is rising. Stacked the other way, every horizon agrees it is falling.',
    why:
      'Stacked averages are shorthand for "the trend agrees with itself." Tangled averages mean the horizons disagree, which usually means a range rather than a trend.',
    howToRead: [
      'Perfectly bullish — price above 9, above 21, above 65, above 100, above 200.',
      'Perfectly bearish — the exact reverse.',
      'Mostly bullish or bearish — one average out of order.',
      'Mixed — the averages are tangled. Trend-following setups work poorly here.',
    ],
    caution:
      'Perfect alignment often shows up late, after a large part of the move has happened. It confirms a trend; it does not find one early.',
    related: ['ema', 'trend', 'overextension'],
  },

  // -------------------------------------------------------------------
  atr: {
    id: 'atr',
    title: 'ATR (Average True Range)',
    category: 'volatility',
    short: 'The size of a typical move for this stock, in dollars.',
    what:
      'ATR averages how much a stock travels in a bar, gaps included. If ATR is $2.40, a $2.40 move is an ordinary day for that stock — not news.',
    why:
      'It is the unit that makes everything else comparable. Position size, stop distance, and how far a level is from price are all more meaningful in ATRs than in dollars or percentages.',
    howToRead: [
      'Under 1% of price — quiet.',
      '1% to 3% — normal.',
      'Above 3% — volatile. Expect wider swings in both directions.',
      'A stop placed inside 1 ATR will often be hit by ordinary noise.',
    ],
    caution:
      'Rising ATR tells you moves are getting bigger. It says nothing at all about direction — volatility rises in crashes and in melt-ups alike.',
    related: ['relevance', 'stopLoss', 'bollinger'],
  },

  // -------------------------------------------------------------------
  bollinger: {
    id: 'bollinger',
    title: 'Bollinger Bands',
    category: 'volatility',
    short: 'A band around the average that widens when a stock gets volatile.',
    what:
      'Bollinger Bands draw a 20-period average with an envelope two standard deviations above and below it. The envelope widens as the stock gets more volatile and narrows as it calms down.',
    why:
      'The bands give context for whether a price is unusual relative to its own recent behaviour, rather than relative to some fixed number.',
    howToRead: [
      'Near the upper band — price is high relative to its recent range.',
      'Near the lower band — price is low relative to its recent range.',
      'Bands pinched tight ("squeeze") — volatility has compressed. Larger moves often follow, but the direction is not indicated.',
      '%B tells you where in the band price sits: 0% is the lower band, 100% the upper.',
    ],
    caution:
      'Touching the upper band is not a sell signal. In a strong trend price can ride the upper band for weeks — selling every touch is one of the most common ways beginners fight a trend.',
    related: ['atr', 'overextension'],
  },

  // -------------------------------------------------------------------
  overextension: {
    id: 'overextension',
    title: 'Overextension',
    category: 'momentum',
    short: 'How stretched price is from its 21 EMA, measured in ATRs.',
    what:
      'Overextension measures the gap between price and the 21 EMA, then divides by ATR so it is comparable across stocks. Two ATRs from the average is a genuine stretch; four is rare.',
    why:
      'Price tends to travel away from its average and then back toward it. Knowing you are unusually far from the average is useful context for whether you are early or late to a move.',
    howToRead: [
      'Under 1.5 ATR — normal.',
      '1.5 to 2.5 — moderately extended. A pause would be healthy.',
      '2.5 to 4 — overextended. Snapbacks toward the average are common.',
      'Above 4 — extremely extended, and historically unstable.',
    ],
    caution:
      'Overextended is not a reversal signal and is a genuinely dangerous thing to trade against. Stocks can stay stretched far longer than expected, and the strongest trends are overextended almost by definition. This flags context, not a trade.',
    related: ['ema', 'atr', 'bollinger'],
  },

  // -------------------------------------------------------------------
  fibonacci: {
    id: 'fibonacci',
    title: 'Fibonacci retracements',
    category: 'level',
    short: 'Common percentages of a recent move where pullbacks often pause.',
    what:
      'Pick a recent swing from low to high. Fibonacci retracements mark where price would sit if it gave back 38.2%, 50% or 61.8% of that move. Those percentages have no special mathematical power over markets — they matter mainly because a very large number of traders watch them.',
    why:
      'They give a structured, repeatable answer to "how deep is a normal pullback," instead of guessing.',
    howToRead: [
      '38.2% — a shallow pullback. Common in strong trends.',
      '50% — the midpoint. The most watched of the three.',
      '61.8% — a deep pullback. Beyond it, the original move is in question.',
      'Atlas measures from the most recent meaningful swing, not the widest one on the chart.',
    ],
    caution:
      'Fibonacci levels are only as good as the swing they are drawn from. Change the swing and every level moves. If the reference swing is old or tiny, the levels mean very little — which is why Atlas rejects stale and trivial swings rather than drawing off them.',
    related: ['supportLevel', 'confluence'],
  },

  // -------------------------------------------------------------------
  volumeProfile: {
    id: 'volumeProfile',
    title: 'Volume profile',
    category: 'volume',
    short: 'Which prices actually traded the most shares.',
    what:
      'Instead of showing volume by time, a volume profile shows volume by price — how many shares changed hands at each price rather than on each day.',
    why:
      'Prices where enormous volume traded are prices where a lot of people have a position and an opinion. Those prices tend to attract activity when revisited.',
    howToRead: [
      'High-volume node — a price with heavy trading. Often acts as a magnet or a shelf.',
      'Low-volume gap — thin trading. Price often moves through quickly.',
      'Point of control — the single busiest price in the window.',
      'Atlas weights recent volume more heavily, so nodes reflect where the stock is trading now.',
    ],
    caution:
      'A high-volume node from six months ago matters far less than one from last week. Check how far it is from current price before treating it as relevant.',
    related: ['pointOfControl', 'supportLevel'],
  },

  // -------------------------------------------------------------------
  pointOfControl: {
    id: 'pointOfControl',
    title: 'Point of control',
    category: 'volume',
    short: 'The single price where the most shares changed hands.',
    what:
      'The point of control is the busiest price in the window — the one price where more volume traded than any other.',
    why:
      'It is a rough centre of gravity. Price often drifts back toward it during quiet stretches.',
    howToRead: [
      'Price above the point of control — buyers have pushed above the busiest price.',
      'Price below it — sellers have pushed below it.',
      'The further price gets from it, the more room there is to drift back.',
    ],
    caution:
      'A magnet is not a target. Price can leave the point of control behind permanently when something fundamental changes about the company.',
    related: ['volumeProfile'],
  },

  // -------------------------------------------------------------------
  trend: {
    id: 'trend',
    title: 'Trend & strength',
    category: 'trend',
    short: 'Which way price has been leaning and how consistently.',
    what:
      'Atlas combines the moving-average order and the sequence of highs and lows into a single direction, plus a strength score for how consistent that direction has been.',
    why:
      'Almost every technique behaves differently in a trend versus a range. Knowing which one you are in is the first decision, before any level matters.',
    howToRead: [
      'High strength — the signals agree. Pullbacks tend to be shallow.',
      'Low strength — the signals conflict. Expect chop and false starts.',
      'Direction describes what has happened, not a forecast.',
    ],
    caution:
      'Trend readings lag by design. A trend can be labelled strong right up until the day it ends — strength describes the past, not durability.',
    related: ['emaAlignment', 'ema'],
  },

  // -------------------------------------------------------------------
  confidence: {
    id: 'confidence',
    title: 'Atlas confidence',
    category: 'score',
    short: "How much the signals agree with each other in this analysis.",
    what:
      'Confidence summarises how consistent the picture is. Clean trend, clear levels and agreeing indicators push it up; conflicting signals, thin data or a choppy range push it down.',
    why:
      'It tells you how much weight to put on the rest of the analysis. Low confidence is a real result and often the most useful one — it usually means "there is no clean setup here."',
    howToRead: [
      'High — signals agree.',
      'Moderate — mostly agree, with some conflict.',
      'Low or very low — conflicting or insufficient signals.',
      'The factor list shows exactly what raised or lowered it.',
    ],
    caution:
      'Confidence is about signal agreement, not about whether a trade will work. High confidence in a clean setup that fails is completely normal. It is never a probability of profit.',
    related: ['confluence', 'trend'],
  },

  // -------------------------------------------------------------------
  tradeIdea: {
    id: 'tradeIdea',
    title: 'Trade idea',
    category: 'trade',
    short: 'An illustration of how the levels could be used — not a recommendation.',
    what:
      'Atlas takes the highest-ranked level as a reference entry, places a stop a set distance away based on ATR, and uses the nearest opposite level as a target. It is an illustration of how the levels fit together.',
    why:
      'Seeing entry, stop and target as one structure makes the risk explicit, which is harder to ignore than a level on its own.',
    howToRead: [
      'Entry — the reference level, shown as a zone.',
      'Stop — placed roughly 2 ATR away, outside normal noise.',
      'Target — the next meaningful level in the opposite direction.',
      'R:R — how much you stand to make compared with what you risk.',
    ],
    caution:
      'This is generated from chart geometry alone. It knows nothing about earnings dates, company news, your account size, or your risk tolerance. It is educational output, not financial advice, and ChartSignl is not a financial adviser.',
    related: ['riskReward', 'stopLoss'],
  },

  // -------------------------------------------------------------------
  riskReward: {
    id: 'riskReward',
    title: 'Risk / reward (R:R)',
    category: 'trade',
    short: 'How much you would make versus how much you would lose.',
    what:
      'R:R compares the distance from entry to target against the distance from entry to stop. 3:1 means the target is three times further away than the stop.',
    why:
      'It sets how often you need to be right. At 3:1 a trader can be wrong most of the time and still come out ahead; at 1:1 they need to be right well over half the time.',
    howToRead: [
      'Below 1:1 — risking more than the potential gain.',
      '2:1 to 3:1 — the range many traders look for.',
      'Above 4:1 — attractive on paper, but usually means a distant target.',
    ],
    caution:
      'A great ratio is easy to manufacture by moving the stop closer, which just means getting stopped out more often by normal noise. Ratio and probability trade against each other — improving one usually worsens the other.',
    related: ['tradeIdea', 'stopLoss'],
  },

  // -------------------------------------------------------------------
  stopLoss: {
    id: 'stopLoss',
    title: 'Stop loss',
    category: 'trade',
    short: 'The price at which the idea is wrong and the trade is exited.',
    what:
      'A stop is a predetermined exit price. Atlas places it roughly 2 ATR from entry — far enough that ordinary movement should not trigger it.',
    why:
      'Deciding the exit before entering is the difference between a defined loss and an open-ended one.',
    howToRead: [
      'Stops inside 1 ATR get hit by ordinary noise.',
      'Wider stops mean smaller position sizes for the same dollar risk.',
      'The stop should sit beyond the level, not exactly on it.',
    ],
    caution:
      'Moving a stop further away to avoid taking a loss is the single most common way traders turn a small loss into a large one. If the stop is wrong, the position size was wrong first.',
    related: ['atr', 'riskReward'],
  },
};

// ===========================================================================
// Helpers
// ===========================================================================

/** Look up an entry by id. Returns null rather than throwing. */
export function getEducation(id: string): EducationEntry | null {
  return INDICATOR_EDUCATION[id] ?? null;
}

/** Band label + meaning for a confluence score. */
export function getConfluenceBand(score: number) {
  return (
    CONFLUENCE_BANDS.find((b) => score >= b.min && score <= b.max) ??
    CONFLUENCE_BANDS[CONFLUENCE_BANDS.length - 1]
  );
}

/**
 * Which entries are worth showing at the end of a given analysis.
 * Pass the indicator ids that actually appeared so beginners are not handed a
 * glossary of things the analysis never mentioned.
 */
export function getRelevantEducation(presentIds: string[]): EducationEntry[] {
  const seen = new Set<string>();
  const ordered: EducationCategory[] = [
    'score', 'level', 'trend', 'momentum', 'volatility', 'volume', 'trade',
  ];
  return presentIds
    .map((id) => INDICATOR_EDUCATION[id])
    .filter((e): e is EducationEntry => {
      if (!e || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .sort(
      (a, b) => ordered.indexOf(a.category) - ordered.indexOf(b.category)
    );
}

/**
 * Standard disclaimer. Render once per analysis wherever education appears.
 * Keep it short - a wall of legal text gets ignored, which defeats the point.
 */
export const EDUCATION_DISCLAIMER =
  'ChartSignl provides educational analysis of price data, not financial advice. Technical indicators describe what price has already done — they do not predict what it will do. Trading involves real risk of loss.';
