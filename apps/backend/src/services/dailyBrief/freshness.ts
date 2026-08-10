import { parseGeneratedAt } from '../briefShared/parseGeneratedAt.js';
import type { StoredDailyBrief } from './types.js';

/** Morning briefs should not send if older than ~36 hours. */
const MAX_AGE_MS = 36 * 60 * 60 * 1000;

export type FreshnessResult =
  | { ok: true }
  | { ok: false; reason: string };

export function checkArtifactFreshness(stored: StoredDailyBrief | null): FreshnessResult {
  if (!stored) {
    return { ok: false, reason: 'No daily brief artifact found' };
  }

  if (stored.data_stale) {
    return { ok: false, reason: 'Latest artifact is marked data_stale=true' };
  }

  if (!stored.generated_at) {
    return { ok: false, reason: 'Latest artifact has no generated_at timestamp' };
  }

  const generatedAt = parseGeneratedAt(stored.generated_at);
  if (Number.isNaN(generatedAt)) {
    return { ok: false, reason: `Invalid generated_at: ${stored.generated_at}` };
  }

  const ageMs = Date.now() - generatedAt;
  if (ageMs > MAX_AGE_MS) {
    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    return { ok: false, reason: `Artifact is ${hours} hours old (max 36 hours)` };
  }

  return { ok: true };
}
