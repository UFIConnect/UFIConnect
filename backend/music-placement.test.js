'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isMusicVideoPost, isVideoSurfacePost, isRegularFeedSurfacePost } = require('./video-placement');

test('song videos are exclusive to Music, including long concerts and non-YouTube sources', () => {
  for (const source of ['youtube', 'reddit', 'vimeo']) {
    const post = { source, mediaType: 'video', mediaUrl: source === 'youtube' ? 'https://youtube.com/watch?v=abcdefghijk' : 'https://example.com/song.mp4', title: 'Acoustic song - live performance', videoDurationSeconds: 1800 };
    assert.equal(isMusicVideoPost(post), true);
    assert.equal(isVideoSurfacePost(post), false);
    assert.equal(isRegularFeedSurfacePost(post), false);
  }
  assert.equal(isMusicVideoPost({ mediaType: 'video', mediaUrl: 'https://example.com/song.mp4', title: 'An untitled performance', categoryId: '10' }), true);
});

test('classification does not move music lessons, reviews or generic official videos', () => {
  for (const title of ['Music production tutorial', 'Music industry news', 'Camera official video', 'Music review']) {
    const post = { mediaType: 'video', mediaUrl: 'https://example.com/video.mp4', title, videoDurationSeconds: 60 };
    assert.equal(isMusicVideoPost(post), false);
    assert.equal(isVideoSurfacePost(post), true);
  }
  assert.equal(isMusicVideoPost({ mediaType: 'image', title: 'Pop song', mediaUrl: 'https://example.com/song.jpg' }), false);
});
