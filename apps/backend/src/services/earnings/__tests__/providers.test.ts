import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { adaptAlphaVantageCsv } from '../providers/alphaVantage.js';
import { adaptFinnhubPayload } from '../providers/finnhub.js';
import { mapHourToSession } from '../types.js';
import { extractEarningsDateFromText, extractFromArticles } from '../news.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const AV_CSV = readFileSync(resolve(__dirname, '../../../../fixtures/alphavantage_earnings_2026-09.csv'), 'utf-8');
const FINNHUB = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../fixtures/finnhub_earnings_2026-09.json'), 'utf-8')
);
const NEWS = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../fixtures/massive_news_avgo.json'), 'utf-8')
);

test('Alpha Vantage CSV maps reportDate and fiscal period; session stays unknown', () => {
  const rows = adaptAlphaVantageCsv(AV_CSV, '2026-09-01', '2026-09-22');
  const avgo = rows.find((r) => r.ticker === 'AVGO');
  assert.ok(avgo);
  assert.equal(avgo.date, '2026-09-02');
  assert.equal(avgo.session, 'unknown');
  assert.equal(avgo.source, 'alphavantage');
  assert.equal(avgo.fiscalYear, 2026);
  assert.equal(avgo.fiscalPeriod, 'Q3');
  const hpe = rows.find((r) => r.ticker === 'HPE');
  assert.ok(hpe);
  assert.equal(hpe.companyName, 'Hewlett Packard Enterprise, Inc.');
});

test('Finnhub hour bmo/amc maps; empty and dmh map to unknown', () => {
  const rows = adaptFinnhubPayload(FINNHUB, '2026-09-01', '2026-09-22');
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  assert.equal(byTicker.get('AVGO')?.session, 'amc');
  assert.equal(byTicker.get('DELL')?.session, 'amc');
  assert.equal(byTicker.get('PANW')?.session, 'unknown');
  assert.equal(byTicker.get('HPE')?.session, 'unknown');
  assert.equal(mapHourToSession(''), 'unknown');
  assert.equal(mapHourToSession('dmh'), 'unknown');
  assert.equal(mapHourToSession('bmo'), 'bmo');
});

test('news extractor reads the captured Massive AVGO articles and ignores Ciena', () => {
  const row = extractFromArticles('AVGO', NEWS.results, {
    companyName: 'Broadcom',
    horizonStart: '2026-09-01',
    horizonEnd: '2026-09-08',
  });
  assert.ok(row);
  assert.equal(row.date, '2026-09-02');
  assert.equal(row.source, 'news');
  assert.equal(row.confidence, 'inferred');
  const cien = extractEarningsDateFromText(
    "Ciena's Next Earnings Report on September 3 Could Send the Stock Soaring. Here's Why.",
    { ticker: 'AVGO', companyName: 'Broadcom', horizonStart: '2026-09-01', horizonEnd: '2026-09-08' }
  );
  assert.equal(cien, null);
});

test('news date without a year resolves against the horizon window', () => {
  const hit = extractEarningsDateFromText(
    'Broadcom is expected to report Q3 fiscal 2026 results on September 2',
    { ticker: 'AVGO', companyName: 'Broadcom', horizonStart: '2026-09-01', horizonEnd: '2026-09-08' }
  );
  assert.ok(hit);
  assert.equal(hit.date, '2026-09-02');
  assert.equal(hit.session, 'unknown');
});

console.log(`\n${passed} tests passed`);
