import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNewPassword } from '../web/src/auth/passwordPolicy.js';
import { redactTelemetry, telemetryPath } from '../web/src/api/telemetryPrivacy.js';
import { createAuthenticatedStream } from '../web/src/api/authenticatedStream.js';
import { isRelativeApiRequest, validateApiBaseUrl } from '../web/src/api/apiEndpointPolicy.js';

test('production API destinations require HTTPS and reject ambiguous credential URLs', () => {
  const production = { production: true, pageOrigin: 'https://uficonnect.org' };
  assert.equal(validateApiBaseUrl('https://api.uficonnect.org/', production), 'https://api.uficonnect.org');
  assert.equal(validateApiBaseUrl('/api', production), '/api');
  for (const value of ['http://api.uficonnect.org', 'http://localhost:3000', '//other.example', 'https://user:secret@example.org', 'https://api.example.org?token=x', 'https://api.example.org#fragment', 'javascript:alert(1)']) {
    assert.throws(() => validateApiBaseUrl(value, production));
  }
  assert.equal(validateApiBaseUrl('http://127.0.0.1:3000', { production: true, pageOrigin: 'http://localhost:5000' }), 'http://127.0.0.1:3000');
  for (const value of ['https://other.example/profile', '//other.example/profile', '\\\\other.example/profile', ' https://other.example/profile', 'javascript:alert(1)']) {
    assert.equal(isRelativeApiRequest(value), false);
  }
  assert.equal(isRelativeApiRequest('/profile?view=me'), true);
});

test('new passwords enforce Unicode character and bcrypt byte boundaries', () => {
  assert.ok(validateNewPassword('a'.repeat(14)));
  assert.equal(validateNewPassword('a'.repeat(15)), '');
  assert.equal(validateNewPassword('a'.repeat(72)), '');
  assert.ok(validateNewPassword('a'.repeat(73)));
  assert.equal(validateNewPassword('😀'.repeat(18)), '');
  assert.ok(validateNewPassword('😀'.repeat(19)));
  assert.ok(validateNewPassword('😀'.repeat(14)));
});

test('telemetry excludes reset routes and redacts complete quoted passphrases', () => {
  assert.equal(telemetryPath('/reset-password?token=secret'), null);
  assert.equal(telemetryPath('/login'), null);
  assert.equal(telemetryPath('/search?q=private'), '/search');
  const safe = redactTelemetry('Failed: {"currentPassword":"a secret passphrase", "accessToken":"another-secret"} Bearer hidden-token https://example.org/?token=reset-secret');
  for (const secret of ['a secret passphrase', 'another-secret', 'hidden-token', 'reset-secret']) assert.ok(!safe.includes(secret));
});

test('legacy persistent credentials are removed and logout clears in-memory member data', async () => {
  function storage(entries) {
    const values = new Map(entries);
    return { get length() { return values.size; }, key: (index) => [...values.keys()][index], removeItem: (key) => values.delete(key), getItem: (key) => values.get(key) ?? null };
  }
  const previous = globalThis.window;
  const localStorage = storage([['pc_token', 'legacy-secret'], ['ufi_profile_snapshot', 'private-profile'], ['@@auth0spajs@@cache', 'refresh-secret'], ['unrelated', 'keep']]);
  const sessionStorage = storage([['ufi_feed_v1:member', 'private-post']]);
  globalThis.window = { localStorage, sessionStorage, dispatchEvent() {} };
  try {
    const session = await import('../web/src/auth/session.js?security-test');
    assert.equal(localStorage.getItem('pc_token'), null);
    assert.equal(localStorage.getItem('ufi_profile_snapshot'), null);
    assert.equal(localStorage.getItem('@@auth0spajs@@cache'), null);
    assert.equal(localStorage.getItem('unrelated'), 'keep');
    assert.equal(sessionStorage.length, 0);
    session.setAccessToken('memory-secret');
    session.privateSessionStorage.setItem('private-profile', 'member data');
    assert.equal(localStorage.length, 1);
    assert.equal(sessionStorage.length, 0);
    session.clearSession();
    assert.equal(session.getAccessToken(), null);
    assert.equal(session.privateSessionStorage.getItem('private-profile'), null);
  } finally { globalThis.window = previous; }
});

test('SSE authentication uses a header and decodes split multiline events', async () => {
  const previous = globalThis.fetch;
  let request;
  const encoder = new TextEncoder();
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(': heartbeat\r\ndata: {"posts":\r'));
      controller.enqueue(encoder.encode('\ndata: []}\r\n\r\n'));
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const stream = createAuthenticatedStream('https://api.example.org/feed/stream', 'private-token');
    const message = await new Promise((resolve, reject) => {
      stream.onmessage = resolve;
      stream.onerror = reject;
    });
    stream.close();
    assert.deepEqual(JSON.parse(message.data), { posts: [] });
    assert.ok(!request.url.includes('private-token'));
    assert.equal(request.options.headers.Authorization, 'Bearer private-token');
    assert.equal(request.options.cache, 'no-store');
    assert.equal(request.options.referrerPolicy, 'no-referrer');
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.signal.aborted, true);
  } finally { globalThis.fetch = previous; }
});
