'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const { createTokenVault } = require('./token-vault');

const WEBHOOK = { id: '123456789', channel_id: '234567891', guild_id: '345678912', token: 'authorized-webhook-secret' };
const ENV = {
  PINTEREST_CLIENT_ID: 'pin-client', PINTEREST_CLIENT_SECRET: 'pin-secret', PINTEREST_STANDARD_ACCESS_APPROVED: 'true',
  TUMBLR_CLIENT_ID: 'tumblr-client', TUMBLR_CLIENT_SECRET: 'tumblr-secret', FIGMA_CLIENT_ID: 'figma-client', FIGMA_CLIENT_SECRET: 'figma-secret',
  DISCORD_CLIENT_ID: 'discord-client', DISCORD_CLIENT_SECRET: 'discord-secret', TIKTOK_CLIENT_KEY: 'tiktok-client', TIKTOK_CLIENT_SECRET: 'tiktok-secret',
};
const ENDPOINTS = {
  pinterest: 'https://api.pinterest.com/v5/oauth/token', tumblr: 'https://api.tumblr.com/v2/oauth2/token',
  figma: 'https://api.figma.com/v1/oauth/token', discord: 'https://discord.com/api/oauth2/token',
};
function reply(data, status = 200) { return { data, status, headers: {} }; }
function transport(request) {
  return { './publishing-http': { createPublishingHttp: () => ({ request, downloadMedia: async () => { throw Error('No media downloads in this test'); } }) } };
}
function providerResult(provider, url) {
  if (provider === 'tumblr') return reply({ response: { user: { blogs: [{ name: 'my-blog', title: 'My blog', type: 'public' }] } } });
  if (provider === 'pinterest') return reply({ items: [{ id: '1', name: 'My board', privacy: 'PUBLIC' }] });
  if (provider === 'figma') return reply(url.endsWith('/me') ? { id: 'figma-user' } : { comments: [] });
  if (provider === 'discord') return reply(url.includes('/users/@me') ? { id: '456789123' } : { ...WEBHOOK, application_id: ENV.DISCORD_CLIENT_ID, type: 1, name: 'My channel' });
  throw Error('Unexpected provider');
}
function unwrap(value, provider) { return provider === 'discord' ? JSON.parse(value).accessToken : value; }
function assertPrivate(value) {
  const raw = JSON.stringify(value);
  for (const secret of ['old-access', 'fresh-access', 'member-refresh', 'rotated-refresh', WEBHOOK.token]) assert.ok(!raw.includes(secret), `Response leaked ${secret}`);
}

test('expired publishing destination reads safely refresh new OAuth sources for the current member only', async t => {
  for (const provider of ['tumblr', 'pinterest', 'figma', 'discord']) {
    await t.test(provider, async t => {
      const calls = [];
      const app = await createAppHarness({ env: ENV, modules: transport(async (url, options = {}) => {
        calls.push({ url, ...options });
        assert.ok(!options.method || options.method === 'GET', 'destination lookup must never publish');
        if (options.headers?.Authorization === 'Bearer old-access') return reply({ error: 'expired' }, 401);
        if (options.headers?.Authorization) assert.equal(options.headers.Authorization, 'Bearer fresh-access');
        return providerResult(provider, url);
      }) });
      t.after(() => app.close());
      const old = provider === 'discord' ? JSON.stringify({ accessToken: 'old-access', webhook: WEBHOOK }) : 'old-access';
      const owner = member(`refresh-owner-${provider}`, { plan: 'pro', socialTokens: { [provider]: old }, socialRefreshTokens: { [provider]: 'member-refresh' } });
      const other = member(`refresh-other-${provider}`, { plan: 'pro', socialTokens: { [provider]: 'other-member-access' }, socialRefreshTokens: { [provider]: 'other-member-refresh' } });
      app.seedUser(owner); app.seedUser(other);
      let exchanges = 0;
      app.setTokenExchange(async (url, form, headers) => {
        exchanges++;
        assert.equal(url, ENDPOINTS[provider]);
        assert.equal(form.grant_type, 'refresh_token');
        assert.equal(form.refresh_token, 'member-refresh');
        if (['pinterest', 'figma', 'discord'].includes(provider)) {
          const client = provider === 'pinterest' ? 'pin' : provider;
          assert.equal(headers.Authorization, `Basic ${Buffer.from(`${client}-client:${client}-secret`).toString('base64')}`);
          assert.equal(form.client_secret, undefined);
        } else {
          assert.equal(form.client_id, ENV[`${provider.toUpperCase()}_CLIENT_ID`]);
          assert.equal(form.client_secret, ENV[`${provider.toUpperCase()}_CLIENT_SECRET`]);
        }
        return { access_token: 'fresh-access', refresh_token: 'rotated-refresh' };
      });
      const response = await app.request(`/command-center/cross-post/${provider}/destinations${provider === 'figma' ? '?destinationId=FigmaFile123' : ''}`, { userId: owner.id });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.ok(response.data.destinations.length);
      assert.equal(exchanges, 1);
      assert.equal(unwrap(owner.socialTokens[provider], provider), 'fresh-access');
      if (provider === 'discord') assert.deepEqual(JSON.parse(owner.socialTokens.discord).webhook, WEBHOOK);
      assert.equal(owner.socialRefreshTokens[provider], 'rotated-refresh');
      assert.equal(other.socialTokens[provider], 'other-member-access');
      assert.equal(other.socialRefreshTokens[provider], 'other-member-refresh');
      assert.equal(calls.filter(call => call.headers?.Authorization === 'Bearer old-access').length, 1);
      assertPrivate(response.data);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    });
  }
});

test('a rejected refresh or a source revoked after renewal cannot retry the read with a stale connection or write content', async t => {
  for (const outcome of ['invalid_grant', 'revoked']) {
    await t.test(outcome, async t => {
      let reads = 0, writes = 0, owner;
      const modules = transport(async (_url, options = {}) => {
        if (options.method === 'POST') writes++; else reads++;
        return reply({ error: 'expired' }, 401);
      });
      if (outcome === 'revoked') modules['./filestore'] = {
        loadUsers: () => [], saveUsersNow() {}, saveUsers() {
          // Simulate disconnect immediately after persistence, before the
          // destination route's authoritative connection/version recheck.
          if (owner?.socialTokens?.tumblr === 'fresh-access') delete owner.socialTokens.tumblr;
        },
      };
      const app = await createAppHarness({ env: ENV, modules });
      t.after(() => app.close());
      owner = member(`refresh-${outcome}`, { plan: 'pro', socialTokens: { tumblr: 'old-access' }, socialRefreshTokens: { tumblr: 'member-refresh' } });
      app.seedUser(owner);
      let exchanges = 0;
      app.setTokenExchange(async () => {
        exchanges++;
        return outcome === 'invalid_grant' ? { error: 'invalid_grant' } : { access_token: 'fresh-access', refresh_token: 'rotated-refresh' };
      });
      const response = await app.request('/command-center/cross-post/tumblr/destinations', { userId: owner.id });
      assert.equal(response.status, 409, JSON.stringify(response.data));
      assert.equal(response.data.reconnectRequired, true);
      assert.equal(exchanges, 1);
      assert.equal(reads, 1, 'do not retry with a grant that was rejected or disconnected');
      assert.equal(writes, 0);
      assert.equal(owner.socialTokens.tumblr, outcome === 'invalid_grant' ? 'old-access' : undefined);
      assertPrivate(response.data);
    });
  }
});

test('a publishing POST rejected by the provider is sent once and never renewed or automatically retried', async t => {
  let writes = 0, exchanges = 0;
  const app = await createAppHarness({ env: ENV, modules: transport(async (url, options = {}) => {
    if (options.method === 'POST') { writes++; return reply({ error: 'expired after profile check' }, 401); }
    return providerResult('tumblr', url);
  }) });
  t.after(() => app.close());
  const owner = member('publish-no-retry', { plan: 'pro', socialTokens: { tumblr: 'old-access' }, socialRefreshTokens: { tumblr: 'member-refresh' } });
  app.seedUser(owner);
  app.setTokenExchange(async () => { exchanges++; return { access_token: 'fresh-access' }; });
  const result = await app.publishCrossPostTarget(owner, 'tumblr', { content: 'Publish this update.', settings: { destinationId: 'my-blog' }, crossPostId: 'one-attempt' });
  assert.equal(result.status, 'failed');
  assert.equal(writes, 1);
  assert.equal(exchanges, 0);
  assert.equal(owner.socialTokens.tumblr, 'old-access');
  assertPrivate(result);
});

test('Discord token rotation preserves its authorized webhook inside encrypted database credentials', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec('CREATE TABLE users(id uuid PRIMARY KEY,social_tokens jsonb,social_refresh_tokens jsonb,social_connected_at jsonb)');
  const env = { ...ENV, OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') }, vault = createTokenVault(env);
  const id = '11111111-1111-4111-8111-111111111111';
  const old = JSON.stringify({ accessToken: 'old-access', webhook: WEBHOOK });
  await pg.query('INSERT INTO users VALUES($1,$2,$3,$4)', [id,
    JSON.stringify(vault.encryptMap({ discord: old, tumblr: 'another-source-access' }, id, 'access')),
    JSON.stringify(vault.encryptMap({ discord: 'member-refresh', tumblr: 'another-source-refresh' }, id, 'refresh')), '{}']);
  const app = await createAppHarness({ env, connected: true, query: (sql, params) => pg.query(sql, params) });
  t.after(() => app.close());
  app.seedUser(member(id, { plan: 'pro', socialTokens: { discord: old }, socialRefreshTokens: { discord: 'member-refresh' } }));
  app.setTokenExchange(async () => ({ access_token: 'fresh-access', refresh_token: 'rotated-refresh' }));
  const rotated = await app.refreshConnectedAccessToken(id, 'discord', old);
  assert.deepEqual(JSON.parse(rotated), { accessToken: 'fresh-access', webhook: WEBHOOK });
  const { rows: [row] } = await pg.query('SELECT * FROM users WHERE id=$1', [id]);
  assert.match(row.social_tokens.discord, /^enc:v1:/);
  assert.match(row.social_refresh_tokens.discord, /^enc:v1:/);
  assertPrivate({ access: row.social_tokens, refresh: row.social_refresh_tokens });
  const access = vault.decryptMap(row.social_tokens, id, 'access'), refresh = vault.decryptMap(row.social_refresh_tokens, id, 'refresh');
  assert.deepEqual(JSON.parse(access.discord), { accessToken: 'fresh-access', webhook: WEBHOOK });
  assert.equal(refresh.discord, 'rotated-refresh');
  assert.equal(access.tumblr, 'another-source-access');
  assert.equal(refresh.tumblr, 'another-source-refresh');
  assert.ok(app.queries.some(query => query.sql.includes('FOR UPDATE')));
});

test('TikTok refresh uses client_key and accepts its nested token response without discarding the grant', async t => {
  const app = await createAppHarness({ env: ENV });
  t.after(() => app.close());
  const owner = member('tiktok-refresh-owner', { socialTokens: { tiktok: 'old-access' }, socialRefreshTokens: { tiktok: 'member-refresh' } });
  app.seedUser(owner);
  app.setTokenExchange(async (url, form) => {
    assert.equal(url, 'https://open.tiktokapis.com/v2/oauth/token/');
    assert.equal(form.client_key, 'tiktok-client');
    assert.equal(form.client_id, undefined);
    assert.equal(form.client_secret, 'tiktok-secret');
    return { data: { access_token: 'fresh-access', refresh_token: 'rotated-refresh' } };
  });
  assert.equal(await app.refreshConnectedAccessToken(owner.id, 'tiktok', 'old-access'), 'fresh-access');
  assert.equal(owner.socialRefreshTokens.tiktok, 'rotated-refresh');
});
