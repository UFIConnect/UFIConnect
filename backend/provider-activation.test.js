const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const targets = require('./content-platforms.json');
const env = {
  PUBLIC_API_URL: 'https://api.uficonnect.org', FRONTEND_URL: 'https://uficonnect.org',
  DISCORD_CLIENT_ID: 'discord-client', DISCORD_CLIENT_SECRET: 'discord-secret',
  FIGMA_CLIENT_ID: 'figma-client', FIGMA_CLIENT_SECRET: 'figma-secret',
  LINKEDIN_CLIENT_ID: 'linkedin-client', LINKEDIN_CLIENT_SECRET: 'linkedin-secret',
  TIKTOK_CLIENT_KEY: 'tiktok-client', TIKTOK_CLIENT_SECRET: 'tiktok-secret',
};

test('configured providers can authorize with exact callbacks and least required scopes', async t => {
  const app = await createAppHarness({ env }); t.after(() => app.close());
  app.seedUser(member('provider-owner'));
  const catalog = await app.request('/social/platforms', { userId: 'provider-owner' });
  for (const [id, host, scope] of [
    ['discord', 'discord.com', 'identify'], ['figma', 'www.figma.com', 'current_user:read'],
    ['linkedin', 'www.linkedin.com', 'openid profile email w_member_social'],
    ['tiktok', 'www.tiktok.com', 'user.info.basic,video.list,video.publish'],
  ]) {
    assert.equal(catalog.data.platforms[id].configured, true);
    assert.equal(catalog.data.platforms[id].forceComingSoon, false);
    const start = await app.request(`/auth/social/${id}/start?returnTo=command-center`, { userId: 'provider-owner' });
    assert.equal(start.status, 200);
    const url = new URL(start.data.url);
    assert.equal(url.hostname, host); assert.equal(url.searchParams.get('scope'), scope);
    assert.equal(url.searchParams.get('redirect_uri'), `${env.PUBLIC_API_URL}/auth/social/${id}/callback`);
    assert.equal(url.searchParams.has('client_secret'), false);
    assert.match(start.headers.get('set-cookie'), /HttpOnly/);
    assert.match(start.headers.get('set-cookie'), /SameSite=Lax/);
    assert.equal(app.verifyOAuthState(url.searchParams.get('state'), id).extra.returnTo, 'command-center');
    if (id === 'figma') assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  }
  assert.equal(catalog.data.platforms.discord.crossPost.supported, false);
  assert.equal(catalog.data.platforms.figma.crossPost.supported, false);
  assert.equal(catalog.data.platforms.linkedin.crossPost.supported, true);
  assert.equal(catalog.data.platforms.tiktok.crossPost.delivery, 'direct');
  assert.equal(catalog.data.platforms.tiktok.crossPost.requiresCreatorSettings, true);
  assert.equal((await app.request('/auth/social/discord/start')).status, 401);
});

test('missing credentials and business isolation still block connections', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  app.seedUser(member('unconfigured')); app.seedUser(member('recruiter', { plan: 'business' }));
  const catalog = await app.request('/social/platforms', { userId: 'unconfigured' });
  assert.equal(catalog.data.platforms.discord.configured, false);
  assert.equal((await app.request('/auth/social/discord/start', { userId: 'unconfigured' })).status, 501);
  assert.equal((await app.request('/auth/social/discord/start', { userId: 'recruiter' })).status, 403);
  assert.equal((await app.request('/command-center/cross-post', { userId: 'recruiter', method: 'POST', body: { content: 'Test', platforms: ['linkedin'] } })).status, 403);
  const businessCatalog = await app.request('/social/platforms', { userId: 'recruiter' });
  assert.equal(businessCatalog.data.platforms.discord, undefined);
});

test('profile connections validate browser, code exchange and identity before saving', async t => {
  let exchanges = 0, identityValid = true;
  const fetchJSON = async (url, headers) => {
    assert.match(url, /(?:discord\.com\/api\/v10\/users\/@me|api\.figma\.com\/v1\/me)$/);
    assert.equal(headers.Authorization, 'Bearer synthetic-access');
    return identityValid ? { id: '42' } : { error: 'invalid_token' };
  };
  const app = await createAppHarness({ env, modules: { './provider-json': { createProviderJsonClient: () => ({ fetchJSON }) } } });
  t.after(() => app.close());
  const owner = member('profile-owner'); app.seedUser(owner);
  app.setTokenExchange(async (url, form, headers) => {
    exchanges++;
    assert.ok(url.endsWith('/oauth2/token') || url.endsWith('/v1/oauth/token'));
    assert.equal(form.grant_type, 'authorization_code');
    assert.match(headers.Authorization, /^Basic /);
    if (url.includes('figma')) assert.ok(form.code_verifier?.length >= 43);
    return { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' };
  });
  for (const provider of ['discord', 'figma']) {
    const start = await app.request(`/auth/social/${provider}/start?returnTo=command-center`, { userId: owner.id });
    const state = new URL(start.data.url).searchParams.get('state');
    const url = app.base + `/auth/social/${provider}/callback?` + new URLSearchParams({ state, code: 'synthetic-code' });
    const withoutCookie = await fetch(url, { redirect: 'manual' });
    assert.match(withoutCookie.headers.get('location'), /browser_mismatch$/);
    const cookie = start.headers.get('set-cookie').split(';')[0];
    const valid = await fetch(url, { redirect: 'manual', headers: { cookie } });
    assert.equal(valid.headers.get('location'), `https://uficonnect.org/command-center?tab=accounts&social_connected=${provider}`);
    assert.equal(owner.socialTokens[provider], 'synthetic-access');
    assert.equal(owner.socialRefreshTokens[provider], 'synthetic-refresh');
  }
  assert.equal(exchanges, 2);
  const previous = owner.socialTokens.figma;
  identityValid = false;
  const start = await app.request('/auth/social/figma/start', { userId: owner.id });
  const state = new URL(start.data.url).searchParams.get('state');
  const failed = await fetch(app.base + '/auth/social/figma/callback?' + new URLSearchParams({ state, code: 'synthetic-code' }), {
    redirect: 'manual', headers: { cookie: start.headers.get('set-cookie').split(';')[0] },
  });
  assert.match(failed.headers.get('location'), /token_exchange_failed:profile_unavailable$/);
  assert.equal(owner.socialTokens.figma, previous);
});

test('LinkedIn reports a post only when the provider confirms its creation', async t => {
  const app = await createAppHarness({ env, modules: { './provider-json': { createProviderJsonClient: () => ({ fetchJSON: async () => ({ sub: 'person123' }) }) } } }); t.after(() => app.close());
  const owner = member('publisher', { plan: 'pro', socialTokens: { linkedin: 'synthetic-token' } });
  let reply = { status: 201, headers: { 'x-restli-id': 'urn:li:share:12345' }, data: {} };
  app.setPostJSONWithMeta(async (url, body, headers) => {
    assert.equal(url, 'https://api.linkedin.com/rest/posts');
    assert.equal(body.author, 'urn:li:person:person123');
    assert.equal(headers.Authorization, 'Bearer synthetic-token');
    return reply;
  });
  const result = await app.publishCrossPostTarget(owner, 'linkedin', { content: 'A useful update' });
  assert.equal(result.status, 'posted'); assert.match(result.postedUrl, /urn%3Ali%3Ashare%3A12345$/);
  for (const status of [201, 202, 403]) {
    reply = { status, headers: {}, data: {} };
    assert.equal((await app.publishCrossPostTarget(owner, 'linkedin', { content: 'Test' })).status, 'failed');
  }
  const business = { ...owner, plan: 'business' };
  assert.equal((await app.publishCrossPostTarget(business, 'linkedin', { content: 'Test' })).status, 'failed');
  reply = { status: 201, headers: { 'x-restli-id': 'urn:li:share:67890' }, data: {} };
  const businessResult = await app.publishCrossPostTarget(business, 'linkedin', { content: 'A hiring update' });
  assert.equal(businessResult.status, 'posted');
  assert.match(businessResult.postedUrl, /urn%3Ali%3Ashare%3A67890$/);
  assert.equal((await app.publishCrossPostTarget(business, 'twitter', { content: 'Test' })).status, 'unsupported');
});

test('AI Content uses all shared target labels and guidance without paid generation', async t => {
  const history = new Map();
  const module = require('./generated-content');
  const app = await createAppHarness({ env: { OPENAI_API_KEY: 'synthetic-key' }, modules: {
    './generated-content': { ...module, createGeneratedContentStore: () => ({
      create: async (_userId, entry) => { const result = { ...entry, id: String(history.size + 1) }; history.set(result.id, result); return result; },
      update: async (_userId, id, update) => ({ ...history.get(id), ...update }),
    }) },
  } }); t.after(() => app.close());
  app.seedUser(member('ai-writer', { plan: 'pro' }));
  let prompt = '';
  app.setAIText(async (_key, value) => { prompt = value; return '1. A useful first draft.\n2. A different second draft.\n3. A third idea.'; });
  assert.equal(new Set(targets.map(target => target.id)).size, targets.length);
  for (const target of targets) {
    const response = await app.request('/command-center/content-draft', { userId: 'ai-writer', method: 'POST', body: { platform: target.id, topic: 'A community garden' } });
    assert.equal(response.status, 200, target.id);
    assert.ok(prompt.includes(target.label), target.id);
    assert.ok(prompt.includes(target.guidance), target.id);
    assert.equal(response.data.drafts.length, 3);
  }
  const invalid = await app.request('/command-center/content-draft', { userId: 'ai-writer', method: 'POST', body: { platform: '__proto__', topic: 'A community garden' } });
  assert.equal(invalid.status, 200);
  assert.ok(prompt.includes('social media'));
});
