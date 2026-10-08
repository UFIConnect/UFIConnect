const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createProviderSignIn, parseProviderCallback, validAuthorizationUrl } = require('./providerSignIn');
const code = 'C'.repeat(43), verifier = 'V'.repeat(64), callback = `uficonnect://auth/callback#code=${code}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  let value = null, time = 1000;
  const requests = [], opened = [], accepted = [], discarded = [], states = [];
  const store = { read: async () => value, write: async item => { value = item; }, clear: async () => { value = null; } };
  const flow = createProviderSignIn({ apiBase: 'https://api.example.test', store, now: () => time,
    post: async (path, body) => { requests.push({ path, body }); return path.endsWith('/start') ? { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic', verifier } : { token: 'synthetic-session', profile: { id: 'synthetic' } }; },
    openURL: async url => opened.push(url), acceptSession: async session => accepted.push(session), discardSession: async session => discarded.push(session), ...overrides });
  flow.subscribe(state => states.push(state));
  return { flow, requests, opened, accepted, discarded, states, store, value: () => value, advance: amount => { time += amount; } };
}

test('provider callback accepts only the exact scheme, host, path, and single opaque fragment', () => {
  assert.deepEqual(parseProviderCallback(callback), { code });
  assert.deepEqual(parseProviderCallback('uficonnect://auth/callback#error=cancelled'), { error: 'cancelled' });
  for (const input of [null, '', callback.replace('uficonnect:', 'https:'), callback.replace('/callback', '/other'), callback.replace('#code=', '?code='), callback + '&token=private', callback + '&code=' + code, callback.replace('C', '%43'), ' ' + callback, callback.replace('auth/', 'auth.evil/')]) assert.equal(parseProviderCallback(input), null);
  assert.equal(validAuthorizationUrl('https://accounts.google.com/o/oauth2/v2/auth', 'google', 'https://api.example.test'), true);
  assert.equal(validAuthorizationUrl('https://appleid.apple.com/auth/authorize', 'apple', 'https://api.example.test'), true);
  for (const input of ['javascript:alert(1)', 'https://accounts.google.com.evil/auth', 'https://accounts.google.com@evil.test/auth', 'http://accounts.google.com/auth']) assert.equal(validAuthorizationUrl(input, 'google', 'https://api.example.test'), false);
});

test('native OAuth keeps the verifier in secure storage and exchanges a callback exactly once', async () => {
  const f = fixture();
  await f.flow.start('google', 'signup');
  assert.deepEqual(f.requests[0], { path: '/auth/providers/google/start', body: { client: 'native', mode: 'signup' } });
  assert.equal(f.value().verifier, verifier);
  assert.equal(f.opened.length, 1); assert.equal(f.opened[0].includes(verifier), false);
  await Promise.all([f.flow.open(callback), f.flow.open(callback)]);
  assert.deepEqual(f.requests[1], { path: '/auth/providers/finish', body: { code, verifier } });
  assert.equal(f.accepted.length, 1); assert.equal(f.value(), null);
  assert.equal(JSON.stringify(f.states).includes(verifier), false);
  assert.equal(f.states.at(-1).busy, false);
});

test('cold return can recover only a recent pending verifier; unsolicited or expired links cannot sign in', async () => {
  const cold = fixture(); await cold.store.write({ provider: 'apple', verifier, createdAt: 1000 });
  await cold.flow.restore(); assert.equal(cold.states.at(-1).phase, 'browser');
  await cold.flow.open(callback); assert.equal(cold.accepted.length, 1);
  for (const expired of [false, true]) {
    const f = fixture(); if (expired) { await f.flow.start('google', 'login'); f.advance(600001); }
    await f.flow.open(callback); assert.equal(f.accepted.length, 0);
    assert.equal(f.requests.some(item => item.path.endsWith('/finish')), false);
    assert.equal(f.value(), null);
  }
});

test('cancelled, rejected, and secure-storage failures never retain a verifier or accept a session', async () => {
  const cancelled = fixture(); await cancelled.flow.start('google', 'login'); await cancelled.flow.cancel(); await cancelled.flow.open(callback);
  assert.equal(cancelled.accepted.length, 0); assert.equal(cancelled.value(), null);
  const denied = fixture(); await denied.flow.start('google', 'login'); await denied.flow.open('uficonnect://auth/callback#error=account_exists');
  assert.equal(denied.accepted.length, 0); assert.equal(denied.value(), null);
  const blocked = fixture({ store: { read: async () => null, write: async () => { throw new Error('OS store unavailable'); }, clear: async () => {} } });
  await blocked.flow.start('google', 'login'); assert.equal(blocked.opened.length, 0); assert.equal(blocked.states.at(-1).busy, false);
});

test('cancelling an in-flight exchange discards its late session instead of signing in', async () => {
  let finish;
  const f = fixture({ post: async path => path.endsWith('/start') ? { authorizationUrl: 'https://accounts.google.com/auth', verifier } : new Promise(resolve => { finish = resolve; }) });
  await f.flow.start('google', 'login'); const operation = f.flow.open(callback); await tick();
  await f.flow.cancel(); finish({ token: 'late-session', profile: { id: 'late' } }); await operation;
  assert.equal(f.accepted.length, 0); assert.equal(f.discarded.length, 1); assert.equal(f.value(), null);
});

test('existing authenticated accounts cannot be replaced by unsolicited provider callbacks', async () => {
  const f = fixture({ canAccept: () => false });
  await f.flow.start('google', 'login'); await f.flow.open(callback);
  assert.equal(f.requests.length, 0); assert.equal(f.accepted.length, 0);
});
