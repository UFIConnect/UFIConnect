'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

test('web protection verifies the current session and cookie-authenticated responses cannot be cached', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  app.seedUser(member('web-security-member'));
  const token = app.token('web-security-member');
  assert.equal((await app.request('/security/web-connection')).status,401);
  const result = await app.request('/security/web-connection',{headers:{cookie:'ufi_session='+token,'x-forwarded-proto':'https'}});
  assert.equal(result.status,200);
  assert.equal(result.data.session.verified,true);
  assert.equal(result.data.transport.encrypted,false,'An untrusted forwarding header cannot prove HTTPS');
  assert.equal(result.data.scope,'uficonnect-web');
  assert.match(result.headers.get('cache-control'),/no-store/);
  assert.match(result.headers.get('vary'),/Cookie/);
  assert.match(result.headers.get('vary'),/Authorization/);
  const invalid = await app.request('/security/web-connection',{headers:{cookie:'ufi_session='+token+'; ufi_session=other'}});
  assert.equal(invalid.status,401);
});

test('Vault connection monitoring requires current paid billing without trusting caller flags or other plans', async t => {
  const reads = [];
  let status = { vpnConnectorAddon: false, subscriptions: [] }, failed = false;
  const app = await createAppHarness({ modules: { './billing': {
    ...require('./billing'), createBilling: () => ({ status: async userId => {
      reads.push(userId);
      if (failed) throw new Error('private Stripe customer and credential');
      return userId === 'vault-monitor-member' ? status : { vpnConnectorAddon: false, subscriptions: [] };
    } }),
  } } });
  t.after(() => app.close());
  app.seedUser(member('vault-monitor-member', { plan: 'business', vpnConnectorAddon: true }));
  app.seedUser(member('other-monitor-member'));
  const path = '/security/vault-connection?vpnConnectorAddon=true&plan=business&userId=other-monitor-member';
  assert.equal((await app.request(path)).status, 401);
  assert.deepEqual(reads, []);
  assert.equal((await app.request('/security/web-connection', { userId: 'vault-monitor-member' })).status, 200,
    'Baseline security diagnostics remain available without a Vault subscription');
  assert.deepEqual(reads, []);
  const subscription = { kind: 'vpn_connector', status: 'active', currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600 };
  const paid = { vpnConnectorAddon: true, subscriptions: [subscription] };
  for (const value of [
    status, { plan: 'pro', vpnConnectorAddon: true, subscriptions: [] }, { plan: 'business', vpnConnectorAddon: true, subscriptions: [] },
    ...['trialing', 'past_due', 'canceled'].map(state => ({ ...paid, subscriptions: [{ ...subscription, status: state }] })),
    { ...paid, subscriptions: [{ ...subscription, currentPeriodEnd: Math.floor(Date.now() / 1000) }] },
    { ...paid, subscriptions: [subscription, subscription] },
  ]) {
    status = value;
    const result = await app.request(path, { userId: 'vault-monitor-member' });
    assert.equal(result.status, 403);
    assert.equal(Object.hasOwn(result.data, 'protections'), false);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  }
  status = paid;
  const token = app.token('vault-monitor-member');
  const granted = await app.request(path, { headers: { cookie: 'ufi_session=' + token, 'x-forwarded-proto': 'https' } });
  assert.equal(granted.status, 200);
  assert.equal(granted.data.scope, 'uficonnect-web');
  assert.equal(granted.data.session.verified, true);
  assert.equal(granted.data.transport.encrypted, false, 'Untrusted forwarding headers never prove HTTPS');
  assert.equal('vpnConnected' in granted.data, false);
  assert.equal(JSON.stringify(granted.data).includes('vault-monitor-member'), false);
  assert.equal(JSON.stringify(granted.data).includes('subscriptions'), false);
  assert.match(granted.headers.get('vary'), /Cookie/);
  assert.match(granted.headers.get('vary'), /Authorization/);
  status = { vpnConnectorAddon: false, subscriptions: [] };
  assert.equal((await app.request(path, { userId: 'vault-monitor-member' })).status, 403,
    'A previous paid success cannot authorize a later request');
  assert.ok(reads.every(id => id === 'vault-monitor-member'), 'Only the verified session owner reaches billing');
  status = paid;
  assert.equal((await app.request('/security/vault-connection?userId=vault-monitor-member', { userId: 'other-monitor-member' })).status, 403);
  assert.equal(reads.at(-1), 'other-monitor-member');
  failed = true;
  const unavailable = await app.request(path, { userId: 'vault-monitor-member' });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.data.message, 'Vault connection monitoring is temporarily unavailable. Please try again.');
  assert.equal(unavailable.headers.get('cache-control'), 'private, no-store');
});

test('a session revoked during Vault billing verification cannot receive a monitoring success', async t => {
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const app = await createAppHarness({ modules: { './billing': {
    ...require('./billing'), createBilling: () => ({ status: async userId => {
      assert.equal(userId, 'vault-revocation-member');
      started();
      return held;
    } }),
  } } });
  t.after(() => app.close());
  app.seedUser(member('vault-revocation-member'));
  const resultPromise = app.request('/security/vault-connection', { userId: 'vault-revocation-member' });
  await entered;
  app.localSessions.clear();
  release({ vpnConnectorAddon: true, subscriptions: [{ kind: 'vpn_connector', status: 'active', currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600 }] });
  const result = await resultPromise;
  assert.equal(result.status, 401);
  assert.equal(Object.hasOwn(result.data, 'protections'), false);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
});

test('malformed and oversized JSON cannot reflect private submitted text', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const secret = 'private submitted credential';
  for (const [body,status,message] of [
    ['{"password":"'+secret+'",',400,'Invalid JSON request.'],
    [JSON.stringify({password:secret,content:'x'.repeat(600_000)}),413,'This request is too large.'],
  ]) {
    const response = await fetch(app.base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body});
    assert.equal(response.status,status);
    const text = await response.text();
    assert.equal(JSON.parse(text).message,message);
    assert.equal(text.includes(secret),false);
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
});
