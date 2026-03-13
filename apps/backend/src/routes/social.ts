import { Hono } from 'hono';
import { generateSocialContent } from '../lib/socialContent.js';

const socialRoute = new Hono();

/**
 * POST /api/social/generate
 * Requires header: x-social-key: <SOCIAL_API_SECRET>
 * Body: { event: string, context?: string, tickers?: string[] }
 * Returns: { success: true, analysis, content } or { success: false, error }
 */
socialRoute.post('/generate', async (c) => {
  const secret = process.env.SOCIAL_API_SECRET;
  if (!secret) {
    return c.json({ success: false, error: 'Social API not configured' }, 503);
  }
  if (c.req.header('x-social-key') !== secret) {
    return c.json({ success: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await c.req.json() as { event?: string; context?: string; tickers?: string[] };

    if (!body.event) {
      return c.json({ success: false, error: 'event is required' }, 400);
    }

    const result = await generateSocialContent({
      event: body.event,
      context: body.context,
      tickers: body.tickers,
    });

    return c.json({
      success: true,
      analysis: result.analysis,
      content: result.content,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[SOCIAL] Generation error:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

export default socialRoute;
