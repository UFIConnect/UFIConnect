const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createSuspiciousDevices, suspiciousReason, contentActivity, contentForActivity } = require('./suspicious-devices');
const secret = 'synthetic-device-test-key-with-at-least-32-characters';
const phishing = index => `Send us your password at https://example.invalid/claim/${index}`;
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY)');
  const userId = randomUUID(); await pg.query('INSERT INTO users(id) VALUES($1)', [userId]);
  let connected = true, tail = Promise.resolve();
  const db = { isConnected: () => connected, query: (...args) => pg.query(...args),
    withClient: work => { const next = tail.then(() => work({ query: (...args) => pg.query(...args) })); tail = next.catch(() => {}); return next; } };
  const service = createSuspiciousDevices({ db, secret, production: true }); await service.initialize();
  return { pg, db, userId, service, disconnect: () => { connected = false; } };
}
async function guard(service, userId, values = {}) {
  const response = { code: 200, headers: {}, body: null, next: false,
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, append(key, value) { this.headers[key] = value; return this; } };
  const req = { method: 'POST', path: '/groups/general/posts', headers: {}, body: { content: 'A useful ordinary update.' }, user: { id: userId, sid: 'stable-session' }, ...values };
  await service.guard(req, response, () => { response.next = true; }); return response;
}
test('device tokens reject tampering, expiration and invalid identities', () => {
  let now = Date.now(); const service = createSuspiciousDevices({ db: {}, secret, now: () => now });
  const id = randomUUID(), signed = service.token(id);
  assert.equal(service.verify(signed), id);
  assert.equal(service.verify(signed.replace(id, randomUUID())), null);
  assert.equal(service.verify(signed.slice(0, -1) + (signed.endsWith('a') ? 'b' : 'a')), null);
  assert.equal(service.verify(signed + '.extra'), null);
  now += 366 * 86400000; assert.equal(service.verify(signed), null);
});
test('detectors use actual submitted content fields and do not count normal warnings, engagement calls or unused fields', () => {
  assert.equal(suspiciousReason(phishing(1)), 'credential_phishing');
  assert.equal(suspiciousReason('Never send us your password at https://example.invalid'), null);
  assert.equal(suspiciousReason('Beware: scammers offer to buy verified accounts at https://example.org/report'), null);
  assert.equal(suspiciousReason('This article explains why you should never buy verified accounts.'), null);
  assert.equal(suspiciousReason('A useful ordinary update with discussion.'), null);
  assert.equal(contentActivity({ method: 'POST', path: '/posts/engagement-signal' }), false);
  assert.equal(contentActivity({ method: 'PATCH', path: '/posts/native-post' }), true);
  assert.equal(contentActivity({ method: 'POST', path: '/business/posts' }), true);
  assert.equal(suspiciousReason(contentForActivity({ path: '/business/posts', body: { details: { description: 'Enter your password', applyUrl: 'https://example.invalid/apply' } } })), 'credential_phishing');
  assert.equal(contentForActivity({ path: '/snaps', body: { caption: 'A caption', overlayText: 'Overlay', ignored: phishing(1) } }), 'A caption\nOverlay');
  assert.equal(contentForActivity({ path: '/messages/a', body: { content: 'Normal', caption: phishing(1) } }), 'Normal');
});
test('six distinct events block a registered device; retries, reads and ordinary activity never inflate strikes', async t => {
  const f = await fixture(t);
  const first = await guard(f.service, f.userId); assert.equal(first.next, true);
  assert.match(first.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=None/);
  assert.equal((await f.service.list(f.userId)).devices[0].strikes, 0);
  for (let index = 0; index < 5; index++) {
    const response = await guard(f.service, f.userId, { body: { content: phishing(index) } });
    assert.equal(response.code, 400); assert.equal(response.body.strikes, index + 1);
  }
  const repeated = await guard(f.service, f.userId, { body: { content: phishing(4) } }); assert.equal(repeated.body.strikes, 5);
  const sixth = await guard(f.service, f.userId, { body: { content: phishing(5) } }); assert.equal(sixth.code, 403); assert.equal(sixth.body.code, 'DEVICE_BLOCKED');
  assert.equal((await guard(f.service, f.userId)).code, 403);
  assert.equal((await guard(f.service, f.userId, { method: 'GET' })).next, true);
  assert.equal((await guard(f.service, f.userId, { path: '/auth/logout' })).next, true);
  const report = await f.service.list(f.userId); assert.equal(report.devices.length, 1); assert.equal(report.devices[0].strikes, 6); assert.equal(report.devices[0].events.length, 6);
  const persisted = await f.pg.query('SELECT * FROM office_security_device_events');
  assert.doesNotMatch(JSON.stringify(persisted.rows), /password|example.invalid/);
});
test('device identity survives missing cookies on the same session and new sessions carrying the signed cookie', async t => {
  const f = await fixture(t), first = await guard(f.service, f.userId);
  const cookie = first.headers['Set-Cookie'].split(';')[0], original = (await f.service.list(f.userId)).devices[0].id;
  await guard(f.service, f.userId); assert.equal((await f.service.list(f.userId)).devices.length, 1);
  await guard(f.service, f.userId, { headers: { cookie }, user: { id: f.userId, sid: 'another-session' } });
  assert.equal((await f.service.list(f.userId)).devices.length, 1);
  const otherId = randomUUID(); await f.pg.query('INSERT INTO users(id) VALUES($1)', [otherId]);
  await guard(f.service, otherId, { headers: { cookie }, user: { id: otherId, sid: 'other-account-session' } });
  const other = await f.service.list(otherId); assert.equal(other.devices[0].id, original); assert.equal(other.devices[0].accounts, 2);
  await guard(f.service, f.userId, { user: { id: f.userId, sid: 'different-device-session' } });
  assert.equal((await f.service.list(f.userId)).devices.length, 2, 'A distinct browser/session is not blocked by account or IP association');
});
test('concurrent duplicate submissions are counted once and a reviewed reset retains history', async t => {
  const f = await fixture(t); await guard(f.service, f.userId);
  const deviceId = (await f.service.list(f.userId)).devices[0].id;
  const event = { deviceId, userId: f.userId, reason: 'credential_phishing', activity: '/groups/general/posts', content: phishing(0) };
  const retries = await Promise.all(Array.from({ length: 8 }, () => f.service.record(event)));
  assert.equal(retries.filter(row => row.counted).length, 1);
  await Promise.all(Array.from({ length: 5 }, (_, index) => f.service.record({ ...event, content: phishing(index + 1) })));
  assert.equal((await f.service.list(f.userId)).devices[0].strikes, 6);
  await assert.rejects(f.service.unblock(deviceId, ''), error => error.status === 400);
  await f.service.unblock(deviceId, 'Reviewed reported false positive.');
  let device = (await f.service.list(f.userId)).devices[0]; assert.equal(device.strikes, 0); assert.equal(device.blockedAt, null); assert.equal(device.events.length, 6);
  assert.equal((await f.pg.query('SELECT previous_strikes FROM office_security_device_reviews')).rows[0].previous_strikes, 6);
  assert.equal((await f.service.record(event)).strikes, 1, 'After review, a new violation can be counted again');
});
test('a clean existing session cannot mask a blocked browser cookie or overwrite it', async t => {
  const f = await fixture(t);
  const blocked = await guard(f.service, f.userId, { user: { id: f.userId, sid: 'blocked-session' } });
  const blockedCookie = blocked.headers['Set-Cookie'].split(';')[0];
  const blockedId = f.service.verify(blockedCookie.slice(blockedCookie.indexOf('=') + 1));
  const clean = await guard(f.service, f.userId, { user: { id: f.userId, sid: 'clean-session' } });
  const cleanCookie = clean.headers['Set-Cookie'].split(';')[0];
  await f.pg.query('UPDATE office_security_devices SET strikes=6,blocked_at=NOW() WHERE id=$1', [blockedId]);
  const response = await guard(f.service, f.userId, { user: { id: f.userId, sid: 'clean-session' }, headers: { cookie: blockedCookie } });
  assert.equal(response.code, 403); assert.equal(response.body.code, 'DEVICE_BLOCKED');
  assert.equal(response.headers['Set-Cookie'], undefined, 'The blocked cookie is preserved');
  const inverse = await guard(f.service, f.userId, { user: { id: f.userId, sid: 'blocked-session' }, headers: { cookie: cleanCookie } });
  assert.equal(inverse.code, 403, 'A clean cookie cannot mask a blocked existing session either');
});
test('security storage failures stop mutations without manufacturing an activity event', async t => {
  const f = await fixture(t); f.disconnect();
  const result = await guard(f.service, f.userId, { body: { content: phishing(0) } });
  assert.equal(result.code, 503); assert.equal(result.next, false);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS count FROM office_security_device_events')).rows[0].count, 0);
});
test('real production authentication permits ordinary writes, persistent device blocks and Office review', async t => {
  const f = await fixture(t);
  await f.pg.exec(`ALTER TABLE users ADD COLUMN name TEXT DEFAULT 'Device fixture',ADD COLUMN email TEXT DEFAULT 'device@example.invalid',ADD COLUMN auth_version INTEGER DEFAULT 0;
    CREATE TABLE auth_sessions(id UUID PRIMARY KEY,user_id UUID,expires_at TIMESTAMPTZ)`);
  const { createAppHarness, member } = require('./test-support/app-harness');
  const app = await createAppHarness({ connected: true,
    env: { NODE_ENV: 'production', JWT_SECRET: secret, OFFICE_TOKEN: 'device-office-fixture' },
    // Keep the real security module explicit if unrelated route fixtures use a stub.
    modules: { './suspicious-devices': require('./suspicious-devices') },
    query: async (sql, params) => {
      if (sql.includes('site_activity_heartbeat')) return { rows: [], rowCount: 0 };
      return f.db.query(sql, params.map(value => Object.prototype.toString.call(value) === '[object Date]' ? value.toISOString() : value));
    }, withClient: work => f.db.withClient(work),
  }); t.after(() => app.close());
  // The harness deliberately leaves background startup unresolved. All auth
  // and device tables used by these routes have been initialized above.
  app.markSecurityStorageReady();
  const token = await app.issueSession(member(f.userId)), headers = { authorization: `Bearer ${token}` };
  const ordinary = await app.request('/posts/engagement-signal', { method: 'POST', headers, body: {} });
  assert.equal(ordinary.status, 204, JSON.stringify(ordinary.data));
  assert.equal((await f.service.list(f.userId)).devices[0].strikes, 0);
  assert.equal((await app.request('/office/security/devices')).status, 401);
  for (let i = 0; i < 6; i++) {
    const result = await app.request('/groups/ufi-general/posts', { method: 'POST', headers, body: { content: phishing(i) } });
    assert.equal(result.status, i < 5 ? 400 : 403, JSON.stringify(result.data));
    assert.equal(result.data.strikes, i + 1);
  }
  const blocked = await app.request('/posts/engagement-signal', { method: 'POST', headers, body: {} });
  assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'DEVICE_BLOCKED');
  const officeHeaders = { 'x-office-token': 'device-office-fixture' };
  const report = await app.request('/office/security/devices?userId=' + f.userId, { headers: officeHeaders });
  assert.equal(report.status, 200); assert.equal(report.data.devices[0].strikes, 6);
  const deviceId = report.data.devices[0].id;
  assert.equal((await app.request('/office/security/devices/' + deviceId + '/unblock', { method: 'POST', headers: officeHeaders, body: { reason: 'Verified account owner' } })).status, 400);
  const review = await app.request('/office/security/devices/' + deviceId + '/unblock', { method: 'POST', headers: officeHeaders, body: { confirmed: true, reason: 'Verified account owner' } });
  assert.equal(review.status, 200);
  assert.equal((await app.request('/posts/engagement-signal', { method: 'POST', headers, body: {} })).status, 204);
});
