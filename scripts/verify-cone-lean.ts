/**
 * Verify deriveDriftBias field paths and cone lean on a trending ticker.
 * Run: npx tsx scripts/verify-cone-lean.ts
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { calculateAllIndicators } from '../apps/backend/src/lib/technicalCalculator.js';
import { buildVolatilityCone, deriveDriftBias } from '../apps/backend/src/lib/volatilityCone.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/backend/.env') });

const API_URL = process.env.API_URL || 'http://localhost:4000';
const SYMBOL = process.env.CONE_VERIFY_SYMBOL || 'NVDA';

async function main() {
  const mdRes = await fetch(`${API_URL}/api/market-data/${SYMBOL}?interval=3mo`);
  if (!mdRes.ok) {
    console.error('FAIL fetch market data:', mdRes.status);
    process.exit(1);
  }
  const md = await mdRes.json();
  const data = md.data ?? [];
  if (data.length < 20) {
    console.error('FAIL insufficient bars');
    process.exit(1);
  }

  const indicators = calculateAllIndicators(data, SYMBOL, '3mo');
  if (!indicators) {
    console.error('FAIL calculateAllIndicators returned null');
    process.exit(1);
  }

  const bias = deriveDriftBias(indicators);
  const lastClose = indicators.currentPrice;
  const lastTs = data[data.length - 1].timestamp;
  const stepMs = 24 * 60 * 60 * 1000;
  const horizonBars = 10;

  const { projectedPath, expectedChangePct } = buildVolatilityCone({
    lastClose,
    atr: indicators.atr.atr,
    driftBias: bias,
    horizonBars,
    stepMs,
    lastTimestamp: lastTs,
  });

  const first = projectedPath[0].price;
  const last = projectedPath[projectedPath.length - 1].price;
  const leanUp = last > first;
  const leanDown = last < first;

  console.log('Cone lean check:', {
    symbol: SYMBOL,
    emaAlignment: indicators.trend.emaAlignment,
    atrNormalizedDistance: indicators.overextension.atrNormalizedDistance,
    driftBias: bias,
    lastClose,
    firstFuture: first,
    lastFuture: last,
    expectedChangePct,
    trendDirection: indicators.trend.direction,
  });

  if (bias === 0) {
    console.warn('WARN driftBias is exactly 0 — check field paths or mixed alignment');
  }

  const bullishAlign =
    indicators.trend.emaAlignment === 'perfectly_bullish' ||
    indicators.trend.emaAlignment === 'mostly_bullish';

  if (bullishAlign && bias > 0 && !leanUp) {
    console.error('FAIL bullish alignment but cone does not lean up');
    process.exit(1);
  }

  if (bullishAlign && bias === 0) {
    console.error('FAIL bullish emaAlignment but driftBias is 0 (silent flat bug)');
    process.exit(1);
  }

  if (Math.abs(bias) > 0.01 && Math.abs(last - first) < 0.001) {
    console.error('FAIL non-zero bias but flat cone');
    process.exit(1);
  }

  console.log('OK cone lean verified');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
