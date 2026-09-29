const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { randomBytes } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');
const { createTokenVault } = require('./token-vault');

const A = 'a0000000-0000-4000-8000-000000000001';
const listing = [{ kind: 'Listing', data: { children: [] } }, { kind: 'Listing', data: { children: [
  { kind: 't1', data: { id: 'c1', author: 'pilot', body: 'Great approach over the bay.', score: 12, created_utc: 1790000000 } },
  { kind: 't1', data: { id: 'c2', author: 'gone', body: '[removed]', score: 1, created_utc: 1790000001 } },
] } }];

// A stand-in for the https module: Reddit answers only the requests allowed by `reachable`.
function fakeHttps(calls, reachable) {
  const get = (target, options, callback) => {
    const url = new URL(target);
    calls.push({ url: url.toString(), authorization: options.headers.Authorization || '' });
    const response = new EventEmitter();
    const ok = reachable(url, options.headers);
    Object.assign(response, { statusCode: ok ? 200 : 403, headers: {}, resume() {}, destroy() {}, setEncoding() {} });
    process.nextTick(() => {
      callback(response);
      if (ok) response.emit('data', JSON.stringify(listing));
      response.emit('end');
    });
    const outgoing = new EventEmitter();
    Object.assign(outgoing, { setTimeout() { return outgoing; }, destroy() {}, end() {} });
    return outgoing;
  };
  return { ...require('node:https'), get, request: get };
}

test('Reddit comments load through the viewer\'s connected account and outages are not cached as empty', async t => {
  const env = { OAUTH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  const vault = createTokenVault(env);
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,plan TEXT DEFAULT 'free',auth_version INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false,social_tokens JSONB DEFAULT '{}')`);
  await pg.query("INSERT INTO users(id,name,email,social_tokens) VALUES($1,'Alice','alice@example.invalid',$2)", [A, JSON.stringify(vault.encryptMap({ reddit: 'member-token' }, A, 'access'))]);
  const calls = [];
  let redditUp = false;
  const app = await createAppHarness({ env, connected: true,
    modules: { https: fakeHttps(calls, (url, headers) => redditUp && url.hostname === 'oauth.reddit.com' && headers.Authorization === 'Bearer member-token') },
    query: async (sql, params) => {
      if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: params[0] }] };
      if (sql.includes('FROM users WHERE id')) return pg.query(sql, params);
      return { rows: [], rowCount: 0 };
    } });
  t.after(() => app.close());
  app.seedUser(member(A, { name: 'Alice' }));

  const down = await app.request('/feed/reddit_abc123/comments', { userId: A });
  assert.equal(down.status, 200);
  assert.equal(down.data.unavailable, true, 'An unreachable Reddit is reported, not shown as "no comments"');
  assert.deepEqual(down.data.comments, []);

  redditUp = true;
  const up = await app.request('/feed/reddit_abc123/comments', { userId: A });
  assert.deepEqual(up.data.comments.map(comment => [comment.author, comment.body]), [['u/pilot', 'Great approach over the bay.']], 'The outage was not cached; removed comments are left out');
  assert.equal(up.data.live, true);
  const read = calls.find(call => call.url.startsWith('https://oauth.reddit.com/comments/abc123'));
  assert.equal(read?.authorization, 'Bearer member-token', "The viewer's connected Reddit account is used first");

  const own = await app.request('/feed/reddit_own_xyz789/comments', { userId: A });
  assert.equal(own.data.comments.length, 1);
  assert.ok(calls.some(call => call.url.startsWith('https://oauth.reddit.com/comments/xyz789')), 'Posts from a member\'s own account use the Reddit post ID');
  assert.deepEqual((await app.request('/feed/reddit_bad%20id/comments')).data.comments, []);
});
