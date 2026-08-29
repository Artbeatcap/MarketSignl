import { createHmac, timingSafeEqual } from 'crypto';

const MAX_AGE_SECONDS = 5 * 60;

/**
 * Verify a Resend (Svix) webhook signature.
 * Secret is the `whsec_...` value from the Resend dashboard.
 */
export function verifyResendWebhookSignature(input: {
  payload: string;
  secret: string;
  svixId: string | undefined;
  svixTimestamp: string | undefined;
  svixSignature: string | undefined;
  nowMs?: number;
}): boolean {
  const { payload, secret, svixId, svixTimestamp, svixSignature } = input;
  if (!payload || !secret || !svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  const timestamp = Number(svixTimestamp);
  if (!Number.isFinite(timestamp)) return false;

  const nowMs = input.nowMs ?? Date.now();
  if (Math.abs(nowMs / 1000 - timestamp) > MAX_AGE_SECONDS) {
    return false;
  }

  const secretPart = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(secretPart, 'base64');
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expected = createHmac('sha256', key).update(signedContent).digest('base64');
  const expectedBuf = Buffer.from(expected, 'utf8');

  const signatures = svixSignature
    .split(' ')
    .map((part) => {
      const [version, value] = part.split(',', 2);
      return version === 'v1' ? value : null;
    })
    .filter((value): value is string => !!value);

  for (const sig of signatures) {
    const sigBuf = Buffer.from(sig, 'utf8');
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }

  return false;
}

export interface ResendWebhookEvent {
  type?: string;
  data?: {
    to?: string[];
    bounce?: { type?: string };
  };
}

export function parseResendWebhookPayload(raw: string): ResendWebhookEvent | null {
  try {
    const parsed = JSON.parse(raw) as ResendWebhookEvent;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}
