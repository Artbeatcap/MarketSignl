import { EventWebhook } from '@sendgrid/eventwebhook';
import type { SendGridEvent } from './newsletter.js';

export const SENDGRID_SIGNATURE_HEADER = 'X-Twilio-Email-Event-Webhook-Signature';
export const SENDGRID_TIMESTAMP_HEADER = 'X-Twilio-Email-Event-Webhook-Timestamp';

export type SendGridVerifier = (
  publicKey: string,
  payload: string,
  signature: string | undefined,
  timestamp: string | undefined
) => boolean;

function toPem(publicKey: string): string {
  const trimmed = publicKey.trim().replace(/\\n/g, '\n');
  if (trimmed.includes('BEGIN PUBLIC KEY')) return trimmed;
  const body = trimmed.replace(/\s+/g, '');
  if (!body) return trimmed;
  const lines = body.match(/.{1,64}/g)?.join('\n') ?? body;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

function defaultVerify(
  publicKey: string,
  payload: string,
  signature: string | undefined,
  timestamp: string | undefined
): boolean {
  if (!publicKey || !payload || !signature || !timestamp) return false;
  try {
    const webhook = new EventWebhook();
    const ecdsaKey = webhook.convertPublicKeyToECDSA(toPem(publicKey));
    return webhook.verifySignature(ecdsaKey, payload, signature, timestamp);
  } catch {
    return false;
  }
}

let verifyImpl: SendGridVerifier = defaultVerify;

export function setSendGridWebhookVerifierForTests(next: SendGridVerifier | null): void {
  verifyImpl = next ?? defaultVerify;
}

/**
 * Verify a SendGrid Event Webhook signature (ECDSA).
 * Must be called with the raw request body — JSON.parse + stringify will fail.
 */
export function verifySendGridWebhookSignature(
  publicKey: string,
  payload: string,
  signature: string | undefined,
  timestamp: string | undefined
): boolean {
  return verifyImpl(publicKey, payload, signature, timestamp);
}

export function parseSendGridWebhookPayload(raw: string): SendGridEvent[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as SendGridEvent[];
  } catch {
    return null;
  }
}

/** True when parse+stringify mutates the bytes SendGrid signed. */
export function jsonRoundTripChangesBytes(raw: string): boolean {
  try {
    return JSON.stringify(JSON.parse(raw)) !== raw;
  } catch {
    return true;
  }
}
