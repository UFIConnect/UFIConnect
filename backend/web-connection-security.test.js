'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionCookie, readSessionCookie, isPrivateRequest, webConnectionStatus,
  hasPaidVaultSubscription, createVaultConnectionHandler } = require('./web-connection-security');

test('production session cookie is host-bound and ambiguous or legacy cookies cannot choose an account', () => {
  const env = { NODE_ENV: 'production' };
  const cookie = createSessionCookie('signed-token', 60, env);
  assert.equal(cookie, '__Host-ufi_session=signed-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
  assert.equal(readSessionCookie({ headers: { cookie: 'ufi_session=legacy; __Host-ufi_session=signed-token' } }, env), 'signed-token');
  for (const cookie of ['ufi_session=legacy', '__Host-ufi_session=a; __Host-ufi_session=b', '__Host-ufi_session=%ZZ', '__Host-ufi_session=bad%20token']) {
    assert.equal(readSessionCookie({ headers: { cookie } }, env), null);
  }
  assert.equal(readSessionCookie({ headers: { cookie: 'ufi_session=local' } }, {}), 'local');
});

test('cookie-authenticated feeds and every messaging, import and authentication response remain private', () => {
  for (const path of ['/auth/session','/messages','/messages/person/attachments/message','/connected-inbox/messages/x/1','/profile/attachments','/media/upload-signature','/security/web-connection','/security/vault-connection']) {
    assert.equal(isPrivateRequest({ path, headers: {} }), true, path);
  }
  assert.equal(isPrivateRequest({path:'/feed',headers:{cookie:'__Host-ufi_session=value'}}),true);
  assert.equal(isPrivateRequest({path:'/feed',headers:{authorization:'Bearer value'}}),true);
  assert.equal(isPrivateRequest({path:'/feed',headers:{cookie:'unrelated=value'}}),false);
});

test('web protection reports actual trusted transport and verified identity without a VPN claim', () => {
  const http = webConnectionStatus({secure:false,headers:{'x-forwarded-proto':'https'},user:{id:'member'}},0);
  assert.equal(http.transport.encrypted,false);
  assert.equal(http.transport.protocol,'http');
  assert.equal(http.session.verified,true);
  const https = webConnectionStatus({secure:true,user:{id:'member'}},0);
  assert.equal(https.transport.encrypted,true);
  assert.equal(https.scope,'uficonnect-web');
  assert.equal(https.checkedAt,'1970-01-01T00:00:00.000Z');
  assert.equal('vpnConnected' in https,false);
});

test('paid Vault monitoring uses exactly one active subscription and respects its paid-through boundary', () => {
  const now = 100000;
  const subscription = { kind: 'vpn_connector', status: 'active', currentPeriodEnd: 101 };
  const paid = { vpnConnectorAddon: true, subscriptions: [subscription] };
  assert.equal(hasPaidVaultSubscription(paid, now), true);
  assert.equal(hasPaidVaultSubscription({ ...paid, subscriptions: [{ ...subscription, cancelAtPeriodEnd: true }] }, now), true,
    'Scheduled cancellation retains access during the paid period');
  assert.equal(hasPaidVaultSubscription(paid, 101000), false);
  for (const value of [null, {}, { plan: 'pro' }, { plan: 'business' },
    { ...paid, vpnConnectorAddon: false }, { ...paid, vpnConnectorAddon: 'true' },
    { ...paid, subscriptions: [] }, { ...paid, subscriptions: [subscription, subscription] },
    ...['trialing', 'past_due', 'canceled', 'unpaid', 'paused'].map(status => ({ ...paid, subscriptions: [{ ...subscription, status }] })),
    ...[null, NaN, Infinity, 99, 100].map(currentPeriodEnd => ({ ...paid, subscriptions: [{ ...subscription, currentPeriodEnd }] })),
    { ...paid, subscriptions: [{ ...subscription, kind: 'plan' }] },
  ]) assert.equal(hasPaidVaultSubscription(value, now), false);
});

test('Vault monitoring rechecks session owner and time after asynchronous billing and sanitizes failures', async () => {
  const paid = { vpnConnectorAddon: true, subscriptions: [{ kind: 'vpn_connector', status: 'active', currentPeriodEnd: 101 }] };
  const response = () => ({ statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; this.headersSent = true; return this; } });
  for (const change of ['owner', 'expiry', 'failure', 'missing']) {
    let time = 100000, reads = 0;
    const req = { secure: true, user: change === 'missing' ? null : { id: 'alice' }, query: { userId: 'bob', vpnConnectorAddon: true } };
    const res = response();
    const handler = createVaultConnectionHandler({ now: () => time,
      readBillingStatus: async id => { assert.equal(id, 'alice'); reads++; if (change === 'failure') throw new Error('private-provider-secret'); return paid; },
      authenticate: async (request, _response, next) => { if (change === 'owner') request.user = { id: 'bob' }; if (change === 'expiry') time = 101000; return next(); },
    });
    await handler(req, res);
    assert.equal(res.statusCode, change === 'expiry' ? 403 : change === 'failure' ? 503 : 401);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.equal(JSON.stringify(res.body).includes('private-provider-secret'), false);
    assert.equal(Object.hasOwn(res.body, 'protections'), false);
    assert.equal(reads, change === 'missing' ? 0 : 1);
  }
});
