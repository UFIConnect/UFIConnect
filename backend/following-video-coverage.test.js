'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAppHarness, member } = require('./test-support/app-harness');

const feed = '/office/feed/videos/following';

function video(source, number) {
  return {
    id: `${source}-clip-${number}`, source, authorId: `followed-${source}`,
    sourceUrl: source === 'youtube'
      ? `https://www.youtube.com/watch?v=FixtureVid${number}`
      : `https://mastodon.social/@creator/${number}`,
    mediaUrl: source === 'mastodon' ? `https://media.example.org/clip-${number}.mp4` : null,
    title: 'A followed creator’s update', content: 'Highlights from the creator’s latest project.',
    createdAt: new Date(Date.now() - (10 - number) * 60000).toISOString(),
    mediaType: 'video', videoDurationSeconds: 60, isExternal: true,
  };
}

test('mixed Following video pages expose source coverage and explicit refresh updates the bounded pool', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const viewer = member('video-coverage', { socialTokens: {
    youtube: 'youtube-fixture', mastodon: 'mastodon-fixture', bluesky: 'bluesky-fixture',
    twitch: 'twitch-fixture', twitter: 'x-fixture', threads: 'threads-fixture',
  } });
  app.seedUser(viewer);
  const request = (query = '') => app.request(feed + query, { userId: viewer.id });
  let mastodonPosts = [video('mastodon', 1), video('mastodon', 2), video('mastodon', 3)];
  const youtubePosts = [video('youtube', 1), video('youtube', 2), video('youtube', 3)];
  const reads = [];
  app.setFollowingFetcher('mastodon', async (token, { bust }) => {
    assert.equal(token, 'mastodon-fixture');
    reads.push(bust);
    return mastodonPosts;
  });
  app.setFollowingFetcher('youtube', async () => youtubePosts);
  app.setFollowingFetcher('bluesky', async () => []);
  app.setFollowingFetcher('twitch', async () => { throw Object.assign(new Error('Provider denied timeline access.'), { status: 403 }); });
  app.setFollowingFetcher('twitter', async () => { throw Object.assign(new Error('HTTP 401'), { status: 401 }); });
  app.setFollowingFetcher('threads', async () => assert.fail('No Threads Following adapter is supported'));

  const first = await request('?limit=2');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Set(first.data.posts.map(post => post.source)), new Set(['youtube', 'mastodon']));
  assert.deepEqual(first.data.videoSources.mastodon, { status: 'available', videoCount: 3 });
  assert.deepEqual(first.data.videoSources.youtube, { status: 'available', videoCount: 3 });
  assert.deepEqual(first.data.videoSources.bluesky, { status: 'no_videos', videoCount: 0 });
  assert.deepEqual(first.data.videoSources.reddit, { status: 'not_connected' });
  assert.deepEqual(first.data.videoSources.twitch, { status: 'access_unavailable' });
  assert.deepEqual(first.data.videoSources.twitter, { status: 'reconnect_required' });
  assert.equal(first.data.videoSources.threads, undefined);
  const second = await request(`?limit=2&cursor=${encodeURIComponent(first.data.cursor)}`);
  const third = await request(`?limit=2&cursor=${encodeURIComponent(second.data.cursor)}`);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(third.data.waitingForNew, true);
  const ids = [first, second, third].flatMap(result => result.data.posts.map(post => post.id));
  assert.deepEqual(ids.sort(), [...mastodonPosts, ...youtubePosts].map(post => post.id).sort());
  assert.deepEqual(reads, [false], 'Pagination uses the authenticated cached pool');

  mastodonPosts = [video('mastodon', 4), ...mastodonPosts];
  const filtered = await request('?source=mastodon');
  assert.equal(filtered.data.posts.length, 3);
  assert.deepEqual(Object.keys(filtered.data.videoSources), ['mastodon']);
  const refreshed = await request('?source=mastodon&bust=1');
  assert.equal(refreshed.data.posts.length, 4);
  assert.deepEqual(refreshed.data.videoSources.mastodon, { status: 'available', videoCount: 4 });
  assert.deepEqual(reads, [false, true]);
});

test('cached and in-flight Following videos respect a replaced or disconnected account', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const viewer = member('video-reconnect', { socialTokens: { mastodon: 'old-grant', youtube: 'youtube-grant' } });
  app.seedUser(viewer);
  app.setFollowingFetcher('youtube', async () => [video('youtube', 1)]);
  const inFlight = Promise.withResolvers();
  const release = Promise.withResolvers();
  app.setFollowingFetcher('mastodon', async (token, { bust }) => {
    if (token === 'old-grant') return [video('mastodon', 1)];
    assert.equal(token, 'new-grant');
    if (bust) {
      inFlight.resolve();
      await release.promise;
    }
    return [video('mastodon', 2)];
  });
  const request = (query = '') => app.request(feed + query, { userId: viewer.id });
  assert.ok((await request()).data.posts.some(post => post.id === 'mastodon-clip-1'));

  // Simulate another worker replacing the account without purging this worker’s cache.
  viewer.socialTokens.mastodon = 'new-grant';
  const replaced = await request();
  assert.ok(replaced.data.posts.some(post => post.id === 'mastodon-clip-2'));
  assert.ok(!replaced.data.posts.some(post => post.id === 'mastodon-clip-1'));

  const pending = request('?bust=1');
  await Promise.race([inFlight.promise, pending.then(() => assert.fail('Expected an in-flight Mastodon read'))]);
  try {
    const disconnected = await app.request('/social/connect/mastodon', { method: 'DELETE', userId: viewer.id });
    assert.equal(disconnected.status, 200);
  } finally {
    release.resolve();
  }
  const afterDisconnection = await pending;
  assert.deepEqual(afterDisconnection.data.posts.map(post => post.source), ['youtube']);
  assert.deepEqual(afterDisconnection.data.videoSources.mastodon, { status: 'not_connected' });
  const next = await request(`?page=2&cursor=${encodeURIComponent(replaced.data.cursor)}`);
  assert.ok(next.data.posts.every(post => post.source !== 'mastodon'));
  assert.deepEqual(next.data.videoSources.mastodon, { status: 'not_connected' });
});
