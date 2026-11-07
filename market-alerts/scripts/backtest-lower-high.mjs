#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLowerHighs } from '../src/lowerHigh.mjs';
import { formatLowerHighMessage } from '../src/formatMessage.mjs';
import { printAcceptance } from '../src/acceptance.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dir, '..', 'fixtures', 'spy-daily.json');

if (!existsSync(fixturePath)) {
  console.error('Missing fixtures/spy-daily.json — run: node scripts/fetch-fixture.mjs');
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const bars = fixture.bars;
const ticker = fixture.ticker || 'SPY';

const all = detectLowerHighs(ticker, bars, { onlyLatest: false });
const latest = detectLowerHighs(ticker, bars, { onlyLatest: true });

console.log(`Bars: ${bars.length}`);
console.log(`Historical confirmations: ${all.length}`);
console.log(`Latest-bar signals: ${latest.length}`);

if (latest[0]) {
  console.log('--- sample Slack message ---');
  console.log(formatLowerHighMessage(latest[0]));
} else if (all[0]) {
  console.log('--- most recent historical (not today) ---');
  console.log(formatLowerHighMessage(all[all.length - 1]));
}

printAcceptance(ticker, bars, { from: '2026-10-26', to: '2026-10-30' });

if (all.length === 0) {
  console.warn('No setups found in fixture (ok for live SPY; synthetic fixture should find some).');
}
