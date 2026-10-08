'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

test('web protection verifies the current session and cookie-authenticated responses cannot be cached', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  app.seedUser(member('web-security-member'));
  const token = app.token('web-security-member');
  assert.equal((await app.request('/security/web-connection')).status,401);
  const result = await app.request('/security/web-connection',{headers:{cookie:'ufi_session='+token,'x-forwarded-proto':'https'}});
  assert.equal(result.status,200);
  assert.equal(result.data.session.verified,true);
  assert.equal(result.data.transport.encrypted,false,'An untrusted forwarding header cannot prove HTTPS');
  assert.equal(result.data.scope,'uficonnect-web');
  assert.match(result.headers.get('cache-control'),/no-store/);
  assert.match(result.headers.get('vary'),/Cookie/);
  assert.match(result.headers.get('vary'),/Authorization/);
  const invalid = await app.request('/security/web-connection',{headers:{cookie:'ufi_session='+token+'; ufi_session=other'}});
  assert.equal(invalid.status,401);
});

test('malformed and oversized JSON cannot reflect private submitted text', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const secret = 'private submitted credential';
  for (const [body,status,message] of [
    ['{"password":"'+secret+'",',400,'Invalid JSON request.'],
    [JSON.stringify({password:secret,content:'x'.repeat(600_000)}),413,'This request is too large.'],
  ]) {
    const response = await fetch(app.base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body});
    assert.equal(response.status,status);
    const text = await response.text();
    assert.equal(JSON.parse(text).message,message);
    assert.equal(text.includes(secret),false);
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
});
