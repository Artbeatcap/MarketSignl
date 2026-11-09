import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { MarketDataPoint } from '../lib/technicalCalculator.js';
import { runPrediction } from '../lib/runPrediction.js';
import { runAtlasAnalysis } from '../lib/runAtlasAnalysis.js';
import {
  GUEST_COOKIE_NAME,
  GUEST_LIMIT_MESSAGE,
  consumeGuestQuota,
  guestKeyFromCookie,
  guestRemaining,
  hashGuestIp,
  newGuestKey,
} from '../lib/guestUsage.js';
import { clientMessageForError } from '../lib/openaiGuard.js';

const analyzeGuestRoute = new Hono();

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return c.req.header('x-real-ip') || 'unknown';
}

function attachGuestCookie(c: Context, guestKey: string): void {
  const secure = (() => {
    try {
      return new URL(c.req.url).protocol === 'https:';
    } catch {
      return false;
    }
  })();
  setCookie(c, GUEST_COOKIE_NAME, guestKey, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 400,
  });
}

function resolveGuestIdentity(c: Context): { guestKey: string; ipHash: string | null; ip: string } {
  const existing = guestKeyFromCookie(getCookie(c, GUEST_COOKIE_NAME));
  const guestKey = existing ?? newGuestKey();
  const ip = clientIp(c);
  return { guestKey, ipHash: hashGuestIp(ip), ip };
}

analyzeGuestRoute.get('/', async (c) => {
  try {
    const identity = resolveGuestIdentity(c);
    attachGuestCookie(c, identity.guestKey);
    const remaining = await guestRemaining({
      guestKey: identity.guestKey,
      ipHash: identity.ipHash,
    });
    return c.json({ success: true, remaining });
  } catch (error) {
    console.error('[Guest] Status error:', error);
    return c.json({ success: false, error: 'Unable to check guest quota' }, 500);
  }
});

analyzeGuestRoute.post('/', async (c) => {
  try {
    const identity = resolveGuestIdentity(c);
    attachGuestCookie(c, identity.guestKey);

    const remaining = await guestRemaining({
      guestKey: identity.guestKey,
      ipHash: identity.ipHash,
    });
    if (remaining === 0) {
      return c.json({ success: false, error: GUEST_LIMIT_MESSAGE, remaining: 0 }, 429);
    }

    const body = await c.req.json();
    const { symbol, interval, data, freshness: rawFreshness } = body as {
      symbol: string;
      interval: string;
      data: MarketDataPoint[];
      freshness?: unknown;
    };

    if (!symbol || !interval || !Array.isArray(data) || data.length === 0) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const sliced = data.slice(-100);
    const predictionResult = await runPrediction({
      symbol,
      interval,
      data: sliced,
    });
    if (!predictionResult.ok) {
      return c.json(
        { success: false, error: predictionResult.error },
        predictionResult.status
      );
    }

    const analysisResult = await runAtlasAnalysis({
      symbol,
      interval,
      data: sliced,
      forecast: {
        direction: predictionResult.prediction.direction,
        confidence: predictionResult.prediction.confidence,
      },
      rawFreshness,
    });
    if (!analysisResult.ok) {
      return c.json(
        { success: false, error: analysisResult.error },
        analysisResult.status
      );
    }

    const ipHash = identity.ipHash ?? hashGuestIp(`cookie:${identity.guestKey}`) ?? identity.guestKey;
    await consumeGuestQuota({
      guestKey: identity.guestKey,
      ipHash,
    });

    return c.json({
      success: true,
      remaining: 0,
      prediction: predictionResult.prediction,
      analysis: analysisResult.analysis,
    });
  } catch (error) {
    console.error('[Guest] Analyze error:', error);
    const mapped = clientMessageForError(error);
    return c.json({ success: false, error: mapped.message }, mapped.status);
  }
});

export default analyzeGuestRoute;
