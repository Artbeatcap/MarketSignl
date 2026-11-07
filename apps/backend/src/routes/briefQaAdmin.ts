import { Hono } from 'hono';
import { ingestReferenceNote, sendWeeklyQaReport } from '../lib/briefQaLive.js';

const referenceNotesRoute = new Hono();
const briefQaAdminRoute = new Hono();

function internalTokenOk(header: string | undefined): boolean {
  const expected = process.env.INTERNAL_INGEST_TOKEN;
  return !!expected && header === expected;
}

function cronOk(header: string | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  return !!expected && header === expected;
}

/** Transcripts land here from the Drive workflow. Service role only after this check. */
referenceNotesRoute.post('/', async (c) => {
  if (!internalTokenOk(c.req.header('x-internal-token'))) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  let body: {
    source?: unknown;
    published_date?: unknown;
    title?: unknown;
    url?: unknown;
    transcript?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const result = await ingestReferenceNote(body);
  if (!result.ok) return c.json({ success: false, error: result.error }, 400);
  return c.json({ success: true });
});

/** Sunday 6 PM ET internal summary. n8n calls this; the in-process cron is opt-in. */
briefQaAdminRoute.post('/weekly-report', async (c) => {
  if (!cronOk(c.req.header('x-cron-secret'))) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const result = await sendWeeklyQaReport();
  if (!result.ok) return c.json({ success: false, error: result.error }, 500);
  return c.json({ success: true });
});

export { referenceNotesRoute, briefQaAdminRoute };
