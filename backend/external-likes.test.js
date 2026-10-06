const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');
const { hydratePostLikes } = require('./post-likes');
const vault = require('./token-vault').createTokenVault({ OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') });

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const POST = 'reddit_likes_audit';

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,plan TEXT DEFAULT 'free',auth_version INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false,social_tokens JSONB DEFAULT '{}');
    CREATE TABLE external_post_likes(post_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(post_id,user_id));
    CREATE TABLE restaurant_post_likes(LIKE external_post_likes INCLUDING ALL);
    CREATE TABLE community_posts(id TEXT PRIMARY KEY,content TEXT,source TEXT,likes TEXT[] DEFAULT '{}')`);
  await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Alice','alice@example.invalid'),($2,'Bob','bob@example.invalid')", [A, B]);
  const feedRow = { id: POST, source: 'reddit', title: 'A post in the feed', content: 'A useful discussion of software.',
    source_url: 'https://www.reddit.com/r/test/comments/abc/a_post/', topic: 'Technology', likes_count: 40,
    comments_count: 3, post_created_at: new Date().toISOString() };
  let failWrite = false;
  async function start() {
    const app = await createAppHarness({ connected: true, query: async (sql, params) => {
      if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: params[0] }] };
      if (sql.includes('FROM feed_posts_cache WHERE id')) return { rows: params[0] === POST ? [feedRow] : [] };
      if (sql.includes('FROM community_posts') && sql.includes('COALESCE(source')) return { rows: [] };
      if (failWrite && /^(INSERT INTO (external|restaurant)_post_likes|UPDATE community_posts)/.test(sql)) throw new Error('Simulated write failure');
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || /external_post_likes|restaurant_post_likes|community_posts|FROM users WHERE id/.test(sql)) return pg.query(sql, params);
      return { rows: [], rowCount: 0 };
    } });
    t.after(() => app.close());
    app.seedUser(member(A, { name: 'Alice' })); app.seedUser(member(B, { name: 'Bob' }));
    return app;
  }
  return { pg, feedRow, start, setFailWrite(value) { failWrite = value; } };
}

test('external likes require the matching connected account, preserve provider counts, and expose public counts', async t => {
  const { pg, start, feedRow } = await fixture(t); const app = await start();
  const like = (userId, liked) => app.request(`/feed/${POST}/like`, { userId, method: 'POST', body: { liked } });
  assert.equal((await like(undefined, true)).status, 401);
  assert.equal((await like(A, 'true')).status, 400);
  assert.equal((await like(A, true)).status, 403);
  assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM external_post_likes')).rows[0].count, 0);
  await pg.query('UPDATE users SET social_tokens=$1::jsonb WHERE id=$2', [JSON.stringify(vault.encryptMap({ github: 'unrelated-test-token' }, A, 'access')), A]);
  assert.equal((await like(A, true)).status, 403, 'A different connected source does not unlock likes');
  for (const id of [A, B]) await pg.query('UPDATE users SET social_tokens=$1::jsonb WHERE id=$2', [JSON.stringify(vault.encryptMap({ reddit: 'test-source-token' }, id, 'access')), id]);
  assert.equal((await app.request('/social/interaction-capabilities', { userId: A })).data.sources.reddit.connected, true);
  const first = await like(A, true);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.likesCount, 1); assert.equal(first.data.likedByMe, true);
  assert.equal(first.data.post.sourceLikesCount, 40);
  assert.equal((await like(A, true)).data.likesCount, 1, 'Desired-state retries are idempotent');
  assert.equal((await like(B, true)).data.likesCount, 2);
  const guest = await app.request(`/feed/${POST}`);
  assert.equal(guest.data.post.likesCount, 2); assert.equal(guest.data.post.sourceLikesCount, 40);
  assert.equal(guest.data.post.likesScope, 'uficonnect'); assert.equal(guest.data.post.likedByMe, false);
  assert.equal((await app.request(`/feed/${POST}`, { userId: A })).data.post.likedByMe, true);
  assert.deepEqual((await app.request(`/feed/${POST}/likes`)).data, { likesCount: 2, likedByMe: false, users: [] });
  const likers = await app.request(`/feed/${POST}/likes`, { userId: B });
  assert.deepEqual(likers.data.users.map(user => user.id).sort(), [A, B]);
  const bulk = await app.request(`/feed/likes?ids=${POST},unknown_post`, { userId: A });
  assert.equal(bulk.data.likes[POST].count, 2); assert.equal(bulk.data.likes[POST].likedByMe, true);
  assert.equal(bulk.data.likes.unknown_post.count, 0);
  const restarted = await start();
  assert.equal((await restarted.request(`/feed/${POST}`, { userId: A })).data.post.likedByMe, true);
  assert.equal((await like(A, false)).data.likesCount, 1);
  assert.equal((await like(A, false)).data.likesCount, 1);
  assert.equal((await like(B, false)).data.likesCount, 0);
  await pg.query("UPDATE users SET social_tokens='{}'::jsonb WHERE id=$1", [A]);
  assert.equal((await like(A, true)).status, 403, 'Disconnecting overrides a warm worker cache');
  assert.equal((await app.request('/social/interaction-capabilities', { userId: A })).data.sources.reddit.connected, false);
  assert.equal(feedRow.likes_count, 40);
  assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM external_post_likes')).rows[0].count, 0);
  assert.equal((await app.request('/feed/missing_post/like', { userId: A, method: 'POST', body: { liked: true } })).status, 404);
  assert.equal((await app.request('/feed/missing_post/likes')).status, 404);
});

test('native likes preserve another worker\'s changes and roll back failures without phantom cached likes', async t => {
  const data = await fixture(t); const { pg, start } = data;
  await pg.query("INSERT INTO community_posts(id,content,source) VALUES('native','A community update','uficonnect')");
  const first = await start(); const second = await start();
  for (const app of [first, second]) app.posts.push({ id: 'native', source: 'uficonnect', content: 'A community update', likes: [], createdAt: new Date().toISOString() });
  const like = (app, userId, liked) => app.request('/feed/native/like', { userId, method: 'POST', body: { liked } });
  assert.equal((await like(first, A, true)).data.likesCount, 1);
  assert.equal((await like(second, B, true)).data.likesCount, 2);
  assert.equal((await like(first, A, true)).data.likesCount, 2);
  assert.equal((await first.request('/feed/native')).data.post.likesCount, 2);
  data.setFailWrite(true);
  assert.equal((await like(first, A, false)).status, 500);
  assert.equal(first.posts.find(post => post.id === 'native').likes.length, 2);
  assert.deepEqual((await pg.query("SELECT likes FROM community_posts WHERE id='native'")).rows[0].likes.sort(), [A, B]);
  data.setFailWrite(false);
  assert.equal((await like(first, A, false)).data.likesCount, 1);
  assert.equal((await first.request('/feed/native/like', { userId: A, method: 'POST' })).data.likesCount, 2);
  first.groups.push({ id: 'private-likes', isPrivate: true, createdBy: B });
  first.posts.find(post => post.id === 'native').groupId = 'private-likes';
  for (const path of ['/feed/native', '/feed/native/likes', '/posts/native/likes']) assert.equal((await first.request(path, { userId: A })).status, 404);
  assert.equal((await like(first, A, false)).status, 404);
});

test('hydration stays viewer-specific without mutating shared snapshots; outages cannot write likes', async t => {
  const data = await fixture(t); const app = await data.start();
  await data.pg.query('INSERT INTO external_post_likes(post_id,user_id) VALUES($1,$2)', [POST, A]);
  const posts = [{ id: POST, source: 'reddit', likesCount: 40 }];
  const own = await hydratePostLikes(app.db, posts, A);
  const other = await hydratePostLikes(app.db, posts, B);
  assert.equal(own[0].likesCount, 1); assert.equal(own[0].likedByMe, true);
  assert.equal(other[0].likesCount, 1); assert.equal(other[0].likedByMe, false);
  assert.deepEqual(posts, [{ id: POST, source: 'reddit', likesCount: 40 }]);
  assert.equal((await hydratePostLikes(app.db, own, A))[0].sourceLikesCount, 40);
  data.setFailWrite(true);
  await data.pg.query('UPDATE users SET social_tokens=$1::jsonb WHERE id=$2', [JSON.stringify(vault.encryptMap({ reddit: 'test-source-token' }, B, 'access')), B]);
  assert.equal((await app.request(`/feed/${POST}/like`, { userId: B, method: 'POST', body: { liked: true } })).status, 500);
  assert.equal((await data.pg.query('SELECT COUNT(*)::integer AS count FROM external_post_likes')).rows[0].count, 1);
  app.db.isConnected = () => false;
  assert.equal((await app.request(`/feed/${POST}/like`, { userId: B, method: 'POST', body: { liked: true } })).status, 503);
  const offline = await hydratePostLikes(app.db, posts, A);
  assert.equal(offline[0].likesAvailable, false); assert.equal(offline[0].sourceLikesCount, 40);
  assert.equal(offline[0].likesCount, 0, 'Provider metrics must not become local reactions during an outage');
});

test('restaurant and discovery cards use the same persisted counts on subsequent reads', async t => {
  const data = await fixture(t); const app = await data.start();
  const restaurant = 'restaurant_opening_0123456789abcdef0123';
  const osmBar = 'osm:node:123';
  for (const id of [restaurant, osmBar]) {
    const like = liked => app.request(`/feed/${id}/like`, { userId: A, method: 'POST', body: { liked } });
    assert.equal((await like(true)).data.likesCount, 1);
    assert.equal((await like(true)).data.likesCount, 1);
    assert.equal((await app.request(`/feed/${id}/likes`)).data.likesCount, 1);
    const card = { id, source: id === osmBar ? 'bars' : 'restaurants', likesCount: 99 };
    assert.equal((await hydratePostLikes(app.db, [card], A))[0].likesCount, 1);
    assert.equal((await like(false)).data.likesCount, 0);
    assert.equal((await hydratePostLikes(app.db, [card], A))[0].likesCount, 0, 'A cached count is cleared when the last like is removed');
  }
  const discovery = { id: 'bar_opening_0123456789abcdef0123', source: 'bars', title: 'A new community cafe and bar',
    content: 'A new cafe and bar opens with local coffee and food.', sourceUrl: 'https://www.bbc.com/travel/article/new-city-cafe', likesCount: 0 };
  app.locationLiveFeedCache.set('bars:test', { posts: [discovery] });
  const result = await app.request(`/feed/${discovery.id}/like`, { userId: A, method: 'POST', body: { liked: true } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal((await app.request(`/feed/${discovery.id}`)).data.post.likesCount, 1);
});
