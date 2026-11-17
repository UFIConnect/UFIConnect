'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: settle } = require('node:timers/promises');
const { createAppHarness, member } = require('./test-support/app-harness');
const snaps = require('./snaps');
const { PUBLIC_CLIP_QUERY } = require('./external-snaps');

const combinedUrl = '/office/feed?mode=following&passive=1&bust=1&includeSnaps=1';
const followingSnaps = '/snaps?mode=following';
const sourceUrls = {
  mastodon: 'https://mastodon.social/@creator/123',
  bluesky: 'https://bsky.app/profile/creator.bsky.social/post/clip1',
  reddit: 'https://www.reddit.com/r/gardening/comments/abc123/clip/',
  twitch: 'https://clips.twitch.tv/CreatorClip-abc123',
  twitter: 'https://x.com/creator/status/123',
  youtube: 'https://www.youtube.com/shorts/abcdefghijk',
};
const sources = Object.keys(sourceUrls);

function sourcePost(source, revision, media = {}) {
  return { id: `${source}-${revision}`, source, sourceUrl: sourceUrls[source], authorId: `${source}-author`,
    title: 'Source update', content: 'A useful update from a followed account.',
    createdAt: new Date(Date.now() - 1000).toISOString(), isExternal: true, ...media };
}

function sourceClip(source, revision) {
  return sourcePost(source, revision, { mediaType: 'video', videoDurationSeconds: 30,
    mediaUrl: source === 'youtube' ? sourceUrls.youtube : 'https://media.example.com/clip.mp4' });
}

function snapStorage(list) {
  return { './snaps': { ...snaps, createSnaps: options => ({ ...snaps.createSnaps(options), list }) } };
}

function seedViewer(app, id, availableSources, disabledSources = []) {
  app.seedUser(member(id, { socialTokens: Object.fromEntries(availableSources.map(source => [source, source + '-token'])),
    roleSettings: { disabledSources } }));
  for (const source of availableSources) {
    app.seedFollowingCache(id, source, { posts: [sourceClip(source, 'old-clip')], fetchedAt: Date.now() });
  }
  return { userId: id };
}

test('a filtered Following refresh returns fresh clips from all authorized sources and reads the selected provider once', { timeout: 10000 }, async t => {
  const nativeGate = Promise.withResolvers();
  const matchedSourceFetched = Promise.withResolvers();
  let delayNative = false;
  const app = await createAppHarness({ modules: snapStorage(async () => {
    if (delayNative) await nativeGate.promise;
    return [{ id: 'native-snap', source: 'uficonnect' }];
  }) });
  t.after(async () => { nativeGate.resolve(); await app.close(); });
  const viewer = seedViewer(app, 'following-refresh', [...sources, 'facebook']);
  const calls = [];
  for (const source of sources) {
    app.setFollowingFetcher(source, async (token, { bust }) => {
      assert.equal(token, source + '-token');
      assert.equal(bust, true);
      calls.push(source);
      if (source === 'mastodon') matchedSourceFetched.resolve();
      const clip = sourceClip(source, 'new-clip');
      return source === 'mastodon' ? [clip, sourcePost(source, 'fresh-post')] : [clip];
    });
  }
  const warm = await app.request(followingSnaps, viewer);
  assert.equal(warm.status, 200);
  assert.deepEqual(warm.data.snaps.map(item => item.id).sort(),
    ['native-snap', ...sources.map(source => source + '-old-clip')].sort());
  const passivePosts = await app.request('/office/feed?mode=following&passive=1&includeSnaps=1', viewer);
  assert.equal(passivePosts.data.snapFeed, undefined);
  assert.deepEqual(calls, []);

  delayNative = true;
  const pending = app.request(combinedUrl + '&source=mastodon', viewer);
  await matchedSourceFetched.promise;
  await settle();
  // Mastodon's queue entry has completed before the rail reaches that source.
  assert.equal(app.followingRefreshQueue.status().active, 0);
  assert.deepEqual(calls, ['mastodon']);
  nativeGate.resolve();

  const refreshed = await pending;
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(refreshed.data.posts.map(post => post.id), ['mastodon-fresh-post']);
  assert.deepEqual(refreshed.data.snapFeed.snaps.map(item => item.id).sort(),
    ['native-snap', ...sources.map(source => source + '-new-clip')].sort());
  assert.deepEqual(refreshed.data.snapFeed.sourceErrors, {});
  assert.deepEqual(calls.sort(), [...sources].sort());
  assert.equal((await app.request(combinedUrl)).status, 401);
});

test('standalone all-source Snap refreshes bypass warm caches, join in-flight reads, and skip disabled connections', { timeout: 10000 }, async t => {
  const providerGate = Promise.withResolvers();
  const bothRailsStarted = Promise.withResolvers();
  let nativeReads = 0;
  const app = await createAppHarness({ modules: snapStorage(async () => {
    if (++nativeReads === 2) bothRailsStarted.resolve();
    return [];
  }) });
  t.after(async () => { providerGate.resolve(); await app.close(); });
  const viewer = seedViewer(app, 'overlapping-refresh', ['mastodon', 'bluesky', 'twitter'], ['twitter']);
  let mastodonReads = 0, blueskyReads = 0, disabledReads = 0;
  app.setFollowingFetcher('mastodon', async (_token, { bust }) => {
    mastodonReads++;
    assert.equal(bust, true);
    await providerGate.promise;
    return [sourceClip('mastodon', 'concurrent')];
  });
  app.setFollowingFetcher('bluesky', async () => {
    blueskyReads++;
    await providerGate.promise;
    return [sourceClip('bluesky', 'refreshed')];
  });
  app.setFollowingFetcher('twitter', async () => { disabledReads++; return []; });
  const parallel = app.request(followingSnaps + '&bust=1', viewer);
  const forced = app.request(followingSnaps + '&bust=1', viewer);
  await bothRailsStarted.promise;
  await settle();
  assert.equal(mastodonReads, 1);
  providerGate.resolve();
  const [first, second] = await Promise.all([parallel, forced]);
  for (const response of [first, second]) {
    assert.equal(response.status, 200);
    assert.ok(response.data.snaps.some(item => item.id === 'mastodon-concurrent'));
    assert.ok(response.data.snaps.every(item => item.source !== 'twitter'));
  }
  assert.ok(second.data.snaps.some(item => item.id === 'bluesky-refreshed'));
  assert.deepEqual([mastodonReads, blueskyReads, disabledReads], [1, 1, 0]);
});

test('one provider failure leaves other Following results current and a later pull can recover it', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const viewer = seedViewer(app, 'failed-refresh', ['mastodon', 'bluesky', 'twitter'], ['twitter']);
  let mastodonDown = true;
  const calls = [];
  app.setFollowingFetcher('mastodon', async () => {
    calls.push('mastodon');
    if (mastodonDown) throw new Error('Mastodon is temporarily unavailable.');
    return [sourceClip('mastodon', 'recovered'), sourcePost('mastodon', 'fresh-post')];
  });
  app.setFollowingFetcher('bluesky', async () => {
    calls.push('bluesky');
    return [sourceClip('bluesky', 'current'), sourcePost('bluesky', 'fresh-post')];
  });
  app.setFollowingFetcher('twitter', async () => { calls.push('twitter'); return []; });

  const first = await app.request(combinedUrl, viewer);
  assert.equal(first.status, 200);
  assert.ok(first.data.posts.some(post => post.id === 'bluesky-fresh-post'));
  assert.ok(first.data.posts.every(post => post.source === 'bluesky'));
  assert.deepEqual(first.data.snapFeed.snaps.map(item => item.id), ['bluesky-current']);
  assert.deepEqual(first.data.sourceErrors, { mastodon: 'Mastodon is temporarily unavailable.' });
  assert.deepEqual(first.data.snapFeed.sourceErrors, first.data.sourceErrors);
  assert.deepEqual(calls.splice(0).sort(), ['bluesky', 'mastodon']);

  mastodonDown = false;
  const second = await app.request(combinedUrl, viewer);
  assert.deepEqual(second.data.snapFeed.snaps.map(item => item.id).sort(), ['bluesky-current', 'mastodon-recovered']);
  assert.deepEqual(second.data.snapFeed.sourceErrors, {});
  assert.deepEqual(calls.sort(), ['bluesky', 'mastodon']);
});

test('public Snap refresh rereads the collected inventory without starting provider collection', async t => {
  let revision = 'old', reads = 0;
  const app = await createAppHarness({
    connected: true,
    query: async sql => {
      if (sql !== PUBLIC_CLIP_QUERY) return { rows: [] };
      reads++;
      const clip = sourceClip('mastodon', revision);
      return { rows: [{ id: clip.id, source: clip.source, source_url: clip.sourceUrl, media_url: clip.mediaUrl,
        media_type: clip.mediaType, video_duration_seconds: clip.videoDurationSeconds, post_created_at: clip.createdAt,
        title: clip.title, content: clip.content }] };
    },
  });
  t.after(() => app.close());
  const url = '/snaps?mode=home';
  const readClip = async path => {
    const response = await app.request(path);
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.sourceErrors, {});
    return response.data.snaps[0]?.id;
  };
  assert.equal(await readClip(url), 'mastodon-old');
  revision = 'fresh';
  assert.equal(await readClip(url), 'mastodon-old');
  assert.equal(reads, 1);
  assert.equal(await readClip(url + '&bust=1'), 'mastodon-fresh');
  assert.equal(reads, 2);
});
