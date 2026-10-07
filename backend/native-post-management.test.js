const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { registerNativePostManagement } = require('./native-post-management');

test('native post changes enforce authorship, screening and atomic deletion', async t => {
  const sql = new PGlite();
  await sql.exec(`CREATE TABLE community_posts (id text PRIMARY KEY, author_id text, source text, content text, media_url text, media_type text);
    CREATE TABLE post_comments (id text PRIMARY KEY, post_id text, content text);
    INSERT INTO community_posts VALUES ('mine','owner','uficonnect','Original',null,null),('theirs','other','uficonnect','Other',null,null),('external','owner','mastodon','Remote',null,null),('photo','owner','uficonnect','Caption','https://media.test/photo','image'),('video','owner','uficonnect','Caption','https://media.test/video','video');
    INSERT INTO post_comments VALUES ('c1','mine','Reply');`);
  const routes = {}, updated = [], deleted = [];
  let connected = true, rejectScreen = null, failDelete = false, screened = 0;
  const query = (text, params) => {
    if (failDelete && text.startsWith('DELETE FROM community_posts')) throw new Error('simulated database failure');
    return sql.query(text, params);
  };
  const gate = () => {};
  registerNativePostManagement({ patch: (path, ...handlers) => { assert.equal(handlers[0], gate); routes.patch = handlers.at(-1); }, delete: (path, ...handlers) => { assert.equal(handlers[0], gate); routes.delete = handlers.at(-1); } }, {
    authenticate: gate, limiter: gate, db: { isConnected: () => connected, query, withClient: callback => callback({ query }) },
    screenMemberContent: async ({ content }) => { screened++; return rejectScreen ? { allowed: false, reason: rejectScreen } : { allowed: true, content }; },
    fromRow: row => ({ ...row, authorId: row.author_id }), serialize: post => post,
    onUpdated: post => updated.push(post), onDeleted: id => deleted.push(id), logger: { error() {} },
  });
  async function call(method, id, body = { content: 'Changed' }, user = 'owner') {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await routes[method]({ user: { id: user }, params: { postId: id }, body }, response);
    return response;
  }
  try {
    await t.test('another author and external posts cannot be modified or removed', async () => {
      for (const method of ['patch', 'delete']) {
        assert.equal((await call(method, 'theirs')).statusCode, 403);
        assert.equal((await call(method, 'external')).statusCode, 404);
        assert.equal((await call(method, 'missing')).statusCode, 404);
      }
      assert.equal(screened, 0);
      assert.equal((await sql.query('SELECT count(*)::int AS count FROM community_posts')).rows[0].count, 5);
    });
    await t.test('only text is writable; post, photo and video validation is preserved', async () => {
      for (const body of [{ content: 'Changed', authorId: 'intruder' }, { content: 42 }, { content: 'x'.repeat(2001) }, { content: '' }]) assert.equal((await call('patch', 'mine', body)).statusCode, 400);
      assert.equal((await call('patch', 'video', { content: '' })).statusCode, 400);
      assert.equal((await call('patch', 'photo', { content: '' })).statusCode, 200);
    });
    await t.test('screening rejection or unavailable database keeps the original', async () => {
      rejectScreen = 'policy'; assert.equal((await call('patch', 'mine')).statusCode, 422);
      rejectScreen = 'screening_unavailable'; assert.equal((await call('patch', 'mine')).statusCode, 503);
      rejectScreen = null; connected = false;
      assert.equal((await call('patch', 'mine')).statusCode, 503);
      assert.equal((await call('delete', 'mine')).statusCode, 503);
      connected = true;
      assert.equal((await sql.query("SELECT content FROM community_posts WHERE id='mine'")).rows[0].content, 'Original');
    });
    await t.test('successful edit is persisted and returned before notifying the cache', async () => {
      const response = await call('patch', 'mine', { content: '  Edited text  ' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.post.content, 'Edited text');
      assert.equal(updated.at(-1).content, 'Edited text');
      assert.equal((await sql.query("SELECT content FROM community_posts WHERE id='mine'")).rows[0].content, 'Edited text');
    });
    await t.test('failed removal rolls comments back; success removes both durably', async () => {
      failDelete = true;
      assert.equal((await call('delete', 'mine')).statusCode, 500);
      assert.equal((await sql.query("SELECT id FROM post_comments WHERE post_id='mine'")).rows.length, 1);
      assert.equal(deleted.length, 0);
      failDelete = false;
      assert.equal((await call('delete', 'mine')).body.deleted, true);
      assert.equal((await sql.query("SELECT id FROM community_posts WHERE id='mine'")).rows.length, 0);
      assert.equal((await sql.query("SELECT id FROM post_comments WHERE post_id='mine'")).rows.length, 0);
      assert.deepEqual(deleted, ['mine']);
    });
  } finally { await sql.close(); }
});
