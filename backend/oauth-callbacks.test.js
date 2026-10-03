const test = require('node:test');
const assert = require('node:assert/strict');
require('./generated-media');
const { createAppHarness, member } = require('./test-support/app-harness');

test('configured providers send the public callback, independent of Render transport or forwarded hosts', async () => {
  const providers = { github: 'github.com', youtube: 'accounts.google.com', dribbble: 'dribbble.com', twitch: 'id.twitch.tv' };
  const env = {
    API_BASE_URL: 'https://uficonnect-api-708r.onrender.com',
    PUBLIC_API_URL: 'https://api.uficonnect.org',
    FRONTEND_URL: 'https://uficonnect.org',
    ...Object.fromEntries(Object.keys(providers).flatMap(key => [
      [`${key.toUpperCase()}_CLIENT_ID`, 'test-client-id'],
      [`${key.toUpperCase()}_CLIENT_SECRET`, 'test-client-secret'],
    ])),
  };
  const app = await createAppHarness({ connected: true, env });
  app.seedUser(member('oauth-callbacks'));
  try {
    for (const [provider, host] of Object.entries(providers)) {
      const result = await app.request(`/auth/social/${provider}/start`, {
        userId: 'oauth-callbacks', headers: { 'x-forwarded-host': 'untrusted.example' },
      });
      assert.equal(result.status, 200);
      const authorization = new URL(result.data.url);
      assert.equal(authorization.hostname, host);
      assert.equal(authorization.searchParams.get('redirect_uri'), `https://api.uficonnect.org/auth/social/${provider}/callback`);
      assert.equal(authorization.searchParams.get('client_id'), 'test-client-id');
      assert.ok(authorization.searchParams.get('state'));
      assert.equal(authorization.searchParams.has('client_secret'), false);
      if (provider === 'youtube') {
        assert.equal(authorization.searchParams.get('access_type'), 'offline');
        assert.equal(authorization.searchParams.get('prompt'), 'consent');
        assert.equal(authorization.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.readonly');
        assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      }
    }
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('legacy YouTube connections request re-consent without exposing stored credentials', async () => {
  const app = await createAppHarness();
  const user = member('youtube-renewal', { socialTokens: { youtube: 'synthetic-access' } });
  app.seedUser(user);
  try {
    let result = await app.request('/social/platforms', { userId: user.id });
    assert.equal(result.status, 200);
    assert.equal(result.data.connected.youtube, true);
    assert.equal(result.data.platforms.youtube.reconnectRequired, true);
    await app.saveSocialToken(user.id, 'youtube', 'synthetic-new-access', 'synthetic-refresh');
    const connectedAt = user.socialConnectedAt.youtube;
    await app.saveSocialToken(user.id, 'youtube', 'synthetic-renewed-access');
    assert.equal(user.socialRefreshTokens.youtube, 'synthetic-refresh');
    assert.equal(user.socialConnectedAt.youtube, connectedAt);
    result = await app.request('/social/platforms', { userId: user.id });
    assert.equal(result.data.platforms.youtube.reconnectRequired, false);
    assert.equal(JSON.stringify(result.data).includes('synthetic-'), false);
  } finally { await app.close(); }
});
