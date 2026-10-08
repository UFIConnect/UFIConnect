const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { withActiveMembers } = require('./member-write');
const { createAppHarness, member } = require('./test-support/app-harness');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function database(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,plan TEXT DEFAULT 'free',auth_version INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false,
    profile_hidden BOOLEAN DEFAULT false,role_settings JSONB DEFAULT '{}');
    CREATE TABLE direct_messages(id TEXT PRIMARY KEY,conversation_id TEXT,sender_id TEXT,receiver_id TEXT,content TEXT,attachment JSONB,read BOOLEAN,created_at TIMESTAMPTZ);
    CREATE TABLE notifications(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,actor_id TEXT,target_type TEXT,target_id TEXT,preview TEXT);
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE connections(from_id TEXT,to_id TEXT,status TEXT);
    CREATE TABLE follows(follower_id TEXT,following_id TEXT);
    CREATE TABLE attachments(id TEXT PRIMARY KEY,user_id TEXT,is_primary BOOLEAN)`);
  await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Alice','alice@example.invalid'),($2,'Bob','bob@example.invalid')", [A,B]);
  return pg;
}
async function appFor(t, pg, extra = {}) {
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: params[0] }] };
    return pg.query(sql, params);
  }, ...extra });
  t.after(() => app.close());
  app.conversations.length = 0;
  app.seedUser(member(A)); app.seedUser(member(B));
  return app;
}

test('an upload authenticated before deletion cannot recreate attachment records after parsing', async t => {
  const pg = await database(t); const app = await appFor(t, pg);
  const entered = deferred(); const release = deferred();
  app.setResumeExtraction(async () => { entered.resolve(); await release.promise; return 'Example resume'; });
  const form = new FormData(); form.append('file', new Blob(['resume'], { type: 'text/plain' }), 'resume.txt');
  const pending = fetch(app.base + '/profile/attachments', { method: 'POST', headers: { authorization: `Bearer ${app.token(A)}` }, body: form });
  await entered.promise;
  await pg.query('DELETE FROM users WHERE id=$1', [A]);
  release.resolve();
  const response = await pending;
  assert.ok(response.status >= 400);
  assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM attachments')).rows[0].count, 0);
  assert.equal(app.queries.some(q => q.sql.includes('INSERT INTO attachments')), false);
  assert.equal(app.queries.at(-1).sql, 'ROLLBACK');
});

test('messages delayed by screening cannot recreate records for a deleted sender or closing recipient', async t => {
  const pg = await database(t); const app = await appFor(t, pg);
  for (const closeSender of [true, false]) {
    if (!closeSender) await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Alice','alice@example.invalid')", [A]);
    const entered = deferred(); const release = deferred();
    app.setContentScreening(async () => { entered.resolve(); await release.promise; return { allowed: true, content: 'Hello' }; });
    const pending = app.request(`/messages/${B}`, { method: 'POST', userId: A, body: { content: 'Hello' } });
    await entered.promise;
    if (closeSender) await pg.query('DELETE FROM users WHERE id=$1', [A]);
    else await pg.query('UPDATE users SET billing_closed=true WHERE id=$1', [B]);
    release.resolve();
    assert.equal((await pending).status, 404);
    assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM direct_messages')).rows[0].count, 0);
    assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM notifications')).rows[0].count, 0);
    assert.equal(app.conversations.length, 0);
  }
});

test('successful message and notification commit together before the conversation appears in memory', async t => {
  const pg = await database(t); let app; let failNotification = false;
  app = await appFor(t, pg, { query: async (sql, params) => {
    if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: params[0] }] };
    if (sql === 'COMMIT') assert.equal(app.conversations.length, 0);
    if (failNotification && sql.includes('INSERT INTO notifications')) throw new Error('notification write failed');
    return pg.query(sql, params);
  } });
  app.setContentScreening(async () => ({ allowed: true, content: 'Hello' }));
  failNotification = true;
  assert.equal((await app.request(`/messages/${B}`, { method: 'POST', userId: A, body: { content: 'Hello' } })).status, 500);
  assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM direct_messages')).rows[0].count, 0);
  assert.equal(app.conversations.length, 0);
  failNotification = false;
  assert.equal((await app.request(`/messages/${B}`, { method: 'POST', userId: A, body: { content: 'Hello' } })).status, 200);
  assert.equal(app.conversations.length, 1);
  assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM notifications')).rows[0].count, 1);
  const locked = app.queries.filter(q => q.sql.includes('billing_closed FROM users') && q.sql.includes('FOR UPDATE')).slice(-2).map(q => q.params[0]);
  assert.deepEqual(locked, [A,B]);
});

test('a second worker with cached profiles cannot expose a deleted member or send to them', async t => {
  const pg = await database(t); const first = await appFor(t, pg); const second = await appFor(t, pg);
  assert.equal((await second.request(`/users/${B}`, { userId: A })).status, 200);
  await first.db.query('DELETE FROM users WHERE id=$1', [B]);
  for (const url of [`/users/${B}`, `/users/${B}/posts`, `/messages/${B}`]) {
    // Re-seed to simulate different workers independently retaining the row.
    second.seedUser(member(B, { email: 'deleted-secret@example.invalid' }));
    const response = await second.request(url, { userId: A });
    assert.equal(response.status, 404); assert.equal(JSON.stringify(response.data).includes('deleted-secret'), false);
  }
  assert.equal((await second.request(`/messages/${B}`, { method: 'POST', userId: A, body: { content: 'Hello' } })).status, 404);
});

test('profile target reads fail closed during database outages and closed members cannot write', async t => {
  const pg = await database(t); const app = await appFor(t, pg);
  const online = app.db.isConnected;
  app.db.isConnected = () => false;
  assert.equal((await app.request(`/users/${B}`, { userId: A })).status, 503);
  app.db.isConnected = online;
  await pg.query('UPDATE users SET billing_closed=true WHERE id=$1', [A]);
  let ran = false;
  await assert.rejects(withActiveMembers(app.db, [A], async () => { ran = true; }), { status: 404 });
  assert.equal(ran, false);
});
