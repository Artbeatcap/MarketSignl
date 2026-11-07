import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const workflow = JSON.parse(readFileSync(new URL('../../n8n/transcripts.json', import.meta.url), 'utf8'));
const sources = JSON.parse(readFileSync(new URL('../sources.json', import.meta.url), 'utf8'));
const chartsignlCompose = readFileSync(new URL('../../../apps/backend/deploy/docker-compose.yml', import.meta.url), 'utf8');
const personalCompose = readFileSync(new URL('../../deploy/docker-compose.yml', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../../deploy/Dockerfile', import.meta.url), 'utf8');

function node(name) {
  const found = workflow.nodes.find((item) => item.name === name);
  assert.ok(found, `missing node ${name}`);
  return found;
}

describe('transcript workflow', () => {
  it('is scheduled in America/New_York and fails closed', () => {
    assert.equal(workflow.settings.timezone, 'America/New_York');
    const crons = node('Weekday and Sunday schedule').parameters.rule.interval.map((rule) => rule.expression);
    assert.deepEqual(crons, [
      '10 6 * * 1-5',
      '40 20 * * 1-5',
      '40 16 * * 0',
      '30 18 * * 0',
      '15 19 * * 0',
      '0 20 * * 0',
    ]);
    assert.match(node('Assert config').parameters.jsCode, /timezone mismatch/);
    assert.match(node('Require pinned yt-dlp').parameters.jsCode, /yt-dlp version mismatch/);
  });

  it('wires the current provider endpoints and yt-dlp backup', () => {
    const blob = JSON.stringify(workflow);
    assert.match(blob, /https:\/\/api\.supadata\.ai\/v1\/transcript/);
    assert.match(blob, /mode=native|mode: 'native'/);
    assert.match(blob, /x-api-key/);
    assert.match(blob, /https:\/\/transcriptapi\.com\/api\/v2\/youtube\/transcript/);
    assert.doesNotMatch(blob, /feeds\/videos\.xml/);
    assert.match(blob, /--flat-playlist/);
    assert.match(blob, /--playlist-end 5/);
    assert.match(blob, /\/videos/);
    assert.match(blob, /store\.outcomes/);
    assert.match(node('Find Drive folder').parameters.url, /1InBLV4SvbDj4_mhsNk_D7VZR3un-Bp5q/);
    assert.doesNotMatch(node('Find Drive folder').parameters.url, /name%3D/);
    assert.match(node('Apply feed VTT').parameters.jsCode, /\$json\.data/);
    assert.deepEqual(
      sources.find((source) => source.slug === 'lance-b'),
      { slug: 'lance-b', type: 'youtube_channel', channel_id: 'UCzksXiC-Ju-DTIZmMiaOVfQ' },
    );
    assert.match(blob, /transcriptapi: skipped \(no credential\)/);
    assert.match(blob, /Supadata API Key missing/);
    assert.match(blob, /missing config:/);
    assert.match(blob, /no alert channel/);
    assert.match(blob, /\$env/);
    assert.doesNotMatch(blob, /\$vars/);
    assert.equal(node('Slack failure DM').parameters.select, 'user');
    assert.ok(node('Check Supadata').credentials.httpHeaderAuth);
    assert.equal(node('Check Supadata').parameters.credentials, undefined);
    assert.ok(node('Supadata primary').credentials.httpHeaderAuth);
    assert.ok(node('Supadata secondary').credentials.httpHeaderAuth);
    assert.ok(node('Create Google Doc').credentials.googleDriveOAuth2Api);
    assert.doesNotMatch(blob, /googleapis\.com\/youtube\/v3/);
    assert.doesNotMatch(blob, /YouTube Data API Key/);
    assert.match(blob, /--skip-download/);
    assert.match(blob, /--write-auto-subs/);
    assert.match(blob, /--sub-langs en/);
    assert.match(blob, /--sub-format vtt/);
    assert.match(blob, /TRANSCRIPT FETCH FAILED - /);
    assert.match(blob, /Trading Transcripts/);
    assert.doesNotMatch(blob, /AIza[0-9A-Za-z_-]{10,}/);
    assert.doesNotMatch(blob, /xoxb-/);
    assert.doesNotMatch(blob, /sk-[A-Za-z0-9]{10,}/);
  });

  it('loops on the splitInBatches v3 loop output', () => {
    assert.equal(workflow.connections['Split sources'].main[1][0].node, 'Source context');
    assert.equal(workflow.connections['Split sources'].main[0][0].node, 'List candidates');
    assert.equal(workflow.connections['Split items'].main[1][0].node, 'Item route');
    assert.equal(workflow.connections['Split items'].main[0][0].node, 'Summarize');
  });

  it('compiles every code node', () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    for (const item of workflow.nodes) {
      if (!item.parameters?.jsCode) continue;
      assert.doesNotThrow(() => new AsyncFunction(item.parameters.jsCode), item.name);
    }
  });
});

describe('personal n8n container', () => {
  it('does not change the ChartSignl n8n service', () => {
    assert.match(chartsignlCompose, /container_name: n8n\b/);
    assert.match(chartsignlCompose, /image: docker\.n8n\.io\/n8nio\/n8n\n/);
    assert.doesNotMatch(chartsignlCompose, /yt-dlp/);
    assert.doesNotMatch(chartsignlCompose, /n8n-personal/);
  });

  it('pins yt-dlp on n8n-personal only', () => {
    assert.match(personalCompose, /container_name: n8n-personal/);
    assert.match(personalCompose, /5679:5678/);
    assert.match(personalCompose, /N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"/);
    assert.match(personalCompose, /NODES_EXCLUDE: '\["n8n-nodes-base.localFileTrigger"\]'/);
    assert.doesNotMatch(personalCompose, /executeCommand/);
    assert.match(personalCompose, /\.\.\/transcripts\/\.env/);
    assert.doesNotMatch(personalCompose, /HEALTHCHECK_TRANSCRIPTS_URL:/);
    assert.doesNotMatch(personalCompose, /SLACK_ALERT_CHANNEL:/);
    assert.match(dockerfile, /yt-dlp==2026\.10\.26/);
    assert.match(dockerfile, /n8n:2\.46\.6/);
    assert.match(dockerfile, /ca-certificates deno/);
    assert.match(dockerfile, /\/usr\/local\/bin\/deno/);
    assert.doesNotMatch(personalCompose, /SUPADATA|TRANSCRIPTAPI_KEY|YOUTUBE_API_KEY/);
  });
});
