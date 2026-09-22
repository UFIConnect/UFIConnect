const test = require('node:test');
const assert = require('node:assert/strict');
const { analyticsParentOrigins, createAnalyticsBridgeHandler } = require('./analytics-bridge');
const { createAppHarness } = require('./test-support/app-harness');

test('analytics frame parents use configured HTTPS origins with development-only loopback exceptions', () => {
  const env = { NODE_ENV: 'production', ANALYTICS_PARENT_ORIGINS: 'https://uficonnect.org,http://localhost:8081,https://user:secret@example.org,https://example.org/?token=x,javascript:alert(1)', FRONTEND_URL: 'https://uficonnect.org/' };
  assert.deepEqual(analyticsParentOrigins(env), ['https://uficonnect.org']);
  assert.deepEqual(analyticsParentOrigins({ NODE_ENV: 'development', ANALYTICS_PARENT_ORIGINS: 'http://localhost:8081,http://evil.example' }), ['http://localhost:8081']);
  assert.deepEqual(analyticsParentOrigins({ NODE_ENV: 'production', ANALYTICS_PARENT_ORIGINS: 'invalid' }), []);
});

test('public analytics document has isolated script permissions and never accepts URL parameters', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const response = await app.request('/analytics-bridge.html');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('x-frame-options'), null);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors https:\/\//);
  assert.match(response.headers.get('content-security-policy'), /script-src 'sha256-/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-inline|unsafe-eval/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal((await app.request('/analytics-bridge.html?token=synthetic-sensitive-value')).status, 400);
});

test('an invalid parent allowlist produces a non-embeddable bridge', () => {
  let headers;
  const handler = createAnalyticsBridgeHandler({ env: { NODE_ENV: 'production', ANALYTICS_PARENT_ORIGINS: 'invalid' } });
  handler({ url: '/analytics-bridge.html' }, { removeHeader() {}, set(value) { headers = value; }, status() { return this; }, send() {} });
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'$/);
});

test('a Global Privacy Control request receives no optional analytics document', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const response = await app.request('/analytics-bridge.html', { headers: { 'Sec-GPC': '1' } });
  assert.equal(response.status, 204);
  assert.equal(response.data, '');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
