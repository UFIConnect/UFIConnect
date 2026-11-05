'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness } = require('./test-support/app-harness');

test('reviewed Office preflights are reusable while each API read still requires authorization', async t => {
  const origin = 'https://office.uficonnect.org';
  const app = await createAppHarness({ env: { ALLOWED_ORIGINS: origin, OFFICE_TOKEN: 'synthetic-preflight-token' } });
  t.after(() => app.close());
  const preflight = await fetch(app.base + '/office/status', { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-office-token',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-max-age'), '600');
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-office-token/);
  const denied = await fetch(app.base + '/office/status', { headers: { Origin: origin } });
  assert.equal(denied.status, 401);
  const allowed = await fetch(app.base + '/office/status', { headers: { Origin: origin, 'x-office-token': 'synthetic-preflight-token' } });
  assert.equal(allowed.status, 200);
});

test('a preflight from an unconfigured origin never receives permission to read Office', async t => {
  const app = await createAppHarness({ env: { ALLOWED_ORIGINS: 'https://office.uficonnect.org' } });
  t.after(() => app.close());
  const response = await fetch(app.base + '/office/status', { method: 'OPTIONS', headers: {
    Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-office-token',
  } });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
