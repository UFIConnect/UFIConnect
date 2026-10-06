'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createManagedVpn, registerManagedVpnRoutes, MANAGED_VPN_SCHEMA,
  gatewayRateLimitKey, isAuthenticatedGatewayPoll } = require('./managed-vpn');

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'a0000000-0000-4000-8000-000000000002';
const key = () => randomBytes(32).toString('base64');
const gateway = { id: 'test-us-1', label: 'Test US', country: 'US', endpoint: 'gateway.example.invalid:51820',
  publicKey: key(), subnet: '10.80.0.0/24', ipv6Subnet: 'fd80:80:0::/64', dns: ['10.80.0.1'], token: randomBytes(32).toString('base64url') };
const auth = 'Bearer ' + gateway.token;

async function fixture(t, options = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,vpn_connector_addon BOOLEAN NOT NULL DEFAULT true,billing_closed BOOLEAN NOT NULL DEFAULT false,
    auth_version INTEGER NOT NULL DEFAULT 0,auth_provider TEXT DEFAULT 'local',auth_subject TEXT);
    CREATE TABLE auth_sessions(id UUID PRIMARY KEY,user_id UUID REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL)`);
  await pg.query('INSERT INTO users(id) VALUES($1),($2)', [ALICE, BOB]);
  for (const sql of MANAGED_VPN_SCHEMA) await pg.exec(sql);
  const control = { now: Date.now(), connected: true, billingReads: 0, failBilling: false, status: {}, onStatus: null };
  let tail = Promise.resolve();
  const serial = fn => { const promise = tail.then(fn); tail = promise.catch(() => {}); return promise; };
  const db = { isConnected: () => control.connected,
    query: (sql, args) => serial(() => pg.query(sql, args)),
    withClient: fn => serial(() => fn({ query: (sql, args) => pg.query(sql, args) })) };
  const paid = () => ({ vpnConnectorAddon: true, subscriptions: [{ kind: 'vpn_connector', status: 'active', currentPeriodEnd: Math.floor(control.now / 1000) + 3600 }] });
  const billing = { status: async userId => {
    control.billingReads++;
    if (control.onStatus) await control.onStatus(userId);
    if (control.failBilling) throw new Error('Provider internal diagnostic must not reach clients');
    return control.status[userId] || paid();
  } };
  const vpn = createManagedVpn({ db, billing, gateways: [gateway], now: () => control.now, ...options });
  const enroll = (userId = ALICE, overrides = {}) => vpn.enroll(userId, { label: 'Test device', publicKey: key(), ...overrides });
  return { pg, db, billing, control, paid, vpn, enroll };
}

test('VPN config is truthful and never exposes gateway credentials', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.vpn.config().gateways, [{ id: gateway.id, label: gateway.label, country: 'US' }]);
  assert.equal(JSON.stringify(f.vpn.config()).includes(gateway.token), false);
  assert.equal(f.vpn.config().clientRequired, true);
  assert.equal(f.vpn.config().trialAccess, false);
  f.control.connected = false;
  assert.equal(f.vpn.config().available, false);
  const unconfigured = createManagedVpn({ db: f.db, billing: f.billing });
  assert.equal(unconfigured.config().available, false);
  f.control.connected = true;
  await assert.rejects(unconfigured.enroll(ALICE, { publicKey: key(), label: 'phone' }), { status: 503 });
});

test('paid enrollment returns public native configuration with both IP families and is idempotent', async t => {
  const f = await fixture(t);
  const publicKey = key();
  const first = await f.enroll(ALICE, { publicKey });
  assert.equal(first.state, 'enrolled');
  assert.deepEqual(first.device.addresses, ['10.80.0.2/32', 'fd80:80:0::2/128']);
  assert.deepEqual(first.device.allowedIPs, ['0.0.0.0/0', '::/0']);
  assert.deepEqual(first.device.dns, ['10.80.0.1']);
  assert.equal(first.device.serverPublicKey, gateway.publicKey);
  assert.equal(first.device.ipv6Egress, 'blocked');
  assert.equal(JSON.stringify(first).includes(gateway.token), false);
  f.control.now += 30000;
  const again = await f.enroll(ALICE, { publicKey });
  assert.equal(again.device.deviceId, first.device.deviceId);
  assert.ok(Date.parse(again.device.leaseExpiresAt) > Date.parse(first.device.leaseExpiresAt));
  assert.equal((await f.vpn.list(ALICE)).devices.length, 1);
  assert.equal((await f.vpn.list(BOB)).devices.length, 0);
});

test('private keys, arbitrary commands and invalid public keys never enter enrollment storage', async t => {
  const f = await fixture(t);
  for (const body of [{ privateKey: 'not-accepted' }, { endpoint: 'attacker.invalid:1' }, { command: 'anything' },
    { publicKey: Buffer.alloc(32).toString('base64') }, { publicKey: 'invalid' }, { label: 'phone\nPostUp=unsafe' }]) {
    await assert.rejects(f.enroll(ALICE, body), { status: 400 });
  }
  assert.equal(f.control.billingReads, 0);
  assert.equal((await f.vpn.list(ALICE)).devices.length, 0);
});

test('paid access cannot be inferred from a flag, trial, canceled subscription or expired period', async t => {
  const f = await fixture(t);
  for (const status of [
    { vpnConnectorAddon: true, subscriptions: [] },
    { vpnConnectorAddon: false, subscriptions: f.paid().subscriptions },
    { vpnConnectorAddon: true, subscriptions: [{ ...f.paid().subscriptions[0], status: 'trialing' }] },
    { vpnConnectorAddon: true, subscriptions: [{ ...f.paid().subscriptions[0], status: 'canceled' }] },
    { vpnConnectorAddon: true, subscriptions: [{ ...f.paid().subscriptions[0], currentPeriodEnd: Math.floor(f.control.now / 1000) - 1 }] },
    { vpnConnectorAddon: true, subscriptions: [...f.paid().subscriptions, ...f.paid().subscriptions] },
  ]) {
    f.control.status[ALICE] = status;
    await assert.rejects(f.enroll(), { status: 403 });
  }
  assert.equal((await f.vpn.list(ALICE)).devices.length, 0);
});

test('concurrent enrollment enforces device limits and unique addresses across owners', async t => {
  const f = await fixture(t, { maxDevices: 2 });
  const results = await Promise.allSettled([f.enroll(), f.enroll(), f.enroll(), f.enroll(BOB)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  const addresses = results.filter(result => result.status === 'fulfilled').map(result => result.value.device.addresses[0]);
  assert.equal(new Set(addresses).size, 3);
  assert.equal((await f.vpn.list(ALICE)).devices.length, 2);
});

test('gateway capacity and public-key ownership cannot be bypassed', async t => {
  const f = await fixture(t, { gateways: [{ ...gateway, maxPeers: 1 }] });
  const publicKey = key();
  await f.enroll(ALICE, { publicKey });
  await assert.rejects(f.enroll(BOB, { publicKey }), { status: 409 });
  await assert.rejects(f.enroll(BOB), { status: 503 });
  assert.equal((await f.vpn.list(BOB)).devices.length, 0);
});

test('gateway authentication is isolated and precedes account or billing reads', async t => {
  const second = { ...gateway, id: 'test-eu-1', token: randomBytes(32).toString('base64url') };
  const f = await fixture(t, { gateways: [gateway, second] });
  for (const [id, authorization] of [[gateway.id, null], [gateway.id, 'Bearer wrong'], ['unknown', auth], [second.id, auth]]) {
    await assert.rejects(f.vpn.desired(id, authorization), { status: 401 });
  }
  assert.equal(f.control.billingReads, 0);
});

test('desired peers are public, restricted to their gateway and expire no later than payment', async t => {
  const second = { ...gateway, id: 'test-eu-1', token: randomBytes(32).toString('base64url') };
  const f = await fixture(t, { gateways: [gateway, second] });
  const paidThrough = Math.floor(f.control.now / 1000) + 60;
  f.control.status[ALICE] = { vpnConnectorAddon: true, subscriptions: [{ ...f.paid().subscriptions[0], currentPeriodEnd: paidThrough }] };
  const first = await f.enroll();
  await f.enroll(BOB, { gatewayId: second.id });
  const desired = await f.vpn.desired(gateway.id, auth);
  assert.equal(desired.peers.length, 1);
  assert.deepEqual(desired.peers[0], { deviceId: first.device.deviceId, publicKey: first.device.publicKey,
    allowedIPs: first.device.addresses, expiresAt: new Date(paidThrough * 1000).toISOString() });
  assert.equal(Date.parse(desired.expiresAt) - f.control.now, 300000);
  for (const secret of [ALICE, BOB, gateway.token, 'privateKey', 'Test device']) assert.equal(JSON.stringify(desired).includes(secret), false);
});

test('every poll reconciles membership and removes canceled, expired or unverifiable peers', async t => {
  const f = await fixture(t);
  const first = await f.enroll();
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 1);
  f.control.status[ALICE] = { vpnConnectorAddon: false, subscriptions: [] };
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
  f.control.status[ALICE] = f.paid();
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 1);
  f.control.failBilling = true;
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
  const rows = await f.pg.query('SELECT lease_expires_at FROM managed_vpn_devices');
  assert.equal(new Date(rows.rows[0].lease_expires_at).toISOString(), first.device.leaseExpiresAt);
  f.control.failBilling = false;
  f.control.status[ALICE].subscriptions[0].currentPeriodEnd = Math.floor(f.control.now / 1000) - 1;
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
});

test('gateway polls cannot renew an abandoned client and expired keys cannot reenroll', async t => {
  const f = await fixture(t, { maxDevices: 1, gateways: [{ ...gateway, maxPeers: 1 }] });
  const first = await f.enroll();
  f.control.now += 240000;
  const beforeExpiry = await f.vpn.desired(gateway.id, auth);
  assert.equal(beforeExpiry.peers[0].expiresAt, first.device.leaseExpiresAt);
  f.control.now += 60000;
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
  assert.equal((await f.vpn.list(ALICE)).devices.length, 0);
  await assert.rejects(f.enroll(ALICE, { publicKey: first.device.publicKey }), { status: 409 });
  // A fresh identity reclaims the device slot and unique gateway address.
  const replacement = await f.enroll();
  assert.notEqual(replacement.device.deviceId, first.device.deviceId);
  assert.deepEqual(replacement.device.addresses, first.device.addresses);
  await assert.rejects(f.enroll(ALICE, { publicKey: first.device.publicKey }), { status: 409 });
  assert.deepEqual((await f.vpn.desired(gateway.id, auth)).peers.map(peer => peer.deviceId), [replacement.device.deviceId]);
});

test('client renewal extends its own lease and released capacity is safe across owners', async t => {
  const f = await fixture(t, { gateways: [{ ...gateway, maxPeers: 1 }] });
  const first = await f.enroll();
  f.control.now += 270000;
  const renewed = await f.enroll(ALICE, { publicKey: first.device.publicKey });
  assert.equal(renewed.device.deviceId, first.device.deviceId);
  f.control.now += 60000;
  const desired = await f.vpn.desired(gateway.id, auth);
  assert.equal(desired.peers[0].expiresAt, renewed.device.leaseExpiresAt);
  await assert.rejects(f.enroll(BOB), { status: 503 });
  f.control.now = Date.parse(renewed.device.leaseExpiresAt);
  const second = await f.enroll(BOB);
  assert.deepEqual(second.device.addresses, first.device.addresses);
  await assert.rejects(f.enroll(ALICE, { publicKey: first.device.publicKey }), { status: 409 });
  assert.deepEqual((await f.vpn.desired(gateway.id, auth)).peers.map(peer => peer.deviceId), [second.device.deviceId]);
});

test('client expiry during a slow billing poll cannot produce a peer', async t => {
  const f = await fixture(t);
  await f.enroll();
  f.control.onStatus = () => { f.control.now += 300000; };
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
});

test('expired devices on another gateway release member slots without a cross-gateway sweep', async t => {
  const second = { ...gateway, id: 'test-eu-1', token: randomBytes(32).toString('base64url') };
  const f = await fixture(t, { maxDevices: 1, gateways: [gateway, second] });
  const first = await f.enroll();
  f.control.now += 300000;
  const replacement = await f.enroll(ALICE, { gatewayId: second.id });
  assert.equal(replacement.device.gatewayId, second.id);
  const old = await f.pg.query('SELECT revoked_at FROM managed_vpn_devices WHERE id=$1', [first.device.deviceId]);
  assert.equal(old.rows[0].revoked_at, null);
  await assert.rejects(f.enroll(ALICE, { publicKey: first.device.publicKey }), { status: 409 });
  assert.equal((await f.vpn.list(ALICE)).devices.length, 1);
});

test('a session revoked while billing runs cannot create or renew a device', async t => {
  const f = await fixture(t);
  const sid = 'b0000000-0000-4000-8000-000000000001';
  const identity = { id: ALICE, sid, ver: 0, authProvider: 'local' };
  await f.db.query('INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [sid, ALICE, new Date(f.control.now + 3600000)]);
  const body = { publicKey: key(), label: 'Phone' };
  const first = await f.vpn.enroll(ALICE, body, identity);
  f.control.onStatus = async () => {
    await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [ALICE]);
    await f.vpn.remove(ALICE, first.device.deviceId);
  };
  await assert.rejects(f.vpn.enroll(ALICE, { ...body, publicKey: key() }, identity), { status: 401 });
  f.control.onStatus = null;
  await assert.rejects(f.vpn.enroll(ALICE, body, identity), { status: 401 });
  assert.equal((await f.vpn.list(ALICE)).devices.length, 0);
  const currentIdentity = { ...identity, ver: 1 };
  f.control.onStatus = () => f.db.query('DELETE FROM auth_sessions WHERE id=$1', [sid]);
  await assert.rejects(f.vpn.enroll(ALICE, { ...body, publicKey: key() }, currentIdentity), { status: 401 });
});

test('verified identities cannot switch accounts and session expiry caps the lease', async t => {
  const f = await fixture(t);
  const sid = 'b0000000-0000-4000-8000-000000000001';
  await f.db.query('INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [sid, ALICE, new Date(f.control.now + 60000)]);
  const body = { publicKey: key(), label: 'Phone' };
  const identity = { id: ALICE, sid, ver: 0 };
  for (const invalid of [null, {}, { ...identity, id: BOB }, { ...identity, sid: 'bad' }, { ...identity, ver: undefined }]) {
    await assert.rejects(f.vpn.enroll(ALICE, body, invalid), { status: 401 });
  }
  assert.equal(Date.parse((await f.vpn.enroll(ALICE, body, identity)).device.leaseExpiresAt), f.control.now + 60000);
  await f.db.query("UPDATE users SET auth_provider='auth0',auth_subject='auth0|fixture' WHERE id=$1", [BOB]);
  await assert.rejects(f.vpn.enroll(BOB, { ...body, publicKey: key() }, { id: BOB, authProvider: 'auth0', sub: 'auth0|other' }), { status: 401 });
  assert.equal((await f.vpn.enroll(BOB, { ...body, publicKey: key() }, { id: BOB, authProvider: 'auth0', sub: 'auth0|fixture' })).state, 'enrolled');
});

test('revocation stays owner-bound and works after cancellation without billing', async t => {
  const f = await fixture(t);
  const first = await f.enroll();
  await assert.rejects(f.vpn.remove(BOB, first.device.deviceId), { status: 404 });
  f.control.failBilling = true;
  assert.equal((await f.vpn.remove(ALICE, first.device.deviceId)).removed, true);
  assert.equal((await f.vpn.list(ALICE)).devices.length, 0);
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
});

test('account deletion and concurrent revocation cannot be resurrected by an older poll', async t => {
  const f = await fixture(t);
  const first = await f.enroll();
  f.control.onStatus = () => f.vpn.remove(ALICE, first.device.deviceId);
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
  f.control.onStatus = null;
  await f.enroll();
  f.control.onStatus = () => f.db.query('DELETE FROM users WHERE id=$1', [ALICE]);
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
  assert.equal((await f.pg.query('SELECT * FROM managed_vpn_devices')).rows.length, 0);
});

test('stalled membership checks fail closed within a bounded poll and never reuse stale success', async t => {
  const f = await fixture(t, { billingTimeoutMs: 10, reconcileBudgetMs: 20 });
  await f.enroll();
  f.control.onStatus = () => new Promise(() => {});
  const started = Date.now();
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
  assert.ok(Date.now() - started < 1000);
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
});

test('member routes require authentication and never expose internal provider errors', async t => {
  const f = await fixture(t);
  const express = require('express');
  const http = require('node:http');
  const app = express(); app.use(express.json());
  const authenticate = (req, res, next) => {
    if (req.get('x-test-account') !== ALICE) return res.status(401).json({ message: 'Sign in.' });
    req.user = { id: ALICE }; next();
  };
  registerManagedVpnRoutes(app, { vpn: f.vpn, authenticate });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/vpn/config')).status, 401);
  // A middleware identity without the required verified session context must
  // not bypass the transaction's fresh authorization check.
  const unauthorized = await fetch(base + '/vpn/devices', { method: 'POST', headers: { 'x-test-account': ALICE, 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: key(), label: 'Phone' }) });
  assert.equal(unauthorized.status, 401);
  f.control.failBilling = true;
  const response = await fetch(base + '/vpn/devices', { method: 'POST', headers: { 'x-test-account': ALICE, 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: key(), label: 'Phone' }) });
  assert.equal(response.status, 503);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await response.text()).includes('internal diagnostic'), false);
});

test('shared-IP abuse cannot consume a verified gateway polling allowance or bypass ordinary API limits', async t => {
  const second = { ...gateway, id: 'test-eu-1', token: randomBytes(32).toString('base64url') };
  const f = await fixture(t, { gateways: [gateway, second] });
  await f.enroll();
  const express = require('express');
  const http = require('node:http');
  const { rateLimit } = require('express-rate-limit');
  const app = express();
  app.use(rateLimit({ windowMs: 60000, limit: 3,
    skip: req => isAuthenticatedGatewayPoll(req, f.vpn), standardHeaders: false, legacyHeaders: false }));
  const gatewayLimiter = rateLimit({ windowMs: 60000, limit: 2,
    keyGenerator: gatewayRateLimitKey, standardHeaders: false, legacyHeaders: false });
  registerManagedVpnRoutes(app, { vpn: f.vpn, authenticate: (_req, res) => res.sendStatus(401), gatewayLimiter });
  app.get('/ordinary', (_req, res) => res.sendStatus(200));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const poll = (id = gateway.id, authorization) => fetch(`${base}/vpn/gateways/${id}/desired`, {
    headers: authorization ? { authorization } : {},
  });
  for (const badAuth of [undefined, 'Bearer wrong', 'Bearer ' + second.token]) {
    const denied = await poll(gateway.id, badAuth);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('cache-control'), /no-store/);
  }
  // All requests use the same local address, modeling the shared VPN NAT.
  assert.equal((await poll()).status, 429);
  assert.equal((await fetch(base + '/ordinary', { headers: { authorization: auth } })).status, 429);
  const first = await poll(gateway.id, auth);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).peers.length, 1);
  assert.equal((await poll(gateway.id, auth)).status, 200);
  assert.equal((await poll(gateway.id, auth)).status, 429);
  // An exhausted verified gateway cannot consume another gateway's allowance.
  assert.equal((await poll(second.id, 'Bearer ' + second.token)).status, 200);
  assert.equal(isAuthenticatedGatewayPoll({ method: 'POST', path: `/vpn/gateways/${gateway.id}/desired`, get: () => auth }, f.vpn), false);
  assert.throws(() => gatewayRateLimitKey({}), { status: 401 });
});
