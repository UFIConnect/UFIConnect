'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createMessageMedia, MESSAGE_MEDIA_SCHEMA } = require('./messaging-security');
const { createAppHarness, member } = require('./test-support/app-harness');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const env = { CLOUDINARY_CLOUD_NAME: 'fixture-cloud', CLOUDINARY_API_KEY: 'fixture-key', CLOUDINARY_API_SECRET: 'fixture-secret' };
async function fixture(t, extra = {}) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,auth_version INTEGER DEFAULT 0,
    billing_closed BOOLEAN DEFAULT false,profile_hidden BOOLEAN DEFAULT false,role_settings JSONB DEFAULT '{}',skills TEXT[],title TEXT,organization TEXT);
    CREATE TABLE direct_messages(id TEXT PRIMARY KEY,conversation_id TEXT,sender_id TEXT,receiver_id TEXT,content TEXT,attachment JSONB,read BOOLEAN DEFAULT false,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE notifications(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,actor_id TEXT,target_type TEXT,target_id TEXT,preview TEXT);
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE connections(from_id TEXT,to_id TEXT,status TEXT);
    CREATE TABLE follows(follower_id TEXT,following_id TEXT)`);
  for (const sql of MESSAGE_MEDIA_SCHEMA) await pg.exec(sql);
  await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Alice','alice@example.invalid'),($2,'Bob','bob@example.invalid'),($3,'Carol','carol@example.invalid')", [A,B,C]);
  const app = await createAppHarness({ env, connected: true, query: async (sql, params) => {
    if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: params[0] }] };
    return pg.query(sql, params);
  }, ...extra });
  t.after(() => app.close());
  app.conversations.length = 0;
  for (const id of [A,B,C]) app.seedUser(member(id));
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  return { pg, app };
}

test('real message endpoints reject arbitrary attachment URLs and return safe private attachment paths without upload proofs', async t => {
  const publicId = `uficonnect-messages/message-${createHash('sha256').update(A).digest('hex')}-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  const asset = { public_id: publicId, version: 1, type: 'authenticated', resource_type: 'image', bytes: 3, format: 'jpg',
    secure_url: `https://res.cloudinary.com/fixture-cloud/image/authenticated/s--private--/v1/${publicId}.jpg` };
  const media = createMessageMedia({ env, api: { resource: async () => asset } });
  const { pg, app } = await fixture(t, { modules: { './messaging-security': { ...require('./messaging-security'), createMessageMedia: () => media } } });
  const send = body => app.request(`/messages/${B}`, { userId: A, method: 'POST', body });
  for (const attachment of [{ type: 'image', url: 'javascript:alert(1)' }, { type: 'image', url: 'https://attacker.invalid/tracker.jpg' }, ['wrong']]) {
    assert.equal((await send({ attachment })).status, 400);
  }
  assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM direct_messages')).rows[0].count, 0);
  const attachment = { type: 'image', url: asset.secure_url, upload: { publicId, version: 1,
    signature: createHash('sha1').update(`public_id=${publicId}&version=1${env.CLOUDINARY_API_SECRET}`).digest('hex') } };
  const response = await send({ content: '<script>stays text</script>', attachment });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.data.message.attachment.accessPath, /^\/messages\/.*\/attachments\/m_/);
  assert.equal(JSON.stringify(response.data).includes(publicId), false);
  assert.equal(JSON.stringify(response.data).includes(attachment.upload.signature), false);
  assert.equal((await pg.query('SELECT attachment FROM direct_messages')).rows[0].attachment.publicId, publicId);
  const read = await app.request(`/messages/${A}`, { userId: B });
  assert.equal(read.status, 200); assert.equal(read.data.messages.length, 1);
  assert.equal(read.data.messages[0].attachment.accessPath, `/messages/${A}/attachments/${response.data.message.id}`);
});

test('real thread reads and read markers cannot expose or mutate a different sender/receiver pair with the same conversation ID', async t => {
  const { pg, app } = await fixture(t);
  const conversation = [A,B].sort().join('__');
  await pg.query(`INSERT INTO direct_messages(id,conversation_id,sender_id,receiver_id,content) VALUES
    ('mine',$1,$2,$3,'mine'),('other-recipient',$1,$2,$4,'private Carol message'),('other-sender',$1,$4,$3,'private Carol-to-Alice message')`, [conversation, B,A,C]);
  const read = await app.request(`/messages/${B}`, { userId: A });
  assert.equal(read.status, 200); assert.deepEqual(read.data.messages.map(message => message.id), ['mine']);
  assert.deepEqual((await pg.query('SELECT id,read FROM direct_messages ORDER BY id')).rows,
    [{ id: 'mine', read: true }, { id: 'other-recipient', read: false }, { id: 'other-sender', read: false }]);
});

test('real messaging endpoints apply current durable block/private/connection policy across cached workers', async t => {
  const { pg, app } = await fixture(t);
  await pg.query('UPDATE users SET profile_hidden=true WHERE id=$1', [B]);
  assert.equal((await app.request(`/messages/${B}`, { userId: A })).status, 403);
  assert.equal((await app.request(`/messages/${B}`, { userId: A, method: 'POST', body: { content: 'Hello' } })).status, 403);
  await pg.query('UPDATE users SET profile_hidden=false,role_settings=$2 WHERE id=$1', [B, { privacy_messagePermission: 'connections' }]);
  assert.equal((await app.request(`/messages/${B}`, { userId: A, method: 'POST', body: { content: 'Hello' } })).status, 403);
  await pg.query("INSERT INTO connections VALUES($1,$2,'accepted')", [A,B]);
  assert.equal((await app.request(`/messages/${B}`, { userId: A, method: 'POST', body: { content: 'Hello' } })).status, 200);
  app.conversations.length = 0; await pg.exec('DELETE FROM connections');
  assert.equal((await app.request(`/messages/${B}`, { userId: A, method: 'POST', body: { content: 'Existing thread' } })).status, 200);
  await pg.query('INSERT INTO blocks VALUES($1,$2)', [B,A]);
  assert.equal((await app.request(`/messages/${B}`, { userId: A })).status, 403);
  assert.equal((await app.request(`/messages/${B}`, { userId: A, method: 'POST', body: { content: 'Blocked' } })).status, 403);
  const inbox = await app.request('/messages', { userId: A });
  assert.equal(inbox.status, 200); assert.deepEqual(inbox.data.conversations, []);
  const unavailable = app.db.query;
  app.db.query = async (...args) => { if (args[0].startsWith('SELECT\n        EXISTS')) throw new Error('fixture permissions unavailable'); return unavailable(...args); };
  assert.equal((await app.request(`/messages/${B}`, { userId: A })).status, 503);
});

test('message permissions changed during screening are checked again before committing content and notifications', async t => {
  const { pg, app } = await fixture(t);
  for (const change of ['block', 'private', 'connections']) {
    let entered, release;
    const screeningStarted = new Promise(resolve => { entered = resolve; });
    const screeningContinue = new Promise(resolve => { release = resolve; });
    app.setContentScreening(async () => { entered(); await screeningContinue; return { allowed: true, content: 'Delayed message' }; });
    const pending = app.request(`/messages/${B}`, { userId: A, method: 'POST', body: { content: 'Delayed message' } });
    await screeningStarted;
    if (change === 'block') await pg.query('INSERT INTO blocks VALUES($1,$2)', [B,A]);
    if (change === 'private') await pg.query('UPDATE users SET profile_hidden=true WHERE id=$1', [B]);
    if (change === 'connections') await pg.query('UPDATE users SET role_settings=$2 WHERE id=$1', [B, { privacy_messagePermission: 'connections' }]);
    release();
    assert.equal((await pending).status, 403, change);
    assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM direct_messages')).rows[0].count, 0, change);
    assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM notifications')).rows[0].count, 0, change);
    await pg.exec("DELETE FROM blocks; UPDATE users SET profile_hidden=false,role_settings='{}'");
  }
});
