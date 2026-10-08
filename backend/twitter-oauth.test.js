const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { createAppHarness, member } = require('./test-support/app-harness');
const { createTokenVault } = require('./token-vault');

const callbackUrl = 'https://api.uficonnect.org/auth/social/twitter/callback';
const tokenUrl = 'https://api.x.com/2/oauth2/token';
const baseEnv = { PUBLIC_API_URL: 'https://api.uficonnect.org', FRONTEND_URL: 'https://uficonnect.org' };
const xEnv = { ...baseEnv, X_CLIENT_ID: 'synthetic-x-client', X_CLIENT_SECRET: 'synthetic-x-secret' };
const encryptionKey = Buffer.alloc(32, 1).toString('base64');
const challenge = value => crypto.createHash('sha256').update(value).digest('base64url');

async function callback(app, state, cookie, params = { code: 'synthetic-code' }) {
  return fetch(app.base + '/auth/social/twitter/callback?' + new URLSearchParams({ state, ...params }), {
    redirect: 'manual', headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(5000),
  });
}

test('X OAuth accepts saved client aliases and preserves canonical credential precedence', async t => {
  for (const [credentials, expectedClient, expectedSecret] of [
    [{ X_CLIENT_ID: 'x-id', X_CLIENT_SECRET: 'x-secret' }, 'x-id', 'x-secret'],
    [{ X_CLIENT_KEY: 'x-key', X_CLIENT_SECRET: 'x-secret' }, 'x-key', 'x-secret'],
    [{ X_CLIENT_ID: 'x-id', X_CLIENT_KEY: 'x-key', X_CLIENT_SECRET: 'x-secret' }, 'x-id', 'x-secret'],
    [{ TWITTER_CLIENT_ID: 'twitter-id', TWITTER_CLIENT_SECRET: 'twitter-secret', X_CLIENT_ID: 'x-id', X_CLIENT_KEY: 'x-key', X_CLIENT_SECRET: 'x-secret' }, 'twitter-id', 'twitter-secret'],
    [{ TWITTER_CLIENT_ID: '  ', TWITTER_CLIENT_SECRET: ' ', X_CLIENT_ID: '\t', X_CLIENT_KEY: 'x-key', X_CLIENT_SECRET: 'x-secret' }, 'x-key', 'x-secret'],
  ]) {
    await t.test(expectedClient + ' with ' + Object.keys(credentials).join(', '), async t => {
      const app = await createAppHarness({ env: { ...baseEnv, ...credentials } });
      t.after(() => app.close()); app.seedUser(member('x-alias-owner'));
      const catalog = await app.request('/social/platforms', { userId: 'x-alias-owner' });
      assert.equal(catalog.data.platforms.twitter.configured, true);
      assert.equal(catalog.data.platforms.twitter.forceComingSoon, false);
      const configured = await app.request('/auth/social/config', { userId: 'x-alias-owner' });
      assert.equal(configured.data.platforms.twitter.configured, true);
      assert.deepEqual(configured.data.platforms.twitter.missingEnv, []);
      assert.equal(configured.data.platforms.twitter.callbackUrl, callbackUrl);
      assert.equal(configured.data.platforms.twitter.authUrl, 'https://x.com/i/oauth2/authorize');
      const started = await app.request('/auth/social/twitter/start', { userId: 'x-alias-owner' });
      assert.equal(started.status, 200);
      const url = new URL(started.data.url);
      assert.equal(url.searchParams.get('client_id'), expectedClient);
      assert.equal(url.searchParams.has('client_secret'), false);
      assert.equal(JSON.stringify({ catalog: catalog.data, config: configured.data, start: started.data }).includes(expectedSecret), false);
      let exchanged = false;
      app.setFollowingFetcher('twitter', async () => []);
      app.setTokenExchange(async (url, _form, headers) => {
        exchanged = true; assert.equal(url, tokenUrl);
        assert.equal(headers.Authorization, 'Basic ' + Buffer.from(`${expectedClient}:${expectedSecret}`).toString('base64'));
        return { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' };
      });
      const result = await callback(app, url.searchParams.get('state'), started.headers.get('set-cookie').split(';')[0]);
      assert.match(result.headers.get('location'), /social_connected=twitter$/);
      assert.equal(exchanged, true);
      assert.deepEqual(app.errors, []);
    });
  }
});

test('X stays unavailable without OAuth credentials and does not use API keys or bearer tokens as client credentials', async t => {
  for (const credentials of [
    {},
    { X_CLIENT_ID: 'x-id' },
    { X_CLIENT_SECRET: 'x-secret' },
    { X_API_KEY: 'api-key', X_API_SECRET: 'api-secret', X_BEARER_TOKEN: 'bearer-token' },
    { TWITTER_API_KEY: 'api-key', TWITTER_API_SECRET: 'api-secret', TWITTER_BEARER_TOKEN: 'bearer-token' },
  ]) {
    const app = await createAppHarness({ env: { ...baseEnv, ...credentials } });
    t.after(() => app.close()); app.seedUser(member('unconfigured-x'));
    const catalog = await app.request('/social/platforms', { userId: 'unconfigured-x' });
    assert.equal(catalog.data.platforms.twitter.configured, false);
    const started = await app.request('/auth/social/twitter/start', { userId: 'unconfigured-x' });
    assert.equal(started.status, 501);
    assert.equal(started.data.callbackUrl, callbackUrl);
    assert.ok(started.data.missingEnv.length);
    assert.equal(started.headers.has('set-cookie'), false);
  }
});

test('X authorization uses the public callback, S256 PKCE and a secure browser cookie', async t => {
  const app = await createAppHarness({ env: { ...xEnv, API_BASE_URL: 'https://uficonnect-api-708r.onrender.com' } });
  t.after(() => app.close()); app.seedUser(member('x-start-owner'));
  assert.equal((await app.request('/auth/social/twitter/start')).status, 401);
  for (const interactions of ['', '?interactions=1']) {
    const started = await app.request('/auth/social/twitter/start' + interactions, {
      userId: 'x-start-owner', headers: { 'x-forwarded-host': 'untrusted.example' },
    });
    assert.equal(started.status, 200);
    assert.equal(started.headers.get('cache-control'), 'no-store');
    const url = new URL(started.data.url);
    assert.equal(url.origin + url.pathname, 'https://x.com/i/oauth2/authorize');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('redirect_uri'), callbackUrl);
    assert.equal(url.searchParams.get('scope'), 'tweet.read tweet.write users.read offline.access' + (interactions ? ' like.write' : ''));
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const state = url.searchParams.get('state');
    assert.ok(state.length <= 500, `X state has ${state.length} characters`);
    const decoded = app.verifyOAuthState(state, 'twitter');
    assert.equal(decoded.userId, 'x-start-owner');
    assert.equal(url.searchParams.get('code_challenge'), challenge(decoded.codeVerifier));
    assert.equal(state.includes(decoded.codeVerifier), false);
    const cookie = started.headers.get('set-cookie');
    assert.match(cookie, /^ufi_oauth_twitter=/);
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/auth\/social\/twitter/); assert.match(cookie, /Max-Age=600/);
    assert.equal(decoded.extra.browserHash, challenge(cookie.split(';')[0].slice('ufi_oauth_twitter='.length)));
  }
});

test('X state fits UUID accounts and Command Center returns, survives restart, and rejects invalid envelopes', async t => {
  const app = await createAppHarness({ env: xEnv });
  const restarted = await createAppHarness({ env: xEnv });
  const differentKey = await createAppHarness({ env: { ...xEnv, OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64') } });
  t.after(() => Promise.all([app.close(), restarted.close(), differentKey.close()]));
  const userId = '00000000-0000-4000-8000-000000000001';
  const verifier = crypto.randomBytes(32).toString('base64url');
  for (const returnTo of [undefined, 'command-center']) {
    const extra = { browserHash: challenge('synthetic-browser'), ...(returnTo ? { returnTo } : {}) };
    const state = app.createOAuthState(userId, 'twitter', verifier, extra);
    assert.ok(state.length <= 500, `UUID X state${returnTo ? ' with Command Center return' : ''} has ${state.length} characters`);
    const decoded = restarted.verifyOAuthState(state, 'twitter');
    assert.equal(decoded.userId, userId); assert.equal(decoded.codeVerifier, verifier);
    assert.equal(decoded.extra.browserHash, extra.browserHash); assert.equal(decoded.extra.returnTo, returnTo);
    assert.equal(differentKey.verifyOAuthState(state, 'twitter'), null);
    assert.equal(restarted.verifyOAuthState(state, 'linkedin'), null);
    assert.equal(restarted.verifyOAuthState(state, 'github'), null);
    const position = Math.floor(state.length / 2);
    assert.equal(restarted.verifyOAuthState(state.slice(0, position) + (state[position] === 'A' ? 'B' : 'A') + state.slice(position + 1), 'twitter'), null);
    assert.equal(state.includes(verifier), false);
  }
  const vault = createTokenVault({ OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey });
  const payload = { userId, platform: 'twitter', cv: verifier, expiresAt: Date.now() + 600000 };
  for (const overrides of [
    { expiresAt: Date.now() - 1 }, { expiresAt: null }, { expiresAt: '2099-01-01' },
    { expiresAt: 1.5 }, { platform: 'github' }, { userId: null },
  ]) {
    const invalid = 'x1.' + vault.seal(JSON.stringify({ ...payload, ...overrides }), 'twitter-oauth-state');
    assert.equal(restarted.verifyOAuthState(invalid, 'twitter'), null);
  }
  assert.equal(restarted.verifyOAuthState('x1.' + 'a'.repeat(501), 'twitter'), null);
  assert.equal(restarted.verifyOAuthState('x1.invalid', 'twitter'), null);
  assert.equal(restarted.verifyOAuthState(undefined, 'twitter'), null);
  // An in-progress redirect issued before activation remains usable after deployment.
  const legacy = jwt.sign({ purpose: 'oauth-state', data: vault.seal(JSON.stringify({ userId, platform: 'twitter', cv: verifier }), 'oauth-state') }, 'route-test-only', {
    algorithm: 'HS256', issuer: 'uficonnect', audience: 'uficonnect-oauth', expiresIn: '10m',
  });
  assert.equal(restarted.verifyOAuthState(legacy, 'twitter').codeVerifier, verifier);
  assert.equal(restarted.verifyOAuthState(legacy, 'linkedin'), null);
});

test('X callback enforces browser binding and uses the encrypted PKCE verifier before saving tokens', async t => {
  const app = await createAppHarness({ env: xEnv });
  t.after(() => app.close()); const owner = member('x-callback-owner'); app.seedUser(owner);
  app.setFollowingFetcher('twitter', async () => []);
  let exchanges = 0, expectedVerifier;
  app.setTokenExchange(async (url, form, headers) => {
    exchanges++; assert.equal(url, tokenUrl);
    assert.equal(form.grant_type, 'authorization_code'); assert.equal(form.code, 'synthetic-code');
    assert.equal(form.redirect_uri, callbackUrl); assert.equal(form.code_verifier, expectedVerifier);
    assert.equal(form.client_secret, undefined);
    assert.equal(headers.Authorization, 'Basic ' + Buffer.from('synthetic-x-client:synthetic-x-secret').toString('base64'));
    return { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' };
  });
  const started = await app.request('/auth/social/twitter/start?returnTo=command-center', { userId: owner.id });
  assert.equal(started.status, 200);
  const state = new URL(started.data.url).searchParams.get('state');
  expectedVerifier = app.verifyOAuthState(state, 'twitter').codeVerifier;
  const cookie = started.headers.get('set-cookie').split(';')[0];
  for (const invalidCookie of [undefined, 'ufi_oauth_twitter=wrong-browser']) {
    const denied = await callback(app, state, invalidCookie);
    assert.match(denied.headers.get('location'), /reason=browser_mismatch$/);
    assert.equal(exchanges, 0); assert.equal(owner.socialTokens.twitter, undefined);
  }
  const missingCode = await callback(app, state, cookie, {});
  assert.match(missingCode.headers.get('location'), /reason=invalid_callback$/);
  const providerDenied = await callback(app, state, cookie, { error: 'access_denied' });
  assert.match(providerDenied.headers.get('location'), /reason=access_denied$/);
  assert.equal(exchanges, 0);
  const invalidState = await callback(app, 'invalid-state', cookie);
  assert.match(invalidState.headers.get('location'), /reason=invalid_state$/);
  assert.equal(exchanges, 0);
  const successful = await callback(app, state, cookie);
  assert.equal(successful.status, 302);
  assert.equal(successful.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(successful.headers.get('location'), 'https://uficonnect.org/command-center?tab=accounts&social_connected=twitter');
  assert.match(successful.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal(exchanges, 1); assert.equal(owner.socialTokens.twitter, 'synthetic-access');
  assert.equal(owner.socialRefreshTokens.twitter, 'synthetic-refresh');
  assert.deepEqual(app.errors, []);
});

test('X refresh uses saved OAuth aliases with Basic authentication and persists rotated tokens', async t => {
  const app = await createAppHarness({ env: xEnv });
  t.after(() => app.close());
  const owner = member('x-refresh-owner', { socialTokens: { twitter: 'synthetic-old-access' }, socialRefreshTokens: { twitter: 'synthetic-old-refresh' } });
  app.seedUser(owner); let exchanges = 0;
  app.setTokenExchange(async (url, form, headers) => {
    exchanges++; assert.equal(url, tokenUrl);
    assert.equal(form.grant_type, 'refresh_token'); assert.equal(form.refresh_token, 'synthetic-old-refresh');
    assert.equal(form.client_secret, undefined);
    assert.equal(headers.Authorization, 'Basic ' + Buffer.from('synthetic-x-client:synthetic-x-secret').toString('base64'));
    return { access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh' };
  });
  const results = await Promise.all([
    app.refreshConnectedAccessToken(owner.id, 'twitter', 'synthetic-old-access'),
    app.refreshConnectedAccessToken(owner.id, 'twitter', 'synthetic-old-access'),
  ]);
  assert.deepEqual(results, ['synthetic-new-access', 'synthetic-new-access']); assert.equal(exchanges, 1);
  assert.equal(owner.socialTokens.twitter, 'synthetic-new-access'); assert.equal(owner.socialRefreshTokens.twitter, 'synthetic-new-refresh');
});

test('X remains a personal social account and refuses callbacks after a switch to Business', async t => {
  const app = await createAppHarness({ env: xEnv });
  t.after(() => app.close()); const owner = member('x-plan-owner'); app.seedUser(owner);
  const started = await app.request('/auth/social/twitter/start', { userId: owner.id });
  assert.equal(started.status, 200);
  const state = new URL(started.data.url).searchParams.get('state');
  owner.plan = 'business';
  const catalog = await app.request('/social/platforms', { userId: owner.id });
  assert.equal(catalog.data.platforms.twitter, undefined);
  const rejectedStart = await app.request('/auth/social/twitter/start', { userId: owner.id });
  assert.equal(rejectedStart.status, 403); assert.equal(rejectedStart.data.code, 'business_career_only');
  app.setTokenExchange(async () => { assert.fail('Business X callback must not exchange a token'); });
  const rejectedCallback = await callback(app, state, started.headers.get('set-cookie').split(';')[0]);
  assert.match(rejectedCallback.headers.get('location'), /reason=account_unavailable$/);
  assert.equal(owner.socialTokens.twitter, undefined);
});
