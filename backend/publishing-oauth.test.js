'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publishingOAuthConfig, publishingScope, discordPublishingToken } = require('./publishing-oauth');
const { createAppHarness, member } = require('./test-support/app-harness');

const scopes = value => new Set(String(value || '').split(/[\s,]+/).filter(Boolean));
const PROVIDERS = {
  pinterest: { authUrl: 'https://www.pinterest.com/oauth/', tokenUrl: 'https://api.pinterest.com/v5/oauth/token', write: 'pins:write', base: ['user_accounts:read', 'boards:read', 'pins:read'] },
  tumblr: { authUrl: 'https://www.tumblr.com/oauth2/authorize', tokenUrl: 'https://api.tumblr.com/v2/oauth2/token', write: 'write', base: ['basic', 'offline_access'] },
  wordpress: { authUrl: 'https://public-api.wordpress.com/oauth2/authorize', tokenUrl: 'https://public-api.wordpress.com/oauth2/token', write: 'posts', base: ['users', 'sites'] },
};
test('new provider configs use official OAuth2 endpoints and keep write grants contextual', () => {
  const env = { PINTEREST_CLIENT_ID: 'pin-client', PINTEREST_CLIENT_SECRET: 'pin-secret', TUMBLR_CLIENT_ID: 'tumblr-client', TUMBLR_CLIENT_SECRET: 'tumblr-secret', WORDPRESS_CLIENT_ID: 'wp-client', WORDPRESS_CLIENT_SECRET: 'wp-secret' };
  const configs = publishingOAuthConfig(env);
  for (const [provider, expected] of Object.entries(PROVIDERS)) {
    const config = configs[provider];
    assert.equal(config.authUrl, expected.authUrl);
    assert.equal(config.tokenUrl, expected.tokenUrl);
    assert.deepEqual(scopes(config.scope), new Set(expected.base));
    assert.ok(!scopes(config.scope).has(expected.write));
    const publishing = scopes(publishingScope(provider, config.scope));
    assert.ok(publishing.has(expected.write));
    for (const scope of expected.base) assert.ok(publishing.has(scope));
  }
  assert.equal(configs.pinterest.basicAuth, true);
  assert.equal(configs.pinterest.clientSecret(), 'pin-secret');
  assert.equal(configs.tumblr.clientId(), 'tumblr-client');
  assert.equal(configs.wordpress.clientId(), 'wp-client');
  env.WORDPRESS_CLIENT_ID = 'rotated-client';
  assert.equal(configs.wordpress.clientId(), 'rotated-client');
});

test('publishing scope unions preserve existing permissions, normalize separators and never duplicate grants', () => {
  const cases = {
    discord: ['identify email', ['identify', 'email', 'webhook.incoming']],
    figma: ['current_user:read', ['current_user:read', 'file_comments:read', 'file_comments:write']],
    youtube: ['https://www.googleapis.com/auth/youtube.force-ssl', ['https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload']],
    gitlab: ['read_user', ['read_user', 'api']],
    twitch: ['user:read:follows', ['user:read:follows', 'user:write:chat']],
    medium: ['basicProfile', ['basicProfile', 'publishPost']],
    dribbble: ['public', ['public', 'upload']],
    pinterest: ['boards:read,pins:read pins:write', ['boards:read', 'pins:read', 'pins:write']],
  };
  for (const [provider, [current, expected]] of Object.entries(cases)) {
    const value = publishingScope(provider, current);
    assert.deepEqual(scopes(value), new Set(expected));
    assert.equal(value.split(/[\s,]+/).length, expected.length);
    assert.equal(publishingScope(provider, value), value);
  }
  assert.equal(publishingScope('unknown', 'read'), 'read');
  assert.equal(publishingScope('toString', 'read'), 'read');
  assert.equal(publishingScope('wordpress', undefined), 'posts media');
  assert.ok(!publishingScope('discord', null).includes('null'));
  assert.equal(publishingScope('medium', 'basicProfile'), 'basicProfile,publishPost');
});

const WEBHOOK = { id: '123456789', channel_id: '234567891', guild_id: '345678912', token: 'valid-webhook-token-123' };
test('Discord publishing wraps only the authorized webhook fields for encrypted token storage', () => {
  const raw = { webhook: { ...WEBHOOK, url: 'https://evil.example/do-not-use', secret: 'not-for-client' }, extra_secret: 'discard' };
  assert.equal(discordPublishingToken('member-token', raw, false), 'member-token');
  const stored = JSON.parse(discordPublishingToken('member-token', raw, true));
  assert.deepEqual(stored, { accessToken: 'member-token', webhook: WEBHOOK });
  assert.ok(!JSON.stringify(stored).includes('evil.example'));
  assert.ok(!JSON.stringify(stored).includes('extra_secret'));
});

test('Discord denies missing or malformed webhook grants without returning partial credentials', () => {
  const invalid = [null, {}, { ...WEBHOOK, id: 'https://evil.example' }, { ...WEBHOOK, channel_id: '' }, { ...WEBHOOK, guild_id: '' },
    { ...WEBHOOK, token: ['valid-webhook-token-123'] }, { ...WEBHOOK, token: 'short' }, { ...WEBHOOK, token: 'secret\r\nInjected: value' }];
  for (const webhook of invalid) assert.throws(() => discordPublishingToken('member-token', { webhook }, true), /did not authorize a publishing channel/);
  for (const token of ['', null, { access_token: 'bad-object' }, 'bad\nheader']) assert.throws(() => discordPublishingToken(token, { webhook: WEBHOOK }, true));
});

test('real OAuth start routes request publishing grants only for publishing=1 and sign the intent into state', async () => {
  const app = await createAppHarness({ env: {
    API_BASE_URL: 'https://api.uficonnect.org', PUBLIC_API_URL: 'https://api.uficonnect.org', OAUTH_CALLBACK_BASE_URL: 'https://api.uficonnect.org',
    PINTEREST_CLIENT_ID: 'pin-client', PINTEREST_CLIENT_SECRET: 'pin-secret', PINTEREST_STANDARD_ACCESS_APPROVED: 'true',
    TUMBLR_CLIENT_ID: 'tumblr-client', TUMBLR_CLIENT_SECRET: 'tumblr-secret', WORDPRESS_CLIENT_ID: 'wp-client', WORDPRESS_CLIENT_SECRET: 'wp-secret',
    DISCORD_CLIENT_ID: 'discord-client', DISCORD_CLIENT_SECRET: 'discord-secret',
  } });
  const owner = member('publishing-oauth-owner', { plan: 'pro' });
  app.seedUser(owner);
  try {
    for (const [provider, expected] of Object.entries({ ...PROVIDERS, discord: { write: 'webhook.incoming' } })) {
      for (const mode of ['', '?publishing=0', '?publishing=true', '?publishing=1']) {
        const result = await app.request(`/auth/social/${provider}/start${mode}`, { userId: owner.id });
        assert.equal(result.status, 200, `${provider}${mode}: ${JSON.stringify(result.data)}`);
        const url = new URL(result.data.url), elevated = mode === '?publishing=1';
        assert.equal(scopes(url.searchParams.get('scope')).has(expected.write), elevated);
        assert.equal(url.searchParams.get('redirect_uri'), `https://api.uficonnect.org/auth/social/${provider}/callback`);
        const state = app.verifyOAuthState(url.searchParams.get('state'), provider);
        assert.equal(state.extra.publishing, elevated);
        assert.equal(state.userId, owner.id);
        assert.ok(state.extra.browserHash);
      }
    }
  } finally { await app.close(); }
});

test('Discord callbacks bind webhook storage to signed publishing intent and reject malformed grants atomically', async () => {
  const app = await createAppHarness({ env: {
    PUBLIC_API_URL: 'https://api.uficonnect.org', FRONTEND_URL: 'https://uficonnect.org',
    DISCORD_CLIENT_ID: 'discord-client', DISCORD_CLIENT_SECRET: 'discord-secret',
  }, modules: { './provider-json': { createProviderJsonClient: () => ({ fetchJSON: async url => {
    assert.equal(url, 'https://discord.com/api/v10/users/@me');
    return { id: '123456789' };
  } }) } } });
  const owner = member('discord-publishing-owner', { socialTokens: { discord: 'original-access' } });
  const outsider = member('discord-unrelated-member', { socialTokens: { discord: 'outsider-access' } });
  app.seedUser(owner); app.seedUser(outsider);
  let tokenReply = { access_token: 'new-member-access', refresh_token: 'new-member-refresh', webhook: WEBHOOK };
  app.setTokenExchange(async (url, form) => {
    assert.equal(url, 'https://discord.com/api/oauth2/token');
    assert.equal(form.redirect_uri, 'https://api.uficonnect.org/auth/social/discord/callback');
    return tokenReply;
  });
  async function finish(publishing, extraQuery = '') {
    const start = await app.request(`/auth/social/discord/start?returnTo=command-center${publishing ? '&publishing=1' : ''}`, { userId: owner.id });
    assert.equal(start.status, 200);
    const state = new URL(start.data.url).searchParams.get('state');
    return fetch(`${app.base}/auth/social/discord/callback?${new URLSearchParams({ state, code: 'provider-code' })}${extraQuery}`, {
      redirect: 'manual', headers: { cookie: start.headers.get('set-cookie').split(';')[0], authorization: `Bearer ${app.token(outsider.id)}` },
    });
  }
  try {
    const profileOnly = await finish(false, '&publishing=1');
    assert.equal(profileOnly.status, 302);
    assert.equal(owner.socialTokens.discord, 'new-member-access');
    assert.equal(outsider.socialTokens.discord, 'outsider-access');
    const publishing = await finish(true);
    assert.equal(publishing.status, 302);
    assert.deepEqual(JSON.parse(owner.socialTokens.discord), { accessToken: 'new-member-access', webhook: WEBHOOK });
    assert.equal(owner.socialRefreshTokens.discord, 'new-member-refresh');
    const saved = owner.socialTokens.discord;
    tokenReply = { access_token: 'unusable-member-access', refresh_token: 'unusable-member-refresh', webhook: { ...WEBHOOK, token: '' } };
    const rejected = await finish(true);
    assert.equal(rejected.status, 302);
    assert.ok(new URL(rejected.headers.get('location')).searchParams.get('reason').startsWith('token_exchange_failed'));
    assert.equal(owner.socialTokens.discord, saved);
    assert.equal(owner.socialRefreshTokens.discord, 'new-member-refresh');
    const catalog = await app.request('/social/platforms', { userId: owner.id });
    assert.ok(!JSON.stringify(catalog.data).includes('new-member-access'));
    assert.ok(!JSON.stringify(catalog.data).includes(WEBHOOK.token));
    for (const result of [profileOnly, publishing, rejected]) {
      assert.ok(!result.headers.get('location').includes('member-access'));
      assert.ok(!result.headers.get('location').includes(WEBHOOK.token));
    }
  } finally { await app.close(); }
});
