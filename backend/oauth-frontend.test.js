'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { APP_ORIGIN, createOAuthFrontend } = require('./oauth-frontend');
const { createAppHarness, member } = require('./test-support/app-harness');
const mastodon = require('./mastodon-oauth');
const frontendBase = 'https://uficonnect.org';
const baseEnv = { FRONTEND_URL: frontendBase, PUBLIC_API_URL: 'https://api.uficonnect.org',
  ALLOWED_ORIGINS: `${frontendBase},${APP_ORIGIN},https://untrusted.example`,
  YOUTUBE_CLIENT_ID: 'synthetic-client', YOUTUBE_CLIENT_SECRET: 'synthetic-secret',
  X_CLIENT_ID: 'synthetic-x-client', X_CLIENT_SECRET: 'synthetic-x-secret' };

test('OAuth frontend selection requires the exact app Origin and its explicit allowlist entry', () => {
  const policy = createOAuthFrontend({ frontendBase, allowedOrigins: baseEnv.ALLOWED_ORIGINS });
  assert.deepEqual(policy.capture({ headers: { origin: APP_ORIGIN } }), { returnOrigin: APP_ORIGIN });
  for (const origin of [undefined, 'null', frontendBase, 'https://untrusted.example', `${APP_ORIGIN}/`, `${APP_ORIGIN}:443`,
    `${APP_ORIGIN}.untrusted.example`, 'https://user@app.uficonnect.org', 'http://app.uficonnect.org', [APP_ORIGIN]]) {
    assert.deepEqual(policy.capture({ headers: { origin, referer: APP_ORIGIN, 'x-forwarded-host': 'app.uficonnect.org' },
      query: { returnOrigin: APP_ORIGIN } }), {});
  }
  for (const origin of [undefined, '//untrusted.example', 'https://untrusted.example', `${APP_ORIGIN}/`]) assert.equal(policy.resolve(origin), frontendBase);
  assert.equal(policy.resolve(APP_ORIGIN), APP_ORIGIN);
  for (const allowedOrigins of [undefined, '*', frontendBase, true]) {
    const disabled = createOAuthFrontend({ frontendBase, allowedOrigins });
    assert.deepEqual(disabled.capture({ headers: { origin: APP_ORIGIN } }), {});
    assert.equal(disabled.resolve(APP_ORIGIN), frontendBase);
  }
});

test('connected provider callbacks use sealed start Origin, preserve main returns and reject callback overrides', async t => {
  const app = await createAppHarness({ env: baseEnv }); t.after(() => app.close());
  app.seedUser(member('app-youtube'));
  app.setFollowingFetcher('youtube', async () => []);
  app.setTokenExchange(async (_url, form) => {
    assert.equal(form.redirect_uri, 'https://api.uficonnect.org/auth/social/youtube/callback');
    return { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' };
  });
  for (const origin of [APP_ORIGIN, frontendBase, 'https://untrusted.example', undefined]) {
    const start = await app.request('/auth/social/youtube/start?returnOrigin=https://untrusted.example', {
      userId: 'app-youtube', headers: origin ? { origin } : {},
    });
    assert.equal(start.status, 200);
    const url = new URL(start.data.url), state = url.searchParams.get('state');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://api.uficonnect.org/auth/social/youtube/callback');
    assert.equal(app.verifyOAuthState(state, 'youtube').extra.returnOrigin, origin === APP_ORIGIN ? APP_ORIGIN : undefined);
    const result = await fetch(app.base + '/auth/social/youtube/callback?' + new URLSearchParams({ state, code: 'code', returnOrigin: 'https://untrusted.example' }), {
      redirect: 'manual', headers: { origin: 'https://untrusted.example', cookie: start.headers.get('set-cookie').split(';')[0] },
    });
    assert.equal(result.headers.get('location'), `${origin === APP_ORIGIN ? APP_ORIGIN : frontendBase}/connected-accounts?social_connected=youtube`);
  }
  const invalid = await fetch(app.base + '/auth/social/youtube/callback?state=invalid&returnOrigin=' + encodeURIComponent(APP_ORIGIN),
    { redirect: 'manual', headers: { origin: APP_ORIGIN } });
  assert.equal(new URL(invalid.headers.get('location')).origin, frontendBase);
  const foreignState = app.createOAuthState('app-youtube', 'youtube', null, { returnOrigin: 'https://untrusted.example' });
  const foreign = await fetch(app.base + '/auth/social/youtube/callback?state=' + encodeURIComponent(foreignState), { redirect: 'manual' });
  assert.equal(new URL(foreign.headers.get('location')).origin, frontendBase);
});

test('app X state fits the provider limit with UUID account IDs and Command Center returns', async t => {
  const app = await createAppHarness({ env: baseEnv }); t.after(() => app.close());
  const uuidState = app.createOAuthState('c73f2819-fada-43eb-aafc-7511c0ed07fe', 'twitter', crypto.randomBytes(32).toString('base64url'), {
    browserHash: crypto.createHash('sha256').update('browser').digest('base64url'), returnOrigin: APP_ORIGIN, returnTo: 'command-center' });
  assert.ok(uuidState.length <= 500, `App X UUID state has ${uuidState.length} characters`);
  assert.equal(app.verifyOAuthState(uuidState, 'twitter').extra.returnOrigin, APP_ORIGIN);
  const userId = 'app-x'; app.seedUser(member(userId));
  const start = await app.request('/auth/social/twitter/start?returnTo=command-center', { userId, headers: { origin: APP_ORIGIN } });
  assert.equal(start.status, 200);
  const state = new URL(start.data.url).searchParams.get('state');
  assert.ok(state.length <= 500, `App X state has ${state.length} characters`);
  assert.equal(app.verifyOAuthState(state, 'twitter').extra.returnOrigin, APP_ORIGIN);
  const result = await fetch(app.base + '/auth/social/twitter/callback?' + new URLSearchParams({ state, error: 'access_denied' }), {
    redirect: 'manual', headers: { cookie: start.headers.get('set-cookie').split(';')[0] },
  });
  assert.equal(result.headers.get('location'), APP_ORIGIN + '/command-center?tab=accounts&social_error=twitter&reason=access_denied');
});

test('Mastodon captures the trusted app Origin separately from its provider instance', async t => {
  const service = { application: async () => ({ client_id: 'id', client_secret: 'secret' }),
    json: async (_origin, route, options) => {
      if (route === '/oauth/token') { assert.equal(options.form.redirect_uri, 'https://api.uficonnect.org/auth/social/mastodon/callback'); return { access_token: 'access' }; }
      return { id: '42' };
    } };
  const app = await createAppHarness({ env: baseEnv, modules: { './mastodon-oauth': { ...mastodon, createMastodonService: () => service } } });
  t.after(() => app.close()); app.seedUser(member('app-mastodon'));
  const start = await app.request('/auth/social/mastodon/start?server=mastodon.social&returnTo=command-center', { userId: 'app-mastodon', headers: { origin: APP_ORIGIN } });
  const state = new URL(start.data.url).searchParams.get('state'), entry = app.verifyOAuthState(state, 'mastodon');
  assert.equal(entry.extra.origin, 'https://mastodon.social'); assert.equal(entry.extra.returnOrigin, APP_ORIGIN);
  const result = await fetch(app.base + '/auth/social/mastodon/callback?' + new URLSearchParams({ state, code: 'code', returnOrigin: 'https://untrusted.example' }), {
    redirect: 'manual', headers: { cookie: start.headers.get('set-cookie').split(';')[0] },
  });
  assert.equal(result.headers.get('location'), APP_ORIGIN + '/command-center?tab=accounts&social_connected=mastodon');
});

test('Bluesky stores app Origin during authorization and revalidates it from signed callback state', async t => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const app = await createAppHarness({ env: { ...baseEnv, BLUESKY_SIGNING_KEY: JSON.stringify(privateKey.export({ format: 'jwk' })) } });
  t.after(() => app.close()); app.seedUser(member('app-bluesky'));
  app.setBlueskyAuthServerResolver(async () => ({ did: 'did:plc:app', pdsUrl: 'https://pds.example', authServerMeta: {
    issuer: 'https://auth.example', token_endpoint: 'https://auth.example/token', pushed_authorization_request_endpoint: 'https://auth.example/par', authorization_endpoint: 'https://auth.example/authorize' } }));
  let state;
  app.setAtprotoTokenExchange(async (url, params) => {
    assert.equal(params.redirect_uri, 'https://api.uficonnect.org/auth/social/bluesky/callback');
    if (url.endsWith('/par')) { state = params.state; return { status: 201, data: { request_uri: 'urn:app-oauth' } }; }
    return { status: 200, data: { access_token: 'access', refresh_token: 'refresh', sub: 'did:plc:app' } };
  });
  const start = await app.request('/auth/social/bluesky/start?handle=app.example&returnTo=command-center', { userId: 'app-bluesky', headers: { origin: APP_ORIGIN } });
  assert.equal(start.status, 200); assert.equal(app.verifyOAuthState(state, 'bluesky').extra.returnOrigin, APP_ORIGIN);
  const result = await fetch(app.base + '/auth/social/bluesky/callback?' + new URLSearchParams({ state, code: 'code', iss: 'https://auth.example', returnOrigin: 'https://untrusted.example' }), { redirect: 'manual' });
  assert.equal(result.headers.get('location'), APP_ORIGIN + '/command-center?tab=accounts&social_connected=bluesky');
});
