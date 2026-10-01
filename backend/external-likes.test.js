const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { randomBytes } = require('node:crypto');
const { createAppHarness, member } = require('./test-support/app-harness');
const { createTokenVault } = require('./token-vault');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const POST = 'reddit_likes_audit';

test('external feed likes require a provider action and never manufacture local source counts', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  const env = { OAUTH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  const vault = createTokenVault(env);
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,plan TEXT DEFAULT 'free',auth_version INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false,social_tokens JSONB DEFAULT '{}');
    CREATE TABLE external_post_likes (post_id TEXT NOT NULL, user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (post_id, user_id))`);
  // Alice and Bob have connected Reddit (their credentials are stored encrypted, as in production).
  await pg.query("INSERT INTO users(id,name,email,social_tokens) VALUES($1,'Alice','alice@example.invalid',$3),($2,'Bob','bob@example.invalid',$4)",
    [A, B, JSON.stringify(vault.encryptMap({ reddit: 'token-a' }, A, 'access')), JSON.stringify(vault.encryptMap({ reddit: 'token-b' }, B, 'access'))]);
  const feedRow = { id: POST, source: 'reddit', title: 'A post in the feed', content: 'Body', source_url: 'https://www.reddit.com/r/test/comments/abc/a_post/',
    topic: 'Technology', likes_count: 40, comments_count: 3, created_at: new Date().toISOString() };
  const app = await createAppHarness({ env, connected: true, query: async (sql, params) => {
    if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: params[0] }] };
    if (sql.includes('external_post_likes') || sql.includes('FROM users WHERE id')) return pg.query(sql, params);
    if (sql.includes('FROM feed_posts_cache WHERE id')) return { rows: params[0] === POST ? [feedRow] : [] };
    return { rows: [], rowCount: 0 };
  } });
  t.after(() => app.close());
  const C = 'c0000000-0000-4000-8000-000000000003';
  await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Carol','carol@example.invalid')", [C]);
  app.seedUser(member(A, { name: 'Alice' })); app.seedUser(member(B, { name: 'Bob' }));
  app.seedUser(member(C, { name: 'Carol' }));
  for (const userId of [A, B, C]) {
    const response = await app.request(`/feed/${POST}/like`, { userId, method: 'POST' });
    assert.equal(response.status, 422, 'External actions must use the approved provider route regardless of local account connection');
    assert.equal(response.data.likedByMe, undefined);
    assert.equal(response.data.memberLikesCount, undefined);
  }
  assert.equal(feedRow.likes_count, 40, 'Provider metric remains unchanged after rejected local requests');
  assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM external_post_likes')).rows[0].count, 0);

  const forAlice = await app.request(`/feed/likes?ids=${POST},unknown_post`, { userId: A });
  assert.deepEqual(forAlice.data.likes, {});
  const forGuest = await app.request(`/feed/likes?ids=${POST}`);
  assert.deepEqual(forGuest.data.likes, {}, 'Guests receive no fabricated source reactions');

  const likers = await app.request(`/feed/${POST}/likes`, { userId: B });
  assert.equal(likers.status, 200);
  assert.deepEqual(likers.data.users, []);

  assert.equal((await app.request(`/feed/missing_post/like`, { userId: A, method: 'POST' })).status, 404, 'Only posts that are really in the feed can be liked');
  assert.equal((await app.request(`/feed/${POST}/like`, { method: 'POST' })).status, 401);
});
