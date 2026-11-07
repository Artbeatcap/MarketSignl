import assert from 'node:assert/strict';
import { calculateOverextension, calculateAllIndicators, type MarketDataPoint } from '../technicalCalculator.js';
import { computeMarketContext, contextCutoff, loadMarketContext } from '../marketContext.js';
import { buildAnalysisGuide, describeOverextension, formatMarketContext } from '../analysisGuide.js';
import { scoreLevels } from '../confluenceScorer.js';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn(); passed++; console.log(`  ✓ ${name}`);
}
function series(slope: number): MarketDataPoint[] {
  const out: MarketDataPoint[] = [];
  for (let ms = Date.parse('2025-01-02T12:00:00Z'); out.length < 220; ms += 86_400_000) {
    const day = new Date(ms).getUTCDay();
    if (day === 0 || day === 6) continue;
    const close = 300 + slope * out.length;
    out.push({ timestamp: ms, date: new Date(ms).toISOString().slice(0, 10), open: close, high: close + 2, low: close - 2, close, volume: 100 });
  }
  return out;
}
const benchmarks = { SMH: series(-0.5), QQQ: series(0.2), RSP: series(0.1) };
const cutoff = benchmarks.QQQ.at(-1)!.date;
const breakdown = computeMarketContext(benchmarks, cutoff);

await test('declining semiconductor leadership plus 200-session break triggers experimental context', () => {
  assert.equal(breakdown.status, 'available');
  if (breakdown.status !== 'available') throw new Error('expected context');
  assert.equal(breakdown.regime, 'factor_breakdown');
  assert.equal(breakdown.smhAbove200, false);
  assert.ok(breakdown.smhQqqSlope20 < 0);
});
await test('supportive benchmarks do not imply a win probability', () => {
  const result = computeMarketContext({ ...benchmarks, SMH: series(0.7) }, cutoff);
  assert.equal(result.status === 'available' && result.regime, 'risk_on');
  assert.match(formatMarketContext(result), /experimental/);
});
await test('distribution volume excludes the event bar from its baseline', () => {
  const input = structuredClone({ ...benchmarks, SMH: series(0.1), QQQ: series(0.3) });
  const last = input.QQQ.at(-1)!;
  last.low = last.close; last.volume = 200;
  const result = computeMarketContext(input, cutoff);
  assert.ok(result.status === 'available' && result.qqqDistributionDay);
  assert.equal(result.status === 'available' && result.qqqVolumeMultiple, 2);
});
await test('below-average stretch in a downtrend is not a mean-reversion signal', () => {
  for (const trendDirection of ['downtrend', 'strong_downtrend', 'weak_downtrend'] as const) {
    const result = calculateOverextension(95, 100, 2, { trendDirection });
    assert.equal(result.signalType, 'extended_in_downtrend');
    assert.equal(result.meanReversionSignal, false);
    assert.doesNotMatch(describeOverextension(result), /high probability|mean reversion is likely/i);
  }
});
await test('factor breakdown guards a dip even if its own trend is upward', () => {
  assert.equal(calculateOverextension(95, 100, 2, { trendDirection: 'uptrend', regime: 'factor_breakdown' }).signalType, 'extended_in_downtrend');
});
await test('uptrend dip without adverse context preserves its existing candidate classification', () => {
  const result = calculateOverextension(95, 100, 2, { trendDirection: 'uptrend', regime: 'risk_on' });
  assert.equal(result.signalType, 'reversal_candidate');
  assert.doesNotMatch(describeOverextension(result), /high probability|mean reversion is likely/i);
});
await test('normal prices and above-average extension are not mislabeled as falling', () => {
  assert.equal(calculateOverextension(99, 100, 2, { trendDirection: 'downtrend' }).signalType, 'none');
  assert.equal(calculateOverextension(105, 100, 2, { trendDirection: 'downtrend' }).signalType, 'reversal_candidate');
});
await test('unavailable context suppresses an unverified dip signal explicitly', () => {
  const result = calculateOverextension(95, 100, 2, { trendDirection: 'uptrend', regime: 'unavailable' });
  assert.equal(result.signalType, 'context_unavailable');
  assert.equal(result.meanReversionSignal, false);
});
await test('insufficient, misaligned and stale histories are rejected', () => {
  assert.throws(() => computeMarketContext({ ...benchmarks, SMH: benchmarks.SMH.slice(-199) }, cutoff), /insufficient/);
  assert.throws(() => computeMarketContext({ ...benchmarks, SMH: benchmarks.SMH.slice(0, -1) }, cutoff), /unaligned/);
  assert.throws(() => computeMarketContext(benchmarks, '2026-01-01'), /stale/);
});
await test('invalid OHLC and duplicate sessions cannot produce a healthy regime', () => {
  const invalid = structuredClone(benchmarks);
  invalid.SMH.at(-1)!.close = Number.NaN;
  assert.throws(() => computeMarketContext(invalid, cutoff), /invalid/);
  invalid.SMH = [...benchmarks.SMH, benchmarks.SMH.at(-1)!];
  assert.throws(() => computeMarketContext(invalid, cutoff), /invalid/);
});
await test('future sessions cannot affect a historical context', () => {
  const input = structuredClone(benchmarks);
  input.SMH.push({ ...input.SMH.at(-1)!, timestamp: Date.parse('2026-01-02T12:00:00Z'), close: 10000 });
  assert.deepEqual(computeMarketContext(input, cutoff), breakdown);
  assert.equal(contextCutoff(Date.parse('2026-11-06T15:00:00Z')), '2026-11-05');
});
await test('provider failure is visible and never becomes neutral', async () => {
  const result = await loadMarketContext(Date.parse('2026-11-06T15:00:00Z'), async () => { throw new Error('provider unavailable'); });
  assert.equal(result.status, 'unavailable');
  assert.match(formatMarketContext(result), /Market context unavailable/);
});
await test('customer guide contains concrete levels, invalidation, return reason and score meaning', () => {
  const indicators = calculateAllIndicators(series(-0.5), 'MU', '3mo', 'factor_breakdown')!;
  const guide = buildAnalysisGuide(indicators, scoreLevels(indicators), breakdown);
  assert.ok(guide.whatIsHappening && guide.marketContext && guide.whatToWatch.length);
  assert.match(guide.whenToReassess, /completed chart bar/);
  assert.match(guide.scoreMeaning, /not the probability/);
  assert.match(guide.marketContext, /experimental/);
});

await test('Atlas wiring guards model prose and long ideas, includes context, and keys cache by bars', async () => {
  const savedKey = process.env.OPENAI_API_KEY;
  const savedMassive = process.env.MASSIVE_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.MASSIVE_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  const { Completions } = await import('openai/resources/chat/completions');
  const originalCreate = Completions.prototype.create;
  let prompt = '';
  Completions.prototype.create = (async (body: { messages: Array<{ content: string }> }) => {
    prompt = body.messages.map((m) => m.content).join('\n');
    return { choices: [{ message: { content: JSON.stringify({
      headline: 'High probability of reversal', summary: 'Mean reversion is likely.',
      keyObservations: ['Buy the decline'], riskFactors: [],
      tradeIdeas: [{ direction: 'long', scenario: 'Buy the dip', confidence: 90, invalidation: 'Lower close' }],
    }) } }] };
  }) as unknown as typeof originalCreate;
  const benchmarkRequests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (request: string | URL | Request, init?: RequestInit) => {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    if (url.includes('/aggs/ticker/')) {
      benchmarkRequests.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      const ticker = /ticker\/([^/]+)/.exec(url)![1] as keyof typeof benchmarks;
      return new Response(JSON.stringify({ results: benchmarks[ticker].map((bar) => ({ t: bar.timestamp, o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: bar.volume })) }));
    }
    throw new Error(`Unexpected request in offline test: ${new URL(url).hostname}`);
  }) as typeof fetch;
  try {
    const { runAtlasAnalysis, atlasAnalysisCacheKey } = await import('../runAtlasAnalysis.js');
    const data = series(-0.5);
    // The chart's newest session is one day after the last benchmark observation.
    data.push({ ...data.at(-1)!, timestamp: data.at(-1)!.timestamp + 86_400_000, close: 180, low: 178, high: 200, open: 190 });
    const input = { symbol: 'MU', interval: '3mo', data };
    const result = await runAtlasAnalysis(input);
    assert.ok(result.ok);
    assert.equal(result.analysis.marketContext?.status, 'available');
    assert.equal(result.analysis.overextension.signal, 'extended_in_downtrend');
    assert.equal(result.analysis.tradeIdeas.length, 0);
    assert.doesNotMatch(result.analysis.summary, /high probability|mean reversion is likely/i);
    assert.ok(result.analysis.guide);
    assert.match(prompt, /MARKET CONTEXT/);
    assert.match(prompt, /Reversal guard: ACTIVE/);
    assert.doesNotMatch(prompt, /\(\d{4,}% strength\)/);
    assert.doesNotMatch(prompt, /â€|Ã|Â/, 'prompt text must not contain mis-encoded characters');
    assert.notEqual(atlasAnalysisCacheKey(input), atlasAnalysisCacheKey({ ...input, data: data.slice(0, -1) }));
    assert.ok(benchmarkRequests.length >= 3);
    for (const req of benchmarkRequests) {
      assert.match(req.url, /[?&]apiKey=test-key(&|$)/, 'benchmark fetch must use the same apiKey auth as marketDataFetcher');
      assert.equal(req.authorization, null);
    }

    // Outage: symbols outside the semiconductor scope keep their normal classification.
    globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch;
    // Shifted a week so the context cache from the run above cannot answer.
    const uptrendDip = series(0.5).map((bar) => ({ ...bar, timestamp: bar.timestamp + 7 * 86_400_000 }));
    const lastClose = uptrendDip.at(-1)!.close;
    uptrendDip.push({ ...uptrendDip.at(-1)!, timestamp: uptrendDip.at(-1)!.timestamp + 86_400_000, open: lastClose, high: lastClose, low: lastClose - 25, close: lastClose - 24 });
    const aapl = await runAtlasAnalysis({ symbol: 'AAPL', interval: '6mo', data: uptrendDip });
    const mu = await runAtlasAnalysis({ symbol: 'MU', interval: '6mo', data: uptrendDip });
    assert.ok(aapl.ok && mu.ok);
    if (!aapl.ok || !mu.ok) throw new Error('expected analyses');
    assert.equal(aapl.analysis.marketContext?.status, 'unavailable');
    assert.notEqual(aapl.analysis.overextension.signal, 'context_unavailable');
    assert.ok(!aapl.analysis.riskFactors.some((r) => /Market context unavailable/.test(r)));
    assert.equal(mu.analysis.overextension.signal, 'context_unavailable');

    // Missing fields are tolerated; malformed output is a clean error, not an exception.
    const shifted = (days: number) => uptrendDip.map((bar) => ({ ...bar, timestamp: bar.timestamp + days * 86_400_000 }));
    Completions.prototype.create = (async () => ({ choices: [{ message: { content: '{"headline":"Levels in focus"}' } }] })) as unknown as typeof originalCreate;
    const sparse = await runAtlasAnalysis({ symbol: 'AAPL', interval: '6mo', data: shifted(1) });
    assert.ok(sparse.ok);
    assert.deepEqual(sparse.analysis.riskFactors, []);
    Completions.prototype.create = (async () => ({ choices: [{ message: { content: '{"tradeIdeas":"buy"}' } }] })) as unknown as typeof originalCreate;
    const malformed = await runAtlasAnalysis({ symbol: 'AAPL', interval: '6mo', data: shifted(2) });
    assert.equal(malformed.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    Completions.prototype.create = originalCreate;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
    if (savedMassive === undefined) delete process.env.MASSIVE_API_KEY; else process.env.MASSIVE_API_KEY = savedMassive;
  }
});

console.log(`\n${passed} market-context and clarity tests passed`);
