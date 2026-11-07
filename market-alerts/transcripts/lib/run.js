/**
 * Run decisions shared by tests and the n8n code nodes.
 * Provider endpoints were read from vendor docs on 2026-11-04:
 *   Supadata GET https://api.supadata.ai/v1/transcript  header x-api-key
 *   TranscriptAPI GET https://transcriptapi.com/api/v2/youtube/transcript  Authorization: Bearer
 */

import { providerJsonToPlainText, transcriptCharCount } from './vtt.js';
import {
  classifyYouTubeVideo,
  dropAlreadySaved,
  podcastTranscriptDecision,
} from './feeds.js';

export const FAILURE_PREFIX = 'TRANSCRIPT FETCH FAILED - ';
export const TRANSCRIPTAPI_SKIPPED = 'transcriptapi: skipped (no credential)';
export const EXPECTED_TIMEZONE = 'America/New_York';
export const DRIVE_FOLDER_NAME = 'Trading Transcripts';
export const DRIVE_FOLDER_ID = '1InBLV4SvbDj4_mhsNk_D7VZR3un-Bp5q';
export const YT_DLP_VERSION = '2026.10.26';
export const SHORT_TRANSCRIPT_CHARS = 2000;
export const LONG_VIDEO_SECONDS = 600;

export const PROVIDERS = {
  supadata: {
    name: 'supadata',
    url: 'https://api.supadata.ai/v1/transcript',
    docs: 'https://docs.supadata.ai/get-transcript',
    header: 'x-api-key',
    query(videoUrl) {
      return { url: videoUrl, lang: 'en', text: 'false', mode: 'native' };
    },
  },
  transcriptapi: {
    name: 'transcriptapi',
    url: 'https://transcriptapi.com/api/v2/youtube/transcript',
    docs: 'https://transcriptapi.com/docs/api/',
    header: 'Authorization',
    query(videoUrl) {
      return { video_url: videoUrl, language: 'en' };
    },
  },
};

const SECRET_PATTERNS = [
  /\b(?:xox[baprs]-|xapp-)[A-Za-z0-9-]+/g,
  /\bBearer\s+[A-Za-z0-9._\-]+/gi,
  /\b(?:x-api-key|api[_-]?key)\s*[:=]\s*\S+/gi,
];

export function redact(value, maxLen = 1500) {
  let text = value == null ? '' : String(value);
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxLen) text = text.slice(0, maxLen - 1) + '…';
  return text;
}

export function assertTranscriptTimezone(timezone) {
  const tz = String(timezone || '').trim();
  if (tz !== EXPECTED_TIMEZONE) {
    throw new Error(`timezone mismatch: expected ${EXPECTED_TIMEZONE}, got ${tz || '(empty)'}`);
  }
  return tz;
}

export function providerOrder(primary) {
  const name = String(primary || 'supadata').trim().toLowerCase();
  if (name !== 'supadata' && name !== 'transcriptapi') {
    throw new Error(`TRANSCRIPT_PROVIDER must be supadata or transcriptapi, got ${name}`);
  }
  return {
    primary: name,
    secondary: name === 'supadata' ? 'transcriptapi' : 'supadata',
  };
}

export function providerRequestUrl(providerName, videoUrl) {
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`unknown transcript provider ${providerName}`);
  const query = Object.entries(provider.query(videoUrl))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${provider.url}?${query}`;
}

export const CONFIG_KEYS = [
  'TRANSCRIPT_TIMEZONE',
  'TRANSCRIPT_PROVIDER',
  'MONTHLY_TRANSCRIPT_LIMIT',
  'SLACK_ALERT_CHANNEL',
  'HEALTHCHECK_TRANSCRIPTS_URL',
];

export function configPresence(env = {}) {
  return Object.fromEntries(CONFIG_KEYS.map((key) => [key, String(env[key] ?? '').trim() !== '']));
}

export function readTranscriptConfig(env = {}, workflowTimezone = '') {
  const presence = configPresence(env);
  const missing = CONFIG_KEYS.filter((key) => !presence[key]);
  if (!presence.SLACK_ALERT_CHANNEL) {
    return { ok: false, noAlertChannel: true, presence, missing, dm: '' };
  }
  if (missing.length) {
    return {
      ok: false,
      noAlertChannel: false,
      presence,
      missing,
      channel: String(env.SLACK_ALERT_CHANNEL).trim(),
      dm: `${FAILURE_PREFIX}missing config: ${missing.join(', ')}`,
    };
  }
  const timezone = String(env.TRANSCRIPT_TIMEZONE).trim();
  const wfTz = String(workflowTimezone || '').trim();
  if (timezone !== EXPECTED_TIMEZONE || (wfTz && wfTz !== EXPECTED_TIMEZONE)) {
    throw new Error('timezone mismatch: expected America/New_York');
  }
  let order;
  try {
    order = providerOrder(String(env.TRANSCRIPT_PROVIDER).trim());
  } catch {
    throw new Error(`${FAILURE_PREFIX}TRANSCRIPT_PROVIDER is not supadata or transcriptapi`);
  }
  const limit = Number(String(env.MONTHLY_TRANSCRIPT_LIMIT).trim());
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`${FAILURE_PREFIX}missing config: MONTHLY_TRANSCRIPT_LIMIT`);
  }
  const channel = String(env.SLACK_ALERT_CHANNEL).trim();
  if (!/^U[A-Z0-9]+$/.test(channel)) {
    throw new Error(`${FAILURE_PREFIX}SLACK_ALERT_CHANNEL is not a member id`);
  }
  return {
    ok: true,
    noAlertChannel: false,
    presence,
    missing: [],
    timezone,
    primary: order.primary,
    secondary: order.secondary,
    limit,
    channel,
    healthUrl: String(env.HEALTHCHECK_TRANSCRIPTS_URL).trim().replace(/\/$/, ''),
  };
}

export function formatDateEt(iso, nowFallback) {
  const date = iso ? new Date(iso) : nowFallback ? new Date(nowFallback) : null;
  if (!date || Number.isNaN(date.getTime())) return 'unknown-date';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EXPECTED_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function monthStartEt(date = new Date()) {
  return `${formatDateEt(date).slice(0, 8)}01`;
}

export function formatDurationLabel(durationSeconds) {
  if (durationSeconds == null || !Number.isFinite(Number(durationSeconds))) return 'unknown';
  const total = Math.max(0, Math.floor(Number(durationSeconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function sanitizeTitle(title) {
  return String(title || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function documentName({ slug, publishedAt, title }) {
  const name = `${slug} ${formatDateEt(publishedAt)} ${sanitizeTitle(title)}`.trim();
  return name.slice(0, 200);
}

export function documentBody({ source, title, publishedAt, url, durationSeconds, method, text }) {
  return [
    `source: ${source}`,
    `title: ${title || ''}`,
    `publish date: ${formatDateEt(publishedAt)}`,
    `url: ${url || ''}`,
    `duration: ${formatDurationLabel(durationSeconds)}`,
    `method: ${method || ''}`,
    'auto-generated captions, speakers not labeled',
    '',
    String(text || '').trim(),
  ].join('\n');
}

export function isTooShortForDuration({ chars, durationSeconds }) {
  return Number(durationSeconds) > LONG_VIDEO_SECONDS && Number(chars) < SHORT_TRANSCRIPT_CHARS;
}

export function transcriptApiCredentialMissing(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (Number(payload.statusCode) >= 100) return false;
  const error = payload.error;
  const text = [
    error && typeof error === 'object' ? error.message : '',
    error && typeof error === 'object' ? error.description : '',
    typeof error === 'string' ? error : '',
    payload.message,
  ].join(' ');
  return /credential/i.test(text);
}

export function supadataStartupFailure({ errorText = '', statusCode = 0 } = {}) {
  const status = Number(statusCode) || 0;
  const text = String(errorText || '');
  if (text && /credential/i.test(text)) return 'Supadata API Key missing';
  if (status === 401 || status === 403) return 'Supadata API Key rejected';
  if (!status && text) return text;
  return null;
}

export function sqlLiteral(value) {
  if (value == null) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function sqlIdentList(ids) {
  return (ids || []).map((id) => sqlLiteral(id)).join(', ');
}

export function channelIdFromListResponse(body) {
  const data = typeof body === 'string' ? JSON.parse(body) : body;
  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length !== 1 || !items[0]?.id) {
    throw new Error(
      `YouTube channels.list forHandle returned ${items.length} items; refusing to guess a channel id`,
    );
  }
  const id = String(items[0].id);
  if (!/^UC[\w-]{22}$/.test(id)) {
    throw new Error('YouTube channels.list returned an id that is not a channel id');
  }
  return id;
}

export function pickPrivateFolder(files) {
  const list = Array.isArray(files) ? files : [];
  const match = list.find((file) => file && file.id && file.trashed !== true && file.shared !== true);
  return match ? match.id : null;
}

export function readbackFailure(meta, { name, folderId } = {}) {
  if (!meta || !meta.id) return 'drive readback missing id';
  if (meta.trashed === true) return 'drive readback trashed';
  if (meta.mimeType !== 'application/vnd.google-apps.document') {
    return `drive readback mimeType ${meta.mimeType || '(empty)'}`;
  }
  if (name && meta.name !== name) return `drive readback name mismatch: ${meta.name}`;
  const parents = Array.isArray(meta.parents) ? meta.parents : [];
  if (folderId && !parents.includes(folderId)) return 'drive readback not in Trading Transcripts folder';
  return null;
}

function headerMap(headers) {
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  for (const [key, value] of Object.entries(headers)) out[String(key).toLowerCase()] = value;
  return out;
}

function bodyPreview(body) {
  if (body == null) return '';
  if (typeof body === 'string') return redact(body, 400);
  try {
    return redact(JSON.stringify(body), 400);
  } catch {
    return redact(String(body), 400);
  }
}

/**
 * @param {{ provider: string, statusCode?: number, body?: unknown, headers?: object }} args
 */
export function interpretProviderHttp({ provider, statusCode, body, headers }) {
  const name = String(provider || '');
  const status = Number(statusCode || 0);
  const heads = headerMap(headers);
  let credits = 0;
  if (name === 'supadata' && heads['x-billable-requests'] != null && heads['x-billable-requests'] !== '') {
    const parsed = Number(heads['x-billable-requests']);
    credits = Number.isFinite(parsed) ? parsed : 0;
  }
  if (status === 202) {
    return { ok: false, credits, error: 'supadata HTTP 202 jobId; native transcript was not returned inline', text: '' };
  }
  if (status !== 200) {
    return {
      ok: false,
      credits: name === 'supadata' ? credits : 0,
      error: `HTTP ${status || 'error'} ${bodyPreview(body)}`.trim(),
      text: '',
    };
  }
  const payload = body && typeof body === 'object' && body.content == null && body.transcript == null && body.body
    ? body.body
    : body;
  if (payload && typeof payload === 'object' && payload.jobId && payload.content == null && payload.transcript == null) {
    return { ok: false, credits, error: 'supadata returned jobId without a transcript', text: '' };
  }
  const text = providerJsonToPlainText(payload);
  if (!String(text || '').trim()) {
    return { ok: false, credits, error: 'empty transcript', text: '' };
  }
  if (name === 'transcriptapi') credits = 1;
  const durationSeconds = name === 'transcriptapi' && payload && payload.length_seconds != null
    ? Number(payload.length_seconds)
    : null;
  return { ok: true, credits, error: null, text, durationSeconds };
}

export function creditWarningNeeded({ creditsUsed, limit = 100, alreadyWarned }) {
  const cap = Number(limit);
  const threshold = 0.8 * (Number.isFinite(cap) && cap > 0 ? cap : 100);
  return !alreadyWarned && Number(creditsUsed) >= threshold;
}

export function formatFailureDm(failures) {
  const blocks = (failures || []).map((failure) => {
    const head = `${FAILURE_PREFIX}${failure.source}: ${failure.title || '(untitled)'}`;
    const attempts = (failure.attempts || []).map(
      (attempt) => `${attempt.method}: ${redact(attempt.error || 'unknown error', 800)}`,
    );
    return [head, ...attempts].join('\n');
  });
  const text = blocks.join('\n');
  return text.length > 12000 ? `${text.slice(0, 11999)}…` : text;
}

export function formatAttempts(attempts) {
  return (attempts || [])
    .filter((attempt) => attempt && attempt.error)
    .map((attempt) => `${attempt.method}: ${redact(attempt.error, 800)}`)
    .join('\n');
}

export function httpErrorText(item) {
  const error = item?.error;
  if (!error) return 'request failed';
  if (typeof error === 'string') return redact(error, 800);
  return redact(error.description || error.message || JSON.stringify(error), 800);
}

export function podcastLedgerQuery(slug, itemIds) {
  const ids = (itemIds || []).filter(Boolean);
  if (!ids.length) return null;
  return `select
  coalesce(json_agg(item_id) filter (where status = 'saved'), '[]'::json) as saved_ids,
  coalesce(json_agg(item_id) filter (where coalesce(error, '') like 'no transcript after 7 days:%'), '[]'::json) as notified_ids
from transcripts
where slug = ${sqlLiteral(slug)}
  and item_id in (${sqlIdentList(ids)});`;
}

export function dropAlreadyNotified(items, notifiedIds) {
  const notified = new Set(notifiedIds || []);
  return (items || []).filter((item) => item && !notified.has(item.itemId));
}

export function savedIdsQuery(slug, itemIds) {
  const ids = (itemIds || []).filter(Boolean);
  if (!ids.length) return null;
  return `select coalesce(json_agg(item_id), '[]'::json) as saved_ids
from transcripts
where slug = ${sqlLiteral(slug)}
  and status = 'saved'
  and item_id in (${sqlIdentList(ids)});`;
}

export function cacheLookupQuery(slug) {
  return `select coalesce(max(channel_id), '') as channel_id
from transcript_channel_cache
where slug = ${sqlLiteral(slug)};`;
}

export function cacheUpsertQuery(slug, handle, channelId) {
  return `insert into transcript_channel_cache (slug, handle, channel_id)
values (${sqlLiteral(slug)}, ${sqlLiteral(handle)}, ${sqlLiteral(channelId)})
on conflict (slug) do update
set handle = excluded.handle,
    channel_id = excluded.channel_id,
    resolved_at = now()
returning slug, channel_id;`;
}

export function upsertTranscriptQuery(row) {
  const method = row.method || null;
  return `insert into transcripts (slug, item_id, title, published_at, status, method, drive_file_id, chars, error)
values (
  ${sqlLiteral(row.slug)},
  ${sqlLiteral(row.itemId)},
  ${sqlLiteral(row.title || '')},
  ${row.publishedAt ? sqlLiteral(row.publishedAt) : 'null'},
  ${sqlLiteral(row.status)},
  ${method ? sqlLiteral(method) : 'null'},
  ${row.driveFileId ? sqlLiteral(row.driveFileId) : 'null'},
  ${row.chars == null ? 'null' : String(Math.max(0, Math.floor(Number(row.chars) || 0)))},
  ${row.error ? sqlLiteral(redact(row.error, 2000)) : 'null'}
)
on conflict (slug, item_id) do update set
  title = excluded.title,
  published_at = excluded.published_at,
  status = excluded.status,
  method = excluded.method,
  drive_file_id = excluded.drive_file_id,
  chars = excluded.chars,
  error = excluded.error,
  updated_at = now()
returning id, status;`;
}

export function sourceFailure(source, method, error) {
  return {
    source: source?.slug || 'unknown',
    title: source?.type || 'feed',
    attempts: [{ method, error: redact(error, 800) }],
  };
}

export function collectFromParsed(context, parsed, savedIds) {
  const fresh = dropAlreadySaved(parsed, savedIds);
  const items = fresh.map((item) => ({
    ...item,
    slug: context.source.slug,
    type: context.source.type,
    runId: context.runId,
    primary: context.primary,
    secondary: context.secondary,
    decided: false,
    attempts: [],
    credits: 0,
  }));
  return { items, failures: context.failures || [] };
}

export function applyPodcastFeed(context, parsed) {
  const now = new Date();
  const items = [];
  const failures = [...(context.failures || [])];
  for (const item of parsed) {
    const decision = podcastTranscriptDecision({
      transcriptUrl: item.transcriptUrl,
      publishedAt: item.publishedAt,
      now,
    });
    const base = {
      ...item,
      slug: context.source.slug,
      type: 'podcast_rss',
      runId: context.runId,
      source: context.source.slug,
      attempts: [],
      credits: 0,
    };
    if (decision.action === 'fetch') {
      items.push({ ...base, decided: false });
    } else if (decision.action === 'waiting') {
      items.push({
        ...base,
        decided: true,
        persist: true,
        status: 'waiting',
        error: decision.reason,
      });
    } else if (decision.action === 'notice') {
      items.push({
        ...base,
        decided: true,
        persist: true,
        status: 'failed',
        noticeOnce: true,
        error: `no transcript after 7 days: ${item.title || ''}`,
        attempts: [],
      });
    } else {
      items.push({
        ...base,
        decided: true,
        persist: true,
        status: 'failed',
        error: decision.reason,
        attempts: [{ method: 'feed_vtt', error: decision.reason }],
      });
    }
  }
  return { items, failures };
}

export function interpretVideosList(body) {
  const data = typeof body === 'string' ? JSON.parse(body) : body;
  const video = Array.isArray(data?.items) ? data.items[0] : null;
  if (!video) {
    return {
      ok: false,
      error: 'videos.list returned no items',
    };
  }
  const classified = classifyYouTubeVideo({
    duration: video.contentDetails?.duration,
    liveBroadcastContent: video.snippet?.liveBroadcastContent,
    actualEndTime: video.liveStreamingDetails?.actualEndTime,
  });
  return { ok: true, ...classified };
}

export function applyProviderResult(item, { which, provider, statusCode, body, headers }) {
  const interpreted = interpretProviderHttp({ provider, statusCode, body, headers });
  const attempts = [
    ...(item.attempts || []),
    { method: which, error: interpreted.ok ? null : interpreted.error },
  ];
  const credits = Number(item.credits || 0) + Number(interpreted.credits || 0);
  if (interpreted.ok) {
    return {
      ...item,
      attempts,
      credits,
      text: interpreted.text,
      method: which,
      durationSeconds: item.durationSeconds || interpreted.durationSeconds || null,
      needsAnother: false,
    };
  }
  return { ...item, attempts, credits, needsAnother: true, lastError: interpreted.error };
}

export function applyFeedVtt(item, vtt, error) {
  if (error) {
    const attempts = [...(item.attempts || []), { method: 'feed_vtt', error }];
    return {
      ...item,
      attempts,
      status: 'failed',
      persist: true,
      decided: true,
      error: formatAttempts(attempts),
    };
  }
  return { ...item, text: vtt, method: 'feed_vtt', needsAnother: false, attempts: item.attempts || [] };
}

export function applyYtDlp(item, { ok, text, error }) {
  const attempts = [
    ...(item.attempts || []),
    { method: 'yt_dlp', error: ok ? null : (error || 'yt-dlp produced no transcript') },
  ];
  if (ok && String(text || '').trim()) {
    return { ...item, attempts, text, method: 'yt_dlp', needsAnother: false };
  }
  return {
    ...item,
    attempts,
    needsAnother: false,
    status: 'failed',
    persist: true,
    decided: true,
    error: formatAttempts(attempts),
  };
}

export function prepareSave(item) {
  if (item.status === 'failed' || item.status === 'waiting' || item.status === 'skipped') {
    return { ...item, persist: item.persist !== false && item.status !== 'skipped' };
  }
  const chars = transcriptCharCount(item.text);
  if (!String(item.text || '').trim()) {
    const attempts = item.attempts || [];
    return {
      ...item,
      status: 'failed',
      persist: true,
      chars: 0,
      error: formatAttempts(attempts) || 'empty transcript',
    };
  }
  if (isTooShortForDuration({ chars, durationSeconds: item.durationSeconds })) {
    return {
      ...item,
      status: 'failed',
      persist: true,
      chars,
      error: `short transcript: ${chars} chars for video of ${item.durationSeconds} seconds`,
      attempts: [
        ...(item.attempts || []),
        {
          method: item.method || 'transcript',
          error: `short transcript: ${chars} chars for video of ${item.durationSeconds} seconds`,
        },
      ],
    };
  }
  const docName = documentName({ slug: item.slug, publishedAt: item.publishedAt, title: item.title });
  const docBody = documentBody({
    source: item.slug,
    title: item.title,
    publishedAt: item.publishedAt,
    url: item.url,
    durationSeconds: item.durationSeconds,
    method: item.method,
    text: item.text,
  });
  const boundary = `txbnd_${String(item.itemId).replace(/[^A-Za-z0-9]/g, '')}_7f3c`;
  return {
    ...item,
    status: 'pending_drive',
    persist: true,
    chars,
    docName,
    docBody,
    multipartContentType: `multipart/related; boundary=${boundary}`,
    multipartBody: documentMultipart({ name: docName, folderId: item.folderId, body: docBody, boundary }),
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function documentMultipart({ name, folderId, body, boundary }) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><pre>${escapeHtml(body)}</pre></body></html>`;
  const meta = JSON.stringify({
    name,
    mimeType: 'application/vnd.google-apps.document',
    parents: folderId ? [folderId] : undefined,
  });
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    meta,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export function publishInstantFromWatch(html) {
  const match = String(html || '').match(/"publishDate":\{"simpleText":"([A-Za-z]{3,9}) (\d{1,2}), (\d{4})"\}/);
  if (!match) return null;
  const months = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const month = months[match[1].slice(0, 3).toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31 || year < 2000) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}T17:00:00.000Z`;
}

export function parseDiscoveryLines(stdout) {
  const videos = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|');
    if (parts.length < 3) continue;
    const itemId = parts[0].trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(itemId)) continue;
    const durationRaw = parts[parts.length - 1].trim();
    const title = parts.slice(1, -1).join('|').trim() || itemId;
    const durationSeconds = /^\d+(?:\.\d+)?$/.test(durationRaw) ? Math.round(Number(durationRaw)) : null;
    videos.push({
      itemId,
      title,
      durationSeconds,
      url: `https://www.youtube.com/watch?v=${itemId}`,
      publishedAt: null,
    });
  }
  return videos;
}

export function selectDiscoveredVideos(videos) {
  return (videos || []).filter((video) => video.durationSeconds == null || Number(video.durationSeconds) >= 180);
}

export function discoveryFailure(slug, error) {
  return {
    source: 'discovery',
    title: `${slug || 'unknown'}: ${redact(error, 500)}`,
    attempts: [],
  };
}

export function youtubeDiscoveryCommand(channelId) {
  const id = String(channelId || '');
  if (!/^UC[\w-]{22}$/.test(id)) {
    throw new Error('refusing to build a yt-dlp command for an invalid channel id');
  }
  const dir = `/tmp/disc-${id}`;
  const url = `https://www.youtube.com/channel/${id}/videos`;
  return [
    `rm -rf ${dir}`,
    `mkdir -p ${dir}`,
    `yt-dlp --no-update --flat-playlist --playlist-end 5 --print '%(id)s|%(title)s|%(duration)s' '${url}' > ${dir}/list.txt 2> ${dir}/err.txt`,
    `echo $? > ${dir}/exit`,
    `node /opt/transcripts/bin/cli.mjs discover-result --dir ${dir}`,
  ].join('; ');
}

export function ytDlpCommand(videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) {
    throw new Error('refusing to build a yt-dlp command for an invalid video id');
  }
  const dir = `/tmp/tx-${videoId}`;
  const command = [
    `rm -rf ${dir}`,
    `mkdir -p ${dir}`,
    `yt-dlp --no-update --skip-download --write-auto-subs --sub-langs en --sub-format vtt --no-playlist -o '${dir}/%(id)s' 'https://www.youtube.com/watch?v=${videoId}' >${dir}/stdout.txt 2>${dir}/stderr.txt || true`,
    `node /opt/transcripts/bin/cli.mjs ytdlp-result --dir ${dir} --id ${videoId}`,
  ].join(' && ').replace(' || true && ', ' || true; ');
  return { dir, command };
}

export function toOutcome(item) {
  const status = item.status === 'pending_drive' ? 'failed' : item.status;
  return {
    slug: item.slug,
    itemId: item.itemId,
    title: item.title || '',
    publishedAt: item.publishedAt || null,
    status,
    method: item.method || null,
    driveFileId: item.driveFileId || null,
    chars: item.chars ?? null,
    error: item.error || null,
    persist: item.persist !== false && status !== 'skipped',
    transcriptApiSkipped: item.transcriptApiSkipped === true,
    credits: Number(item.credits || 0),
    attempts: (item.attempts || []).filter((attempt) => attempt && attempt.error),
    source: item.slug,
    noticeOnce: item.noticeOnce === true,
  };
}

export function summarizeRun({ outcomes = [], sourceFailures = [], limit = 100 } = {}) {
  const transcriptApiSkipped = (outcomes || []).some((row) => row && row.transcriptApiSkipped);
  const rows = (outcomes || []).filter((row) => row && row.status && row.status !== 'skipped');
  const saved = rows.filter((row) => row.status === 'saved').length;
  const waiting = rows.filter((row) => row.status === 'waiting').length;
  const failedRows = rows.filter((row) => row.status === 'failed');
  const failures = [
    ...(sourceFailures || []),
    ...failedRows.map((row) => (row.noticeOnce
      ? { source: row.slug, title: row.error, attempts: [] }
      : {
        source: row.slug,
        title: row.title,
        attempts: row.attempts && row.attempts.length
          ? row.attempts
          : [{ method: row.method || 'save', error: row.error || 'failed' }],
      })),
  ];
  const failed = failedRows.length + (sourceFailures || []).length;
  const credits = rows.reduce((sum, row) => sum + Number(row.credits || 0), 0);
  const ok = failed === 0;
  return {
    saved,
    waiting,
    failed,
    credits,
    ok,
    failures,
    dm: failures.length ? formatFailureDm(failures) : '',
    transcriptApiSkipped,
    transcriptApiNote: transcriptApiSkipped ? TRANSCRIPTAPI_SKIPPED : '',
    limit: Number(limit) || 100,
  };
}

export function healthUrlFor(base, ok) {
  const root = String(base || '').replace(/\/$/, '');
  if (!root) throw new Error('HEALTHCHECK_TRANSCRIPTS_URL missing');
  return ok ? root : `${root}/fail`;
}

export function creditIncrementQuery(monthStart, credits) {
  const amount = Math.max(0, Math.floor(Number(credits) || 0));
  return `insert into transcript_credit_months (month_start, credits_used)
values (${sqlLiteral(monthStart)}::date, ${amount})
on conflict (month_start) do update
set credits_used = transcript_credit_months.credits_used + excluded.credits_used,
    updated_at = now()
returning credits_used, warning_sent_at;`;
}

export function creditClaimQuery(monthStart, limit) {
  const cap = Number(limit);
  const threshold = Math.ceil(0.8 * (Number.isFinite(cap) && cap > 0 ? cap : 100));
  return `with upd as (
  update transcript_credit_months
  set warning_sent_at = now()
  where month_start = ${sqlLiteral(monthStart)}::date
    and warning_sent_at is null
    and credits_used >= ${threshold}
  returning month_start
)
select (select count(*) from upd)::int as claimed, ${threshold}::int as threshold;`;
}

export function finishRunQuery({ runId, status, saved, waiting, failed, credits, error }) {
  return `update transcript_runs
set status = ${sqlLiteral(status)},
    saved = ${Math.max(0, Math.floor(Number(saved) || 0))},
    waiting = ${Math.max(0, Math.floor(Number(waiting) || 0))},
    failed = ${Math.max(0, Math.floor(Number(failed) || 0))},
    credits_used = ${Math.max(0, Math.floor(Number(credits) || 0))},
    error = ${error ? sqlLiteral(redact(error, 2000)) : 'null'},
    finished_at = now()
where id = ${sqlLiteral(runId)}::uuid
returning id, status;`;
}

export function staleSweepQuery() {
  return `with upd as (
  update transcript_runs
  set status = 'failed',
      error = 'stale running row (likely crash)',
      finished_at = now()
  where status = 'running'
    and run_at < now() - interval '30 minutes'
  returning id
)
select coalesce(json_agg(id), '[]'::json) as stale_ids from upd;`;
}

export function insertRunQuery(executionId) {
  return `insert into transcript_runs (status, n8n_execution_id, run_at)
values ('running', ${sqlLiteral(executionId)}, now())
returning id;`;
}

export function missingAlertChannelQuery(executionId) {
  return `insert into transcript_runs (status, n8n_execution_id, run_at, finished_at, saved, waiting, failed, credits_used, error)
values ('failed', ${sqlLiteral(executionId)}, now(), now(), 0, 0, 0, 0, 'no alert channel')
returning id, status, error;`;
}
