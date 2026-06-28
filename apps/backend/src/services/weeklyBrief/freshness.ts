import type { StoredWeeklyBrief } from './types.js';

const MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

export type FreshnessResult =
  | { ok: true }
  | { ok: false; reason: string };

export function checkArtifactFreshness(stored: StoredWeeklyBrief | null): FreshnessResult {
  if (!stored) {
    return { ok: false, reason: 'No weekly brief artifact found' };
  }

  if (stored.data_stale) {
    return { ok: false, reason: 'Latest artifact is marked data_stale=true' };
  }

  if (!stored.generated_at) {
    return { ok: false, reason: 'Latest artifact has no generated_at timestamp' };
  }

  const generatedAt = Date.parse(stored.generated_at);
  if (Number.isNaN(generatedAt)) {
    return { ok: false, reason: `Invalid generated_at: ${stored.generated_at}` };
  }

  const ageMs = Date.now() - generatedAt;
  if (ageMs > MAX_AGE_MS) {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    return { ok: false, reason: `Artifact is ${days} days old (max 8 days)` };
  }

  return { ok: true };
}
