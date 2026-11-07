#!/usr/bin/env node
/**
 * Fetch (or synthesize) daily bars into fixtures/spy-daily.json for offline tests.
 * With MASSIVE_API_KEY set, pulls live data. Without it, writes a deterministic synthetic series.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDailyBars } from '../src/fetchBars.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');
const outDir = join(root, 'fixtures');
const outFiles = [
  join(outDir, 'spy-daily.json'),
  join(outDir, 'lower-high-daily.json'),
];

function loadDotEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] != null && process.env[m[1]] !== '') continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function synthesizeBars(targetSessions = 260) {
  // End on 2026-11-03 so the Oct 26–30 2026 acceptance window is covered.
  const end = new Date('2026-11-03T21:00:00Z');
  /** @type {Date[]} */
  const sessionDates = [];
  const cursor = new Date(end);
  while (sessionDates.length < targetSessions) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) sessionDates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  sessionDates.reverse();

  const bars = [];
  let price = 400;
  for (let i = 0; i < sessionDates.length; i++) {
    const d = sessionDates[i];
    const drift = Math.sin(i / 18) * 4 + (i > targetSessions - 40 ? -0.15 : 0.05);
    const open = price;
    const close = price + drift + (i % 7 === 0 ? 2 : -0.5);
    const high = Math.max(open, close) + 1.2 + (i % 11 === 0 ? 3 : 0);
    const low = Math.min(open, close) - 1.1;
    const date = d.toISOString().slice(0, 10);
    bars.push({
      date,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: 50_000_000 + i * 1000,
      t: d.getTime(),
    });
    price = close;
  }

  // Plant one clean lower-high confirmation ending on the last bar.
  // Force consistent OHLC so swing detection is deterministic.
  const n = bars.length;
  const h1 = n - 12;
  const retest = n - 6;
  const last = n - 1;
  const base = bars[h1].close;

  setBar(bars[h1], {
    open: base,
    high: base + 10,
    low: base - 1,
    close: base + 2,
  });
  for (const j of [h1 - 2, h1 - 1, h1 + 1, h1 + 2]) {
    setBar(bars[j], {
      open: base,
      high: base + 6,
      low: base - 2,
      close: base,
    });
  }

  const retestHigh = base + 7; // lower than H1 high (base+10)
  const retestLow = retestHigh - 3;
  setBar(bars[retest], {
    open: retestHigh - 1,
    high: retestHigh,
    low: retestLow,
    close: retestHigh - 1.5,
  });
  // Neighbors: highs below retest, closes stay ABOVE retest low so only last bar confirms
  for (const j of [retest - 2, retest - 1, retest + 1, retest + 2]) {
    if (j === h1 || j === last) continue;
    setBar(bars[j], {
      open: retestLow + 2,
      high: retestHigh - 1.5,
      low: retestLow + 0.5,
      close: retestLow + 1.5,
    });
  }

  setBar(bars[last], {
    open: retestLow,
    high: retestLow + 0.4,
    low: retestLow - 2,
    close: retestLow - 1.5,
  });

  // Stamp last bar "now" so freshness checks pass offline
  const now = new Date();
  bars[last].date = now.toISOString().slice(0, 10);
  bars[last].t = now.getTime();

  return bars;
}

function setBar(bar, { open, high, low, close }) {
  bar.open = round2(open);
  bar.high = round2(high);
  bar.low = round2(low);
  bar.close = round2(close);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  loadDotEnv();
  mkdirSync(outDir, { recursive: true });

  let bars;
  let source;
  if (process.env.MASSIVE_API_KEY) {
    try {
      bars = await fetchDailyBars({
        ticker: 'SPY',
        // Skip freshness for fixture capture if market is closed long
        now: new Date(),
      });
      // Soften: if freshness would fail elsewhere, still save raw
      source = 'massive';
    } catch (e) {
      console.warn('Live fetch failed, using synthetic:', e.message);
      bars = synthesizeBars();
      source = 'synthetic';
    }
  } else {
    bars = synthesizeBars();
    source = 'synthetic';
  }

  const payload = {
    ticker: 'SPY',
    source,
    fetchedAt: new Date().toISOString(),
    bars,
  };
  const body = JSON.stringify(payload, null, 2);
  for (const outFile of outFiles) {
    writeFileSync(outFile, body);
    console.log(`Wrote ${bars.length} bars → ${outFile} (${source})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
