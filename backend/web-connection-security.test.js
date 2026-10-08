'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionCookie, readSessionCookie, isPrivateRequest, webConnectionStatus } = require('./web-connection-security');

test('production session cookie is host-bound and ambiguous or legacy cookies cannot choose an account', () => {
  const env = { NODE_ENV: 'production' };
  const cookie = createSessionCookie('signed-token', 60, env);
  assert.equal(cookie, '__Host-ufi_session=signed-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
  assert.equal(readSessionCookie({ headers: { cookie: 'ufi_session=legacy; __Host-ufi_session=signed-token' } }, env), 'signed-token');
  for (const cookie of ['ufi_session=legacy', '__Host-ufi_session=a; __Host-ufi_session=b', '__Host-ufi_session=%ZZ', '__Host-ufi_session=bad%20token']) {
    assert.equal(readSessionCookie({ headers: { cookie } }, env), null);
  }
  assert.equal(readSessionCookie({ headers: { cookie: 'ufi_session=local' } }, {}), 'local');
});

test('cookie-authenticated feeds and every messaging, import and authentication response remain private', () => {
  for (const path of ['/auth/session','/messages','/messages/person/attachments/message','/connected-inbox/messages/x/1','/profile/attachments','/media/upload-signature','/security/web-connection']) {
    assert.equal(isPrivateRequest({ path, headers: {} }), true, path);
  }
  assert.equal(isPrivateRequest({path:'/feed',headers:{cookie:'__Host-ufi_session=value'}}),true);
  assert.equal(isPrivateRequest({path:'/feed',headers:{authorization:'Bearer value'}}),true);
  assert.equal(isPrivateRequest({path:'/feed',headers:{cookie:'unrelated=value'}}),false);
});

test('web protection reports actual trusted transport and verified identity without a VPN claim', () => {
  const http = webConnectionStatus({secure:false,headers:{'x-forwarded-proto':'https'},user:{id:'member'}},0);
  assert.equal(http.transport.encrypted,false);
  assert.equal(http.transport.protocol,'http');
  assert.equal(http.session.verified,true);
  const https = webConnectionStatus({secure:true,user:{id:'member'}},0);
  assert.equal(https.transport.encrypted,true);
  assert.equal(https.scope,'uficonnect-web');
  assert.equal(https.checkedAt,'1970-01-01T00:00:00.000Z');
  assert.equal('vpnConnected' in https,false);
});
