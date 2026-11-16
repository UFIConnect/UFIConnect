'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');
const liveModule = require('./get-ready-live');
const { GET_READY_LIVE_SCHEMA, createGetReadyLive, createLiveIceServers } = liveModule;

const OFFER = 'v=0\r\ns=viewer\r\n';
const ANSWER = 'v=0\r\ns=host\r\n';

async function fixture(t, names) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY, name TEXT, billing_closed BOOLEAN DEFAULT false);
    CREATE TABLE blocks(blocker_id TEXT, blocked_id TEXT, PRIMARY KEY (blocker_id, blocked_id))`);
  for (const sql of GET_READY_LIVE_SCHEMA) await pg.exec(sql);
  const members = Object.fromEntries(names.map(name => [name, randomUUID()]));
  for (const [name, id] of Object.entries(members)) await pg.query('INSERT INTO users(id,name) VALUES($1,$2)', [id, name]);
  const db = { isConnected: () => true, query: (...args) => pg.query(...args), withClient: fn => fn(pg) };
  const live = createGetReadyLive({ db, secret: 'live-test-only', iceServers: async () => [] });
  return { pg, db, live, ...members };
}

test('live routes authenticate, protect each viewer’s signaling, and revoke links when a host ends', async t => {
  const { pg, live, Host, Guest, Other } = await fixture(t, ['Host', 'Guest', 'Other']);
  const app = await createAppHarness({ connected: true,
    query(sql, args) {
      if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: args[0] }] };
      if (sql === 'SELECT * FROM users WHERE id=$1') return pg.query(sql, args);
      return { rows: [] };
    },
    modules: { './get-ready-live': { ...liveModule, createGetReadyLive: () => live } },
  });
  t.after(() => app.close());
  for (const [name, id] of Object.entries({ Host, Guest, Other })) app.seedUser(member(id, { name }));
  const call = (path, method, userId, body) => app.request(`/get-ready-with-us${path}`, { method, userId, body });
  const sessionId = randomUUID();
  const viewerId = randomUUID();
  const path = `/sessions/${sessionId}`;
  const viewerPath = `${path}/viewers/${viewerId}`;
  const start = { title: 'Morning routine', sessionId };
  assert.equal((await call('/sessions', 'POST', null, start)).status, 401);
  const started = await call('/sessions', 'POST', Host, start);
  assert.equal(started.status, 201);
  assert.equal(started.headers.get('cache-control'), 'private, no-store');
  const { inviteToken, session } = started.data;
  assert.equal(session.title, 'Morning routine');
  assert.equal((await call('/sessions', 'POST', Host, start)).data.inviteToken, inviteToken);
  assert.equal((await call('/sessions', 'POST', Host, { ...start, sessionId: randomUUID() })).status, 409);
  assert.notEqual((await pg.query('SELECT invite_hash FROM get_ready_live_sessions')).rows[0].invite_hash, inviteToken);

  assert.equal((await call('/invite', 'POST', Guest, { inviteToken })).data.session.hostName, 'Host');
  assert.equal((await call('/invite', 'POST', Guest, { inviteToken: sessionId })).status, 404);
  assert.equal((await call('/join', 'POST', Guest, { inviteToken, viewerId })).status, 201);
  assert.equal((await call(viewerPath, 'PUT', Guest, { offer: 'invalid offer' })).status, 400);
  assert.equal((await call(viewerPath, 'PUT', Other, { offer: OFFER })).status, 404);
  assert.equal((await call(viewerPath, 'PUT', Guest, { offer: OFFER })).data.answer, null);
  assert.equal((await call(`${path}/host`, 'POST', Guest, {})).status, 404);
  assert.deepEqual((await call(`${path}/host`, 'POST', Host, {})).data.viewers, [{ id: viewerId, offer: OFFER, answered: false }]);
  assert.equal((await call(`${viewerPath}/answer`, 'PUT', Other, { answer: ANSWER })).status, 404);
  assert.equal((await call(`${viewerPath}/answer`, 'PUT', Host, { answer: ANSWER })).status, 204);
  assert.equal((await call(viewerPath, 'PUT', Guest, {})).data.answer, ANSWER);
  assert.equal((await call(viewerPath, 'PUT', Other, {})).status, 404);
  await call(path, 'DELETE', Guest);
  assert.equal((await call('/invite', 'POST', Guest, { inviteToken })).status, 200);
  assert.equal((await call(path, 'DELETE', Host)).status, 204);
  assert.equal((await call(viewerPath, 'PUT', Guest, {})).status, 404);
  assert.equal((await call('/invite', 'POST', Guest, { inviteToken })).status, 404);
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM get_ready_live_viewers')).rows[0].total, 0);
  const restarted = await call('/sessions', 'POST', Host, start);
  assert.equal(restarted.status, 201);
  assert.notEqual(restarted.data.inviteToken, inviteToken);
  assert.equal((await call('/invite', 'POST', Guest, { inviteToken })).status, 404);
});

test('capacity, blocks, a rejoining viewer, and expired leases stay consistent', async t => {
  const names = ['Host', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'];
  const { pg, live, Host, First, Second, Third, Fourth, Fifth, Sixth, Seventh } = await fixture(t, names);
  const sessionId = randomUUID();
  const { inviteToken, session } = await live.start(Host, { title: '', sessionId });
  assert.equal(session.title, 'Get Ready With Us');
  const firstId = randomUUID();
  await live.join(First, { inviteToken, viewerId: firstId });
  for (const viewer of [Second, Third, Fourth, Fifth, Sixth]) await live.join(viewer, { inviteToken, viewerId: randomUUID() });
  await assert.rejects(live.join(Seventh, { inviteToken, viewerId: randomUUID() }), { status: 409 });

  const nextId = randomUUID();
  await live.join(First, { inviteToken, viewerId: nextId });
  await live.leave(First, sessionId, firstId);
  await assert.rejects(live.viewerSync(First, sessionId, firstId, { offer: OFFER }), { status: 404 });
  await live.viewerSync(First, sessionId, nextId, { offer: OFFER });
  await pg.query('INSERT INTO blocks VALUES ($1,$2)', [First, Host]);
  await assert.rejects(live.invite(First, inviteToken), { status: 404 });
  await assert.rejects(live.viewerSync(First, sessionId, nextId, {}), { status: 404 });
  assert.deepEqual((await live.hostSync(Host, sessionId)).viewers, []);
  await live.join(Seventh, { inviteToken, viewerId: randomUUID() });

  await pg.query("UPDATE get_ready_live_sessions SET lease_until=NOW()-INTERVAL '1 second' WHERE id=$1", [sessionId]);
  await assert.rejects(live.hostSync(Host, sessionId), { status: 404 });
  await live.prune();
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM get_ready_live_viewers')).rows[0].total, 0);
});

test('relay access returns only short-lived credentials for approved ICE servers', async () => {
  const iceServers = createLiveIceServers({
    getConfig: () => ({ keyId: 'a-turn-key', token: 'private-api-token' }),
    fetcher: async (url, options) => {
      assert.equal(new URL(url).origin, 'https://rtc.live.cloudflare.com');
      assert.equal(options.headers.Authorization, 'Bearer private-api-token');
      assert.equal(options.redirect, 'error');
      assert.ok(JSON.parse(options.body).ttl < 86_400);
      return { ok: true, json: async () => ({ iceServers: [{
        urls: ['turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp', 'turn:unknown.invalid:443?transport=tcp'],
        username: 'temporary-user', credential: 'temporary-password',
      }] }) };
    },
  });
  const result = await iceServers();
  assert.deepEqual(result[1], { urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'temporary-user', credential: 'temporary-password' });
  assert.doesNotMatch(JSON.stringify(result), /private-api-token|a-turn-key/);
});
