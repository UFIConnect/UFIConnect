const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

const env = {
  API_BASE_URL: 'https://uficonnect-api-708r.onrender.com',
  PUBLIC_API_URL: 'https://api.uficonnect.org',
  FRONTEND_URL: 'https://uficonnect.org',
  LINKEDIN_CLIENT_ID: 'synthetic-linkedin-client',
  LINKEDIN_CLIENT_SECRET: 'synthetic-linkedin-secret',
};
const callbackUrl = `${env.PUBLIC_API_URL}/auth/social/linkedin/callback`;
const scope = 'openid profile email w_member_social';

async function startFlow(app, userId, returnTo = 'command-center') {
  const result = await app.request(`/auth/social/linkedin/start?returnTo=${returnTo}`, { userId });
  assert.equal(result.status, 200);
  const authorization = new URL(result.data.url);
  return {
    authorization,
    cookie: result.headers.get('set-cookie').split(';')[0],
    state: authorization.searchParams.get('state'),
  };
}

async function callback(app, { state, cookie }, params = {}, headers = {}) {
  const result = await fetch(`${app.base}/auth/social/linkedin/callback?${new URLSearchParams({ state, ...params })}`, {
    redirect: 'manual',
    headers: { ...(cookie ? { cookie } : {}), ...headers },
    signal: AbortSignal.timeout(5000),
  });
  return { status: result.status, location: result.headers.get('location') };
}

function identityModule(readProfile = () => ({ sub: 'synthetic-member', name: 'LinkedIn Member' })) {
  return { './provider-json': { createProviderJsonClient: () => ({
    fetchJSON: async (url, headers) => {
      assert.equal(url, 'https://api.linkedin.com/v2/userinfo');
      assert.match(headers.Authorization, /^Bearer synthetic-/);
      return readProfile();
    },
  }) } };
}

test('configured LinkedIn authorizes personal and Business accounts with current products and the public callback', async t => {
  const app = await createAppHarness({ env });
  t.after(() => app.close());
  for (const plan of ['free', 'business']) {
    const owner = member(`linkedin-${plan}`, { plan });
    app.seedUser(owner);
    const catalog = await app.request('/social/platforms', { userId: owner.id });
    const linkedin = catalog.data.platforms.linkedin;
    assert.equal(linkedin.configured, true);
    assert.equal(linkedin.forceComingSoon, false);
    assert.equal(linkedin.locked, false);
    assert.equal(linkedin.crossPost.supported, true);
    assert.equal(linkedin.crossPost.media, 'native-image');
    assert.equal(linkedin.ownContent.supported, false);
    assert.equal(linkedin.feed.home, false);
    assert.equal(linkedin.feed.following, null);

    const config = await app.request('/auth/social/config', { userId: owner.id });
    assert.equal(config.data.platforms.linkedin.callbackUrl, callbackUrl);
    assert.equal(config.data.platforms.linkedin.scope, scope);
    assert.equal(config.data.platforms.linkedin.forceComingSoon, false);
    assert.equal(JSON.stringify(config.data).includes(env.LINKEDIN_CLIENT_SECRET), false);

    const result = await app.request('/auth/social/linkedin/start?returnTo=command-center', {
      userId: owner.id,
      headers: { 'x-forwarded-host': 'untrusted.example', 'x-forwarded-proto': 'http' },
    });
    assert.equal(result.status, 200);
    const authorization = new URL(result.data.url);
    assert.equal(authorization.origin, 'https://www.linkedin.com');
    assert.equal(authorization.pathname, '/oauth/v2/authorization');
    assert.equal(authorization.searchParams.get('client_id'), env.LINKEDIN_CLIENT_ID);
    assert.equal(authorization.searchParams.get('redirect_uri'), callbackUrl);
    assert.equal(authorization.searchParams.get('scope'), scope);
    assert.equal(authorization.searchParams.get('response_type'), 'code');
    assert.equal(authorization.searchParams.has('client_secret'), false);
    const state = app.verifyOAuthState(authorization.searchParams.get('state'), 'linkedin');
    assert.equal(state.userId, owner.id);
    assert.equal(state.extra.returnTo, 'command-center');
    assert.ok(state.extra.browserHash);
    const cookie = result.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/auth\/social\/linkedin/);
  }
  assert.equal((await app.request('/auth/social/linkedin/start')).status, 401);
  assert.deepEqual(app.errors, []);
});

test('LinkedIn keeps missing and partial credential pairs unavailable without starting a provider exchange', async t => {
  for (const credentials of [
    { LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: ' ' },
    { LINKEDIN_CLIENT_ID: 'synthetic-linkedin-client', LINKEDIN_CLIENT_SECRET: '' },
  ]) {
    const app = await createAppHarness({ env: { ...env, ...credentials } });
    t.after(() => app.close());
    app.seedUser(member('linkedin-unconfigured'));
    app.setTokenExchange(() => { assert.fail('Unconfigured LinkedIn must not exchange tokens'); });
    const catalog = await app.request('/social/platforms', { userId: 'linkedin-unconfigured' });
    assert.equal(catalog.data.platforms.linkedin.configured, false);
    assert.equal(catalog.data.platforms.linkedin.forceComingSoon, false);
    const start = await app.request('/auth/social/linkedin/start', { userId: 'linkedin-unconfigured' });
    assert.equal(start.status, 501);
    assert.deepEqual(start.data.requiredEnv, ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']);
    assert.ok(start.data.missingEnv.includes('LINKEDIN_CLIENT_SECRET'));
    assert.equal(start.data.callbackUrl, callbackUrl);
    assert.equal(start.headers.get('set-cookie'), null);
  }
});

test('LinkedIn callbacks reject invalid states, browser mismatches, declined consent and absent codes before exchanging tokens', async t => {
  const app = await createAppHarness({ env });
  t.after(() => app.close());
  const owner = member('linkedin-protected', { socialTokens: { linkedin: 'synthetic-existing-access' } });
  app.seedUser(owner);
  app.setTokenExchange(() => { assert.fail('Rejected callbacks must not exchange tokens'); });
  const flow = await startFlow(app, owner.id);
  for (const [input, params, reason] of [
    [{ ...flow, state: 'invalid-state' }, { code: 'synthetic-code' }, 'invalid_state'],
    [{ ...flow, state: app.createOAuthState(owner.id, 'github') }, { code: 'synthetic-code' }, 'invalid_state'],
    [{ ...flow, cookie: undefined }, { code: 'synthetic-code' }, 'browser_mismatch'],
    [{ ...flow, cookie: 'ufi_oauth_linkedin=unrelated-browser' }, { code: 'synthetic-code' }, 'browser_mismatch'],
    [flow, { error: 'access_denied' }, 'access_denied'],
    [flow, {}, 'invalid_callback'],
  ]) {
    const result = await callback(app, input, params);
    assert.equal(result.status, 302);
    const destination = new URL(result.location);
    assert.equal(destination.origin, env.FRONTEND_URL);
    assert.equal(destination.searchParams.get('social_error'), 'linkedin');
    assert.equal(destination.searchParams.get('reason'), reason);
    assert.equal(owner.socialTokens.linkedin, 'synthetic-existing-access');
  }
  assert.deepEqual(app.errors, []);
});

test('LinkedIn code exchange binds the public callback and saves only the state owner connection for personal and Business accounts', async t => {
  let identityChecks = 0;
  const app = await createAppHarness({ env, modules: identityModule(() => {
    identityChecks++;
    return { sub: 'synthetic-member', name: 'LinkedIn Member' };
  }) });
  t.after(() => app.close());
  const outsider = member('linkedin-unrelated', { socialTokens: { linkedin: 'synthetic-outsider-access' } });
  app.seedUser(outsider);
  let exchanges = 0;
  app.setTokenExchange(async (url, form) => {
    exchanges++;
    assert.equal(url, 'https://www.linkedin.com/oauth/v2/accessToken');
    assert.equal(form.grant_type, 'authorization_code');
    assert.equal(form.code, 'synthetic-code');
    assert.equal(form.redirect_uri, callbackUrl);
    assert.equal(form.client_id, env.LINKEDIN_CLIENT_ID);
    assert.equal(form.client_secret, env.LINKEDIN_CLIENT_SECRET);
    return { access_token: `synthetic-access-${exchanges}`, refresh_token: `synthetic-refresh-${exchanges}` };
  });
  for (const plan of ['free', 'business']) {
    const owner = member(`linkedin-callback-${plan}`, { plan });
    app.seedUser(owner);
    const flow = await startFlow(app, owner.id);
    const result = await callback(app, flow, { code: 'synthetic-code' }, { authorization: `Bearer ${app.token(outsider.id)}` });
    assert.equal(result.status, 302);
    assert.equal(result.location, `${env.FRONTEND_URL}/command-center?tab=accounts&social_connected=linkedin`);
    assert.equal(owner.socialTokens.linkedin, `synthetic-access-${exchanges}`);
    assert.equal(owner.socialRefreshTokens.linkedin, `synthetic-refresh-${exchanges}`);
    assert.ok(owner.socialConnectedAt.linkedin);
    assert.equal(outsider.socialTokens.linkedin, 'synthetic-outsider-access');
    const catalog = await app.request('/social/platforms', { userId: owner.id });
    assert.equal(catalog.data.connected.linkedin, true);
    assert.equal(JSON.stringify(catalog.data).includes('synthetic-access'), false);
    assert.equal(JSON.stringify(catalog.data).includes('synthetic-refresh'), false);
  }
  assert.equal(exchanges, 2);
  assert.equal(identityChecks, 2);
  assert.deepEqual(app.errors, []);
});

test('LinkedIn requires a verified member identity before replacing an existing connection', async t => {
  let profile;
  const app = await createAppHarness({ env, modules: identityModule(() => profile) });
  t.after(() => app.close());
  const owner = member('linkedin-identity', {
    socialTokens: { linkedin: 'synthetic-existing-access' },
    socialRefreshTokens: { linkedin: 'synthetic-existing-refresh' },
    socialConnectedAt: { linkedin: '2026-01-01T00:00:00.000Z' },
  });
  app.seedUser(owner);
  app.setTokenExchange(async () => ({ access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh' }));
  for (profile of [{}, { sub: '' }, { sub: ' ' }, { sub: 123 }, { sub: 'synthetic-member', error: 'invalid_token' }]) {
    const flow = await startFlow(app, owner.id);
    const result = await callback(app, flow, { code: 'synthetic-code' });
    const destination = new URL(result.location);
    assert.equal(result.status, 302);
    assert.equal(destination.searchParams.get('social_error'), 'linkedin');
    assert.equal(destination.searchParams.get('reason'), 'token_exchange_failed:profile_unavailable');
    assert.equal(owner.socialTokens.linkedin, 'synthetic-existing-access');
    assert.equal(owner.socialRefreshTokens.linkedin, 'synthetic-existing-refresh');
    assert.equal(owner.socialConnectedAt.linkedin, '2026-01-01T00:00:00.000Z');
    assert.equal(result.location.includes('synthetic-'), false);
  }
});

test('a rejected LinkedIn exchange preserves the existing connection and returns a provider error code', async t => {
  const app = await createAppHarness({ env, modules: identityModule() });
  t.after(() => app.close());
  const owner = member('linkedin-reconnect', {
    socialTokens: { linkedin: 'synthetic-existing-access' },
    socialRefreshTokens: { linkedin: 'synthetic-existing-refresh' },
  });
  app.seedUser(owner);
  app.setTokenExchange(async () => ({ error: 'invalid_grant' }));
  const result = await callback(app, await startFlow(app, owner.id), { code: 'synthetic-expired-code' });
  assert.equal(result.status, 302);
  const destination = new URL(result.location);
  assert.equal(destination.searchParams.get('social_error'), 'linkedin');
  assert.equal(destination.searchParams.get('reason'), 'token_exchange_failed:invalid_grant');
  assert.equal(owner.socialTokens.linkedin, 'synthetic-existing-access');
  assert.equal(owner.socialRefreshTokens.linkedin, 'synthetic-existing-refresh');
  assert.equal(result.location.includes('synthetic-'), false);
});
