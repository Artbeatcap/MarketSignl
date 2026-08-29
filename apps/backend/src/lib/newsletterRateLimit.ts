type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;

const hits = new Map<string, Bucket>();

export function resetNewsletterRateLimitForTests(): void {
  hits.clear();
}

export function consumeNewsletterRateLimit(
  ip: string,
  now = Date.now()
): { allowed: boolean; remaining: number } {
  const key = ip || 'unknown';
  const existing = hits.get(key);

  if (!existing || now >= existing.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    prune(now);
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  if (existing.count >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }

  existing.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - existing.count };
}

function prune(now: number): void {
  if (hits.size < 500) return;
  for (const [key, bucket] of hits) {
    if (now >= bucket.resetAt) hits.delete(key);
  }
}
