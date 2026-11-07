/**
 * Atlas OpenAI quota guard: friendly errors, pause, and short-window reuse.
 * Run: npx tsx apps/backend/src/lib/__tests__/openaiGuard.test.ts
 */
import assert from 'node:assert/strict';
import {
  ATLAS_CACHE_TTL_MS,
  ATLAS_PAUSE_MS,
  ATLAS_UNAVAILABLE_MESSAGE,
  GENERIC_ERROR_MESSAGE,
  atlasCacheKey,
  clientMessageForError,
  isAtlasPaused,
  isInsufficientQuota,
  isInvalidApiKey,
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

const invalidKeyMessage =
  '401 Incorrect API key provided: sk-proj-****V7UA. You can find your API key at https://platform.openai.com/account/api-keys.';

function invalidKeyError(): Error {
  return Object.assign(new Error(invalidKeyMessage), { status: 401, code: 'invalid_api_key', type: 'invalid_request_error' });
}

await test('an invalid API key gets the Atlas notice, never the key or OpenAI text, and pauses calls', () => {
  assert.equal(isInvalidApiKey(invalidKeyError()), true);
  assert.equal(isInvalidApiKey(new Error('429 Rate limit reached')), false);
  const mapped = clientMessageForError(invalidKeyError());
  assert.equal(mapped.status, 503);
  assert.equal(mapped.message, ATLAS_UNAVAILABLE_MESSAGE);
  assert.doesNotMatch(mapped.message, /sk-|V7UA|openai\.com|401/);
  assert.equal(isAtlasPaused(), true);
});

await test('any other error shows a generic message instead of its raw text', () => {
  const mapped = clientMessageForError(new Error('Massive API error: 500 https://api.massive.com/v2/aggs?apiKey=secret'));
  assert.equal(mapped.status, 500);
  assert.equal(mapped.message, GENERIC_ERROR_MESSAGE);
  assert.equal(isAtlasPaused(), false);
});

await test('analysis and prediction return the Atlas notice when OpenAI rejects the key', async () => {
  const { Completions } = await import('openai/resources/chat/completions');
  const originalCreate = Completions.prototype.create;
  Completions.prototype.create = (async () => { throw invalidKeyError(); }) as unknown as typeof originalCreate;
  try {
    const { runPrediction } = await import('../runPrediction.js');
    const { runAtlasAnalysis } = await import('../runAtlasAnalysis.js');
    const bars = Array.from({ length: 60 }, (_, i) => ({
      timestamp: Date.parse('2026-08-03T16:00:00Z') + i * 86_400_000, date: '', open: 100 + i, high: 102 + i, low: 98 + i, close: 100 + i, volume: 1000,
    }));
    const prediction = await runPrediction({ symbol: 'AMZN', interval: '3mo', data: bars });
    resetAtlasGuardForTests();
    const analysis = await runAtlasAnalysis({ symbol: 'AMZN', interval: '3mo', data: bars });
    for (const result of [prediction, analysis]) {
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error, ATLAS_UNAVAILABLE_MESSAGE);
        assert.equal(result.status, 503);
      }
    }
  } finally {
    Completions.prototype.create = originalCreate;
  }
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
  const { runAtlasAnalysis, atlasAnalysisCacheKey } = await import('../runAtlasAnalysis.js');
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

  const analysisKey = atlasAnalysisCacheKey({
    data: [bar],
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
