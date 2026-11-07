#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { vttToPlainText } from '../lib/vtt.js';
import {
  parseDiscoveryLines,
  publishInstantFromWatch,
  selectDiscoveredVideos,
} from '../lib/run.js';

const command = argv[2];

function flag(name) {
  const index = argv.indexOf(name);
  return index === -1 ? '' : argv[index + 1] || '';
}

function readSources() {
  const path = fileURLToPath(new URL('../sources.json', import.meta.url));
  process.stdout.write(readFileSync(path, 'utf8'));
}

function ytdlpResult() {
  const dir = flag('--dir');
  const videoId = flag('--id');
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      text: '',
      chars: 0,
      error: `yt-dlp output dir missing: ${error.message}`,
    }));
    return;
  }
  const vtts = names.filter((name) => name.endsWith('.vtt'));
  const preferred = vtts.find((name) => name.includes('.en.')) || vtts[0];
  let stderr = '';
  try {
    stderr = readFileSync(`${dir}/stderr.txt`, 'utf8');
  } catch {
    stderr = '';
  }
  if (!preferred) {
    process.stdout.write(JSON.stringify({
      ok: false,
      text: '',
      chars: 0,
      error: stderr.trim() || 'yt-dlp wrote no VTT',
    }));
    return;
  }
  const text = vttToPlainText(readFileSync(`${dir}/${preferred}`, 'utf8'));
  const ok = Boolean(text.trim());
  process.stdout.write(JSON.stringify({
    ok,
    text,
    chars: text.length,
    error: ok ? null : (stderr.trim() || 'empty transcript'),
    videoId,
    file: preferred,
  }));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'chartsignl-transcripts', 'Accept-Language': 'en-US,en;q=0.9' },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.setTimeout(20000, () => {
      request.destroy(new Error('watch page timeout'));
    });
    request.on('error', reject);
  });
}

async function discoverResult() {
  const dir = flag('--dir');
  let exitCode = 1;
  let stderr = '';
  let list = '';
  try {
    exitCode = Number(readFileSync(`${dir}/exit`, 'utf8').trim());
    if (!Number.isFinite(exitCode)) exitCode = 1;
  } catch {
    exitCode = 1;
  }
  try { stderr = readFileSync(`${dir}/err.txt`, 'utf8'); } catch { stderr = ''; }
  try { list = readFileSync(`${dir}/list.txt`, 'utf8'); } catch { list = ''; }
  const errorLine = stderr.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('ERROR:')) || stderr.trim().split(/\r?\n/).find(Boolean) || '';
  if (exitCode !== 0) {
    process.stdout.write(JSON.stringify({ ok: false, videos: [], error: errorLine || `yt-dlp exited ${exitCode}` }));
    return;
  }
  const found = parseDiscoveryLines(list);
  if (!found.length) {
    process.stdout.write(JSON.stringify({ ok: false, videos: [], error: 'zero videos' }));
    return;
  }
  const videos = selectDiscoveredVideos(found);
  for (const video of videos) {
    try {
      const html = await fetchText(`https://www.youtube.com/watch?v=${video.itemId}`);
      video.publishedAt = publishInstantFromWatch(html);
    } catch {
      video.publishedAt = null;
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, videos }));
}

if (command === 'read-sources') {
  readSources();
} else if (command === 'ytdlp-result') {
  ytdlpResult();
} else if (command === 'discover-result') {
  discoverResult().catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, videos: [], error: error.message }));
    exit(1);
  });
} else {
  process.stderr.write('usage: cli.mjs read-sources | ytdlp-result --dir DIR --id VIDEO_ID | discover-result --dir DIR\n');
  exit(1);
}
