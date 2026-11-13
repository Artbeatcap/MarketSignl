import { Hono } from 'hono';
import { sanitizeDailySections } from '../../lib/briefSanitize.js';
import { consumeBriefPublicRateLimit } from '../../lib/briefPublicRateLimit.js';
import { easternDay } from './easternDay.js';
import type { BriefInAppDb } from './briefStore.js';
import type { DailyContent } from './types.js';

const HIDDEN = new Set(['promptVersion', 'schema_version', 'data_stale']);
const SOURCES = new Set(['push', 'email', 'tab', 'link']);

export interface PublicBriefDeps {
  db: () => BriefInAppDb;
  userFromAuthHeader: (header: string | undefined) => Promise<string | null>;
  now?: () => Date;
}

function clientIp(header: (name: string) => string | undefined): string {
  const forwarded = header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return header('x-real-ip') || 'unknown';
}

export function publicBriefContent(content: DailyContent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    if (HIDDEN.has(key)) continue;
    if (key === 'sections' && value && typeof value === 'object') {
      out[key] = sanitizeDailySections(value as DailyContent['sections']);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function registerPublicBriefRoutes(route: Hono, deps: PublicBriefDeps): void {
  route.get('/latest', async (c) => {
    const ip = clientIp((name) => c.req.header(name));
    if (!consumeBriefPublicRateLimit(ip).allowed) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    const row = await deps.db().getNewestPublished();
    if (!row) return c.json({ error: 'no_brief' }, 404);
    const now = deps.now?.() ?? new Date();
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({
      asOf: row.as_of,
      edition: row.edition,
      publishedAt: row.published_at,
      complete: row.complete,
      isToday: easternDay(now.getTime()) === row.as_of,
      content: publicBriefContent(row.content),
    });
  });

  route.post('/opened', async (c) => {
    const ip = clientIp((name) => c.req.header(name));
    if (!consumeBriefPublicRateLimit(ip).allowed) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    let body: { asOf?: unknown; source?: unknown; platform?: unknown } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      console.error(JSON.stringify({ event: 'brief_open', status: 'bad_json' }));
      return c.body(null, 204);
    }
    const asOf = typeof body.asOf === 'string' ? body.asOf : '';
    const source = typeof body.source === 'string' ? body.source : '';
    const platform = typeof body.platform === 'string' ? body.platform.slice(0, 32) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !SOURCES.has(source)) {
      console.error(JSON.stringify({ event: 'brief_open', status: 'rejected', asOf, source }));
      return c.body(null, 204);
    }
    let userId: string | null = null;
    try {
      userId = await deps.userFromAuthHeader(c.req.header('Authorization'));
    } catch (err) {
      console.error('[brief_open] auth lookup failed', err);
    }
    try {
      await deps.db().insertOpen({
        userId,
        asOf,
        source: source as 'push' | 'email' | 'tab' | 'link',
        platform,
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'brief_open',
          status: 'insert_failed',
          asOf,
          source,
          message: err instanceof Error ? err.message : String(err),
        })
      );
    }
    return c.body(null, 204);
  });
}
