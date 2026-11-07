/**
 * Keeps Atlas from surfacing OpenAI billing failures and from calling the API
 * again while the key has no credits, or when a fresh result already exists.
 */

export const ATLAS_UNAVAILABLE_MESSAGE =
  'Atlas is temporarily unavailable. The chart and levels still work.';

/** How long a symbol/timeframe result can be reused without another OpenAI call. */
export const ATLAS_CACHE_TTL_MS = 15 * 60 * 1000;

/** How long to skip OpenAI after a credits/quota or invalid-key failure. */
export const ATLAS_PAUSE_MS = 15 * 60 * 1000;

const CACHE_MAX = 200;

type CacheEntry = { expiresAt: number; value: unknown };

let pausedUntil = 0;
const cache = new Map<string, CacheEntry>();

export function isInsufficientQuota(error: unknown): boolean {
  if (typeof error === 'string') return quotaText(error);
  if (!error || typeof error !== 'object') return false;

  const e = error as {
    code?: string | null;
    type?: string;
    message?: string;
    error?: { code?: string | null; type?: string; message?: string };
  };
  const code = e.code ?? e.error?.code;
  const type = e.type ?? e.error?.type;
  if (code === 'insufficient_quota' || type === 'insufficient_quota') return true;
  return quotaText(e.message ?? e.error?.message ?? '');
}

function quotaText(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('no credits remaining') ||
    text.includes('insufficient_quota') ||
    text.includes('exceeded your current quota') ||
    text.includes('platform.openai.com/settings/organization/billing')
  );
}

/** A revoked, mistyped or unauthorized key. Retrying cannot succeed until the key is replaced. */
export function isInvalidApiKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; code?: string | null; error?: { code?: string | null }; message?: string };
  const code = e.code ?? e.error?.code;
  if (code === 'invalid_api_key') return true;
  if (e.status === 401) return true;
  return /incorrect api key provided/i.test(e.message ?? '');
}

export function noteQuotaExhausted(now = Date.now()): void {
  pauseAtlas('OpenAI credits exhausted', now);
}

export function noteInvalidApiKey(now = Date.now()): void {
  pauseAtlas('OpenAI rejected OPENAI_API_KEY (invalid_api_key); replace the key in the server .env and recreate chartsignl-api', now);
}

function pauseAtlas(reason: string, now: number): void {
  const wasOpen = now < pausedUntil;
  pausedUntil = Math.max(pausedUntil, now + ATLAS_PAUSE_MS);
  if (!wasOpen) {
    console.error(`[Atlas] ${reason}; pausing new Atlas calls for ${ATLAS_PAUSE_MS / 60000} minutes`);
  }
}

/** Returns true (and pauses Atlas) when the error means OpenAI cannot serve this key right now. */
export function handleOpenAIAccountFailure(error: unknown): boolean {
  if (isInsufficientQuota(error)) {
    noteQuotaExhausted();
    return true;
  }
  if (isInvalidApiKey(error)) {
    noteInvalidApiKey();
    return true;
  }
  return false;
}

export function isAtlasPaused(now = Date.now()): boolean {
  return now < pausedUntil;
}

export function atlasUnavailable(): { ok: false; error: string; status: 503 } {
  return { ok: false, error: ATLAS_UNAVAILABLE_MESSAGE, status: 503 };
}

export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/** Raw error text can carry provider messages, masked keys or URLs, so callers log it and users get a fixed message. */
export function clientMessageForError(error: unknown): { message: string; status: 500 | 503 } {
  if (handleOpenAIAccountFailure(error)) {
    return { message: ATLAS_UNAVAILABLE_MESSAGE, status: 503 };
  }
  return { message: GENERIC_ERROR_MESSAGE, status: 500 };
}

export function atlasCacheKey(parts: {
  kind: 'prediction' | 'analysis';
  symbol: string;
  interval: string;
  forecast?: { direction: string; confidence: number } | null;
}): string {
  const symbol = parts.symbol.trim().toUpperCase();
  const forecast = parts.forecast
    ? `${parts.forecast.direction}:${Math.round(parts.forecast.confidence)}`
    : '';
  return `${parts.kind}|${symbol}|${parts.interval}|${forecast}`;
}

export function readAtlasCache<T>(key: string, now = Date.now()): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return structuredClone(hit.value) as T;
}

export function writeAtlasCache(key: string, value: unknown, now = Date.now()): void {
  cache.set(key, { expiresAt: now + ATLAS_CACHE_TTL_MS, value: structuredClone(value) });
  if (cache.size <= CACHE_MAX) return;
  for (const [entryKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(entryKey);
  }
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function resetAtlasGuardForTests(): void {
  pausedUntil = 0;
  cache.clear();
}
