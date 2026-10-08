'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createManagedVpn, registerManagedVpnRoutes, MANAGED_VPN_SCHEMA,
  gatewayRateLimitKey, isAuthenticatedGatewayPoll } = require('./managed-vpn');

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'a0000000-0000-4000-8000-000000000002';
const key = () => randomBytes(32).toString('base64');
const gateway = { id: 'test-us-1', label: 'Test US', country: 'US', endpoint: 'gateway.example.invalid:51820',
  publicKey: key(), subnet: '10.80.0.0/24', ipv6Subnet: 'fd80:80:0::/64', dns: ['10.80.0.1'], token: randomBytes(32).toString('base64url') };
const auth = 'Bearer ' + gateway.token;
const germany = { ...gateway, id: 'test-de-1', label: 'Test Germany', country: 'DE', token: randomBytes(32).toString('base64url') };
const germanyAuth = 'Bearer ' + germany.token;

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

test('member VPN configuration requires current paid Vault entitlement and a verified same-account session', async t => {
  const f = await fixture(t), identity = await sessionIdentity(f);
  for (const plan of ['free', 'pro', 'business']) {
    f.control.status[ALICE] = { ...f.paid(), plan };
    const result = await f.vpn.memberConfig(ALICE, identity);
    assert.equal(result.available, true);
    assert.deepEqual(result.gateways, [{ id: gateway.id, label: gateway.label, country: 'US' }]);
    assert.equal(JSON.stringify(result).includes(gateway.token), false);
    assert.equal(JSON.stringify(result).includes(gateway.endpoint), false);
  }
  for (const status of [
    { vpnConnectorAddon: true, subscriptions: [] },
    { ...f.paid(), vpnConnectorAddon: false },
    { vpnConnectorAddon: true, subscriptions: [null] },
    { vpnConnectorAddon: true, subscriptions: [{ ...f.paid().subscriptions[0], kind: 'business' }] },
    { vpnConnectorAddon: true, subscriptions: [{ ...f.paid().subscriptions[0], status: 'trialing' }] },
    { vpnConnectorAddon: true, subscriptions: [{ ...f.paid().subscriptions[0], status: 'canceled' }] },
    { vpnConnectorAddon: true, subscriptions: [{ ...f.paid().subscriptions[0], currentPeriodEnd: f.control.now / 1000 }] },
    { vpnConnectorAddon: true, subscriptions: [...f.paid().subscriptions, ...f.paid().subscriptions] },
    { plan: 'pro', vpnConnectorAddon: false, subscriptions: [{ kind: 'plan', status: 'active' }] },
    { plan: 'business', vpnConnectorAddon: false, subscriptions: [{ kind: 'plan', status: 'active' }] },
  ]) {
    f.control.status[ALICE] = status;
    await assert.rejects(f.vpn.memberConfig(ALICE, identity), { status: 403 });
  }
  delete f.control.status[ALICE];
  for (const unverified of [null, { id: ALICE }, { ...identity, id: BOB }, { ...identity, sid: randomUUID() }, { ...identity, ver: 1 }]) {
    await assert.rejects(f.vpn.memberConfig(ALICE, unverified), { status: 401 });
  }
  const unconfigured = createManagedVpn({ db: f.db, billing: f.billing, now: () => f.control.now });
  assert.equal((await unconfigured.memberConfig(ALICE, identity)).available, false);
  f.control.failBilling = true;
  await assert.rejects(f.vpn.memberConfig(ALICE, identity), { status: 503, message: 'VPN membership verification is temporarily unavailable.' });
});

test('configuration rechecks account cancellation and session revocation after billing verification', async t => {
  const f = await fixture(t), identity = await sessionIdentity(f);
  f.control.onStatus = async () => f.pg.query('DELETE FROM auth_sessions WHERE id=$1', [identity.sid]);
  await assert.rejects(f.vpn.memberConfig(ALICE, identity), { status: 401 });
  const nextIdentity = await sessionIdentity(f);
  f.control.onStatus = async () => f.pg.query('UPDATE users SET vpn_connector_addon=false WHERE id=$1', [ALICE]);
  await assert.rejects(f.vpn.memberConfig(ALICE, nextIdentity), { status: 403 });
  f.control.onStatus = async () => f.pg.query('UPDATE users SET vpn_connector_addon=true,billing_closed=true WHERE id=$1', [ALICE]);
  await assert.rejects(f.vpn.memberConfig(ALICE, nextIdentity), { status: 403 });
});

test('VPN configuration HTTP route ignores caller entitlement flags and does not cache a previous paid success', async t => {
  const f = await fixture(t), identity = await sessionIdentity(f);
  const express = require('express'), http = require('node:http');
  const app = express();
  registerManagedVpnRoutes(app, { vpn: f.vpn, authenticate: (req, res, next) => {
    if (req.get('x-test-account') !== ALICE) return res.sendStatus(401);
    req.user = identity; next();
  } });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = () => fetch(base + '/vpn/config?vpnConnectorAddon=true&tier=vpn_connector&userId=' + BOB, { headers: { 'x-test-account': ALICE } });
  assert.equal((await fetch(base + '/vpn/config')).status, 401);
  const allowed = await request();
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).available, true);
  assert.match(allowed.headers.get('cache-control'), /private, no-store/);
  f.control.status[ALICE] = { vpnConnectorAddon: false, subscriptions: [] };
  const denied = await request();
  assert.equal(denied.status, 403);
  const body = await denied.json();
  assert.match(body.message, /paid UFI Vault membership/);
  assert.equal(body.gateways, undefined);
  assert.equal(f.control.billingReads, 2);
  f.control.failBilling = true;
  const unavailable = await request();
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes('internal diagnostic'), false);
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
  for (const route of ['/vpn/launch', '/vpn/launch/consume']) {
    assert.equal((await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'windows', code: randomBytes(32).toString('base64url') }) })).status, 401);
  }
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

async function sessionIdentity(f, userId = ALICE, seconds = 3600) {
  const sid = randomUUID();
  await f.pg.query('INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [sid, userId, new Date(f.control.now + seconds * 1000)]);
  return { id: userId, sid, ver: 0 };
}
const launchCode = value => new URL(value.url).searchParams.get('code');

test('app launch uses a short-lived hashed ticket and only one same-account app can redeem it', async t => {
  const f = await fixture(t), browser = await sessionIdentity(f), native = await sessionIdentity(f);
  const launch = await f.vpn.launch(ALICE, { platform: 'windows' }, browser);
  assert.match(launch.url, /^uficonnect-vpn:\/\/connect\?code=[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(launch.expiresAt) - f.control.now, 180000);
  const stored = (await f.pg.query('SELECT * FROM managed_vpn_launches')).rows[0];
  assert.equal(stored.token_hash.length, 64);
  assert.equal(JSON.stringify(stored).includes(launchCode(launch)), false);
  const results = await Promise.allSettled([1, 2].map(() => f.vpn.consumeLaunch(ALICE, { platform: 'windows', code: launchCode(launch) }, native)));
  assert.deepEqual(results.find(item => item.status === 'fulfilled').value, { action: 'connect' });
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.status, 409);
  assert.equal((await f.pg.query('SELECT * FROM managed_vpn_launches')).rows.length, 0);
  assert.equal((await f.vpn.list(ALICE)).devices.length, 0, 'A launch ticket does not enroll or pretend to connect');
});

test('launch tickets reject account/platform mismatch, replacement, expiry and ended browser sessions', async t => {
  const f = await fixture(t), browser = await sessionIdentity(f), native = await sessionIdentity(f), bob = await sessionIdentity(f, BOB);
  const launch = await f.vpn.launch(ALICE, { platform: 'ios' }, browser);
  const body = { code: launchCode(launch), platform: 'ios' };
  await assert.rejects(f.vpn.consumeLaunch(BOB, body, bob), { status: 409 });
  await assert.rejects(f.vpn.consumeLaunch(ALICE, { ...body, platform: 'android' }, native), { status: 409 });
  assert.deepEqual(await f.vpn.consumeLaunch(ALICE, body, native), { action: 'connect' });
  const stale = await f.vpn.launch(ALICE, { platform: 'ios' }, browser);
  const replaced = await f.vpn.launch(ALICE, { platform: 'ios' }, browser);
  await assert.rejects(f.vpn.consumeLaunch(ALICE, { ...body, code: launchCode(stale) }, native), { status: 409 });
  f.control.now += 180001;
  await assert.rejects(f.vpn.consumeLaunch(ALICE, { ...body, code: launchCode(replaced) }, native), { status: 409 });
  const ended = await f.vpn.launch(ALICE, { platform: 'ios' }, browser);
  await f.pg.query('DELETE FROM auth_sessions WHERE id=$1', [browser.sid]);
  assert.equal((await f.pg.query('SELECT * FROM managed_vpn_launches')).rows.length, 0);
  await assert.rejects(f.vpn.consumeLaunch(ALICE, { ...body, code: launchCode(ended) }, native), { status: 409 });
});

test('launch requires paid access, strict inputs and current identities after asynchronous billing', async t => {
  const f = await fixture(t), browser = await sessionIdentity(f);
  for (const body of [null, {}, { platform: 'linux' }, { platform: 'windows', url: 'https://untrusted.invalid' }]) {
    await assert.rejects(f.vpn.launch(ALICE, body, browser), { status: 400 });
  }
  for (const body of [{ platform: 'windows', code: 'invalid' }, { platform: 'windows', code: 'a'.repeat(43) }]) {
    await assert.rejects(f.vpn.consumeLaunch(ALICE, body, browser), { status: 400 });
  }
  await assert.rejects(f.vpn.launch(ALICE, { platform: 'windows' }, null), { status: 401 });
  f.control.status[ALICE] = { vpnConnectorAddon: false, subscriptions: [] };
  await assert.rejects(f.vpn.launch(ALICE, { platform: 'windows' }, browser), { status: 403 });
  delete f.control.status[ALICE];
  f.control.onStatus = () => f.pg.query('DELETE FROM auth_sessions WHERE id=$1', [browser.sid]);
  await assert.rejects(f.vpn.launch(ALICE, { platform: 'windows' }, browser), { status: 401 });
  assert.equal((await f.pg.query('SELECT * FROM managed_vpn_launches')).rows.length, 0);
});

test('launch intent expires with its browser session and cannot survive account revocation or Auth0 relinking', async t => {
  const f = await fixture(t), browser = await sessionIdentity(f, ALICE, 30), native = await sessionIdentity(f);
  const launch = await f.vpn.launch(ALICE, { platform: 'android' }, browser);
  assert.equal(Date.parse(launch.expiresAt), f.control.now + 30000);
  await f.pg.query('UPDATE users SET auth_version=1 WHERE id=$1', [ALICE]);
  await assert.rejects(f.vpn.consumeLaunch(ALICE, { platform: 'android', code: launchCode(launch) }, { ...native, ver: 1 }), { status: 409 });
  await f.pg.query("UPDATE users SET auth_version=0,auth_provider='auth0',auth_subject='auth0|alice' WHERE id=$1", [ALICE]);
  const oauth = { id: ALICE, authProvider: 'auth0', sub: 'auth0|alice' };
  const oauthLaunch = await f.vpn.launch(ALICE, { platform: 'android' }, oauth);
  await f.pg.query("UPDATE users SET auth_subject='auth0|changed' WHERE id=$1", [ALICE]);
  await assert.rejects(f.vpn.consumeLaunch(ALICE, { platform: 'android', code: launchCode(oauthLaunch) }, native), { status: 409 });
  await f.pg.query('DELETE FROM users WHERE id=$1', [ALICE]);
  assert.equal((await f.pg.query('SELECT * FROM managed_vpn_launches')).rows.length, 0);
});

test('imported profile selects Germany, stores only a public identity and survives browser expiry without client renewal', async t => {
  const f = await fixture(t, { gateways: [gateway, germany] });
  const identity = await sessionIdentity(f, ALICE, 30);
  const body = { publicKey: key(), label: 'UFIConnect iOS' };
  const first = await f.vpn.enrollProfile(ALICE, body, identity);
  assert.equal(first.state, 'registered');
  assert.equal(first.profile.gatewayId, germany.id);
  assert.equal(first.profile.enrollmentMode, 'profile');
  assert.equal(Object.hasOwn(first.profile, 'leaseExpiresAt'), false);
  assert.deepEqual(first.profile.allowedIPs, ['0.0.0.0/0', '::/0']);
  assert.deepEqual(first.profile.dns, germany.dns);
  assert.equal(first.profile.publicKey, body.publicKey);
  assert.equal((await f.vpn.enrollProfile(ALICE, body, identity)).profile.id, first.profile.id);
  assert.equal(f.vpn.config().profileImportAvailable, true);
  const stored = (await f.pg.query('SELECT * FROM managed_vpn_devices')).rows[0];
  assert.equal(stored.enrollment_mode, 'profile');
  assert.equal(stored.registration_auth_version, 0);
  assert.equal(stored.lease_expires_at, null);
  for (const secret of ['privateKey', germany.token, identity.sid]) assert.equal(JSON.stringify(stored).includes(secret), false);
  await f.pg.query('DELETE FROM auth_sessions WHERE id=$1', [identity.sid]);
  f.control.now += 20 * 60000;
  const desired = await f.vpn.desired(germany.id, germanyAuth);
  assert.equal(desired.peers.length, 1);
  assert.equal(desired.peers[0].deviceId, first.profile.id);
  assert.equal(Date.parse(desired.peers[0].expiresAt) - f.control.now, 300000);
  assert.equal((await f.vpn.list(ALICE)).devices.length, 0);
  assert.equal((await f.vpn.listProfiles(ALICE)).profiles[0].enrollmentMode, 'profile');
  assert.equal((await f.vpn.listProfiles(BOB)).profiles.length, 0);
  assert.equal((await f.vpn.desired(gateway.id, auth)).peers.length, 0);
});

test('profile inputs reject private keys, gateway overrides and unverified identities', async t => {
  const f = await fixture(t, { gateways: [germany] });
  const identity = await sessionIdentity(f);
  const body = { publicKey: key(), label: 'UFIConnect iOS' };
  for (const invalid of [null, [], { ...body, privateKey: 'secret' }, { ...body, gatewayId: germany.id },
    { ...body, endpoint: 'other.invalid:51820' }, { ...body, enrollmentMode: 'profile' },
    { ...body, publicKey: Buffer.alloc(32).toString('base64') }, { ...body, label: 'Phone\nPostUp=anything' }]) {
    await assert.rejects(f.vpn.enrollProfile(ALICE, invalid, identity), { status: 400 });
  }
  assert.equal(f.control.billingReads, 0);
  for (const invalid of [undefined, null, { id: ALICE }, { ...identity, id: BOB }, { ...identity, ver: 1 }]) {
    await assert.rejects(f.vpn.enrollProfile(ALICE, body, invalid), { status: 401 });
  }
  assert.equal((await f.vpn.listProfiles(ALICE)).profiles.length, 0);
  const unavailable = createManagedVpn({ db: f.db, billing: f.billing, gateways: [gateway], now: () => f.control.now });
  assert.equal(unavailable.config().profileImportAvailable, false);
  await assert.rejects(unavailable.enrollProfile(ALICE, body, identity), { status: 503 });
});

test('profile registration requires fresh paid access and checks identity again after billing', async t => {
  const f = await fixture(t, { gateways: [germany] }), identity = await sessionIdentity(f);
  const body = { publicKey: key(), label: 'UFIConnect iOS' };
  f.control.status[ALICE] = { vpnConnectorAddon: false, subscriptions: [] };
  await assert.rejects(f.vpn.enrollProfile(ALICE, body, identity), { status: 403 });
  f.control.status[ALICE] = { vpnConnectorAddon: true, subscriptions: [{ ...f.paid().subscriptions[0], status: 'trialing' }] };
  await assert.rejects(f.vpn.enrollProfile(ALICE, body, identity), { status: 403 });
  f.control.status[ALICE] = f.paid();f.control.failBilling = true;
  await assert.rejects(f.vpn.enrollProfile(ALICE, body, identity), { status: 503 });
  f.control.failBilling = false;
  f.control.onStatus = () => f.pg.query('DELETE FROM auth_sessions WHERE id=$1', [identity.sid]);
  await assert.rejects(f.vpn.enrollProfile(ALICE, body, identity), { status: 401 });
  assert.equal((await f.vpn.listProfiles(ALICE)).profiles.length, 0);
});

test('imported profile fails closed for outages and canceled payment, then recovers without reimport or address changes', async t => {
  const f = await fixture(t, { gateways: [germany] }), identity = await sessionIdentity(f);
  const { profile } = await f.vpn.enrollProfile(ALICE, { publicKey: key(), label: 'UFIConnect iOS' }, identity);
  const first = await f.vpn.desired(germany.id, germanyAuth);
  f.control.now += 360000;f.control.failBilling = true;
  assert.equal((await f.vpn.desired(germany.id, germanyAuth)).peers.length, 0);
  assert.equal((await f.vpn.listProfiles(ALICE)).profiles.length, 1);
  f.control.now += 360000;f.control.failBilling = false;
  const restored = await f.vpn.desired(germany.id, germanyAuth);
  assert.equal(restored.peers[0].deviceId, profile.id);
  assert.deepEqual(restored.peers[0].allowedIPs, first.peers[0].allowedIPs);
  assert.equal(Date.parse(restored.peers[0].expiresAt) - f.control.now, 300000);
  f.control.status[ALICE] = { vpnConnectorAddon: false, subscriptions: [] };
  assert.equal((await f.vpn.desired(germany.id, germanyAuth)).peers.length, 0);
  f.control.status[ALICE] = f.paid();
  f.control.status[ALICE].subscriptions[0].currentPeriodEnd = Math.floor(f.control.now / 1000) + 42;
  const paidEnd = await f.vpn.desired(germany.id, germanyAuth);
  assert.equal(Date.parse(paidEnd.peers[0].expiresAt), f.control.status[ALICE].subscriptions[0].currentPeriodEnd * 1000);
  const stored = (await f.pg.query('SELECT revoked_at,lease_expires_at FROM managed_vpn_devices')).rows[0];
  assert.equal(stored.revoked_at, null);assert.equal(stored.lease_expires_at, null);
  const reads = f.control.billingReads;
  await f.pg.query('UPDATE users SET vpn_connector_addon=false WHERE id=$1', [ALICE]);
  assert.equal((await f.vpn.desired(germany.id, germanyAuth)).peers.length, 0);
  assert.equal(f.control.billingReads, reads + 1, 'An inactive profile still gets fresh provider verification');
});

test('native keys cannot upgrade into persistent profiles and profile keys cannot enter native renewal', async t => {
  const f = await fixture(t, { gateways: [germany] }), identity = await sessionIdentity(f);
  const native = await f.enroll();
  await assert.rejects(f.vpn.enrollProfile(ALICE, { publicKey: native.device.publicKey, label: 'iOS' }, identity), { status: 409 });
  const { profile } = await f.vpn.enrollProfile(ALICE, { publicKey: key(), label: 'iOS' }, identity);
  await assert.rejects(f.enroll(ALICE, { publicKey: profile.publicKey }), { status: 409 });
  f.control.now += 300000;
  assert.deepEqual((await f.vpn.desired(germany.id, germanyAuth)).peers.map(peer => peer.deviceId), [profile.id]);
  assert.equal((await f.vpn.list(ALICE)).devices.length, 0);
  assert.equal((await f.vpn.listProfiles(ALICE)).profiles.length, 1);
});

test('native and imported profiles share member capacity, and inactive profiles reserve their gateway address until owner removal', async t => {
  const f = await fixture(t, { maxDevices: 2, gateways: [{ ...germany, maxPeers: 2 }] });
  const identity = await sessionIdentity(f);
  await f.enroll();
  const { profile } = await f.vpn.enrollProfile(ALICE, { publicKey: key(), label: 'iOS' }, identity);
  await assert.rejects(f.enroll(), { status: 409 });
  await assert.rejects(f.vpn.enrollProfile(ALICE, { publicKey: key(), label: 'iPad' }, identity), { status: 409 });
  await assert.rejects(f.enroll(BOB), { status: 503 });
  f.control.now += 86400000;
  f.control.status[ALICE] = { vpnConnectorAddon: false, subscriptions: [] };
  const bob = await f.enroll(BOB); // Expired native address is reclaimable; imported one is not.
  assert.notDeepEqual(bob.device.addresses, profile.addresses);
  await assert.rejects(f.enroll(BOB), { status: 503 });
  await assert.rejects(f.vpn.removeProfile(BOB, profile.id), { status: 404 });
  await assert.rejects(f.vpn.remove(ALICE, profile.id), { status: 404 });
  await assert.rejects(f.vpn.removeProfile(BOB, bob.device.deviceId), { status: 404 });
  f.control.failBilling = true;
  assert.deepEqual(await f.vpn.removeProfile(ALICE, profile.id), { removed: true });
  assert.equal((await f.vpn.listProfiles(ALICE)).profiles.length, 0);
  f.control.failBilling = false;
  const replacement = await f.enroll(BOB);
  assert.deepEqual(replacement.device.addresses, profile.addresses);
});

test('profile enrollment concurrency respects three combined slots and cannot claim another owner key', async t => {
  const f = await fixture(t, { gateways: [germany] }), identity = await sessionIdentity(f), bob = await sessionIdentity(f, BOB);
  const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => f.vpn.enrollProfile(ALICE, { publicKey: key(), label: 'iOS' }, identity)));
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 3);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.status, 409);
  const publicKey = outcomes.find(item => item.status === 'fulfilled').value.profile.publicKey;
  await assert.rejects(f.vpn.enrollProfile(BOB, { publicKey, label: 'iOS' }, bob), { status: 409 });
  const rows = (await f.pg.query('SELECT tunnel_address FROM managed_vpn_devices')).rows;
  assert.equal(new Set(rows.map(row => row.tunnel_address)).size, 3);
});

test('profile account revocation, owner removal and deletion during billing cannot resurrect a peer', async t => {
  for (const action of ['version', 'remove', 'delete']) {
    await t.test(action, async t => {
      const f = await fixture(t, { gateways: [germany] }), identity = await sessionIdentity(f);
      const { profile } = await f.vpn.enrollProfile(ALICE, { publicKey: key(), label: 'iOS' }, identity);
      f.control.onStatus = () => action === 'version'
        ? f.pg.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [ALICE])
        : action === 'remove' ? f.vpn.removeProfile(ALICE, profile.id)
          : f.pg.query('DELETE FROM users WHERE id=$1', [ALICE]);
      assert.equal((await f.vpn.desired(germany.id, germanyAuth)).peers.length, 0);
    });
  }
});

test('profile HTTP endpoints require a verified member, isolate modes and return no-store public configuration', async t => {
  const f = await fixture(t, { gateways: [germany] }), identity = await sessionIdentity(f);
  const express = require('express'), http = require('node:http');
  const app = express();app.use(express.json());
  registerManagedVpnRoutes(app, { vpn: f.vpn, authenticate: (req, res, next) => {
    if (req.get('x-test-account') !== ALICE) return res.sendStatus(401);
    req.user = identity;next();
  } });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections();return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const method of ['GET', 'POST', 'DELETE']) {
    const url = '/vpn/profiles' + (method === 'DELETE' ? '/' + ALICE : '');
    assert.equal((await fetch(base + url, { method })).status, 401);
  }
  const headers = { 'x-test-account': ALICE, 'content-type': 'application/json' };
  const response = await fetch(base + '/vpn/profiles', { method: 'POST', headers, body: JSON.stringify({ publicKey: key(), label: 'UFIConnect iOS' }) });
  assert.equal(response.status, 200);assert.match(response.headers.get('cache-control'), /private, no-store/);
  const { profile } = await response.json();
  assert.equal((await fetch(base + '/vpn/devices/' + profile.id, { method: 'DELETE', headers })).status, 404);
  const listed = await fetch(base + '/vpn/profiles', { headers });
  assert.match(listed.headers.get('cache-control'), /no-store/);
  assert.equal((await listed.json()).profiles[0].id, profile.id);
  assert.equal((await fetch(base + '/vpn/profiles/' + profile.id, { method: 'DELETE', headers })).status, 200);
});

test('gateway poll locks device rows only for owners whose payment was verified and whose account lock was taken', async t => {
  const f = await fixture(t, { gateways: [germany] }), identity = await sessionIdentity(f);
  await f.vpn.enrollProfile(ALICE, { publicKey: key(), label: 'iOS' }, identity);
  await f.enroll(BOB);
  f.control.onStatus = userId => { if (userId === BOB) throw new Error('Unverifiable'); };
  const queries = [];
  const db = { ...f.db, withClient: work => f.db.withClient(client => work({ query: (sql, args) => {
    queries.push({ sql, args });return client.query(sql, args);
  } })) };
  const vpn = createManagedVpn({ db, billing: f.billing, gateways: [germany], now: () => f.control.now });
  assert.equal((await vpn.desired(germany.id, germanyAuth)).peers.length, 1);
  const ownerLock = queries.find(query => /FROM users.*FOR UPDATE/.test(query.sql));
  const deviceLock = queries.find(query => /FOR UPDATE OF d/.test(query.sql));
  assert.deepEqual(ownerLock.args[0], [ALICE]);
  assert.match(deviceLock.sql, /d\.user_id=ANY\(\$4::uuid\[\]\)/);
  assert.deepEqual(deviceLock.args[3], ownerLock.args[0]);
  assert.ok(queries.indexOf(ownerLock) < queries.indexOf(deviceLock));
});

test('a profile recovers after a provider read stalls forever without reusing an earlier verification', async t => {
  const f = await fixture(t, { gateways: [germany], billingTimeoutMs: 10, reconcileBudgetMs: 20 });
  const identity = await sessionIdentity(f);
  const { profile } = await f.vpn.enrollProfile(ALICE, { publicKey: key(), label: 'iOS' }, identity);
  f.control.onStatus = () => new Promise(() => {});
  assert.equal((await f.vpn.desired(germany.id, germanyAuth)).peers.length, 0);
  const reads = f.control.billingReads;
  f.control.onStatus = null;
  await new Promise(resolve => setTimeout(resolve, 12));
  const recovered = await f.vpn.desired(germany.id, germanyAuth);
  assert.equal(f.control.billingReads, reads + 1);
  assert.equal(recovered.peers[0].deviceId, profile.id);
});
