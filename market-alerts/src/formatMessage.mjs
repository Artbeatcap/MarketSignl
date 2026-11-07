/**
 * Numbers-first Slack mrkdwn. Avoid raw `<` so Slack does not treat text as a link.
 * Dates expected as YYYY-MM-DD (America/New_York session dates).
 *
 * @param {object} setup
 */
export function formatLowerHighMessage(setup) {
  const gaps =
    setup.gapsAbove?.length > 0 ? setup.gapsAbove.map((g) => formatPrice(g)).join(', ') : 'none';

  const atrPart =
    setup.invalidationAtr == null ? 'n/a ATR' : `${formatPrice(setup.invalidationAtr)} ATR`;

  const five =
    setup.fiveDayPct == null
      ? 'n/a'
      : `${setup.fiveDayPct > 0 ? '+' : ''}${formatPrice(setup.fiveDayPct)}%`;

  const ema65 = setup.priceVsEma65 ? `Price ${setup.priceVsEma65} EMA65` : 'EMA65 n/a';
  const ema200 = setup.priceVsEma200 ? `Price ${setup.priceVsEma200} EMA200` : 'EMA200 n/a';

  const body = [
    `*LOWER HIGH CONFIRMED: ${String(setup.ticker).toUpperCase()}*`,
    `H1 ${setup.h1Date} ${formatPrice(setup.h1Price)}. Retest ${setup.retestDate} high ${formatPrice(setup.retestHigh)}. Close ${formatPrice(setup.close)}, below retest low ${formatPrice(setup.retestLow)}.`,
    `Invalidation: close above H1 (${formatPrice(setup.invalidationAway)} away, ${atrPart}). ${ema65}, ${ema200}. 5d ${five}.`,
    `Unfilled gaps above: ${gaps}. UNTESTED RULE: awareness only.`,
  ].join(' ');

  return trimWords(body, 120);
}

function formatPrice(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return String(n);
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Soft cap: keep first `maxWords` words. */
function trimWords(text, maxWords) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ');
}

/**
 * Assert Slack API body: HTTP 200 with ok:false is still a failure.
 * @param {{ status?: number, body?: any, ok?: boolean, error?: string, ts?: string }} res
 */
export function assertSlackOk(res) {
  const body = res?.body ?? res;
  if (!body || body.ok !== true) {
    const errCode = body?.error || 'slack_ok_false';
    const err = new Error(String(errCode));
    err.step = 'slack_post';
    err.slackBody = body;
    throw err;
  }
  return body.ts ?? null;
}
