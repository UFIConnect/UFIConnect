const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { BLUESKY_OAUTH_SCOPE, pushBlueskyAuthorization } = require('./bluesky-oauth');

test('new metadata requests chat on the first attempt', async () => {
  const scopes = [];
  const success = { status: 201, data: { request_uri: 'urn:test:request' } };
  assert.equal(await pushBlueskyAuthorization(async scope => { scopes.push(scope); return success; }), success);
  assert.deepEqual(scopes, [BLUESKY_OAUTH_SCOPE]);
});

test('cached metadata retries once with existing permissions', async () => {
  const scopes = [];
  const success = { status: 201, data: { request_uri: 'urn:test:request' } };
  const result = await pushBlueskyAuthorization(async scope => {
    scopes.push(scope);
    return scopes.length === 1 ? { status: 400, data: {
      error: 'invalid_scope', error_description: 'Scope "transition:chat.bsky" is not declared in the client metadata',
    } } : success;
  });
  assert.equal(result, success);
  assert.deepEqual(scopes, [BLUESKY_OAUTH_SCOPE, 'atproto transition:generic']);
});

test('unrelated failures do not downgrade permissions or loop', async () => {
  for (const failure of [
    { status: 400, data: { error: 'invalid_client' } },
    { status: 400, data: { error: 'invalid_scope', error_description: 'Scope atproto is not declared in the client metadata' } },
    { status: 400, data: { error: 'invalid_scope', error_description: 'transition:chat.bsky is not allowed for this user' } },
    { status: 503, data: { error: 'unavailable' } },
  ]) {
    let attempts = 0;
    assert.equal(await pushBlueskyAuthorization(async () => { attempts++; return failure; }), failure);
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  const failure = { status: 400, data: { error: 'invalid_scope', error_description: 'Scope "transition:chat.bsky" is not declared in the client metadata' } };
  assert.equal(await pushBlueskyAuthorization(async () => { attempts++; return failure; }), failure);
  assert.equal(attempts, 2);
});

test('public metadata declares requested permissions and expires cached responses', async () => {
  const { createAppHarness } = require('./test-support/app-harness');
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const app = await createAppHarness({ env: {
    BLUESKY_SIGNING_KEY: JSON.stringify(privateKey.export({ format: 'jwk' })),
  } });
  try {
    const result = await app.request('/oauth/bluesky/client-metadata.json');
    assert.equal(result.status, 200);
    assert.equal(result.data.scope, BLUESKY_OAUTH_SCOPE);
    assert.equal(result.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
    assert.ok(result.data.client_id.endsWith('/oauth/bluesky/client-metadata.json'));
  } finally { await app.close(); }
});
