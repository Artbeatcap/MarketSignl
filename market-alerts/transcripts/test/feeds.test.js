import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyYouTubeVideo,
  dropAlreadySaved,
  parseItunesDuration,
  parsePodcastFeed,
  durationsFromProbe,
  keepLongYouTubeVideos,
  parseYouTubeChannelFeed,
  podcastTranscriptDecision,
  youtubeFeedAuthor,
} from '../lib/feeds.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('feeds', () => {
  it('skips shorts links and videos of 180 seconds or less', () => {
    const xml = `<?xml version="1.0"?><feed>
      <author><name>TheOneLanceB</name></author>
      <entry>
        <yt:videoId>shortvideo1</yt:videoId>
        <title>A short</title>
        <link rel="alternate" href="https://www.youtube.com/shorts/shortvideo1"/>
        <published>2026-11-06T15:00:00+00:00</published>
      </entry>
      <entry>
        <yt:videoId>threeMinVid</yt:videoId>
        <title>Exactly three minutes</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=threeMinVid"/>
        <published>2026-11-05T15:00:00+00:00</published>
        <media:group><media:content duration="180" type="video/mp4"/></media:group>
      </entry>
      <entry>
        <yt:videoId>longvideo01</yt:videoId>
        <title>Long form</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=longvideo01"/>
        <published>2026-11-04T15:00:00+00:00</published>
      </entry>
    </feed>`;
    assert.equal(youtubeFeedAuthor(xml), 'TheOneLanceB');
    const parsed = parseYouTubeChannelFeed(xml, { limit: 15 });
    assert.deepEqual(parsed.map((item) => item.itemId), ['longvideo01']);
    const probed = keepLongYouTubeVideos(
      [
        { itemId: 'shortvideo1', url: 'https://www.youtube.com/shorts/shortvideo1', title: 'A short' },
        { itemId: 'threeMinVid', url: 'https://www.youtube.com/watch?v=threeMinVid', title: 'Exactly three minutes' },
        { itemId: 'longvideo01', url: 'https://www.youtube.com/watch?v=longvideo01', title: 'Long form' },
      ],
      { threeMinVid: 180, longvideo01: 181 },
      { limit: 5 },
    );
    assert.deepEqual(probed.map((item) => item.itemId), ['longvideo01']);
    assert.equal(probed[0].durationSeconds, 181);
  });

  it('parses a YouTube channel RSS feed', () => {
    const items = parseYouTubeChannelFeed(fixture('youtube-feed.xml'));
    assert.equal(items.length, 2);
    assert.equal(items[0].itemId, 'jzpi6KNr0Dg');
    assert.equal(items[0].title, 'These Sectors Are Setting Up For Big Moves!');
    assert.equal(items[0].url, 'https://www.youtube.com/watch?v=jzpi6KNr0Dg');
    assert.equal(items[0].publishedAt, '2026-11-04T15:00:00.000Z');
  });

  it('parses podcast RSS that includes podcast:transcript', () => {
    const items = parsePodcastFeed(fixture('podcast-with-transcript.xml'));
    assert.equal(items.length, 1);
    assert.equal(items[0].itemId, 'dc7b25ff-f033-45be-8c1d-3fcc70e118db');
    assert.equal(items[0].transcriptUrl, 'https://example.com/oct27.vtt');
    assert.equal(items[0].transcriptType, 'text/vtt');
    assert.equal(items[0].durationSeconds, 7350);
    assert.equal(items[0].publishedAt, '2026-10-27T02:15:21.000Z');
    assert.match(items[0].title, /NOVEMBER RALLY & 2 TOP CHIP STOCKS/);
  });

  it('parses podcast RSS without podcast:transcript', () => {
    const items = parsePodcastFeed(fixture('podcast-without-transcript.xml'));
    assert.equal(items.length, 2);
    assert.equal(items[0].transcriptUrl, null);
    assert.equal(items[1].transcriptUrl, null);
    assert.equal(items[0].durationSeconds, 3723);
  });

  it('waits under 7 days and notices once after that when no transcript is in the feed', () => {
    const recent = podcastTranscriptDecision({
      transcriptUrl: null,
      publishedAt: '2026-11-04T18:00:00.000Z',
      now: new Date('2026-11-10T18:00:00.000Z'),
    });
    assert.equal(recent.action, 'waiting');

    const at7d = podcastTranscriptDecision({
      transcriptUrl: null,
      publishedAt: '2026-11-01T18:00:00.000Z',
      now: new Date('2026-11-08T18:00:00.000Z'),
    });
    assert.equal(at7d.action, 'notice');
    assert.equal(at7d.reason, 'no transcript after 7 days');

    const old = podcastTranscriptDecision({
      transcriptUrl: null,
      publishedAt: '2026-06-01T18:00:00.000Z',
      now: new Date('2026-11-04T18:00:00.000Z'),
    });
    assert.equal(old.action, 'notice');

    const ready = podcastTranscriptDecision({
      transcriptUrl: 'https://example.com/a.vtt',
      publishedAt: '2020-01-01T00:00:00.000Z',
    });
    assert.equal(ready.action, 'fetch');
    assert.equal(ready.method, 'feed_vtt');
  });

  it('skips shorts and defers live streams that have not ended', () => {
    assert.equal(classifyYouTubeVideo({ duration: 'PT45S', liveBroadcastContent: 'none' }).action, 'skip');
    assert.equal(classifyYouTubeVideo({ duration: 'PT3M', liveBroadcastContent: 'none' }).action, 'skip');
    assert.equal(classifyYouTubeVideo({ duration: 'PT20M1S', liveBroadcastContent: 'none' }).action, 'fetch');
    const live = classifyYouTubeVideo({ duration: 'PT1H', liveBroadcastContent: 'live' });
    assert.equal(live.action, 'defer');
    assert.match(live.reason, /not ended/);
    const ended = classifyYouTubeVideo({
      duration: 'PT1H',
      liveBroadcastContent: 'live',
      actualEndTime: '2026-11-04T16:00:00Z',
    });
    assert.equal(ended.action, 'fetch');
  });

  it('keeps only items that are not already saved', () => {
    const items = [{ itemId: 'a' }, { itemId: 'b' }];
    assert.deepEqual(dropAlreadySaved(items, ['a']).map((item) => item.itemId), ['b']);
  });

  it('parses itunes durations', () => {
    assert.equal(parseItunesDuration('7350'), 7350);
    assert.equal(parseItunesDuration('1:02:03'), 3723);
  });
});
