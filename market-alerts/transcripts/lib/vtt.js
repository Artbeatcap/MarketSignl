/** VTT and transcript-provider JSON → plain text. No I/O. */

const STAMP_INTERVAL_SEC = 30;

export function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function formatStamp(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `[${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
}

export function parseTimestamp(token) {
  const raw = String(token || '').trim().replace(',', '.');
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

function decodeCueText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drop consecutive duplicate caption lines (rolling YouTube cues).
 * @param {{start: number, text: string}[]} cues
 */
export function dedupeCues(cues) {
  const out = [];
  let prev = '';
  for (const cue of cues || []) {
    const lines = String(cue?.text || '')
      .split(/\r?\n/)
      .map((line) => decodeCueText(line))
      .filter(Boolean);
    const uniqueLines = [];
    for (const line of lines) {
      if (line === uniqueLines[uniqueLines.length - 1]) continue;
      uniqueLines.push(line);
    }
    const text = uniqueLines.join(' ').trim();
    if (!text || text === prev) continue;
    out.push({ start: Math.max(0, Number(cue.start) || 0), text });
    prev = text;
  }
  return out;
}

export function cuesToStampedText(cues, intervalSec = STAMP_INTERVAL_SEC) {
  const kept = dedupeCues(cues);
  if (!kept.length) return '';
  const lines = [];
  let lastStamp = -Infinity;
  for (const cue of kept) {
    if (cue.start - lastStamp >= intervalSec) {
      lines.push(`${formatStamp(cue.start)} ${cue.text}`);
      lastStamp = cue.start;
    } else {
      lines.push(cue.text);
    }
  }
  return lines.join('\n');
}

export function parseVttCues(vtt) {
  const raw = String(vtt || '').replace(/^\uFEFF/, '');
  const blocks = raw.split(/\r?\n\r?\n+/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (!lines.length) continue;
    const arrow = lines.findIndex((line) => line.includes('-->'));
    if (arrow === -1) continue;
    const startToken = lines[arrow].split('-->')[0].trim().split(/\s+/)[0];
    const start = parseTimestamp(startToken);
    if (start == null) continue;
    const text = lines.slice(arrow + 1).join('\n');
    if (!text.trim()) continue;
    cues.push({ start, text });
  }
  return cues;
}

export function vttToPlainText(vtt, intervalSec = STAMP_INTERVAL_SEC) {
  return cuesToStampedText(parseVttCues(vtt), intervalSec);
}

function asObject(payload) {
  if (payload == null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') return payload;
  return null;
}

/**
 * Supadata (text=false): content[].offset is milliseconds.
 * TranscriptAPI (json): transcript[].start is seconds.
 * Checked against vendor docs on 2026-11-04.
 */
export function providerJsonToCues(payload) {
  const data = asObject(payload);
  if (!data) return [];

  if (Array.isArray(data.content)) {
    return data.content.map((seg) => ({
      start: Number(seg?.offset) / 1000,
      text: seg?.text,
    }));
  }
  if (typeof data.content === 'string') {
    const text = data.content.trim();
    return text ? [{ start: 0, text }] : [];
  }
  if (Array.isArray(data.transcript)) {
    return data.transcript.map((seg) => ({
      start: Number(seg?.start) || 0,
      text: seg?.text,
    }));
  }
  if (typeof data.transcript === 'string') {
    const text = data.transcript.trim();
    return text ? [{ start: 0, text }] : [];
  }
  return [];
}

export function providerJsonToPlainText(payload, intervalSec = STAMP_INTERVAL_SEC) {
  return cuesToStampedText(providerJsonToCues(payload), intervalSec);
}

export function transcriptCharCount(text) {
  return String(text || '').trim().length === 0 ? 0 : String(text).length;
}
