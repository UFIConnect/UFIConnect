const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAppHarness, member } = require('./test-support/app-harness');
const mastodon = require('./mastodon-oauth');

test('Mastodon returns to Command Center only through the authorized state', async t => {
  const service = {
    application: async () => ({ client_id: 'synthetic-id', client_secret: 'synthetic-secret' }),
    json: async (_origin, path) => path === '/oauth/token' ? { access_token: 'synthetic-access' } : { id: '42' },
  };
  const app = await createAppHarness({ env: { FRONTEND_URL: 'https://uficonnect.org', PUBLIC_API_URL: 'https://api.uficonnect.org' },
    modules: { './mastodon-oauth': { ...mastodon, createMastodonService: () => service } },
  });
  t.after(() => app.close()); app.seedUser(member('return-member'));
  for (const target of ['command-center', 'https://untrusted.example', '']) {
    const start = await app.request(`/auth/social/mastodon/start?server=mastodon.social&returnTo=${encodeURIComponent(target)}`, { userId: 'return-member' });
    assert.equal(start.status, 200);
    const state = new URL(start.data.url).searchParams.get('state');
    const decoded = app.verifyOAuthState(state, 'mastodon');
    assert.equal(decoded.extra.returnTo, target === 'command-center' ? target : undefined);
    const response = await fetch(app.base + '/auth/social/mastodon/callback?' + new URLSearchParams({ state, code: 'synthetic-code', returnTo: 'https://untrusted.example' }), {
      redirect: 'manual', headers: { cookie: start.headers.get('set-cookie').split(';')[0] },
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), target === 'command-center'
      ? 'https://uficonnect.org/command-center?tab=accounts&social_connected=mastodon'
      : 'https://uficonnect.org/connected-accounts?social_connected=mastodon');
  }
});

test('Bluesky preserves a signed Command Center return and rejects untrusted return paths', async t => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const app = await createAppHarness({ env: { FRONTEND_URL: 'https://uficonnect.org', PUBLIC_API_URL: 'https://api.uficonnect.org',
    BLUESKY_SIGNING_KEY: JSON.stringify(privateKey.export({ format: 'jwk' })),
  } });
  t.after(() => app.close()); app.seedUser(member('bluesky-return'));
  let exchanges = 0;
  app.setAtprotoTokenExchange(async (url, params) => {
    exchanges++; assert.equal(url, 'https://auth.example/token'); assert.equal(params.code_verifier, 'synthetic-verifier');
    return { status: 200, data: { access_token: 'synthetic-access', sub: 'did:plc:member', refresh_token: 'synthetic-refresh' } };
  });
  for (const returnTo of ['command-center', 'https://untrusted.example']) {
    const state = app.createOAuthState('bluesky-return', 'bluesky', 'synthetic-verifier', {
      returnTo, tokenEndpoint: 'https://auth.example/token', issuer: 'https://auth.example', did: 'did:plc:member', pdsUrl: 'https://pds.example',
    });
    const response = await fetch(app.base + '/auth/social/bluesky/callback?' + new URLSearchParams({ state, code: 'synthetic-code', iss: 'https://auth.example' }), { redirect: 'manual' });
    assert.equal(response.headers.get('location'), returnTo === 'command-center'
      ? 'https://uficonnect.org/command-center?tab=accounts&social_connected=bluesky'
      : 'https://uficonnect.org/connected-accounts?social_connected=bluesky');
  }
  const invalid = await fetch(app.base + '/auth/social/bluesky/callback?state=invalid&returnTo=command-center', { redirect: 'manual' });
  assert.equal(invalid.headers.get('location'), 'https://uficonnect.org/connected-accounts?social_error=bluesky&reason=invalid_state');
  assert.equal(exchanges, 2);
});
