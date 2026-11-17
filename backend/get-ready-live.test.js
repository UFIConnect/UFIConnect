'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');
const liveModule = require('./get-ready-live');
const { GET_READY_LIVE_SCHEMA, createGetReadyLive, createLiveIceServers } = liveModule;

const OFFER = 'v=0\r\ns=viewer\r\n';
const ANSWER = 'v=0\r\ns=host\r\n';
const STUN = { urls: 'stun:stun.cloudflare.com:3478' };
const TLS_RELAY = {
  urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
  username: 'temporary-user',
  credential: 'temporary-password',
};

function cloudflareIceServers(fetcher) {
  return createLiveIceServers({
    getConfig: () => ({ keyId: 'a-turn-key', token: 'private-api-token' }),
    fetcher,
  });
}

function turnResponse(iceServers) {
  return Response.json({ iceServers }, { status: 201 });
}

async function fixture(t, names, { schema = GET_READY_LIVE_SCHEMA, iceServers = async () => [] } = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY, name TEXT, billing_closed BOOLEAN DEFAULT false);
    CREATE TABLE blocks(blocker_id TEXT, blocked_id TEXT, PRIMARY KEY (blocker_id, blocked_id))`);
  for (const sql of schema) await pg.exec(sql);
  const members = Object.fromEntries(names.map(name => [name, randomUUID()]));
  for (const [name, id] of Object.entries(members)) await pg.query('INSERT INTO users(id,name) VALUES($1,$2)', [id, name]);
  const db = { isConnected: () => true, query: (...args) => pg.query(...args), withClient: fn => fn(pg) };
  const live = createGetReadyLive({ db, secret: 'live-test-only', iceServers });
  return { pg, db, live, ...members };
}

test('only the host can admit, decline, and remove viewers, and viewers wait for approval before signaling', async t => {
  const iceServers = cloudflareIceServers(async () => turnResponse(TLS_RELAY));
  const { pg, live, Host, Guest, Other } = await fixture(t, ['Host', 'Guest', 'Other'], { iceServers });
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
  const start = { title: 'Morning routine', sessionId, supportsApproval: true };
  assert.equal((await call('/sessions', 'POST', null, start)).status, 401);
  const started = await call('/sessions', 'POST', Host, start);
  assert.equal(started.status, 201);
  assert.equal(started.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(started.data.iceServers, [STUN, TLS_RELAY]);
  const { inviteToken, session } = started.data;
  assert.equal(session.title, 'Morning routine');
  assert.equal(session.requiresApproval, true);
  assert.match(inviteToken, /^v2\.[A-Za-z0-9_-]{43}$/);
  assert.equal((await call('/sessions', 'POST', Host, start)).data.inviteToken, inviteToken);
  assert.equal((await call('/sessions', 'POST', Host, { ...start, sessionId: randomUUID() })).status, 409);
  assert.notEqual((await pg.query('SELECT invite_hash FROM get_ready_live_sessions')).rows[0].invite_hash, inviteToken);

  assert.equal((await call('/invite', 'POST', Guest, { inviteToken })).data.session.hostName, 'Host');
  assert.equal((await call('/invite', 'POST', Guest, { inviteToken: sessionId })).status, 404);
  assert.equal((await call('/join', 'POST', Guest, { inviteToken, viewerId })).status, 409);
  const request = { inviteToken, viewerId, supportsApproval: true };
  const joined = await call('/join', 'POST', Guest, request);
  assert.equal(joined.status, 201);
  assert.equal(joined.data.admission, 'pending');
  assert.equal(joined.data.iceServers, undefined);
  assert.equal((await call(viewerPath, 'PUT', Guest, { offer: 'invalid offer' })).status, 400);
  assert.equal((await call(viewerPath, 'PUT', Other, { offer: OFFER })).status, 404);
  assert.deepEqual((await call(viewerPath, 'PUT', Guest, { offer: OFFER })).data, { admission: 'pending', answer: null });
  assert.equal((await call(`${path}/host`, 'POST', Guest, {})).status, 404);
  assert.deepEqual((await call(`${path}/host`, 'POST', Host, {})).data, {
    viewers: [], guests: [{ id: viewerId, name: 'Guest', admission: 'pending' }],
  });
  const decide = (viewerPath, user, decision) => call(`${viewerPath}/admission`, 'PUT', user, { decision });
  assert.equal((await decide(viewerPath, null, 'approve')).status, 401);
  assert.equal((await decide(viewerPath, Guest, 'approve')).status, 404);
  assert.equal((await call(`${viewerPath}/answer`, 'PUT', Host, { answer: ANSWER })).status, 404);
  assert.equal((await decide(viewerPath, Host, 'approve')).status, 204);
  assert.equal((await decide(viewerPath, Host, 'approve')).status, 204);
  const approved = await call('/join', 'POST', Guest, request);
  assert.equal(approved.status, 201);
  assert.equal(approved.headers.get('cache-control'), 'private, no-store');
  assert.equal(approved.data.admission, 'approved');
  assert.deepEqual(approved.data.iceServers, [STUN, TLS_RELAY]);
  assert.deepEqual((await call(viewerPath, 'PUT', Guest, {})).data, { admission: 'approved', answer: null });
  assert.equal((await call(viewerPath, 'PUT', Guest, { offer: OFFER })).data.answer, null);
  assert.deepEqual((await call(`${path}/host`, 'POST', Host, {})).data.viewers, [{ id: viewerId, offer: OFFER, answered: false }]);
  assert.equal((await call(`${viewerPath}/answer`, 'PUT', Other, { answer: ANSWER })).status, 404);
  assert.equal((await call(`${viewerPath}/answer`, 'PUT', Host, { answer: ANSWER })).status, 204);
  assert.equal((await call(viewerPath, 'PUT', Guest, {})).data.answer, ANSWER);
  assert.equal((await call(viewerPath, 'PUT', Other, {})).status, 404);

  const otherId = randomUUID();
  const otherPath = `${path}/viewers/${otherId}`;
  assert.equal((await call('/join', 'POST', Other, { ...request, viewerId: otherId })).data.admission, 'pending');
  assert.equal((await decide(otherPath, Guest, 'decline')).status, 404);
  assert.equal((await decide(otherPath, Host, 'decline')).status, 204);
  assert.equal((await call(otherPath, 'PUT', Other, {})).data.message, 'The host declined your request to join.');
  assert.equal((await call(otherPath, 'DELETE', Other)).status, 204);
  assert.equal((await call('/join', 'POST', Other, { ...request, viewerId: randomUUID() })).status, 403);

  await call(path, 'DELETE', Guest);
  assert.equal((await call('/invite', 'POST', Guest, { inviteToken })).status, 200);
  assert.equal((await decide(viewerPath, Other, 'remove')).status, 404);
  assert.equal((await decide(viewerPath, Host, 'remove')).status, 204);
  assert.equal((await call(viewerPath, 'PUT', Guest, {})).data.message, 'The host removed you from this session.');
  assert.equal((await call(viewerPath, 'DELETE', Guest)).status, 204);
  assert.equal((await call('/invite', 'POST', Guest, { inviteToken })).status, 403);
  assert.equal((await call('/join', 'POST', Guest, { ...request, viewerId: randomUUID() })).status, 403);
  assert.deepEqual((await call(`${path}/host`, 'POST', Host, {})).data, { guests: [], viewers: [] });
  assert.equal((await call(path, 'DELETE', Host)).status, 204);
  assert.equal((await call(viewerPath, 'PUT', Guest, {})).status, 404);
  assert.equal((await call('/invite', 'POST', Guest, { inviteToken })).status, 404);
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM get_ready_live_viewers')).rows[0].total, 0);
  const restarted = await call('/sessions', 'POST', Host, start);
  assert.equal(restarted.status, 201);
  assert.notEqual(restarted.data.inviteToken, inviteToken);
  assert.equal((await call('/invite', 'POST', Guest, { inviteToken })).status, 404);
  assert.equal((await call('/join', 'POST', Guest, { ...request, inviteToken: restarted.data.inviteToken })).data.admission, 'pending');
});

test('capacity, blocks, a rejoining viewer, and expired leases stay consistent', async t => {
  const names = ['Host', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'];
  const { pg, live, Host, First, Second, Third, Fourth, Fifth, Sixth, Seventh } = await fixture(t, names);
  const sessionId = randomUUID();
  const { inviteToken, session } = await live.start(Host, { title: '', sessionId, supportsApproval: true });
  assert.equal(session.title, 'Get Ready With Us');
  const firstId = randomUUID();
  const join = (memberId, viewerId = randomUUID()) => live.join(memberId, { inviteToken, viewerId, supportsApproval: true });
  for (const [memberId, id] of [[First, firstId], ...[Second, Third, Fourth, Fifth, Sixth].map(member => [member, randomUUID()])]) {
    assert.equal((await join(memberId, id)).admission, 'pending');
    await live.decideAdmission(Host, sessionId, id, 'approve');
  }
  const seventh = await join(Seventh);
  await assert.rejects(live.decideAdmission(Host, sessionId, seventh.viewerId, 'approve'), { status: 409 });

  const nextId = randomUUID();
  assert.equal((await join(First, nextId)).admission, 'approved');
  await live.leave(First, sessionId, firstId);
  await assert.rejects(live.viewerSync(First, sessionId, firstId, { offer: OFFER }), { status: 404 });
  await live.viewerSync(First, sessionId, nextId, { offer: OFFER });
  await pg.query('INSERT INTO blocks VALUES ($1,$2)', [First, Host]);
  await assert.rejects(live.invite(First, inviteToken), { status: 404 });
  await assert.rejects(live.viewerSync(First, sessionId, nextId, {}), { status: 404 });
  assert.deepEqual((await live.hostSync(Host, sessionId)).viewers, []);
  await live.decideAdmission(Host, sessionId, seventh.viewerId, 'approve');
  assert.equal((await live.viewerSync(Seventh, sessionId, seventh.viewerId, {})).admission, 'approved');

  await pg.query("UPDATE get_ready_live_sessions SET lease_until=NOW()-INTERVAL '1 second' WHERE id=$1", [sessionId]);
  await assert.rejects(live.hostSync(Host, sessionId), { status: 404 });
  await live.prune();
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM get_ready_live_viewers')).rows[0].total, 0);
});

test('the admission migration preserves invites and viewers already live at rollout', async t => {
  const oldSchema = GET_READY_LIVE_SCHEMA.filter(sql => !sql.startsWith('ALTER TABLE'));
  const { pg, live, Host, Guest } = await fixture(t, ['Host', 'Guest'], { schema: oldSchema });
  const sessionId = randomUUID();
  const viewerId = randomUUID();
  const inviteToken = 'A'.repeat(43);
  await pg.query(`INSERT INTO get_ready_live_sessions (id,host_id,title,invite_nonce,invite_hash,lease_until,ends_at)
    VALUES ($1,$2,'Legacy live','nonce',$3,NOW()+INTERVAL '1 minute',NOW()+INTERVAL '1 hour')`,
  [sessionId, Host, createHash('sha256').update(inviteToken).digest('hex')]);
  await pg.query(`INSERT INTO get_ready_live_viewers (session_id,member_id,id,offer,answer,lease_until)
    VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '1 minute')`, [sessionId, Guest, viewerId, OFFER, ANSWER]);
  for (const sql of GET_READY_LIVE_SCHEMA) await pg.exec(sql);
  assert.equal((await live.invite(Guest, inviteToken)).session.requiresApproval, false);
  assert.equal((await live.join(Guest, { inviteToken, viewerId })).admission, 'approved');
  assert.deepEqual(await live.viewerSync(Guest, sessionId, viewerId, {}), { admission: 'approved', answer: ANSWER });
});

test('preserves a singleton TURN/TLS relay when port 443 is the only path', async () => {
  const iceServers = cloudflareIceServers(async () => turnResponse({ ...TLS_RELAY, urls: TLS_RELAY.urls[0] }));
  assert.deepEqual(await iceServers(), [STUN, TLS_RELAY]);
});

test('accepts the documented Cloudflare array and returns only allowed relay fields and URLs', async () => {
  const relay = { ...TLS_RELAY, urls: [
    'turn:turn.cloudflare.com:3478?transport=udp',
    'turn:turn.cloudflare.com:443?transport=udp',
    'turn:turn.cloudflare.com:3478?transport=tcp',
    'turn:turn.cloudflare.com:80?transport=tcp',
    'turns:turn.cloudflare.com:5349?transport=tcp',
    TLS_RELAY.urls[0],
  ] };
  let request;
  const iceServers = cloudflareIceServers(async (url, options) => {
    request = { url, options };
    return turnResponse([
      { urls: [STUN.urls] },
      null,
      { ...TLS_RELAY, username: '' },
      {
        ...relay,
        urls: [
          ...relay.urls,
          'turn:turn.cloudflare.com:53?transport=udp',
          'turn:unknown.invalid:443?transport=tcp',
          'turns:turn.cloudflare.com:443?transport=udp',
          'turn:turn.cloudflare.com:80?transport=udp',
          `${TLS_RELAY.urls[0]}&extra=value`,
          [TLS_RELAY.urls[0]],
          443,
        ],
        token: 'private-api-token',
        keyId: 'a-turn-key',
      },
    ]);
  });
  assert.deepEqual(await iceServers(), [STUN, relay]);
  assert.equal(request.url, 'https://rtc.live.cloudflare.com/v1/turn/keys/a-turn-key/credentials/generate-ice-servers');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer private-api-token');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(request.options.body), { ttl: 10_800 });
});

test('falls back to STUN when the provider returns malformed relay data', async t => {
  const cases = [
    ['missing iceServers', undefined],
    ['null iceServers', null],
    ['non-object iceServers', 'invalid'],
    ['empty iceServers array', []],
    ['no allowed relay URLs', { ...TLS_RELAY, urls: [STUN.urls] }],
    ['missing username', { ...TLS_RELAY, username: undefined }],
    ['empty username', { ...TLS_RELAY, username: '' }],
    ['missing credential', { ...TLS_RELAY, credential: undefined }],
    ['empty credential', { ...TLS_RELAY, credential: '' }],
    ['whitespace credential', { ...TLS_RELAY, credential: ' \t' }],
    ['control character in credential', { ...TLS_RELAY, credential: 'invalid\0password' }],
    ['non-string credential', { ...TLS_RELAY, credential: { password: 'invalid' } }],
  ];
  for (const [name, servers] of cases) {
    await t.test(name, async () => {
      const iceServers = cloudflareIceServers(async () => turnResponse(servers));
      assert.deepEqual(await iceServers(), [STUN]);
    });
  }
});

test('falls back to STUN without contacting the provider when TURN is unconfigured', async t => {
  const fetcher = t.mock.fn();
  const iceServers = createLiveIceServers({ getConfig: () => ({}), fetcher });
  assert.deepEqual(await iceServers(), [STUN]);
  assert.equal(fetcher.mock.callCount(), 0);
});

test('falls back to STUN when the TURN provider fails', async t => {
  const cases = [
    ['HTTP error', async () => Response.json({ iceServers: TLS_RELAY }, { status: 503 })],
    ['malformed JSON', async () => new Response('{')],
    ['network error', async () => { throw new TypeError('fetch failed'); }],
    ['timeout', async () => { throw new DOMException('fetch timed out', 'TimeoutError'); }],
  ];
  for (const [name, fetcher] of cases) {
    await t.test(name, async () => {
      assert.deepEqual(await cloudflareIceServers(fetcher)(), [STUN]);
    });
  }
});
