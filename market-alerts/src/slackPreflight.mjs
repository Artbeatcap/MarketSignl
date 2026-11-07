import { assertSlackOk } from './formatMessage.mjs';

/**
 * Slack destination preflight — no chat.postMessage.
 * 1) auth.test
 * 2) conversations.open (user ID U…) or conversations.info (channel C…/G…)
 *
 * Required bot scopes (add only what this needs):
 *   - auth.test:       (any bot token; no extra scope beyond being a bot)
 *   - conversations.open: im:write  (DM to a user id)
 *   - conversations.info: channels:read (public) or groups:read (private)
 *
 * @param {object} opts
 * @param {(method: string, body?: object) => Promise<{ok:boolean,error?:string}>} opts.slackApi
 * @param {string} opts.channel  Slack user id (U…) or channel id (C…/G…)
 */
export async function slackPreflight({ slackApi, channel }) {
  const step = 'slack_preflight';
  if (!channel) {
    const err = new Error('SLACK_ALERT_CHANNEL missing');
    err.step = step;
    throw err;
  }

  const auth = await slackApi('auth.test');
  try {
    assertSlackOk(auth);
  } catch (e) {
    e.step = step;
    throw e;
  }

  const id = String(channel).trim();
  let dest;
  if (id.startsWith('U') || id.startsWith('W')) {
    dest = await slackApi('conversations.open', { users: id });
  } else {
    dest = await slackApi('conversations.info', { channel: id });
  }

  try {
    assertSlackOk(dest);
  } catch (e) {
    e.step = step;
    throw e;
  }

  return {
    ok: true,
    botUserId: auth.user_id ?? auth.userId ?? null,
    team: auth.team ?? null,
    channel: id,
  };
}

/**
 * Scopes required by preflight + chat.postMessage delivery.
 * Documented for the Slack app install screen — do not request extras.
 */
export const REQUIRED_SLACK_SCOPES = Object.freeze({
  always: ['chat:write'],
  dmUserId: ['im:write'],
  publicChannel: ['channels:read'],
  privateChannel: ['groups:read'],
});
