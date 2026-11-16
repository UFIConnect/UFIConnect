const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const { PGlite } = require('@electric-sql/pglite');

async function publishedPostFixture(t) {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, billing_closed BOOLEAN DEFAULT FALSE, joined_groups TEXT[]);
    CREATE TABLE follows (follower_id TEXT, following_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (follower_id, following_id));
    CREATE TABLE blocks (blocker_id TEXT, blocked_id TEXT);
    CREATE TABLE community_groups (id TEXT PRIMARY KEY, is_private BOOLEAN, created_by TEXT);
    INSERT INTO community_groups VALUES ('ufi-general', FALSE, NULL), ('private-room', TRUE, 'post-owner');
    CREATE TABLE community_posts (id TEXT PRIMARY KEY, author_id TEXT, group_id TEXT, source TEXT DEFAULT 'uficonnect',
      content TEXT, created_at TIMESTAMPTZ, likes TEXT[] DEFAULT '{}');
    CREATE TABLE report_content_suppressions (target_id TEXT, target_type TEXT, source TEXT, source_url TEXT);
    CREATE TABLE seen_posts (user_id TEXT, post_id TEXT, context TEXT, engaged_at TIMESTAMPTZ, seen_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, post_id, context));
    INSERT INTO users (id, name) VALUES ('post-owner', 'Post owner'), ('other-author', 'Another author'), ('old-follow', 'Old follow');`);
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    if (/community_posts|report_content_suppressions|candidate.group_id|seen_posts|\bfollows\b|\bblocks\b|FROM users WHERE id=\$1 FOR UPDATE/.test(sql)
      || ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return pg.query(sql, params);
    return { rows: [] };
  } });
  t.after(async () => { await app.close(); await pg.close(); });
  const publish = (id, authorId, createdAt, groupId = 'ufi-general') => pg.query(
    `INSERT INTO community_posts (id, author_id, group_id, content, created_at) VALUES ($1,$2,$3,$4,$5)`,
    [id, authorId, groupId, `Published post ${id}.`, createdAt],
  );
  return { app, pg, publish };
}

test('native post reads use persisted edits and removals instead of another worker cache', async t => {
  let stored = { id: 'p_edited', author_id: 'post-owner', source: 'uficonnect', content: 'Edited on another worker', created_at: new Date().toISOString(), likes: [], comments_count: 0 };
  const app = await createAppHarness({ connected: true, query: async sql => ({ rows: /FROM community_posts/.test(sql) && stored ? [stored] : [], rowCount: 0 }) });
  t.after(() => app.close());
  app.seedUser(member('post-owner'));
  const old = { id: 'p_edited', authorId: 'post-owner', source: 'uficonnect', content: 'Stale cached text', createdAt: stored.created_at, likes: [] };
  app.posts.push(old);
  let response = await app.request('/feed/p_edited');
  assert.equal(response.status, 200);
  assert.equal(response.data.post.content, stored.content);
  app.posts.splice(0, app.posts.length, old);
  let page = await app.getCommunityPosts({ authorId: 'post-owner', viewerId: 'post-owner' });
  assert.equal(page.posts.find(post => post.id === 'p_edited').content, stored.content);
  stored = null;
  page = await app.getCommunityPosts({ authorId: 'post-owner', viewerId: 'post-owner' });
  assert.equal(page.posts.length, 0, 'Deleted posts cannot be merged back from memory');
  response = await app.request('/feed/p_edited');
  assert.equal(response.status, 404);
  assert.equal(app.posts.some(post => post.id === 'p_edited'), false);
});

test('You serves only the signed-in member’s published native posts and keeps all cursor pages reachable', async t => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const at = delta => new Date(now + delta).toISOString();
  const { app, pg, publish } = await publishedPostFixture(t);
  app.seedUser(member('post-owner', { plan: 'pro', socialTokens: { mastodon: 'connected-fixture' } }));
  app.seedUser(member('other-author'));
  await publish('native-new', 'post-owner', at(-1000));
  const sameInstant = at(-2000).replace('.000Z', '.000900Z');
  await publish('native-tie-z', 'post-owner', sameInstant, 'private-room');
  await publish('native-tie-a', 'post-owner', sameInstant);
  await publish('native-within-same-millisecond', 'post-owner', at(-2000).replace('.000Z', '.000100Z'));
  await publish('another-members-post', 'other-author', at(-500));
  await publish('imported-post', 'post-owner', at(-600));
  await pg.exec("UPDATE community_posts SET source='mastodon' WHERE id='imported-post'");
  await publish('removed-post', 'post-owner', at(-750));
  await pg.exec("INSERT INTO report_content_suppressions VALUES ('removed-post', 'post', 'uficonnect', NULL)");

  const url = '/posts/mine?limit=2';
  const read = (suffix = '', userId = 'post-owner') => app.request(url + suffix, { userId });
  assert.equal((await app.request(url)).status, 401);
  const first = await read();
  assert.equal(first.status, 200, JSON.stringify(app.errors));
  assert.deepEqual(first.data.posts.map(post => post.id), ['native-new', 'native-tie-z']);
  assert.equal(first.data.totalAvailable, 4);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  await publish('native-just-published', 'post-owner', at(0));
  const next = await read(`&cursor=${encodeURIComponent(first.data.cursor)}`);
  assert.deepEqual(next.data.posts.map(post => post.id), ['native-tie-a', 'native-within-same-millisecond']);
  assert.equal(next.data.hasMore, false);
  assert.equal((await read()).data.posts[0].id, 'native-just-published');
  const free = await read('', 'other-author');
  assert.equal(free.status, 200);
  assert.deepEqual(free.data.posts.map(post => post.id), ['another-members-post']);
});

test('Following uses database follows and serves recent posts previously read on Home', async t => {
  const { app, pg, publish } = await publishedPostFixture(t);
  for (const id of ['post-owner', 'other-author', 'old-follow']) app.seedUser(member(id));
  app.follows.push({ followerId: 'post-owner', followingId: 'old-follow' });
  await pg.exec(`INSERT INTO follows (follower_id, following_id) VALUES ('post-owner', 'other-author');
    INSERT INTO seen_posts (user_id, post_id, context, engaged_at) VALUES ('post-owner', 'already-read', 'feed', NOW());`);
  const now = Date.now();
  await publish('already-read', 'other-author', new Date(now - 1000).toISOString());
  await publish('newest-post', 'other-author', new Date(now).toISOString());
  await publish('too-old-for-filter', 'other-author', new Date(now - 2 * 3600000).toISOString());
  await publish('stale-follow-post', 'old-follow', new Date(now).toISOString());

  const read = () => app.request('/office/feed?mode=following&source=uficonnect&sort=newest&timeRange=1h', { userId: 'post-owner' });
  const result = await read();
  assert.equal(result.status, 200, JSON.stringify(app.errors));
  assert.deepEqual(result.data.posts.map(post => post.id), ['newest-post', 'already-read']);
  assert.equal(result.data.followingCount, 1);
  const unfollow = await app.request('/users/other-author/follow', { userId: 'post-owner', method: 'DELETE' });
  assert.equal(unfollow.status, 200, JSON.stringify(app.errors));
  assert.deepEqual((await read()).data.posts, []);
});
