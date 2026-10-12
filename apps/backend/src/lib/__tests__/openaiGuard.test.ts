/**
 * Atlas OpenAI quota guard: friendly errors, pause, and short-window reuse.
 * Run: npx tsx apps/backend/src/lib/__tests__/openaiGuard.test.ts
 */
import assert from 'node:assert/strict';
import {
  ATLAS_CACHE_TTL_MS,
  ATLAS_PAUSE_MS,
  ATLAS_UNAVAILABLE_MESSAGE,
  atlasCacheKey,
  clientMessageForError,
  isAtlasPaused,
  isInsufficientQuota,
  noteQuotaExhausted,
  readAtlasCache,
  resetAtlasGuardForTests,
  writeAtlasCache,
} from '../openaiGuard.js';

process.env.OPENAI_API_KEY ||= 'sk-test';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  resetAtlasGuardForTests();
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const billingMessage =
  '429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.';

function quotaError(): Error {
  return Object.assign(new Error(billingMessage), {
    status: 429,
    code: 'insufficient_quota',
    type: 'insufficient_quota',
  });
}

await test('detects the OpenAI no-credits error and ignores a normal rate limit', () => {
  assert.equal(isInsufficientQuota(quotaError()), true);
  assert.equal(isInsufficientQuota(new Error(billingMessage)), true);
  assert.equal(
    isInsufficientQuota(
      Object.assign(new Error('429 Rate limit reached'), {
        status: 429,
        code: 'rate_limit_exceeded',
      })
    ),
    false
  );
  assert.equal(isInsufficientQuota(new Error('Free tier limit reached')), false);
});

await test('replaces the billing message with a short Atlas notice', () => {
  const mapped = clientMessageForError(quotaError());
  assert.equal(mapped.status, 503);
  assert.equal(mapped.message, ATLAS_UNAVAILABLE_MESSAGE);
  assert.equal(mapped.message.includes('openai.com'), false);
  assert.equal(mapped.message.includes('429'), false);
});

await test('pauses further Atlas calls after a credit failure, then resumes', () => {
  const start = 1_000_000;
  noteQuotaExhausted(start);
  assert.equal(isAtlasPaused(start + ATLAS_PAUSE_MS - 1), true);
  assert.equal(isAtlasPaused(start + ATLAS_PAUSE_MS), false);
});

await test('reuses a symbol and timeframe only inside the window', () => {
  const key = atlasCacheKey({ kind: 'prediction', symbol: ' aapl ', interval: '3mo' });
  assert.equal(key, atlasCacheKey({ kind: 'prediction', symbol: 'AAPL', interval: '3mo' }));
  assert.notEqual(key, atlasCacheKey({ kind: 'prediction', symbol: 'MSFT', interval: '3mo' }));
  assert.notEqual(key, atlasCacheKey({ kind: 'prediction', symbol: 'AAPL', interval: '1d' }));
  assert.notEqual(
    atlasCacheKey({
      kind: 'analysis',
      symbol: 'AAPL',
      interval: '3mo',
      forecast: { direction: 'bullish', confidence: 80.4 },
    }),
    atlasCacheKey({
      kind: 'analysis',
      symbol: 'AAPL',
      interval: '3mo',
      forecast: { direction: 'bearish', confidence: 80 },
    })
  );

  writeAtlasCache(key, { headline: 'cached' }, 0);
  const hit = readAtlasCache<{ headline: string }>(key, ATLAS_CACHE_TTL_MS - 1);
  assert.ok(hit);
  hit.headline = 'mutated';
  assert.equal(readAtlasCache<{ headline: string }>(key, ATLAS_CACHE_TTL_MS - 1)?.headline, 'cached');
  assert.equal(readAtlasCache(key, ATLAS_CACHE_TTL_MS), null);
});

await test('prediction and analysis skip OpenAI when a recent result exists or credits are paused', async () => {
  const { runPrediction } = await import('../runPrediction.js');
  const { runAtlasAnalysis } = await import('../runAtlasAnalysis.js');
  const bar = {
    timestamp: Date.now(),
    date: '2026-10-12',
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  };

  const predictionKey = atlasCacheKey({ kind: 'prediction', symbol: 'AAPL', interval: '3mo' });
  writeAtlasCache(predictionKey, {
    ok: true,
    prediction: { symbol: 'AAPL', headline: 'cached forecast' },
    currentPrice: 100,
  });
  const prediction = await runPrediction({ symbol: 'aapl', interval: '3mo', data: [bar] });
  assert.equal(prediction.ok, true);
  if (prediction.ok) assert.equal(prediction.prediction.headline, 'cached forecast');

  const analysisKey = atlasCacheKey({
    kind: 'analysis',
    symbol: 'AAPL',
    interval: '3mo',
    forecast: { direction: 'bullish', confidence: 70 },
  });
  writeAtlasCache(analysisKey, {
    ok: true,
    analysis: { symbol: 'AAPL', headline: 'cached levels' },
  });
  const analysis = await runAtlasAnalysis({
    symbol: 'AAPL',
    interval: '3mo',
    data: [bar],
    forecast: { direction: 'bullish', confidence: 70 },
  });
  assert.equal(analysis.ok, true);
  if (analysis.ok) assert.equal(analysis.analysis.headline, 'cached levels');

  resetAtlasGuardForTests();
  noteQuotaExhausted();
  const pausedPrediction = await runPrediction({ symbol: 'MSFT', interval: '1d', data: [bar] });
  const pausedAnalysis = await runAtlasAnalysis({ symbol: 'MSFT', interval: '1d', data: [bar] });
  assert.equal(pausedPrediction.ok, false);
  assert.equal(pausedAnalysis.ok, false);
  if (!pausedPrediction.ok && !pausedAnalysis.ok) {
    assert.equal(pausedPrediction.error, ATLAS_UNAVAILABLE_MESSAGE);
    assert.equal(pausedPrediction.status, 503);
    assert.equal(pausedAnalysis.error, ATLAS_UNAVAILABLE_MESSAGE);
    assert.equal(pausedAnalysis.error.includes('openai.com'), false);
  }
});

console.log(`\n${passed} tests passed`);
