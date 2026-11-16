import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { validateNewPassword } from '../web/src/auth/passwordPolicy.js';
import { redactTelemetry, telemetryPath } from '../web/src/api/telemetryPrivacy.js';
import { createAuthenticatedStream } from '../web/src/api/authenticatedStream.js';
import { isRelativeApiRequest, validateApiBaseUrl } from '../web/src/api/apiEndpointPolicy.js';
import { browserSecurityPolicy } from '../web/securityPolicy.mjs';
import { safeReturnPath } from '../web/src/auth/returnPath.js';

test('Render bounds the homepage and public asset cache and keeps account routes fresh', () => {
  const blueprint = parse(fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8'));
  const web = blueprint.services.find(service => service.name === 'uficonnect-web');
  const cacheRules = web.headers.filter(header => header.name === 'Cache-Control');
  const homepageRules = cacheRules.filter(header => header.path === '/' || header.path === '/index.html');
  assert.deepEqual(homepageRules.map(header => header.path), ['/', '/index.html']);
  for (const rule of homepageRules) {
    assert.equal(rule.value, 'public, max-age=0, s-maxage=30, must-revalidate');
    assert.doesNotMatch(rule.value, /immutable|stale-while-revalidate|stale-if-error/);
  }
  const policies = new Map(cacheRules.map(header => [header.path, header.value]));
  const sharedPaths = cacheRules.filter(header => /s-maxage=/.test(header.value)).map(header => header.path);
  assert.deepEqual(sharedPaths, [
    '/', '/index.html', '/assets/*', '/appearance-init.js', '/appearance.css',
    '/brand/*', '/homepage-*', '/uficonnect-*', '/media/preparation/*',
  ]);
  for (const route of [
    '/health*', '/sw.js', '/manifest.json', '/login*', '/forgot-password*', '/reset-password*',
    '/register*', '/business/register*', '/onboarding*', '/messages*', '/notifications*', '/profile*',
    '/connected-accounts*', '/app.html', '/global*', '/settings*', '/command-center*', '/vault*', '/resume-builder*',
    '/downloads/*', '/twitch-player.html', '/twitch-player.css', '/twitch-player.js',
  ]) {
    assert.equal(policies.get(route), 'no-cache, no-store, must-revalidate', route);
  }
  assert.equal(policies.get('/assets/*'), 'public, max-age=0, s-maxage=300, must-revalidate', 'The path-only rule also applies to asset errors');
  assert.equal(policies.get('/appearance.css'), 'public, max-age=300, s-maxage=3600, must-revalidate');
  assert.equal(policies.get('/media/preparation/*'), 'public, max-age=3600, s-maxage=86400');
  const office = blueprint.services.find(service => service.name === 'uficonnect-office');
  assert.equal(office.headers.find(header => header.name === 'Cache-Control' && header.path === '/index.html')?.value, 'no-cache, no-store, must-revalidate');
  for (const service of blueprint.services.filter(service => service.runtime !== 'static')) assert.equal(Boolean(service.headers?.some(header => /s-maxage=30/.test(header.value))), false, 'The API and pipeline do not gain the public homepage policy');
});

test('Cloudflare grants immutable caching only to successful public bundles', () => {
  const rules = parse(fs.readFileSync(new URL('../infra/cdn/cloudflare-cache-rules.yaml', import.meta.url), 'utf8'));
  const [bypass, eligible] = rules.http_request_cache_settings;
  assert.equal(bypass.action_parameters.cache, false);
  assert.match(bypass.expression, /"uficonnect\.org" "api\.uficonnect\.org"/);
  assert.deepEqual(eligible.action_parameters, {
    cache: true,
    edge_ttl: { mode: 'bypass_by_default' },
    browser_ttl: { mode: 'respect_origin' },
  });
  assert.match(eligible.expression, /http\.request\.method in \{"GET" "HEAD"\}/);
  assert.match(eligible.expression, /not any\(http\.request\.headers\.names\[\*\] wildcard "authorization"\)/);
  assert.match(eligible.expression, /http\.cookie eq "" and http\.request\.uri\.path in \{"\/" "\/index\.html"\}/);
  assert.match(eligible.expression, /http\.request\.uri\.query eq ""/);
  assert.doesNotMatch(eligible.expression, /\/uploads|\/downloads|\/login|\/manifest\.json|\/sw\.js/);

  const [immutable, errors] = rules.http_response_cache_settings;
  assert.match(immutable.expression, /starts_with\(http\.request\.uri\.path, "\/assets\/"\)/);
  assert.match(immutable.expression, /http\.response\.code eq 200/);
  assert.match(immutable.expression, /not any\(http\.response\.headers\.names\[\*\] wildcard "set-cookie"\)/);
  assert.match(immutable.expression, /not any\(http\.response\.headers\["content-type"\]\[\*\] wildcard "text\/html\*"\)/);
  assert.equal(immutable.action_parameters['max-age'].value, 31536000);
  assert.equal(errors.action_parameters['no-store'].operation, 'set');
  assert.equal(errors.action_parameters.immutable.operation, 'remove');
  assert.match(errors.expression, /http\.response\.code ge 300 and http\.response\.code ne 304/);
});

test('the installed app reads the live manifest and falls back to its offline copy', async () => {
  const origin = 'https://uficonnect.org';
  const handlers = new Map();
  let online = true;
  runInNewContext(fs.readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin }, addEventListener: (type, handler) => handlers.set(type, handler) },
    caches: { match: async () => new Response('offline manifest') },
    fetch: async () => {
      if (!online) throw new Error('offline');
      return new Response('live manifest');
    },
    URL,
    Response,
  });
  const request = new Request(`${origin}/manifest.json`);
  async function readManifest() {
    let response;
    handlers.get('fetch')({ request, respondWith: result => { response = result; } });
    return (await response).text();
  }
  assert.equal(await readManifest(), 'live manifest');
  online = false;
  assert.equal(await readManifest(), 'offline manifest');
});

test('sign-in resumes internal destinations without allowing external redirects or auth loops', () => {
  for (const path of ['/videos?source=reddit#resume', '/music', '/?feed=restaurants']) assert.equal(safeReturnPath(path), path);
  for (const path of [undefined, '//example.org', '/\\example.org', 'https://example.org', '/login', '/reset-password?token=private', '/\n/example.org']) assert.equal(safeReturnPath(path), '/');
});

test('browser CSP allows approved script hashes while blocking inline handlers and eval', () => {
  const html = '<script>window.approved = true;</script><script src="/app.js"></script>';
  const policy = browserSecurityPolicy(html);
  assert.match(policy, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.doesNotMatch(policy.split(';').find(value => value.trim().startsWith('script-src ')), /unsafe-inline|unsafe-eval/);
  assert.match(policy, /frame-ancestors 'self'/);
  assert.doesNotMatch(browserSecurityPolicy(html, { meta: true }), /frame-ancestors/);
  assert.match(browserSecurityPolicy('<script src="/app.js"></script>'), /script-src 'self';/);
});

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
  assert.ok(validateNewPassword('a'.repeat(11)));
  assert.equal(validateNewPassword('a'.repeat(12)), '');
  assert.equal(validateNewPassword('a'.repeat(72)), '');
  assert.ok(validateNewPassword('a'.repeat(73)));
  assert.equal(validateNewPassword('😀'.repeat(18)), '');
  assert.ok(validateNewPassword('😀'.repeat(19)));
  assert.ok(validateNewPassword('😀'.repeat(11)));
  assert.equal(validateNewPassword('😀'.repeat(12)), '');
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
