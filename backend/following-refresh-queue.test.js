'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFollowingRefreshQueue } = require('./following-refresh-queue');
const { createAppHarness, member } = require('./test-support/app-harness');
const settle = () => new Promise(resolve => setImmediate(resolve));
test('manual and background Following reads share per-member/source jobs and four global slots', async () => {
  const queue = createFollowingRefreshQueue();
  const starts = [], releases = [];
  const work = id => () => { starts.push(id); return new Promise(resolve => releases.push(() => resolve(id))); };
  const first = queue.run('member-a::youtube', work(1));
  const same = queue.run('member-a::youtube', work(100));
  assert.equal(first, same);
  const rest = Array.from({ length: 7 }, (_, i) => queue.run('member-' + i + '::reddit', work(i + 2)));
  await settle(); assert.equal(queue.status().active, 4); assert.equal(starts.length, 4);
  releases.splice(0).forEach(release => release()); await settle();
  assert.equal(queue.status().active, 4); assert.equal(starts.length, 8);
  releases.splice(0).forEach(release => release());
  assert.deepEqual(await Promise.all([first, ...rest]), [1, 2, 3, 4, 5, 6, 7, 8]);
  await settle(); assert.equal(queue.status().active, 0); assert.equal(queue.status().pending, 0);
});
test('queued failures release capacity and overload does not create unbounded work', async () => {
  const queue = createFollowingRefreshQueue({ concurrency: 1, maxPending: 1 });
  let release;
  const first = queue.run('one', () => new Promise(resolve => { release = resolve; }));
  const second = queue.run('two', async () => { throw Error('Provider unavailable'); });
  const failure = assert.rejects(second, /Provider unavailable/);
  await assert.rejects(queue.run('three', async () => {}), { status: 503 });
  await settle(); release(); await first; await failure; await settle();
  assert.equal(await queue.run('two', async () => 'recovered'), 'recovered');
});

const sourcePost = (source, id) => ({ id, source, title: 'Latest update', content: 'A real source update',
  authorId: 'source-author', sourceUrl: 'https://example.com/' + id, isExternal: true, createdAt: new Date().toISOString() });

test('Following requests load sources in parallel and share background/manual refresh work', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  app.seedUser(member('queue-reader', { socialTokens: { github: 'github-token', youtube: 'youtube-token' } }));
  const started = [], releases = [];
  for (const source of ['github', 'youtube']) app.setFollowingFetcher(source, async () => {
    started.push(source); return new Promise(resolve => releases.push(() => resolve([sourcePost(source, 'new-' + source)])));
  });
  const first = app.getFollowingFeedPosts('queue-reader', ['github', 'youtube'], { bust: true });
  await settle(); assert.equal(started.length, 2, 'The second source does not wait for the first network response');
  const second = app.getFollowingFeedPosts('queue-reader', ['github', 'youtube'], { bust: true });
  const warmer = app.refreshFollowingSourceCaches();
  await settle(); assert.equal(started.length, 2);
  releases.forEach(release => release());
  const [a, b] = await Promise.all([first, second, warmer]);
  assert.equal(a.posts.length, 2); assert.equal(b.posts.length, 2);
  assert.equal(started.length, 2);
});

test('Following expires one five-minute cycle and does not keep a stale ten-minute outer cache', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  app.seedUser(member('stale-reader', { socialTokens: { github: 'github-token' } }));
  app.followingSourceCache.set('stale-reader::github', { posts: [sourcePost('github', 'old')], fetchedAt: Date.now() - 301000 });
  let calls = 0;
  app.setFollowingFetcher('github', async () => { calls++; return [sourcePost('github', 'fresh')]; });
  const result = await app.getFollowingFeedPosts('stale-reader', ['github']);
  assert.equal(calls, 1); assert.equal(result.posts[0].id, 'fresh');
});

test('an account switch during collection cannot repopulate Following with the previous account', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  const viewer = member('switch-reader', { socialTokens: { github: 'old-account' }, socialConnectedAt: { github: '2026-01-01T00:00:00Z' } });
  app.seedUser(viewer);
  let release;
  app.setFollowingFetcher('github', async () => new Promise(resolve => { release = resolve; }));
  const reading = app.getFollowingFeedPosts(viewer.id, ['github'], { bust: true });
  await settle();
  viewer.socialTokens.github = 'new-account'; viewer.socialConnectedAt.github = '2026-10-13T00:00:00Z';
  release([sourcePost('github', 'previous-account-private-feed')]);
  const result = await reading;
  assert.equal(result.posts.length, 0);
  assert.match(result.sourceErrors.github, /connection changed/);
  assert.equal(app.followingSourceCache.has('switch-reader::github'), false);
});

test('Following warm-up rotates bounded batches fairly instead of restarting the first users', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  for (let i = 0; i < 40; i++) app.seedUser(member('warm-' + i, { socialTokens: { github: 'token-' + i } }));
  const fetched = new Set();
  app.setFollowingFetcher('github', async token => { fetched.add(token); return []; });
  await app.refreshFollowingSourceCaches();
  assert.equal(fetched.size, 32);
  await app.refreshFollowingSourceCaches();
  assert.equal(fetched.size, 40);
  assert.ok(app.followingRefreshQueue.status().active <= 4);
});
