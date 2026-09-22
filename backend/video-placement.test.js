'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VIDEO_FEED_MAX_DURATION_SECONDS,
  isVideoSurfacePost,
  isRegularFeedSurfacePost,
  continuousVideoPageMeta,
  isMusicVideoPost,
  normalizeVideoDurationSeconds,
} = require('./video-placement');

function youtubePost(overrides = {}) {
  return {
    id: 'youtube_abcdefghijk',
    source: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    mediaType: 'video',
    ...overrides,
  };
}

test('Videos and Music reject every known duration below five seconds but keep the boundary and unknown live streams', () => {
  for (const seconds of [0.2, 1, 4, 4.99]) {
    assert.equal(isVideoSurfacePost(youtubePost({ videoDurationSeconds: seconds })), false);
    assert.equal(isMusicVideoPost(youtubePost({ videoDurationSeconds: seconds, title: 'Official song' })), false);
    assert.ok(normalizeVideoDurationSeconds(seconds) < 5, 'storage normalization cannot round a short clip up to five');
  }
  for (const seconds of [5, 6, null, undefined, 0]) {
    assert.equal(isVideoSurfacePost(youtubePost({ videoDurationSeconds: seconds })), true);
    assert.equal(isMusicVideoPost(youtubePost({ videoDurationSeconds: seconds, title: 'Official song' })), true);
  }
  assert.equal(isVideoSurfacePost(youtubePost({ video_duration_seconds: 4 })), false);
});

test('keeps clips through 15 minutes in Videos and long-form video in Home', () => {
  const clip = youtubePost({ videoDurationSeconds: VIDEO_FEED_MAX_DURATION_SECONDS });
  const longForm = youtubePost({ videoDurationSeconds: VIDEO_FEED_MAX_DURATION_SECONDS + 1 });

  assert.equal(isVideoSurfacePost(clip), true);
  assert.equal(isRegularFeedSurfacePost(clip), false);
  assert.equal(isVideoSurfacePost(longForm), false);
  assert.equal(isRegularFeedSurfacePost(longForm), true);
});

test('keeps legacy unknown-duration video reachable while metadata is backfilled', () => {
  const legacy = youtubePost();
  assert.equal(isVideoSurfacePost(legacy), true);
  assert.equal(isRegularFeedSurfacePost(legacy), true);
});

test('recognizes a legacy Shorts URL as Videos-only', () => {
  const short = youtubePost({ sourceUrl: 'https://www.youtube.com/shorts/abcdefghijk' });
  assert.equal(isVideoSurfacePost(short), true);
  assert.equal(isRegularFeedSurfacePost(short), false);
});

test('keeps non-video posts in regular feeds only', () => {
  const article = { id: 'article-1', source: 'medium', mediaType: 'image', mediaUrl: 'https://example.com/photo.jpg' };
  assert.equal(isVideoSurfacePost(article), false);
  assert.equal(isRegularFeedSurfacePost(article), true);
});

test('keeps an unsearched Videos tail open after retained history is exhausted', () => {
  assert.deepEqual(continuousVideoPageMeta({}, false), {
    hasMore: true,
    waitingForNew: true,
  });
  assert.deepEqual(continuousVideoPageMeta({ source: 'reddit' }, true), {
    hasMore: true,
    waitingForNew: false,
  });
});

test('lets explicit video searches end normally', () => {
  assert.deepEqual(continuousVideoPageMeta({ q: 'design systems' }, false), {
    hasMore: false,
    waitingForNew: false,
  });
});
