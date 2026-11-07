import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');

function stripModule(src) {
  return src
    .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

const prelude = [
  '/* __TRANSCRIPT_LIB__ */',
  stripModule(readFileSync(join(root, 'lib/vtt.js'), 'utf8')),
  stripModule(readFileSync(join(root, 'lib/feeds.js'), 'utf8')),
  stripModule(readFileSync(join(root, 'lib/run.js'), 'utf8')),
].join('\n');

const nodes = [];
const connections = {};
const usedIds = new Set();
let x = 0;
let y = 0;

function nodeId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'node';
  let id = base;
  let n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);
  return id;
}

function add(name, type, typeVersion, parameters, extra = {}) {
  nodes.push({
    parameters,
    id: nodeId(name),
    name,
    type,
    typeVersion,
    position: [x, y],
    ...extra,
  });
  x += 240;
  return name;
}

function link(from, to, output = 0) {
  const bucket = connections[from] || (connections[from] = { main: [] });
  while (bucket.main.length <= output) bucket.main.push([]);
  bucket.main[output].push({ node: to, type: 'main', index: 0 });
}

function code(name, mode, body) {
  return add(name, 'n8n-nodes-base.code', 2, {
    mode,
    jsCode: `${prelude}\n${body}`,
  });
}

function iff(name, expression) {
  return add(name, 'n8n-nodes-base.if', 1, {
    conditions: {
      boolean: [{ value1: expression || `={{$json.${nameFlag(name)}}}`, value2: true }],
    },
  });
}

function nameFlag(name) {
  const flags = {
    'YouTube source?': 'isYouTube',
    'Needs channel id?': 'needsResolve',
    'Cache hit?': 'cacheHit',
    'Channel id ok?': 'resolveOk',
    'YouTube items?': 'hasParsed',
    'Discover ready?': 'discoverReady',
    'Podcast ready?': 'podcastReady',
    'Podcast items?': 'hasParsed',
    'Anything to save?': 'hasWork',
    'Drive ok?': 'driveOk',
    'Need folder?': 'needFolder',
    'Already decided?': 'isDecided',
    'YouTube item?': 'isYouTubeItem',
    'Fetch transcript?': 'shouldFetch',
    'Primary is Supadata?': 'useSupadataPrimary',
    'Need secondary?': 'needsSecondary',
    'Secondary is Supadata?': 'useSupadataSecondary',
    'Need yt-dlp?': 'needsYtdlp',
    'Primary needs yt-dlp?': 'needsYtdlp',
    'Podcast has VTT?': 'hasTranscriptUrl',
    'Write doc?': 'pendingDrive',
    'Persist row?': 'persist',
    'Has failures?': 'hasFailures',
    'Used credits?': 'hasCredits',
    'Send credit warning?': 'sendWarning',
    'Claimed warning?': 'sendWarning',
    'Doc created?': 'hasCreatedId',
    'Run ok?': 'runOk',
    'Has stale rows?': 'hasStale',
    'Config ok?': 'configOk',
    'No alert channel?': 'noAlertChannel',
  };
  const flag = flags[name];
  if (!flag) throw new Error(`no flag for ${name}`);
  return flag;
}

const pg = {
  credentials: {
    postgres: { id: 'REPLACE_TRANSCRIPTS_PG_CREDENTIAL_ID', name: 'transcripts_n8n' },
  },
};
const slackCred = {
  credentials: {
    slackApi: { id: 'REPLACE_SLACK_CREDENTIAL_ID', name: 'Slack Bot' },
  },
};
const supadataCred = {
  credentials: {
    httpHeaderAuth: { id: 'REPLACE_SUPADATA_CREDENTIAL_ID', name: 'Supadata API Key' },
  },
};
const transcriptCred = {
  credentials: {
    httpHeaderAuth: { id: 'REPLACE_TRANSCRIPTAPI_CREDENTIAL_ID', name: 'TranscriptAPI Bearer' },
  },
};
const driveCred = {
  credentials: {
    googleDriveOAuth2Api: { id: 'REPLACE_GOOGLE_DRIVE_CREDENTIAL_ID', name: 'Google Drive' },
  },
};

function responseOptions(format) {
  const response = { fullResponse: true, neverError: true };
  if (format) response.responseFormat = format;
  return { response: { response } };
}

function http(name, parameters, extra = {}) {
  const { credentials, ...rest } = parameters;
  return add(name, 'n8n-nodes-base.httpRequest', 4.2, rest, {
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    ...(credentials ? { credentials } : {}),
    ...extra,
  });
}

function postgres(name, query) {
  return add(name, 'n8n-nodes-base.postgres', 2.5, {
    operation: 'executeQuery',
    query,
    options: {},
  }, pg);
}

function headerAuth(cred) {
  return {
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    ...cred,
  };
}

function driveAuth() {
  return {
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleDriveOAuth2Api',
    ...driveCred,
  };
}

function slackDm(name, text, channelExpression) {
  return add(name, 'n8n-nodes-base.slack', 2.2, {
    resource: 'message',
    operation: 'post',
    select: 'user',
    user: { __rl: true, mode: 'id', value: channelExpression },
    text,
    otherOptions: { includeLinkToWorkflow: false },
  }, { ...slackCred, onError: 'continueErrorOutput' });
}

add('Manual run', 'n8n-nodes-base.manualTrigger', 1, {});
y = 160;
x = 0;
add('Weekday and Sunday schedule', 'n8n-nodes-base.scheduleTrigger', 1.2, {
  rule: {
    interval: [
      { field: 'cronExpression', expression: '10 6 * * 1-5' },
      { field: 'cronExpression', expression: '40 20 * * 1-5' },
      { field: 'cronExpression', expression: '40 16 * * 0' },
      { field: 'cronExpression', expression: '30 18 * * 0' },
      { field: 'cronExpression', expression: '15 19 * * 0' },
      { field: 'cronExpression', expression: '0 20 * * 0' },
    ],
  },
});

x = 240;
y = 80;
code('Assert config', 'runOnceForAllItems', `
const cfg = readTranscriptConfig($env, ($workflow.settings && $workflow.settings.timezone) || '');
if (!cfg.ok) {
  return [{ json: {
    configOk: false,
    noAlertChannel: cfg.noAlertChannel === true,
    presence: cfg.presence,
    channel: cfg.channel || '',
    dm: cfg.dm || '',
    missingSql: cfg.noAlertChannel ? missingAlertChannelQuery(String($execution.id)) : '',
  } }];
}
return [{ json: {
  configOk: true,
  presence: cfg.presence,
  timezone: cfg.timezone,
  primary: cfg.primary,
  secondary: cfg.secondary,
  limit: cfg.limit,
  channel: cfg.channel,
  healthUrl: cfg.healthUrl,
  executionId: String($execution.id),
} }];
`);

iff('Config ok?');
iff('No alert channel?');
postgres('Record missing alert channel', '={{ $json.missingSql }}');
slackDm('Slack missing config', '={{ $json.dm }}', '={{ $json.channel }}');

http('Check Supadata', {
  method: 'GET',
  url: 'https://api.supadata.ai/v1/transcript',
  ...headerAuth(supadataCred),
  options: responseOptions('json'),
});

code('Require Supadata key', 'runOnceForAllItems', `
const failure = supadataStartupFailure({
  errorText: $json.error ? httpErrorText($json) : '',
  statusCode: Number($json.statusCode || 0),
});
if (failure) throw new Error(failure);
return [{ json: $('Assert config').first().json }];
`);

add('Check yt-dlp version', 'n8n-nodes-base.executeCommand', 1, {
  command: 'yt-dlp --version',
});

code('Require pinned yt-dlp', 'runOnceForAllItems', `
const cfg = $('Assert config').first().json;
const stdout = String(($input.first().json && $input.first().json.stdout) || '').trim();
if (stdout !== YT_DLP_VERSION) {
  throw new Error('yt-dlp version mismatch: expected ' + YT_DLP_VERSION + ', got ' + (stdout || '(none)'));
}
return [{ json: cfg }];
`);

postgres('Sweep stale runs', '={{ $json.staleSql }}');
code('Attach stale sweep', 'runOnceForAllItems', `
const cfg = $('Require pinned yt-dlp').first().json;
return [{ json: { ...cfg, staleSql: staleSweepQuery() } }];
`);

// The sweep node above references staleSql from the previous code, so reorder by rewiring:
// Attach stale sweep must run BEFORE Sweep stale runs. Fix connections below; node order in the
// array does not affect execution.

code('Note stale', 'runOnceForAllItems', `
const cfg = $('Attach stale sweep').first().json;
const staleIds = $input.first().json.stale_ids || [];
const staleFailures = (Array.isArray(staleIds) ? staleIds : []).map((id) => ({
  source: 'transcript_runs',
  title: 'stale running row',
  attempts: [{ method: 'stale_sweep', error: 'stale running row (likely crash) ' + id }],
}));
return [{ json: { ...cfg, staleFailures, hasStale: staleFailures.length > 0, insertSql: insertRunQuery(cfg.executionId) } }];
`);

postgres('Insert run', "={{ $('Note stale').first().json.insertSql }}");

add('Read sources', 'n8n-nodes-base.executeCommand', 1, {
  command: 'node /opt/transcripts/bin/cli.mjs read-sources',
});

code('Parse sources', 'runOnceForAllItems', `
const cfg = $('Note stale').first().json;
const runId = $('Insert run').first().json.id;
if (!runId) throw new Error('transcript_runs insert returned no id');
const stdout = String(($input.first().json && $input.first().json.stdout) || '');
let sources;
try { sources = JSON.parse(stdout); }
catch (error) { throw new Error('sources.json unreadable: ' + error.message); }
if (!Array.isArray(sources) || !sources.length) throw new Error('sources.json is empty');
return [{ json: { ...cfg, runId: runId, sources: sources } }];
`);

code('Fan out sources', 'runOnceForAllItems', `
const cfg = $input.first().json;
return cfg.sources.map((source) => ({
  json: {
    runId: cfg.runId,
    primary: cfg.primary,
    secondary: cfg.secondary,
    limit: cfg.limit,
    channel: cfg.channel,
    healthUrl: cfg.healthUrl,
    source: source,
  },
}));
`);

add('Split sources', 'n8n-nodes-base.splitInBatches', 3, { batchSize: 1, options: {} });

code('Source context', 'runOnceForEachItem', `
const source = $json.source || {};
const onlySlug = String(($env && $env.TRANSCRIPT_ONLY_SLUG) || '').trim();
if (onlySlug && source.slug !== onlySlug) {
  return { json: { directCollect: true, isYouTube: false, isPodcast: false, items: [], failures: [] } };
}
const isYouTube = source.type === 'youtube_channel';
const isPodcast = source.type === 'podcast_rss';
if (!isYouTube && !isPodcast) {
  return { json: { directCollect: true, isYouTube: false, items: [], failures: [sourceFailure(source, 'sources', 'unknown source type ' + source.type)] } };
}
const handle = String(source.handle || '').replace(/^@/, '');
return { json: {
  ...$json,
  isYouTube: isYouTube,
  isPodcast: isPodcast,
  handle: handle,
  needsResolve: isYouTube && !source.channel_id,
  channelId: source.channel_id || '',
} };
`);

iff('YouTube source?');

code('YouTube ready', 'runOnceForEachItem', `
const source = $json.source || {};
const channelId = String(source.channel_id || '');
if (!/^UC[\\w-]{22}$/.test(channelId)) {
  return { json: { ...$json, discoverReady: false, items: [], failures: [discoveryFailure(source.slug, 'missing channel id')] } };
}
return { json: { ...$json, channelId: channelId, discoverReady: true, discoverCommand: youtubeDiscoveryCommand(channelId) } };
`);

iff('Discover ready?');

add('Discover videos', 'n8n-nodes-base.executeCommand', 1, {
  command: '={{ $json.discoverCommand }}',
}, { onError: 'continueErrorOutput' });

code('Parse discovery', 'runOnceForEachItem', `
const prev = $('YouTube ready').item.json;
if (prev.discoverReady === false) {
  return { json: { ...prev, parsed: [], hasParsed: false } };
}
let parsed;
try {
  parsed = JSON.parse(($json && $json.stdout) || '');
} catch (error) {
  const detail = ($json && ($json.stderr || ($json.error && $json.error.message))) || error.message;
  parsed = { ok: false, videos: [], error: detail };
}
if (!parsed.ok) {
  return { json: { ...prev, parsed: [], hasParsed: false, failures: [discoveryFailure(prev.source.slug, parsed.error || 'discovery failed')] } };
}
const videos = parsed.videos || [];
return { json: {
  ...prev,
  parsed: videos,
  hasParsed: videos.length > 0,
  failures: [],
  savedSql: savedIdsQuery(prev.source.slug, videos.map((item) => item.itemId)),
} };
`);

iff('YouTube items?');
postgres('Saved YouTube ids', '={{ $json.savedSql }}');
code('Filter saved YouTube', 'runOnceForEachItem', `
const prev = $('Parse discovery').item.json;
let saved = $json.saved_ids || [];
if (typeof saved === 'string') saved = JSON.parse(saved);
return { json: collectFromParsed(prev, prev.parsed, saved) };
`);
code('No new YouTube ids', 'runOnceForEachItem', `
const prev = $('Parse discovery').item.json;
return { json: { items: [], failures: prev.failures || [] } };
`);

code('Podcast ready', 'runOnceForEachItem', `
const prev = $json;
if (prev.directCollect) return { json: { podcastReady: false, items: prev.items || [], failures: prev.failures || [] } };
if (!prev.source || !prev.source.url) {
  return { json: { podcastReady: false, items: [], failures: [sourceFailure(prev.source || {}, 'podcast_rss', 'missing url')] } };
}
return { json: { ...prev, podcastReady: true, feedUrl: prev.source.url } };
`);
iff('Podcast ready?');

http('Fetch podcast RSS', {
  method: 'GET',
  url: '={{ $json.feedUrl }}',
  options: responseOptions('text'),
});

code('Parse podcast feed', 'runOnceForEachItem', `
const prev = $('Podcast ready').item.json;
const payload = ($json.body !== undefined && $json.body !== null && $json.body !== '') ? $json.body : $json.data;
const xml = typeof payload === 'string' ? payload : '';
const status = Number($json.statusCode || 0);
if ($json.error && !xml) {
  return { json: { items: [], failures: [sourceFailure(prev.source, 'podcast_rss', httpErrorText($json))], hasParsed: false } };
}
if ((status && status !== 200) || !/<rss[\\s>]/i.test(xml)) {
  return { json: { items: [], failures: [sourceFailure(prev.source, 'podcast_rss', 'HTTP ' + (status || 'bad'))], hasParsed: false } };
}
const parsed = parsePodcastFeed(xml, { limit: NEWEST_LIMIT });
const collected = applyPodcastFeed(prev, parsed);
const ledgerIds = collected.items.filter((item) => !item.decided || item.noticeOnce).map((item) => item.itemId);
return { json: {
  ...prev,
  items: collected.items,
  failures: collected.failures,
  hasParsed: ledgerIds.length > 0,
  savedSql: podcastLedgerQuery(prev.source.slug, ledgerIds),
} };
`);

iff('Podcast items?');
postgres('Saved podcast ids', '={{ $json.savedSql }}');
code('Filter saved podcasts', 'runOnceForEachItem', `
const prev = $('Parse podcast feed').item.json;
let savedIds = $json.saved_ids || [];
let notifiedIds = $json.notified_ids || [];
if (typeof savedIds === 'string') savedIds = JSON.parse(savedIds);
if (typeof notifiedIds === 'string') notifiedIds = JSON.parse(notifiedIds);
const saved = new Set(savedIds);
const notified = new Set(notifiedIds);
const items = (prev.items || []).filter((item) => !notified.has(item.itemId) && (item.decided || !saved.has(item.itemId)));
return { json: { items: items, failures: prev.failures || [] } };
`);
code('No undecided podcasts', 'runOnceForEachItem', `
const prev = $('Parse podcast feed').item.json;
return { json: { items: prev.items || [], failures: prev.failures || [] } };
`);

code('Collect', 'runOnceForEachItem', `
const store = $getWorkflowStaticData('global');
if (!Array.isArray(store.batches)) store.batches = [];
store.batches.push({ items: $json.items || [], failures: $json.failures || [] });
return { json: { items: $json.items || [], failures: $json.failures || [] } };
`);

code('List candidates', 'runOnceForAllItems', `
const store = $getWorkflowStaticData('global');
const stored = Array.isArray(store.batches) ? store.batches : [];
store.batches = [];
store.outcomes = [];
const batches = stored.length ? stored : $('Collect').all().map((item) => item.json);
let items = batches.flatMap((batch) => batch.items || []);
let sourceFailures = batches.flatMap((batch) => batch.failures || []);
const cfg = $('Parse sources').first().json;
const failId = String(($env && $env.TRANSCRIPT_FAIL_VIDEO_ID) || '').trim();
if (failId) {
  items = [{
    slug: 'mike-jones-investing',
    type: 'youtube_channel',
    itemId: failId,
    title: 'forced failure',
    url: 'https://www.youtube.com/watch?v=' + encodeURIComponent(failId),
    publishedAt: new Date().toISOString(),
    decided: false,
    attempts: [],
    credits: 0,
  }];
  sourceFailures = [];
}
const onlySlug = String(($env && $env.TRANSCRIPT_ONLY_SLUG) || '').trim();
if (onlySlug) {
  items = items.filter((item) => item.slug === onlySlug);
  sourceFailures = sourceFailures.filter((failure) => failure.source === onlySlug);
  const onlyCount = Number(($env && $env.TRANSCRIPT_ONLY_COUNT) || 0);
  if (onlyCount > 0) items = items.slice(0, onlyCount);
}
return [{ json: {
  items: items,
  sourceFailures: sourceFailures,
  nothingToSave: items.length === 0,
  hasWork: items.length > 0,
  runId: cfg.runId,
  primary: cfg.primary,
  secondary: cfg.secondary,
  limit: cfg.limit,
  channel: cfg.channel,
  healthUrl: cfg.healthUrl,
} }];
`);

iff('Anything to save?');

http('Find Drive folder', {
  method: 'GET',
  url: 'https://www.googleapis.com/drive/v3/files/1InBLV4SvbDj4_mhsNk_D7VZR3un-Bp5q?fields=id,name,shared,trashed,mimeType',
  ...driveAuth(),
  options: responseOptions('json'),
});

code('Pick folder', 'runOnceForAllItems', `
const prev = $('List candidates').first().json;
const response = $input.first().json;
const body = response.body || response;
const missing = response.error || Number(response.statusCode || 0) >= 400 || !body.id || body.id !== DRIVE_FOLDER_ID || body.trashed === true || body.shared === true;
if (missing) {
  const detail = response.error ? httpErrorText(response) : ('folder id ' + DRIVE_FOLDER_ID + ' unavailable');
  return [{ json: {
    ...prev,
    folderId: '',
    needFolder: false,
    driveOk: false,
    driveError: sourceFailure({ slug: 'google-drive', type: 'google_drive' }, 'google_drive', detail),
  } }];
}
return [{ json: { ...prev, folderId: DRIVE_FOLDER_ID, needFolder: false, driveOk: true } }];
`);

iff('Drive ok?');

iff('Need folder?');

http('Create Drive folder', {
  method: 'POST',
  url: 'https://www.googleapis.com/drive/v3/files?fields=id,name,shared',
  ...driveAuth(),
  sendBody: true,
  contentType: 'json',
  specifyBody: 'json',
  jsonBody: '{"name":"Trading Transcripts","mimeType":"application/vnd.google-apps.folder"}',
  options: responseOptions('json'),
});

code('Use created folder', 'runOnceForAllItems', `
const prev = $('Pick folder').first().json;
if ($input.first().json.error) throw new Error('Drive folder create failed: ' + httpErrorText($input.first().json));
const body = $input.first().json.body || $input.first().json;
if (!body.id) throw new Error('Drive folder create returned no id');
if (body.shared === true) throw new Error('refusing a shared Trading Transcripts folder');
return [{ json: { ...prev, folderId: body.id, needFolder: false } }];
`);

code('Expand items', 'runOnceForAllItems', `
const prev = $input.first().json;
if (!prev.folderId) throw new Error('Trading Transcripts folder missing');
return prev.items.map((item) => ({
  json: {
    ...item,
    folderId: prev.folderId,
    primary: item.primary || prev.primary,
    secondary: item.secondary || prev.secondary,
    runId: prev.runId,
  },
}));
`);

add('Split items', 'n8n-nodes-base.splitInBatches', 3, { batchSize: 1, options: {} });

code('Item route', 'runOnceForEachItem', `
return { json: {
  ...$json,
  isDecided: $json.decided === true,
  isYouTubeItem: $json.type === 'youtube_channel',
  hasTranscriptUrl: Boolean($json.transcriptUrl),
} };
`);

iff('Already decided?');
iff('YouTube item?');
iff('Podcast has VTT?');

code('Queue YouTube fetch', 'runOnceForEachItem', `
const prev = $json;
if (!/^[A-Za-z0-9_-]{11}$/.test(String(prev.itemId || ''))) {
  const error = 'invalid video id';
  return { json: { ...prev, decided: true, status: 'failed', persist: true, shouldFetch: false, attempts: [{ method: 'youtube_rss', error: error }], error: error } };
}
return { json: {
  ...prev,
  shouldFetch: true,
  useSupadataPrimary: prev.primary === 'supadata',
  providerUrl: providerRequestUrl(prev.primary, prev.url),
} };
`);

iff('Fetch transcript?');
iff('Primary is Supadata?');

http('Supadata primary', {
  method: 'GET',
  url: '={{ $json.providerUrl }}',
  ...headerAuth(supadataCred),
  options: responseOptions('json'),
});
http('TranscriptAPI primary', {
  method: 'GET',
  url: '={{ $json.providerUrl }}',
  ...headerAuth(transcriptCred),
  options: responseOptions('json'),
});

code('Interpret primary', 'runOnceForEachItem', `
const prev = $('Queue YouTube fetch').item.json;
if (prev.primary === 'transcriptapi' && transcriptApiCredentialMissing($json)) {
  return { json: { ...prev, transcriptApiSkipped: true, needsSecondary: false, needsYtdlp: true, ytdlpCommand: ytDlpCommand(prev.itemId).command } };
}
const errored = Boolean($json.error);
const next = applyProviderResult(prev, {
  which: 'provider_primary',
  provider: prev.primary,
  statusCode: errored ? 0 : Number($json.statusCode || 0),
  body: errored ? httpErrorText($json) : ($json.body !== undefined ? $json.body : $json),
  headers: $json.headers || {},
});
return { json: {
  ...next,
  needsSecondary: next.needsAnother === true,
  useSupadataSecondary: prev.secondary === 'supadata',
  providerUrl: providerRequestUrl(prev.secondary, prev.url),
} };
`);

iff('Need secondary?');
iff('Secondary is Supadata?');

http('Supadata secondary', {
  method: 'GET',
  url: '={{ $json.providerUrl }}',
  ...headerAuth(supadataCred),
  options: responseOptions('json'),
});
http('TranscriptAPI secondary', {
  method: 'GET',
  url: '={{ $json.providerUrl }}',
  ...headerAuth(transcriptCred),
  options: responseOptions('json'),
});

code('Interpret secondary', 'runOnceForEachItem', `
const prev = $('Interpret primary').item.json;
if (prev.secondary === 'transcriptapi' && transcriptApiCredentialMissing($json)) {
  return { json: { ...prev, transcriptApiSkipped: true, needsYtdlp: true, ytdlpCommand: ytDlpCommand(prev.itemId).command } };
}
const errored = Boolean($json.error);
const next = applyProviderResult(prev, {
  which: 'provider_secondary',
  provider: prev.secondary,
  statusCode: errored ? 0 : Number($json.statusCode || 0),
  body: errored ? httpErrorText($json) : ($json.body !== undefined ? $json.body : $json),
  headers: $json.headers || {},
});
let command = '';
if (next.needsAnother) command = ytDlpCommand(prev.itemId).command;
return { json: { ...next, needsYtdlp: next.needsAnother === true, ytdlpCommand: command } };
`);

iff('Need yt-dlp?');
iff('Primary needs yt-dlp?');
add('Run yt-dlp', 'n8n-nodes-base.executeCommand', 1, {
  command: '={{ $json.ytdlpCommand }}',
}, { onError: 'continueErrorOutput' });

code('Apply yt-dlp', 'runOnceForEachItem', `
let prev = null;
try { prev = $('Interpret secondary').item.json; } catch (error) { prev = null; }
if (!prev || !prev.itemId) prev = $('Interpret primary').item.json;
let parsed;
try {
  parsed = JSON.parse(($json && $json.stdout) || '');
} catch (error) {
  parsed = { ok: false, text: '', error: ($json && ($json.stderr || ($json.error && $json.error.message))) || error.message };
}
return { json: applyYtDlp(prev, parsed) };
`);

http('Fetch feed VTT', {
  method: 'GET',
  url: '={{ $json.transcriptUrl }}',
  options: responseOptions('text'),
});

code('Apply feed VTT', 'runOnceForEachItem', `
const prev = $('Item route').item.json;
if ($json.error) return { json: applyFeedVtt(prev, '', httpErrorText($json)) };
const status = Number($json.statusCode || 0);
const payload = ($json.body !== undefined && $json.body !== null && $json.body !== '') ? $json.body : $json.data;
const body = typeof payload === 'string' ? payload : '';
if (status !== 200 || !body.trim()) {
  return { json: applyFeedVtt(prev, '', 'HTTP ' + (status || 'bad') + ' empty VTT') };
}
const text = vttToPlainText(body);
if (!text.trim()) return { json: applyFeedVtt(prev, '', 'empty transcript') };
return { json: { ...prev, text: text, method: 'feed_vtt', status: null } };
`);

code('Prepare save', 'runOnceForEachItem', `
const prepared = prepareSave($json);
prepared.pendingDrive = prepared.status === 'pending_drive';
return { json: prepared };
`);

iff('Write doc?');

http('Create Google Doc', {
  method: 'POST',
  url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,trashed,parents',
  ...driveAuth(),
  sendHeaders: true,
  headerParameters: {
    parameters: [{ name: 'Content-Type', value: '={{ $json.multipartContentType }}' }],
  },
  sendBody: true,
  contentType: 'raw',
  rawContentType: '={{ $json.multipartContentType }}',
  body: '={{ $json.multipartBody }}',
  options: responseOptions('json'),
});

code('After upload', 'runOnceForEachItem', `
const prev = $('Prepare save').item.json;
if ($json.error || Number($json.statusCode || 0) >= 400) {
  const error = 'drive create failed: ' + ($json.error ? httpErrorText($json) : ('HTTP ' + $json.statusCode));
  return { json: { ...prev, status: 'failed', persist: true, pendingDrive: false, hasCreatedId: false, error: error, attempts: (prev.attempts || []).concat([{ method: 'drive', error: error }]) } };
}
const body = $json.body || {};
if (!body.id) {
  const error = 'drive create returned no id';
  return { json: { ...prev, status: 'failed', persist: true, hasCreatedId: false, error: error, attempts: (prev.attempts || []).concat([{ method: 'drive', error: error }]) } };
}
return { json: { ...prev, createdId: body.id, hasCreatedId: true } };
`);

http('Read back doc', {
  method: 'GET',
  url: "={{ 'https://www.googleapis.com/drive/v3/files/' + $json.createdId + '?fields=id,name,mimeType,trashed,parents' }}",
  ...driveAuth(),
  options: responseOptions('json'),
});

code('Judge readback', 'runOnceForEachItem', `
const prev = $('After upload').item.json;
if ($json.error) {
  const error = 'drive readback failed: ' + httpErrorText($json);
  return { json: { ...prev, status: 'failed', persist: true, driveFileId: null, error: error, attempts: (prev.attempts || []).concat([{ method: 'drive_readback', error: error }]) } };
}
const meta = $json.body || $json;
const reason = Number($json.statusCode || 0) >= 400
  ? ('drive readback HTTP ' + $json.statusCode)
  : readbackFailure(meta, { name: prev.docName, folderId: prev.folderId });
if (reason) {
  const error = reason + (meta && meta.id ? ' id=' + meta.id : '');
  return { json: { ...prev, status: 'failed', persist: true, driveFileId: null, error: error, attempts: (prev.attempts || []).concat([{ method: 'drive_readback', error: error }]) } };
}
return { json: { ...prev, status: 'saved', persist: true, driveFileId: meta.id, error: null } };
`);

code('Outcome', 'runOnceForEachItem', `
const row = toOutcome($json);
const store = $getWorkflowStaticData('global');
if (!Array.isArray(store.outcomes)) store.outcomes = [];
store.outcomes.push(row);
return { json: { ...row, persist: row.persist === true, sql: row.persist ? upsertTranscriptQuery(row) : '' } };
`);

iff('Persist row?');
postgres('Upsert transcript', '={{ $json.sql }}');
code('Loop signal', 'runOnceForEachItem', `
return { json: { cont: true } };
`);

code('Summarize', 'runOnceForAllItems', `
const store = $getWorkflowStaticData('global');
let outcomes = Array.isArray(store.outcomes) ? store.outcomes.slice() : [];
store.outcomes = [];
if (!outcomes.length) {
  try { outcomes = $('Outcome').all().map((item) => item.json); } catch (error) { outcomes = []; }
}
const listed = $('List candidates').first().json;
let sourceFailures = listed.sourceFailures || [];
try {
  const picked = $('Pick folder').first().json;
  if (picked.driveError) sourceFailures = sourceFailures.concat([picked.driveError]);
} catch (error) {}
const summary = summarizeRun({
  outcomes: outcomes,
  sourceFailures: sourceFailures,
  limit: listed.limit,
});
return [{ json: {
  ...summary,
  runId: listed.runId,
  channel: listed.channel,
  healthUrl: listed.healthUrl,
  limit: listed.limit,
  monthStart: monthStartEt(new Date()),
  hasCredits: summary.credits > 0,
  hasFailures: summary.failed > 0,
  runOk: summary.ok,
} }];
`);

iff('Has failures?');
slackDm('Slack failure DM', "={{ $('Summarize').first().json.dm }}", "={{ $('Summarize').first().json.channel }}");

iff('Used credits?', "={{ $('Summarize').first().json.hasCredits }}");
postgres('Add monthly credits', '={{ $json.creditSql }}');
code('Prepare credit SQL', 'runOnceForAllItems', `
const summary = $('Summarize').first().json;
return [{ json: { ...summary, creditSql: creditIncrementQuery(summary.monthStart, summary.credits) } }];
`);

code('Decide warning', 'runOnceForAllItems', `
const summary = $('Prepare credit SQL').first().json;
const row = $input.first().json;
const alreadyWarned = row.warning_sent_at != null && row.warning_sent_at !== '';
const sendWarning = creditWarningNeeded({
  creditsUsed: row.credits_used,
  limit: summary.limit,
  alreadyWarned: alreadyWarned,
});
return [{ json: {
  ...summary,
  sendWarning: sendWarning,
  claimSql: creditClaimQuery(summary.monthStart, summary.limit),
  warningText: 'TRANSCRIPT CREDITS - monthly usage is ' + row.credits_used + ' of ' + summary.limit + ' (80% of MONTHLY_TRANSCRIPT_LIMIT).',
} }];
`);

iff('Send credit warning?');
postgres('Claim credit warning', '={{ $json.claimSql }}');
code('Warning claimed?', 'runOnceForAllItems', `
const prev = $('Decide warning').first().json;
const claimed = Number(($input.first().json && $input.first().json.claimed) || 0) === 1;
return [{ json: { ...prev, sendWarning: claimed } }];
`);

iff('Claimed warning?');
iff('Doc created?');

slackDm('Slack credit warning', "={{ $('Decide warning').first().json.warningText }}", "={{ $('Decide warning').first().json.channel }}");

code('Finish', 'runOnceForAllItems', `
const summary = $('Summarize').first().json;
const notes = [];
if (summary.transcriptApiNote) notes.push(summary.transcriptApiNote);
if (!summary.runOk) notes.push(summary.dm || 'failed');
return [{ json: {
  ...summary,
  finishSql: finishRunQuery({
    runId: summary.runId,
    status: summary.runOk ? 'ok' : 'failed',
    saved: summary.saved,
    waiting: summary.waiting,
    failed: summary.failed,
    credits: summary.credits,
    error: notes.length ? notes.join('\\n') : null,
  }),
  healthOk: healthUrlFor(summary.healthUrl, true),
  healthFail: healthUrlFor(summary.healthUrl, false),
} }];
`);

postgres('Patch run', "={{ $('Finish').first().json.finishSql }}");
iff('Run ok?', "={{ $('Finish').first().json.runOk }}");
http('Ping health ok', {
  method: 'GET',
  url: "={{ $('Finish').first().json.healthOk }}",
  options: {},
}, { retryOnFail: false, maxTries: 1, onError: 'continueRegularOutput' });
http('Ping health fail', {
  method: 'GET',
  url: "={{ $('Finish').first().json.healthFail }}",
  options: {},
}, { retryOnFail: false, maxTries: 1, onError: 'continueRegularOutput' });

function wire() {
  link('Manual run', 'Assert config');
  link('Weekday and Sunday schedule', 'Assert config');
  link('Assert config', 'Config ok?');
  link('Config ok?', 'Check Supadata', 0);
  link('Config ok?', 'No alert channel?', 1);
  link('No alert channel?', 'Record missing alert channel', 0);
  link('No alert channel?', 'Slack missing config', 1);
  link('Check Supadata', 'Require Supadata key', 0);
  link('Check Supadata', 'Require Supadata key', 1);
  link('Require Supadata key', 'Check yt-dlp version');
  link('Check yt-dlp version', 'Require pinned yt-dlp');
  link('Require pinned yt-dlp', 'Attach stale sweep');
  link('Attach stale sweep', 'Sweep stale runs');
  link('Sweep stale runs', 'Note stale');
  link('Note stale', 'Insert run');
  link('Insert run', 'Read sources');
  link('Read sources', 'Parse sources');
  link('Parse sources', 'Fan out sources');
  link('Fan out sources', 'Split sources');
  link('Split sources', 'List candidates', 0);
  link('Split sources', 'Source context', 1);
  link('Source context', 'YouTube source?');
  link('YouTube source?', 'YouTube ready', 0);
  link('YouTube source?', 'Podcast ready', 1);
  link('YouTube ready', 'Discover ready?');
  link('Discover ready?', 'Discover videos', 0);
  link('Discover ready?', 'Collect', 1);
  link('Discover videos', 'Parse discovery', 0);
  link('Discover videos', 'Parse discovery', 1);
  link('Parse discovery', 'YouTube items?');
  link('YouTube items?', 'Saved YouTube ids', 0);
  link('YouTube items?', 'No new YouTube ids', 1);
  link('Saved YouTube ids', 'Filter saved YouTube');
  link('Filter saved YouTube', 'Collect');
  link('No new YouTube ids', 'Collect');
  link('Podcast ready', 'Podcast ready?');
  link('Podcast ready?', 'Fetch podcast RSS', 0);
  link('Podcast ready?', 'Collect', 1);
  link('Fetch podcast RSS', 'Parse podcast feed', 0);
  link('Fetch podcast RSS', 'Parse podcast feed', 1);
  link('Parse podcast feed', 'Podcast items?');
  link('Podcast items?', 'Saved podcast ids', 0);
  link('Podcast items?', 'No undecided podcasts', 1);
  link('Saved podcast ids', 'Filter saved podcasts');
  link('Filter saved podcasts', 'Collect');
  link('No undecided podcasts', 'Collect');
  link('Collect', 'Split sources');
  link('List candidates', 'Anything to save?');
  link('Anything to save?', 'Find Drive folder', 0);
  link('Anything to save?', 'Summarize', 1);
  link('Find Drive folder', 'Pick folder', 0);
  link('Find Drive folder', 'Pick folder', 1);
  link('Pick folder', 'Drive ok?');
  link('Drive ok?', 'Need folder?', 0);
  link('Drive ok?', 'Summarize', 1);
  link('Need folder?', 'Create Drive folder', 0);
  link('Need folder?', 'Expand items', 1);
  link('Create Drive folder', 'Use created folder', 0);
  link('Create Drive folder', 'Use created folder', 1);
  link('Use created folder', 'Expand items');
  link('Expand items', 'Split items');
  link('Split items', 'Summarize', 0);
  link('Split items', 'Item route', 1);
  link('Item route', 'Already decided?');
  link('Already decided?', 'Outcome', 0);
  link('Already decided?', 'YouTube item?', 1);
  link('YouTube item?', 'Queue YouTube fetch', 0);
  link('YouTube item?', 'Podcast has VTT?', 1);
  link('Podcast has VTT?', 'Fetch feed VTT', 0);
  link('Podcast has VTT?', 'Outcome', 1);
  link('Queue YouTube fetch', 'Fetch transcript?');
  link('Fetch transcript?', 'Primary is Supadata?', 0);
  link('Fetch transcript?', 'Outcome', 1);
  link('Primary is Supadata?', 'Supadata primary', 0);
  link('Primary is Supadata?', 'TranscriptAPI primary', 1);
  link('Supadata primary', 'Interpret primary', 0);
  link('Supadata primary', 'Interpret primary', 1);
  link('TranscriptAPI primary', 'Interpret primary', 0);
  link('TranscriptAPI primary', 'Interpret primary', 1);
  link('Interpret primary', 'Need secondary?');
  link('Need secondary?', 'Secondary is Supadata?', 0);
  link('Need secondary?', 'Primary needs yt-dlp?', 1);
  link('Primary needs yt-dlp?', 'Run yt-dlp', 0);
  link('Primary needs yt-dlp?', 'Prepare save', 1);
  link('Secondary is Supadata?', 'Supadata secondary', 0);
  link('Secondary is Supadata?', 'TranscriptAPI secondary', 1);
  link('Supadata secondary', 'Interpret secondary', 0);
  link('Supadata secondary', 'Interpret secondary', 1);
  link('TranscriptAPI secondary', 'Interpret secondary', 0);
  link('TranscriptAPI secondary', 'Interpret secondary', 1);
  link('Interpret secondary', 'Need yt-dlp?');
  link('Need yt-dlp?', 'Run yt-dlp', 0);
  link('Need yt-dlp?', 'Prepare save', 1);
  link('Run yt-dlp', 'Apply yt-dlp', 0);
  link('Run yt-dlp', 'Apply yt-dlp', 1);
  link('Apply yt-dlp', 'Prepare save');
  link('Fetch feed VTT', 'Apply feed VTT', 0);
  link('Fetch feed VTT', 'Apply feed VTT', 1);
  link('Apply feed VTT', 'Prepare save');
  link('Prepare save', 'Write doc?');
  link('Write doc?', 'Create Google Doc', 0);
  link('Write doc?', 'Outcome', 1);
  link('Create Google Doc', 'After upload', 0);
  link('Create Google Doc', 'After upload', 1);
  link('After upload', 'Doc created?');
  link('Doc created?', 'Read back doc', 0);
  link('Doc created?', 'Outcome', 1);
  link('Read back doc', 'Judge readback', 0);
  link('Read back doc', 'Judge readback', 1);
  link('Judge readback', 'Outcome');
  link('Outcome', 'Persist row?');
  link('Persist row?', 'Upsert transcript', 0);
  link('Persist row?', 'Loop signal', 1);
  link('Upsert transcript', 'Loop signal');
  link('Loop signal', 'Split items');
  link('Summarize', 'Has failures?');
  link('Has failures?', 'Slack failure DM', 0);
  link('Has failures?', 'Used credits?', 1);
  link('Slack failure DM', 'Used credits?', 0);
  link('Slack failure DM', 'Used credits?', 1);
  link('Used credits?', 'Prepare credit SQL', 0);
  link('Used credits?', 'Finish', 1);
  link('Prepare credit SQL', 'Add monthly credits');
  link('Add monthly credits', 'Decide warning');
  link('Decide warning', 'Send credit warning?');
  link('Send credit warning?', 'Claim credit warning', 0);
  link('Send credit warning?', 'Finish', 1);
  link('Claim credit warning', 'Warning claimed?');
  link('Warning claimed?', 'Claimed warning?');
  link('Claimed warning?', 'Slack credit warning', 0);
  link('Claimed warning?', 'Finish', 1);
  link('Slack credit warning', 'Finish', 0);
  link('Slack credit warning', 'Finish', 1);
  link('Finish', 'Patch run');
  link('Patch run', 'Run ok?');
  link('Run ok?', 'Ping health ok', 0);
  link('Run ok?', 'Ping health fail', 1);
}

wire();

if (/\bimport\s/.test(prelude) || /^export\s/m.test(prelude)) {
  throw new Error('prelude still has import or export');
}

const names = new Set(nodes.map((node) => node.name));
for (const [from, value] of Object.entries(connections)) {
  if (!names.has(from)) throw new Error(`connection from unknown node ${from}`);
  for (const output of value.main) {
    for (const edge of output) {
      if (!names.has(edge.node)) throw new Error(`${from} links to unknown node ${edge.node}`);
    }
  }
}

const workflow = {
  name: 'Trading Transcripts',
  nodes,
  connections,
  settings: {
    executionOrder: 'v1',
    timezone: 'America/New_York',
  },
  staticData: null,
  meta: {
    templateCredsSetupCompleted: false,
    notes: [
      'Personal n8n only (market-alerts/deploy, container n8n-personal). Do not import this into the ChartSignl n8n service.',
      'Credentials: Postgres transcripts_n8n; Slack Bot; Supadata API Key as Header Auth name x-api-key (required); TranscriptAPI Bearer is optional; Google Drive OAuth (drive.file). No YouTube Data API key. No secrets in this file.',
      'Config is read from the container environment ($env), not n8n Variables: TRANSCRIPT_TIMEZONE, TRANSCRIPT_PROVIDER, MONTHLY_TRANSCRIPT_LIMIT, SLACK_ALERT_CHANNEL, HEALTHCHECK_TRANSCRIPTS_URL.',
      'YouTube items come from yt-dlp --flat-playlist on the channel /videos tab. Channel ids are hard-coded in transcripts/sources.json. A non-zero yt-dlp exit or zero videos fails the source.',
      'Provider endpoints checked 2026-11-04. Supadata GET https://api.supadata.ai/v1/transcript mode=native. TranscriptAPI GET https://transcriptapi.com/api/v2/youtube/transcript. An empty TranscriptAPI credential is skipped.',
      'yt-dlp is pinned to 2026.10.26 in the personal image. Keep the Trading Transcripts Drive folder unshared.',
      'Set the error workflow to Trading Transcripts — Error Handler after import.',
    ].join(' '),
  },
};

const out = join(repo, 'n8n', 'transcripts.json');
writeFileSync(out, JSON.stringify(workflow, null, 2));
console.log(`wrote ${out} (${nodes.length} nodes)`);
