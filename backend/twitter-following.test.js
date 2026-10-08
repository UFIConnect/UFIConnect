'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTwitterFollowingFetcher, mapTwitterTimeline } = require('./twitter-following');
const { createAppHarness, member } = require('./test-support/app-harness');

function timeline() {
  return { data: [{ id: '101', author_id: '7', created_at: new Date(Date.now() - 60_000).toISOString(),
    text: 'A real update from a followed creator https://t.co/link', entities: { urls: [{ url: 'https://t.co/link', expanded_url: 'https://example.com/details' }] },
    attachments: { media_keys: ['photo'] }, public_metrics: { like_count: 12, reply_count: 3 } }],
  includes: { users: [{ id: '7', name: 'A Creator', username: 'creator', profile_image_url: 'https://pbs.twimg.com/creator.jpg' }],
    media: [{ media_key: 'photo', type: 'photo', url: 'https://pbs.twimg.com/photo.jpg' }] }, meta: { result_count: 1 } };
}

test('X Following reads only an authenticated home timeline and maps original attribution, links and media', async () => {
  const calls = [];
  const fetcher = createTwitterFollowingFetcher({ fetchJSON: async (url, headers) => {
    calls.push(new URL(url)); assert.equal(headers.Authorization, 'Bearer fixture-access');
    return calls.length === 1 ? { data: { id: '9' } } : timeline();
  } });
  const posts = await fetcher('fixture-access');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].href, 'https://api.x.com/2/users/me');
  assert.equal(calls[1].pathname, '/2/users/9/timelines/reverse_chronological');
  assert.equal(calls[1].searchParams.get('max_results'), '50');
  assert.ok(calls[1].searchParams.get('expansions').includes('attachments.media_keys'));
  assert.equal(calls[1].searchParams.has('query'), false);
  assert.equal(calls.some(url => url.href.includes('fixture-access')), false);
  assert.equal(posts[0].sourceUrl, 'https://x.com/creator/status/101');
  assert.equal(posts[0].author.profileUrl, 'https://x.com/creator');
  assert.equal(posts[0].content, 'A real update from a followed creator https://example.com/details');
  assert.equal(posts[0].mediaType, 'image'); assert.equal(posts[0].mediaUrl, 'https://pbs.twimg.com/photo.jpg');
  assert.equal(posts[0].likesCount, 12); assert.equal(posts[0].commentsCount, 3);
  assert.equal(posts[0].matchedByInterest, undefined);
});

test('X clips keep playable video, duration and poster; malformed IDs and unsafe media do not become links', () => {
  const raw = timeline();
  raw.data[0].attachments.media_keys = ['video'];
  raw.includes.media = [{ media_key: 'video', type: 'video', duration_ms: 15_500, preview_image_url: 'https://pbs.twimg.com/poster.jpg', variants: [
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/high.m3u8' },
    { content_type: 'video/mp4', bit_rate: 256000, url: 'https://video.twimg.com/clip.mp4' },
    { content_type: 'video/mp4', bit_rate: 1024000, url: 'https://video.twimg.com/large.mp4' },
    { content_type: 'video/mp4', bit_rate: 0, url: 'javascript:unsafe' },
  ] }];
  const [clip] = mapTwitterTimeline(raw);
  assert.equal(clip.mediaType, 'video'); assert.equal(clip.mediaUrl, 'https://video.twimg.com/clip.mp4');
  assert.equal(clip.mediaPoster, 'https://pbs.twimg.com/poster.jpg'); assert.equal(clip.videoDurationSeconds, 15.5);
  raw.includes.media[0].variants = []; raw.includes.media[0].preview_image_url = 'https://pbs.twimg.com/poster.jpg';
  assert.equal(mapTwitterTimeline(raw)[0].mediaType, 'image', 'An unavailable video is a poster, not a fake playable clip');
  raw.data[0].id = '../other-user'; assert.deepEqual(mapTwitterTimeline(raw), []);
});

for (const [status, expected] of [[401, /expired.*Reconnect/], [402, /credits or paid access/], [403, /denied timeline access/], [429, /limited timeline requests/]]) {
  test(`X ${status} produces a safe, actionable source error without a public search fallback`, async () => {
    let calls = 0;
    const fetcher = createTwitterFollowingFetcher({ fetchJSON: async () => { calls++; throw new Error(`HTTP ${status}: fixture-access fixture-refresh`); } });
    await assert.rejects(fetcher('fixture-access'), error => {
      assert.match(error.message, expected); assert.equal(error.status, status);
      assert.equal(error.message.includes('fixture-access'), false); assert.equal(error.message.includes('fixture-refresh'), false);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test('missing user permission and an empty real timeline stay empty without using app access or discovery', async () => {
  let calls = 0;
  const fetcher = createTwitterFollowingFetcher({ fetchJSON: async () => { calls++; return calls === 1 ? { data: { id: '9' } } : { meta: { result_count: 0 } }; } });
  assert.deepEqual(await fetcher(''), []); assert.equal(calls, 0);
  assert.deepEqual(await fetcher('fixture-access'), []); assert.equal(calls, 2);
});

test('timeline refreshes reuse verified account identity without sharing another member’s token', async () => {
  let clock = Date.now(); const calls = [];
  const fetcher = createTwitterFollowingFetcher({ now: () => clock, fetchJSON: async (url, headers) => {
    calls.push({ url: new URL(url), access: headers.Authorization });
    return new URL(url).pathname === '/2/users/me' ? { data: { id: headers.Authorization === 'Bearer alice' ? '9' : '10' } } : timeline();
  } });
  await fetcher('alice'); await fetcher('alice'); await fetcher('bob');
  assert.equal(calls.filter(call => call.url.pathname === '/2/users/me').length, 2);
  assert.equal(calls.at(-1).url.pathname, '/2/users/10/timelines/reverse_chronological');
  assert.equal(calls.at(-1).access, 'Bearer bob');
  clock += 60 * 60 * 1000; await fetcher('alice');
  assert.equal(calls.filter(call => call.url.pathname === '/2/users/me').length, 3);
});

function jsonModule(fetchJSON) {
  return { createProviderJsonClient: () => ({ fetchJSON, fetchJSONWithHeaders: async (...args) => ({ data: await fetchJSON(...args), headers: {} }) }) };
}

test('Following isolates X accounts, coalesces reads, discards old interest caches, and never pulls Facebook search', async t => {
  let reads = 0;
  const app = await createAppHarness({ env: { TWITTER_BEARER_TOKEN: 'public-app-fixture' }, modules: {
    './provider-json': jsonModule(async (url, headers) => {
      reads++; assert.equal(headers.Authorization, 'Bearer user-access-fixture');
      assert.equal(url.includes('search'), false);
      return new URL(url).pathname === '/2/users/me' ? { data: { id: '9' } } : timeline();
    }),
  } });
  t.after(() => app.close());
  app.seedUser(member('reader', { preferences: { interests: ['Science'] }, socialTokens: { twitter: 'user-access-fixture', facebook: 'facebook-fixture' } }));
  app.seedUser(member('unconnected'));
  app.followingSourceCache.set('reader::twitter', { fetchedAt: Date.now(), posts: [{ ...mapTwitterTimeline(timeline())[0], id: 'legacy-discovery', matchedByInterest: true }] });
  const results = await Promise.all(Array.from({ length: 3 }, () => app.getFollowingFeedPosts('reader', ['twitter', 'facebook'], { surface: null })));
  assert.equal(reads, 2, 'Concurrent feed and clips requests share one bounded provider read');
  for (const result of results) {
    assert.deepEqual(Array.from(result.posts, post => post.id), ['twitter_101']); assert.deepEqual(Object.keys(result.sourceErrors), []);
  }
  const result = await app.request('/office/feed?mode=following&passive=1&sources=twitter,facebook', { userId: 'reader' });
  assert.equal(result.status, 200); assert.deepEqual(result.data.posts.map(post => post.id), ['twitter_101']);
  assert.deepEqual(result.data.sourceErrors, {}); assert.equal(reads, 2, 'A repeated read uses the connected account cache');
  assert.equal((await app.getFollowingFeedPosts('unconnected', null, { surface: 'feed' })).posts.length, 0);
  assert.equal(reads, 2, 'An unconnected member never borrows an app or another member’s token');
});

test('X denied access is visible in Following and never serves old interest results', async t => {
  const app = await createAppHarness({ modules: { './provider-json': jsonModule(async () => { throw new Error('HTTP 403: fixture-secret'); }) } });
  t.after(() => app.close());
  app.seedUser(member('denied', { preferences: { interests: ['Science'] }, socialTokens: { twitter: 'fixture-secret', facebook: 'fixture-facebook' } }));
  app.followingSourceCache.set('denied::twitter', { fetchedAt: Date.now(), posts: [{ ...mapTwitterTimeline(timeline())[0], matchedByInterest: true }] });
  const result = await app.request('/office/feed?mode=following&passive=1', { userId: 'denied' });
  assert.equal(result.status, 200); assert.deepEqual(result.data.posts, []);
  assert.match(result.data.sourceErrors.twitter, /denied timeline access/);
  assert.equal(JSON.stringify(result.data).includes('fixture-secret'), false);
  assert.equal(result.data.sourceErrors.facebook, undefined);
});
