/** YouTube channel RSS and podcast RSS. No I/O. */

export const NEWEST_LIMIT = 5;
export const FEED_SCAN_LIMIT = 15;
export const SHORTS_MAX_SECONDS = 180;
export const PODCAST_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

export function decodeXml(value) {
  let text = String(value || '').trim();
  const cdata = text.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) text = cdata[1].trim();
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  text = text.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tagText(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = block.match(re);
  return match ? decodeXml(match[1]) : '';
}

function attr(block, tag, name) {
  const re = new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'i');
  const match = block.match(re);
  if (!match) return '';
  const attrRe = new RegExp(`${name}="([^"]*)"`, 'i');
  const found = match[1].match(attrRe);
  return found ? decodeXml(found[1]) : '';
}

export function isYouTubeShortLink(url) {
  return /\/shorts\//i.test(String(url || ''));
}

function linkHrefs(block) {
  const values = [];
  for (const match of String(block || '').matchAll(/<link\b([^>]*)\/?>/gi)) {
    const found = match[1].match(/\bhref="([^"]*)"/i);
    if (found) values.push(decodeXml(found[1]));
  }
  return values;
}

function mediaDurationSeconds(block) {
  const match = String(block || '').match(/<media:content\b[^>]*\bduration="(\d+(?:\.\d+)?)"/i);
  if (!match) return null;
  const seconds = Math.round(Number(match[1]));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function blocks(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  return [...String(xml || '').matchAll(re)].map((match) => match[1]);
}

export function parseIso8601Duration(value) {
  const match = String(value || '').trim().match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  if (!match[1] && !match[2] && !match[3]) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

export function parseItunesDuration(value) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

export function youtubeFeedAuthor(xml) {
  const author = (String(xml || '').match(/<author\b[^>]*>([\s\S]*?)<\/author>/i) || [])[1] || '';
  return tagText(author, 'name');
}

export function parseYouTubeChannelFeed(xml, { limit = NEWEST_LIMIT } = {}) {
  const items = [];
  for (const block of blocks(xml, 'entry')) {
    const links = linkHrefs(block);
    if (links.some(isYouTubeShortLink)) continue;
    const fromTag = tagText(block, 'yt:videoId');
    const fromId = (tagText(block, 'id').match(/yt:video:([A-Za-z0-9_-]{11})/) || [])[1];
    const itemId = fromTag || fromId || '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(itemId)) continue;
    const title = tagText(block, 'title') || tagText(block, 'media:title') || itemId;
    const href = links.find((link) => link.includes('watch?v=')) || '';
    const url = href.includes('watch?v=') ? href : `https://www.youtube.com/watch?v=${itemId}`;
    if (isYouTubeShortLink(url)) continue;
    const durationSeconds = mediaDurationSeconds(block);
    if (durationSeconds != null && durationSeconds <= SHORTS_MAX_SECONDS) continue;
    const publishedRaw = tagText(block, 'published') || tagText(block, 'updated');
    const publishedAt = publishedRaw ? new Date(publishedRaw).toISOString() : null;
    items.push({ itemId, title, url, publishedAt, durationSeconds, links });
    if (items.length >= limit) break;
  }
  return items;
}

export function durationsFromProbe(stdout) {
  const durations = {};
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z0-9_-]{11})\s+(\d+(?:\.\d+)?)/);
    if (!match) continue;
    durations[match[1]] = Math.round(Number(match[2]));
  }
  return durations;
}

export function keepLongYouTubeVideos(items, durations = {}, { limit = NEWEST_LIMIT } = {}) {
  const kept = [];
  for (const item of items || []) {
    if (isYouTubeShortLink(item && item.url) || (item && item.links || []).some(isYouTubeShortLink)) continue;
    const known = item && item.durationSeconds != null && item.durationSeconds !== ''
      ? Number(item.durationSeconds)
      : durations[item && item.itemId];
    if (known == null || !Number.isFinite(known) || known <= 0) continue;
    if (classifyYouTubeVideo({ duration: known }).action !== 'fetch') continue;
    kept.push({ ...item, durationSeconds: known });
    if (kept.length >= limit) break;
  }
  return kept;
}

function podcastTranscript(block) {
  const re = /<podcast:transcript\b([^>]*)\/?>/i;
  const match = block.match(re);
  if (!match) return { transcriptUrl: null, transcriptType: null };
  const url = (match[1].match(/\burl="([^"]*)"/i) || [])[1] || '';
  const type = (match[1].match(/\btype="([^"]*)"/i) || [])[1] || '';
  return {
    transcriptUrl: url ? decodeXml(url) : null,
    transcriptType: type || null,
  };
}

export function parsePodcastFeed(xml, { limit = NEWEST_LIMIT } = {}) {
  const items = [];
  for (const block of blocks(xml, 'item')) {
    const guid = tagText(block, 'guid');
    const enclosure = attr(block, 'enclosure', 'url');
    const itemId = (guid || enclosure || '').trim();
    if (!itemId) continue;
    const title = tagText(block, 'title') || tagText(block, 'itunes:title') || itemId;
    const pubRaw = tagText(block, 'pubDate');
    const publishedMs = pubRaw ? Date.parse(pubRaw) : NaN;
    const publishedAt = Number.isNaN(publishedMs) ? null : new Date(publishedMs).toISOString();
    const transcript = podcastTranscript(block);
    items.push({
      itemId,
      title,
      url: enclosure || '',
      publishedAt,
      durationSeconds: parseItunesDuration(tagText(block, 'itunes:duration')),
      transcriptUrl: transcript.transcriptUrl,
      transcriptType: transcript.transcriptType,
    });
    if (items.length >= limit) break;
  }
  return items;
}

export function classifyYouTubeVideo({ duration, liveBroadcastContent, actualEndTime } = {}) {
  const durationSeconds = typeof duration === 'number' ? duration : parseIso8601Duration(duration);
  const live = String(liveBroadcastContent || 'none');
  const ended = Boolean(actualEndTime);
  if ((live === 'live' || live === 'upcoming') && !ended) {
    return { action: 'defer', reason: 'live stream has not ended', durationSeconds };
  }
  if (durationSeconds != null && durationSeconds > 0 && durationSeconds <= SHORTS_MAX_SECONDS) {
    return { action: 'skip', reason: 'short', durationSeconds };
  }
  return { action: 'fetch', durationSeconds };
}

export function podcastTranscriptDecision({ transcriptUrl, publishedAt, now = new Date() } = {}) {
  if (transcriptUrl) return { action: 'fetch', method: 'feed_vtt' };
  const publishedMs = Date.parse(publishedAt || '');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (Number.isNaN(publishedMs) || nowMs - publishedMs < PODCAST_WAIT_MS) {
    return { action: 'waiting', reason: 'transcript not in feed yet' };
  }
  return { action: 'notice', reason: 'no transcript after 7 days' };
}

export function dropAlreadySaved(items, savedIds) {
  const saved = new Set(savedIds || []);
  return (items || []).filter((item) => item && !saved.has(item.itemId));
}
