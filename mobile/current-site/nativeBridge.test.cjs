const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MAX_BYTES, validToken, apiPath, bytesToBase64, base64Bytes, safeFileName,
  validateMultipart, createNativeApiBridge, allowDocumentNavigation, externalUrl, assertNativeCapability,
} = require('./nativeBridge.cjs');

const API = 'https://api.uficonnect.org';
const TOKEN_A = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImZpeHR1cmUtYSJ9.signatureA';
const TOKEN_B = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImZpeHR1cmUtYiJ9.signatureB';
const tick = () => new Promise(resolve => setImmediate(resolve));
const json = (data, { status = 200, url = API + '/profile', headers = {} } = {}) => {
  const response = new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
function fixture({ saved = null, respond, multipart, store: storeOverride } = {}) {
  let stored = saved;
  const requests = [], storage = [];
  const store = {
    read: async () => stored,
    write: async value => { stored = value; storage.push(['write', value]); },
    clear: async () => { stored = null; storage.push(['clear']); },
    ...storeOverride,
  };
  const bridge = createNativeApiBridge({ apiBase: API, store, multipart,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return respond ? respond(url, options) : json({ id: 'fixture-a' }, { url });
    } });
  return { bridge, requests, storage, stored: () => stored };
}

test('native requests stay on the canonical HTTPS API and reject dangerous paths before networking', async () => {
  for (const apiBase of ['http://api.uficonnect.org', 'https://api.uficonnect.org.evil.test', 'https://api.uficonnect.org/', 'https://user@api.uficonnect.org']) {
    assert.throws(() => createNativeApiBridge({ apiBase }), /Untrusted/);
  }
  const f = fixture();
  for (const url of ['https://evil.test/profile', '//evil.test/profile', '/\\evil', '/a/../profile', '/a/%2e%2e/profile', '/a/%zz', '/x#fragment', '/x\nsecret', '/%0d%0aHost:evil.test', '/x%5cy', '/x y']) {
    assert.throws(() => apiPath(url), /Invalid/);
    await assert.rejects(f.bridge.request({ url }), /Invalid/);
  }
  await assert.rejects(f.bridge.request({ url: '/profile', method: 'CONNECT' }), /Unsupported/);
  assert.equal(f.requests.length, 0);
  assert.equal(apiPath('/search?q=design%20jobs&page=2'), '/search?q=design%20jobs&page=2');
});

test('restoration uses only SecureStore bearer authorization; private cookies and arbitrary headers never cross the bridge', async () => {
  const f = fixture({ saved: TOKEN_A });
  assert.deepEqual(await f.bridge.restore(), { token: TOKEN_A, profile: { id: 'fixture-a' } });
  await f.bridge.request({ url: '/profile', headers: {
    Authorization: `Bearer ${TOKEN_A}`, Cookie: 'browser-cookie', 'X-API-Key': 'unexpected-key', Origin: 'https://evil.test',
  } });
  const { url, options } = f.requests.at(-1);
  assert.equal(url, API + '/profile');
  assert.equal(options.headers.authorization, `Bearer ${TOKEN_A}`);
  assert.equal(Object.keys(options.headers).some(name => /cookie|api.key|origin/i.test(name)), false);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  await assert.rejects(f.bridge.request({ url: '/profile', headers: { Authorization: `Bearer ${TOKEN_B}` } }), /session changed/);
  await assert.rejects(f.bridge.request({ url: '/profile', headers: { Accept: 'application/json\r\nX-Key: secret' } }), /Invalid request header/);
  assert.equal(f.requests.length, 2);
});

test('missing, invalid and revoked saved sessions fail closed without returning private profile data', async () => {
  const empty = fixture();
  assert.equal(await empty.bridge.restore(), null);
  assert.equal((await empty.bridge.request({ url: '/auth/session' })).status, 401);
  assert.equal(empty.requests.length, 0);
  const invalid = fixture({ saved: 'not-a-session' });
  assert.equal(await invalid.bridge.restore(), null);
  assert.equal(invalid.stored(), null);
  assert.equal(invalid.requests.length, 0);
  const revoked = fixture({ saved: TOKEN_A, respond: () => json({ message: 'Revoked' }, { status: 401 }) });
  assert.equal(await revoked.bridge.restore(), null);
  assert.equal(revoked.bridge.getToken(), null);
  assert.equal(revoked.stored(), null);
  const unavailable = fixture({ saved: TOKEN_A, respond: () => json({ message: 'Retry' }, { status: 503 }) });
  await assert.rejects(unavailable.bridge.restore(), /restore your session/);
  assert.equal(unavailable.stored(), TOKEN_A, 'Temporary network failure must not delete a recoverable session');
});

test('DOM reload restores the live host account after an account change and stays signed out after logout', async () => {
  const f = fixture({ saved: TOKEN_A, respond: (url, options) => {
    if (url.endsWith('/auth/login')) return json({ token: TOKEN_B, profile: { id: 'fixture-b' } }, { url });
    return json({ id: options.headers.authorization === `Bearer ${TOKEN_B}` ? 'fixture-b' : 'fixture-a' }, { url });
  } });
  const startupSession = await f.bridge.restore();
  assert.deepEqual((await f.bridge.request({ url: '/auth/session' })).data, startupSession);

  const login = await f.bridge.request({ url: '/auth/login', method: 'POST', data: {} });
  await f.bridge.persistSession(login.data.token);
  const reloaded = await f.bridge.request({ url: '/auth/session' });
  assert.equal(reloaded.status, 200);
  assert.deepEqual(reloaded.data, { token: TOKEN_B, profile: { id: 'fixture-b' } });
  assert.equal(startupSession.token, TOKEN_A, 'Stale startup props must not choose the recovered account');
  assert.equal(f.requests.at(-1).options.headers.authorization, `Bearer ${TOKEN_B}`);

  await f.bridge.persistSession(null);
  const requestCount = f.requests.length;
  const signedOutReload = await f.bridge.request({ url: '/auth/session' });
  assert.equal(signedOutReload.status, 401);
  assert.equal(signedOutReload.data.token, undefined);
  assert.equal(signedOutReload.data.profile, undefined);
  assert.equal(f.requests.length, requestCount, 'A signed-out reload must not contact the API');
});

test('only a successful canonical authentication response can become the saved session', async () => {
  const f = fixture({ respond: (url) => json({ token: TOKEN_A, profile: { id: 'fixture-a' } }, { url }) });
  await assert.rejects(f.bridge.persistSession(TOKEN_A), /Unrecognized/);
  await f.bridge.request({ url: '/profile' });
  await assert.rejects(f.bridge.persistSession(TOKEN_A), /Unrecognized/);
  const response = await f.bridge.request({ url: '/auth/login', method: 'POST', data: { email: 'fixture@example.invalid', password: 'Synthetic passphrase' } });
  await f.bridge.persistSession(response.data.token);
  assert.equal(f.stored(), TOKEN_A);
  assert.equal(f.bridge.getToken(), TOKEN_A);
  await f.bridge.persistSession(null);
  assert.equal(f.stored(), null);
  await assert.rejects(f.bridge.persistSession(TOKEN_A), /Unrecognized/);
});

test('failed Keychain writes do not activate an unpersisted session', async () => {
  const f = fixture({ store: { write: async () => { throw new Error('Keychain unavailable'); } },
    respond: url => json({ token: TOKEN_A, profile: { id: 'fixture-a' } }, { url }) });
  await f.bridge.request({ url: '/auth/login', method: 'POST', data: {} });
  await assert.rejects(f.bridge.persistSession(TOKEN_A), /Keychain unavailable/);
  assert.equal(f.bridge.getToken(), null);
  assert.equal(f.stored(), null);
  assert.equal((await f.bridge.request({ url: '/auth/session' })).status, 401);
});

test('late authentication cannot resurrect a session after logout', async () => {
  let complete;
  const f = fixture({ saved: TOKEN_A, respond: url => url.endsWith('/auth/login')
    ? new Promise(resolve => { complete = resolve; }) : json({ id: 'fixture-a' }, { url }) });
  await f.bridge.restore();
  const login = f.bridge.request({ url: '/auth/login', method: 'POST', data: {} });
  await tick();
  await f.bridge.persistSession(null);
  complete(json({ token: TOKEN_B, profile: { id: 'fixture-b' } }, { url: API + '/auth/login' }));
  await assert.rejects(login, /session changed/);
  await assert.rejects(f.bridge.persistSession(TOKEN_B), /Unrecognized/);
  assert.equal(f.stored(), null);
});

test('clearing a guest session cancels an authentication response still in flight', async () => {
  let complete;
  const f = fixture({ respond: () => new Promise(resolve => { complete = resolve; }) });
  const login = f.bridge.request({ url: '/auth/login', method: 'POST', data: {} });
  await tick();
  await f.bridge.persistSession(null);
  complete(json({ token: TOKEN_B, profile: { id: 'fixture-b' } }, { url: API + '/auth/login' }));
  await assert.rejects(login, /session changed/);
  await assert.rejects(f.bridge.persistSession(TOKEN_B), /Unrecognized/);
  assert.equal(f.stored(), null);
});

test('an in-flight /auth/session cannot pair a previous profile with a changed token', async () => {
  let complete, hold = false;
  const f = fixture({ saved: TOKEN_A, respond: url => hold ? new Promise(resolve => { complete = resolve; }) : json({ id: 'fixture-a' }, { url }) });
  await f.bridge.restore(); hold = true;
  const session = f.bridge.request({ url: '/auth/session' });
  await tick();
  await f.bridge.persistSession(null);
  complete(json({ id: 'fixture-a' }));
  await assert.rejects(session, /session changed/);
  assert.equal(f.bridge.getToken(), null);
});

test('recovery cannot return a saved session after logout while its profile check was pending', async () => {
  let complete;
  const f = fixture({ saved: TOKEN_A, respond: () => new Promise(resolve => { complete = resolve; }) });
  const restoring = f.bridge.restore();
  await tick();
  await f.bridge.persistSession(null);
  complete(json({ id: 'fixture-a' }));
  await assert.rejects(restoring, /session changed/);
  assert.equal(f.bridge.getToken(), null);
  assert.equal(f.stored(), null);
});

test('a delayed Keychain read cannot restore a credential after local sign-out', async () => {
  let complete;
  const f = fixture({ store: { read: () => new Promise(resolve => { complete = resolve; }) } });
  const restoring = f.bridge.restore();
  await tick();
  await f.bridge.persistSession(null);
  complete(TOKEN_A);
  await assert.rejects(restoring, /session changed/);
  assert.equal(f.bridge.getToken(), null);
  assert.equal(f.requests.length, 0);
});

test('redirected API responses are rejected before reading or accepting their session token', async () => {
  const f = fixture({ respond: () => json({ token: TOKEN_A }, { url: 'https://api.uficonnect.org.evil.test/auth/login' }) });
  await assert.rejects(f.bridge.request({ url: '/auth/login', method: 'POST', data: {} }), /Untrusted API response/);
  await assert.rejects(f.bridge.persistSession(TOKEN_A), /Unrecognized/);
});

test('download metadata is restricted and binary payloads are bounded and serialized without cookies', async () => {
  const raw = Uint8Array.from([0, 1, 127, 128, 254, 255]);
  const f = fixture({ respond: () => new Response(raw, { headers: {
    'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="fixture.pdf"',
    'set-cookie': 'private-cookie', 'x-private-secret': 'must-not-cross',
  } }) });
  const result = await f.bridge.request({ url: '/resume/export' });
  assert.equal(result.bodyType, 'base64');
  assert.deepEqual(Buffer.from(result.data, 'base64'), Buffer.from(raw));
  assert.deepEqual(Object.keys(result.headers).sort(), ['content-disposition', 'content-type']);
  const oversized = fixture({ respond: () => new Response('x', { headers: { 'content-length': String(MAX_BYTES + 1) } }) });
  await assert.rejects(oversized.bridge.request({ url: '/resume/export' }), /exceeds 25 MB/);
  const malformed = fixture({ respond: () => new Response('{bad', { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(malformed.bridge.request({ url: '/profile' }), /invalid response/);
});

test('multipart uploads limit aggregate bytes and clean up temporary files after a failed request', async () => {
  const upload = { __ufiMultipart: true, fields: [
    { name: 'description', value: 'A fixture document' },
    { name: 'file', file: { name: 'sample.pdf', type: 'application/pdf', base64: 'AAH/' } },
  ] };
  assert.equal(validateMultipart(upload), upload);
  for (const invalid of [
    { __ufiMultipart: true, fields: [{ name: 'x\r\n', value: 'x' }] },
    { __ufiMultipart: true, fields: [{ name: 'file', file: { type: 'text/plain\r\nX-Key:secret', base64: 'AAAA' } }] },
    { __ufiMultipart: true, fields: [{ name: 'file', file: { type: 'text/plain', base64: 'not base64!' } }] },
    { __ufiMultipart: true, fields: Array.from({ length: 129 }, () => ({ name: 'x', value: '' })) },
    { __ufiMultipart: true, fields: [{ name: 'x', value: 'x'.repeat(MAX_BYTES + 1) }] },
  ]) assert.throws(() => validateMultipart(invalid));
  let cleaned = 0;
  const f = fixture({ multipart: async () => ({ body: 'native-form-body', cleanup: async () => { cleaned++; } }),
    respond: () => { throw new Error('Network unavailable'); } });
  await assert.rejects(f.bridge.request({ url: '/profile/upload', method: 'POST', data: upload,
    headers: { 'Content-Type': 'multipart/form-data' } }), /Network unavailable/);
  assert.equal(cleaned, 1);
  assert.equal(f.requests[0].options.headers['content-type'], undefined, 'Native transport generates the multipart boundary');
});

test('sign-out during upload preparation cleans files and prevents the old account request', async () => {
  let prepared, cleaned = 0;
  const f = fixture({ saved: TOKEN_A, multipart: () => new Promise(resolve => { prepared = resolve; }) });
  await f.bridge.restore();
  const before = f.requests.length;
  const upload = f.bridge.request({ url: '/profile/upload', method: 'POST', headers: { Authorization: `Bearer ${TOKEN_A}` },
    data: { __ufiMultipart: true, fields: [{ name: 'file', file: { type: 'text/plain', base64: 'eA==' } }] } });
  await tick();
  await f.bridge.persistSession(null);
  prepared({ body: 'prepared-upload', cleanup: async () => { cleaned++; } });
  await assert.rejects(upload, /session changed/);
  assert.equal(f.requests.length, before, 'No stale bearer or uploaded content reaches the network');
  assert.equal(cleaned, 1, 'Prepared temporary files are removed even without a network request');
});

test('private response bodies are discarded when sign-out occurs during their download', async () => {
  let finishBody, hold = false;
  const f = fixture({ saved: TOKEN_A, respond: url => {
    const result = json({ id: 'fixture-a' }, { url });
    if (hold) result.arrayBuffer = () => new Promise(resolve => { finishBody = resolve; });
    return result;
  } });
  await f.bridge.restore(); hold = true;
  const request = f.bridge.request({ url: '/messages', headers: { Authorization: `Bearer ${TOKEN_A}` } });
  await tick();
  await f.bridge.persistSession(null);
  finishBody(new TextEncoder().encode('{"private":"previous-account"}').buffer);
  await assert.rejects(request, /session changed/);
});

test('upload results cannot reach a signed-out account while temporary files are being cleaned', async () => {
  let finishCleanup;
  const f = fixture({ saved: TOKEN_A, multipart: async () => ({ body: 'prepared',
    cleanup: () => new Promise(resolve => { finishCleanup = resolve; }) }) });
  await f.bridge.restore();
  const request = f.bridge.request({ url: '/profile/upload', method: 'POST', headers: { Authorization: `Bearer ${TOKEN_A}` },
    data: { __ufiMultipart: true, fields: [{ name: 'title', value: 'Personal attachment' }] } });
  await tick();
  assert.equal(typeof finishCleanup, 'function');
  await f.bridge.persistSession(null);
  finishCleanup();
  await assert.rejects(request, /session changed/);
});

test('long-running app operations keep their requested timeout instead of stopping after 30 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const f = fixture({ respond: (url, options) => new Promise((resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  }) });
  const request = f.bridge.request({ url: '/command-center/content-draft', method: 'POST', data: {}, timeout: 180000 });
  const rejected = assert.rejects(request, error => error.name === 'AbortError');
  t.mock.timers.tick(30000);
  assert.equal(signal.aborted, false, 'Generation may continue past the old host limit');
  t.mock.timers.tick(149999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true, 'The requested upper bound still aborts the transport');
});

test('native transport timeout values are bounded before any request is sent', async () => {
  const f = fixture();
  for (const timeout of [-1, 0.5, '180000', Infinity, NaN, 240001]) {
    await assert.rejects(f.bridge.request({ url: '/profile', timeout }), /Invalid request timeout/);
  }
  assert.equal(f.requests.length, 0);
  await f.bridge.request({ url: '/command-center/media', timeout: 240000 });
  assert.equal(f.requests.length, 1, 'The current media generation limit is supported');
});

test('file serialization rejects malformed base64 and filenames cannot escape the temporary directory', () => {
  for (const bytes of [[], [0], [0, 1], [0, 1, 255], [0, 1, 2, 3]]) {
    const expected = Buffer.from(bytes).toString('base64');
    assert.equal(bytesToBase64(Uint8Array.from(bytes)), expected);
    assert.equal(base64Bytes(expected), bytes.length);
  }
  for (const value of ['AAA', 'AA=A', 'A===', 'AAAA\n', null]) assert.throws(() => base64Bytes(value));
  assert.equal(/[\x00-\x1f<>:"/\\|?*]/.test(safeFileName('../../private\nfile.pdf')), false);
  assert.ok(safeFileName('a'.repeat(500)).length <= 120);
  assert.equal(validToken('malformed'), false);
  assert.equal(validToken(TOKEN_A), true);
});

test('bundled DOM navigation is locked to its bundle and remote links require an allowed external scheme', () => {
  const bundleRoot = 'file:///app/Bundle/www.bundle/';
  const documentUrl = bundleRoot + 'site.html';
  assert.equal(allowDocumentNavigation(documentUrl, { bundleRoot }), true);
  assert.equal(allowDocumentNavigation(documentUrl + '#route', { documentUrl, bundleRoot }), true);
  assert.equal(allowDocumentNavigation('about:blank', { bundleRoot }), true);
  assert.equal(allowDocumentNavigation('about:blank', { documentUrl, bundleRoot }), false);
  for (const url of ['file:///outside/other.html', bundleRoot + '../outside.html', bundleRoot + '%2e%2e/outside.html',
    'https://uficonnect.org', 'javascript:alert(1)', 'data:text/html,<h1>Bad</h1>']) {
    assert.equal(allowDocumentNavigation(url, { bundleRoot }), false);
    assert.equal(allowDocumentNavigation(url, { documentUrl, bundleRoot }), false);
  }
  assert.equal(allowDocumentNavigation(bundleRoot + 'different.html', { documentUrl, bundleRoot }), false);
  assert.equal(allowDocumentNavigation('http://127.0.0.1:8081/index.html', { development: true }), true);
  assert.equal(allowDocumentNavigation('http://127.0.0.1:8081/index.html'), false);
  for (const url of ['https://example.org/post?x=1#part', 'mailto:support@example.org', 'tel:+15555550100']) assert.equal(externalUrl(url), url);
  for (const url of ['http://example.org', '//evil.test', 'file:///private', 'javascript:alert(1)', 'data:text/html,test',
    'https://user:pass@evil.test', 'https://evil.test\\@safe.test', 'https://evil.test\n']) assert.throws(() => externalUrl(url));
});

test('untrusted frames cannot invoke native actions without the current WebView capability', () => {
  const capability = 'a1'.repeat(32);
  let calls = 0;
  const action = (received, input) => { assertNativeCapability(capability, received); calls++; return input; };
  for (const value of [undefined, null, '', 'a1', 'b2'.repeat(32), capability + 'a', { capability }]) {
    assert.throws(() => action(value, 'private operation'));
  }
  assert.equal(calls, 0, 'Rejected frames produce no native side effect');
  assert.equal(action(capability, 'trusted operation'), 'trusted operation');
  assert.equal(calls, 1);
  assert.throws(() => assertNativeCapability('', ''));
});
