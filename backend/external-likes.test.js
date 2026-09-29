const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const POST = 'reddit_likes_audit';

test('members like external feed posts, see counts per viewer, and see who liked them', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,plan TEXT DEFAULT 'free',auth_version INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false);
    CREATE TABLE external_post_likes (post_id TEXT NOT NULL, user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (post_id, user_id))`);
  await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Alice','alice@example.invalid'),($2,'Bob','bob@example.invalid')", [A, B]);
  const feedRow = { id: POST, source: 'reddit', title: 'A post in the feed', content: 'Body', source_url: 'https://www.reddit.com/r/test/comments/abc/a_post/',
    topic: 'Technology', likes_count: 40, comments_count: 3, created_at: new Date().toISOString() };
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: params[0] }] };
    if (sql.includes('external_post_likes') || sql.includes('FROM users WHERE id')) return pg.query(sql, params);
    if (sql.includes('FROM feed_posts_cache WHERE id')) return { rows: params[0] === POST ? [feedRow] : [] };
    return { rows: [], rowCount: 0 };
  } });
  t.after(() => app.close());
  app.seedUser(member(A, { name: 'Alice' })); app.seedUser(member(B, { name: 'Bob' }));

  const like = await app.request(`/feed/${POST}/like`, { userId: A, method: 'POST' });
  assert.equal(like.status, 200);
  assert.deepEqual(like.data, { likedByMe: true, memberLikesCount: 1 });
  assert.equal((await app.request(`/feed/${POST}/like`, { userId: B, method: 'POST' })).data.memberLikesCount, 2);

  const forAlice = await app.request(`/feed/likes?ids=${POST},unknown_post`, { userId: A });
  assert.deepEqual(forAlice.data.likes, { [POST]: { count: 2, likedByMe: true } });
  const forGuest = await app.request(`/feed/likes?ids=${POST}`);
  assert.deepEqual(forGuest.data.likes[POST], { count: 2, likedByMe: false }, 'Guests see the count, never a like of their own');

  const likers = await app.request(`/feed/${POST}/likes`, { userId: B });
  assert.equal(likers.status, 200);
  assert.deepEqual(likers.data.users.map(user => user.name).sort(), ['Alice', 'Bob']);
  assert.equal(likers.data.users.find(user => user.id === B).isSelf, true);

  const unlike = await app.request(`/feed/${POST}/like`, { userId: A, method: 'POST' });
  assert.deepEqual(unlike.data, { likedByMe: false, memberLikesCount: 1 });
  assert.equal((await app.request(`/feed/missing_post/like`, { userId: A, method: 'POST' })).status, 404, 'Only posts that are really in the feed can be liked');
  assert.equal((await app.request(`/feed/${POST}/like`, { method: 'POST' })).status, 401);
});
