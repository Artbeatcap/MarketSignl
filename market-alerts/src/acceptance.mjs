import { detectLowerHighs } from './lowerHigh.mjs';
import { atrSeries } from './indicators.mjs';

/**
 * Day-by-day replay for a date range. Detection rule is unchanged — we only
 * truncate bars to each as-of date and call detectLowerHighs(..., { onlyLatest: true }).
 *
 * @param {string} ticker
 * @param {{ date: string, open: number, high: number, low: number, close: number }[]} bars
 * @param {{ from: string, to: string }} range ISO dates YYYY-MM-DD inclusive
 */
export function replayRange(ticker, bars, { from, to }) {
  const byDate = new Map(bars.map((b, i) => [b.date, i]));
  const dates = enumerateWeekdays(from, to);
  /** @type {object[]} */
  const rows = [];

  for (const date of dates) {
    const idx = byDate.get(date);
    if (idx == null) {
      rows.push({
        date,
        h1: null,
        r: null,
        trigger: false,
        reason: 'no bar for date',
      });
      continue;
    }

    const slice = bars.slice(0, idx + 1);
    if (slice.length < 220) {
      rows.push({
        date,
        h1: null,
        r: null,
        trigger: false,
        reason: `bar count < 220 (${slice.length})`,
      });
      continue;
    }

    const found = detectLowerHighs(ticker, slice, { onlyLatest: true });
    if (found.length) {
      const s = found[0];
      rows.push({
        date,
        h1: { date: s.h1Date, price: s.h1Price },
        r: { date: s.retestDate, high: s.retestHigh, low: s.retestLow },
        trigger: true,
        reason: null,
        setup: s,
      });
      continue;
    }

    rows.push({
      date,
      ...explainNoTrigger(slice),
      trigger: false,
    });
  }

  return rows;
}

/**
 * Explain why onlyLatest returned empty — does not alter the rule.
 * @param {{ date: string, high: number, low: number, close: number }[]} bars
 */
export function explainNoTrigger(bars) {
  const last = bars[bars.length - 1];
  // Probe full history for nearest incomplete structure
  const all = detectLowerHighs('X', bars, { onlyLatest: false });
  if (all.length) {
    const lastFire = all[all.length - 1];
    if (lastFire.confirmDate !== last.date) {
      return {
        h1: { date: lastFire.h1Date, price: lastFire.h1Price },
        r: {
          date: lastFire.retestDate,
          high: lastFire.retestHigh,
          low: lastFire.retestLow,
        },
        reason: `prior confirm ${lastFire.confirmDate}; no new close below R low today`,
      };
    }
  }

  // Lightweight structure scan for messaging only (same swing definition as detector)
  const swings = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const h = bars[i].high;
    let ok = true;
    for (let j = i - 2; j <= i + 2; j++) {
      if (j === i) continue;
      if (bars[j].high >= h) {
        ok = false;
        break;
      }
    }
    if (ok) swings.push(i);
  }

  if (!swings.length) {
    return { h1: null, r: null, reason: 'no swing high (H1) in window' };
  }

  // Find latest H1 that has a lower retest after it
  for (let s = swings.length - 1; s >= 0; s--) {
    const h1i = swings[s];
    const h1 = bars[h1i];
    for (let r = s + 1; r < swings.length; r++) {
      const ri = swings[r];
      const retest = bars[ri];
      if (!(retest.high < h1.high)) continue;
      if (!(last.close < retest.low)) {
        return {
          h1: { date: h1.date, price: round2(h1.high) },
          r: {
            date: retest.date,
            high: round2(retest.high),
            low: round2(retest.low),
          },
          reason: `close ${round2(last.close)} not below R low ${round2(retest.low)}`,
        };
      }
    }
  }

  const h1i = swings[swings.length - 1];
  const h1 = bars[h1i];
  return {
    h1: { date: h1.date, price: round2(h1.high) },
    r: null,
    reason: 'H1 present; no lower retest (R) yet',
  };
}

/**
 * Backtest summary over all historical fires (detection unchanged).
 * Forward returns from confirm close; "hit H1 before -1 ATR" = adverse touch of H1
 * high occurs before a favorable -1 ATR move (short framing).
 *
 * @param {string} ticker
 * @param {{ date: string, open: number, high: number, low: number, close: number }[]} bars
 */
export function backtestSummary(ticker, bars) {
  const fires = detectLowerHighs(ticker, bars, { onlyLatest: false });
  const atr = atrSeries(bars, 14);
  const byDate = new Map(bars.map((b, i) => [b.date, i]));

  const fwd1 = [];
  const fwd5 = [];
  const fwd10 = [];
  let hitH1Before = 0;
  let scored = 0;

  for (const fire of fires) {
    const i = byDate.get(fire.confirmDate);
    if (i == null) continue;
    const entry = bars[i].close;
    const atrVal = atr[i];

    pushFwd(fwd1, bars, i, 1, entry);
    pushFwd(fwd5, bars, i, 5, entry);
    pushFwd(fwd10, bars, i, 10, entry);

    if (atrVal && atrVal > 0) {
      scored += 1;
      const targetDown = entry - atrVal;
      const stopUp = fire.h1Price;
      let hitH1 = false;
      let hitFavorable = false;
      const end = Math.min(bars.length - 1, i + 10);
      for (let j = i + 1; j <= end; j++) {
        if (bars[j].high >= stopUp) {
          hitH1 = true;
          break;
        }
        if (bars[j].low <= targetDown) {
          hitFavorable = true;
          break;
        }
      }
      if (hitH1 && !hitFavorable) hitH1Before += 1;
      // If neither in 10d, does not count as hitting H1 before -1 ATR
    }
  }

  return {
    fires: fires.length,
    mean: {
      d1: mean(fwd1),
      d5: mean(fwd5),
      d10: mean(fwd10),
    },
    median: {
      d1: median(fwd1),
      d5: median(fwd5),
      d10: median(fwd10),
    },
    pctHitH1BeforeMinus1Atr: scored ? (100 * hitH1Before) / scored : null,
    samples: { d1: fwd1.length, d5: fwd5.length, d10: fwd10.length, atrScored: scored },
  };
}

/** Pretty-print replay + summary for CLI. */
export function printAcceptance(ticker, bars, range = { from: '2026-10-26', to: '2026-10-30' }) {
  const rows = replayRange(ticker, bars, range);
  console.log(`\n=== Replay ${range.from} → ${range.to} (${ticker}) ===`);
  console.log('date       | H1              | R                 | trigger | reason');
  console.log('-----------+-----------------+-------------------+---------+---------------------------');
  for (const row of rows) {
    const h1 = row.h1 ? `${row.h1.date} ${fmt(row.h1.price)}` : '—';
    const r = row.r ? `${row.r.date} ${fmt(row.r.high)}` : '—';
    const trig = row.trigger ? 'YES' : 'no';
    const reason = row.reason || '';
    console.log(
      `${row.date} | ${pad(h1, 15)} | ${pad(r, 17)} | ${pad(trig, 7)} | ${reason}`,
    );
  }

  const summary = backtestSummary(ticker, bars);
  console.log('\n=== Backtest summary ===');
  console.log(`Fires: ${summary.fires}`);
  console.log(
    `Mean  fwd 1/5/10d: ${pct(summary.mean.d1)} / ${pct(summary.mean.d5)} / ${pct(summary.mean.d10)}`,
  );
  console.log(
    `Median fwd 1/5/10d: ${pct(summary.median.d1)} / ${pct(summary.median.d5)} / ${pct(summary.median.d10)}`,
  );
  console.log(
    `% hit H1 before -1 ATR (within 10d): ${
      summary.pctHitH1BeforeMinus1Atr == null
        ? 'n/a'
        : `${summary.pctHitH1BeforeMinus1Atr.toFixed(1)}%`
    }`,
  );
  return { rows, summary };
}

function pushFwd(arr, bars, i, n, entry) {
  const j = i + n;
  if (j >= bars.length) return;
  arr.push(((bars[j].close - entry) / entry) * 100);
}

function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function enumerateWeekdays(from, to) {
  const out = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
function fmt(n) {
  return n == null ? '—' : Number(n).toFixed(2);
}
function pad(s, n) {
  const t = String(s);
  return t.length >= n ? t.slice(0, n) : t + ' '.repeat(n - t.length);
}
function pct(n) {
  if (n == null || Number.isNaN(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
