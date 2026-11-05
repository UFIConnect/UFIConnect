import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSite } from './index.mjs';

test('root deployment combines Office assets with the tested API worker', async () => {
  const config = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(new URL('../../' + config.main, import.meta.url).href, new URL('./index.mjs', import.meta.url).href);
  assert.equal(config.assets.directory, './office/dist');
  assert.deepEqual(config.assets.run_worker_first, ['/api/v1/*']);
  assert.equal(config.assets.not_found_handling, 'none');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: 'uficonnect.ai', custom_domain: true }]);
});
test('static proxy fixes its origin and strips credentials and query strings', async () => {
  let received;
  const site = createSite(async (url, options) => { received = { url: String(url), options }; return new Response('<html>Office</html>', { headers: { 'content-type': 'text/html', 'set-cookie': 'private=1', 'content-security-policy': "default-src 'self'" } }); });
  const response = await site.fetch(new Request('https://uficonnect.ai/?token=never-forward', { headers: { authorization: 'Bearer secret', cookie: 'secret=1', 'x-office-token': 'secret', accept: 'text/html' } }));
  assert.equal(response.status, 200); assert.equal(received.url, 'https://uficonnect-office-708r.onrender.com/');
  assert.deepEqual([...received.options.headers], [['accept', 'text/html']]);
  assert.equal(response.headers.get('set-cookie'), null); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('content-security-policy'), "default-src 'self'");
});
test('unknown hosts, unsupported API paths and mutations never reach upstream', async () => {
  let requests = 0; const site = createSite(async () => { requests++; return new Response(''); });
  for (const [url, method, status] of [['https://attacker.example/', 'GET', 404], ['https://uficonnect.ai/office/status', 'GET', 404], ['https://uficonnect.ai//attacker.example/private', 'GET', 404], ['https://uficonnect.ai/', 'POST', 405], ['https://uficonnect.ai/api/v1/topics', 'POST', 405], ['https://uficonnect.ai/api/v1/feed', 'DELETE', 405], ['https://uficonnect.ai/api/v1/users', 'GET', 404], ['https://uficonnect.ai/api/v1/feed/extra', 'GET', 404], ['https://uficonnect.ai/api/v1//attacker.example/feed', 'GET', 404]]) assert.equal((await site.fetch(new Request(url, { method }))).status, status);
  assert.equal(requests, 0);
});
test('asset paths cannot replace the configured upstream host', async () => {
  let actual;
  const site = createSite(async url => { actual = String(url); return new Response('javascript', { headers: { 'cache-control': 'public, max-age=31536000, immutable' } }); });
  const response = await site.fetch(new Request('https://uficonnect.ai/assets//attacker.example/app.js?secret=never-forward'));
  assert.equal(actual, 'https://uficonnect-office-708r.onrender.com/assets//attacker.example/app.js');
  assert.match(response.headers.get('cache-control'), /immutable/);
});
test('HTTPS and upstream failure handling stay on the official host', async () => {
  const site = createSite(async () => Response.redirect('https://unexpected.example', 302));
  const redirect = await site.fetch(new Request('http://uficonnect.ai/'));
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), 'https://uficonnect.ai/');
  assert.equal((await site.fetch(new Request('https://uficonnect.ai/'))).status, 502);
});

test('API proxy forwards only the bearer credential and allowed feed parameters to its fixed origin', async () => {
  let received;
  const site = createSite(async (url, options) => {
    received = { url: String(url), options };
    return Response.json({ posts: [] }, { headers: {
      'set-cookie': 'upstream=private', 'access-control-allow-origin': '*',
      'access-control-allow-credentials': 'true', 'cache-control': 'public, max-age=3600',
      'cdn-cache-control': 'public, max-age=3600', 'cloudflare-cdn-cache-control': 'public, max-age=3600',
    } });
  });
  const response = await site.fetch(new Request('https://uficonnect.ai/api/v1/feed?limit=20&cursor=abc%2B123&token=never-forward&url=https://attacker.example&limit=999', {
    headers: { authorization: 'Bearer ufi_live_fixture', accept: 'application/json', cookie: 'secret=1', 'x-office-token': 'private', range: 'bytes=0-20', 'if-none-match': 'private', 'x-forwarded-host': 'attacker.example' },
  }));
  assert.equal(received.url, 'https://api.uficonnect.org/api/v1/feed?limit=20&cursor=abc%2B123');
  assert.deepEqual([...received.options.headers], [['accept', 'application/json'], ['authorization', 'Bearer ufi_live_fixture']]);
  assert.equal(received.options.redirect, 'manual');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { posts: [] });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  for (const name of ['set-cookie', 'access-control-allow-origin', 'access-control-allow-credentials', 'cdn-cache-control', 'cloudflare-cdn-cache-control']) assert.equal(response.headers.get(name), null, name);
});

test('topics strip every query parameter and HEAD returns no response body', async () => {
  let received;
  const site = createSite(async (url, options) => {
    received = { url: String(url), options };
    return Response.json({ topics: [] }, { headers: { 'ratelimit-limit': '120' } });
  });
  const response = await site.fetch(new Request('https://uficonnect.ai/api/v1/topics?limit=20&cursor=abc&api_key=never-forward', { method: 'HEAD', headers: { authorization: 'Bearer ufi_live_fixture' } }));
  assert.equal(received.url, 'https://api.uficonnect.org/api/v1/topics');
  assert.equal(received.options.method, 'HEAD');
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('ratelimit-limit'), '120');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('API authentication and rate limit errors remain intact without caching', async () => {
  for (const status of [401, 403, 429]) {
    let headers;
    const site = createSite(async (_url, options) => {
      headers = options.headers;
      return Response.json({ error: 'fixture error' }, { status, headers: { 'retry-after': '60', 'www-authenticate': 'Bearer' } });
    });
    const response = await site.fetch(new Request('https://uficonnect.ai/api/v1/topics'));
    assert.equal(headers.get('authorization'), null);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: 'fixture error' });
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

test('API redirects and fetch failures fail closed at the branded origin', async () => {
  let redirected = false;
  const redirecting = createSite(async (_url, options) => {
    redirected = options.redirect !== 'manual';
    return Response.redirect('https://attacker.example/private', 307);
  });
  const response = await redirecting.fetch(new Request('https://uficonnect.ai/api/v1/feed', { headers: { authorization: 'Bearer ufi_live_fixture' } }));
  assert.equal(response.status, 502);
  assert.equal(redirected, false);
  assert.equal(response.headers.get('location'), null);
  assert.match(await response.text(), /API returned an unexpected redirect/);
  const failing = createSite(async () => { throw Error('private upstream detail'); });
  const unavailable = await failing.fetch(new Request('https://uficonnect.ai/api/v1/topics'));
  assert.equal(unavailable.status, 502);
  assert.match(await unavailable.text(), /API is temporarily unavailable/);
});

test('generation endpoints forward bounded JSON only, to the fixed API origin', async () => {
  for (const endpoint of ['chat/completions', 'images/generations', 'videos/generations', 'content/generations']) {
    let received;
    const site = createSite(async (url, options) => { received = { url: String(url), options }; return Response.json({ id: 'generated' }, { status: 202 }); });
    const body = JSON.stringify({ prompt: 'A garden at dawn' });
    const response = await site.fetch(new Request(`https://uficonnect.ai/api/v1/${endpoint}?token=secret&url=https://attacker.example`, {
      method: 'POST', body, headers: { 'content-type': 'application/json; charset=utf-8', authorization: 'Bearer ufi_live_fixture', cookie: 'secret=1', 'x-office-token': 'secret', 'x-provider-key': 'secret' },
    }));
    assert.equal(received.url, `https://api.uficonnect.org/api/v1/${endpoint}`);
    assert.equal(received.options.method, 'POST');
    assert.equal(new TextDecoder().decode(received.options.body), body);
    assert.deepEqual([...received.options.headers], [['authorization', 'Bearer ufi_live_fixture'], ['content-type', 'application/json; charset=utf-8']]);
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

test('generation rejects unsupported methods, content types and oversized streamed bodies before fetching', async () => {
  let requests = 0;
  const site = createSite(async () => { requests++; return Response.json({}); });
  for (const method of ['GET', 'HEAD', 'DELETE', 'PATCH']) assert.equal((await site.fetch(new Request('https://uficonnect.ai/api/v1/images/generations', { method }))).status, 405);
  assert.equal((await site.fetch(new Request('https://uficonnect.ai/api/v1/images/generations', { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await site.fetch(new Request('https://uficonnect.ai/api/v1/images/generations', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'content-length': '65537' } }))).status, 413);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(30000)); controller.close(); } });
  assert.equal((await site.fetch(new Request('https://uficonnect.ai/api/v1/images/generations', { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/json' } }))).status, 413);
  for (const body of ['{', '[]', 'null', 'true']) assert.equal((await site.fetch(new Request('https://uficonnect.ai/api/v1/images/generations', { method: 'POST', body, headers: { 'content-type': 'application/json' } }))).status, 400);
  assert.equal(requests, 0);
});

test('video status accepts safe job identifiers without forwarding query secrets', async () => {
  let received;
  const site = createSite(async (url, options) => { received = { url: String(url), options }; return Response.json({ status: 'queued' }); });
  for (const id of ['2abd5c11-0f3d-4c6d-ba20-235fc9b8e8b7', '2abd5c11-0f3d-4c6d-ba20-235fc9b8e8b7/content']) {
    assert.equal((await site.fetch(new Request(`https://uficonnect.ai/api/v1/videos/${id}?ticket=never-forward`, { headers: { authorization: 'Bearer ufi_live_fixture' } }))).status, 200);
    assert.equal(received.url, `https://api.uficonnect.org/api/v1/videos/${id}`);
    assert.equal(received.options.headers.get('authorization'), 'Bearer ufi_live_fixture');
  }
  for (const suffix of ['video_job123', 'video_x/content', 'video_x%2fprivate', 'video_', 'unexpected']) assert.equal((await site.fetch(new Request('https://uficonnect.ai/api/v1/videos/' + suffix))).status, 404);
});

test('post publishing and editing use only their exact methods and UUID routes', async () => {
  const calls = [];
  const site = createSite(async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ post: { id: 'fixture' } }); });
  const id = '2abd5c11-0f3d-4c6d-ba20-235fc9b8e8b7';
  for (const [path, method] of [['/api/v1/posts', 'POST'], ['/api/v1/posts/' + id, 'PATCH']]) {
    const response = await site.fetch(new Request('https://uficonnect.ai' + path + '?token=secret', { method, body: JSON.stringify({ content: 'A public update' }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ufi_live_fixture', cookie: 'secret=1', 'x-office-token': 'secret' } }));
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).url, 'https://api.uficonnect.org' + path);
    assert.deepEqual([...calls.at(-1).options.headers], [['authorization', 'Bearer ufi_live_fixture'], ['content-type', 'application/json']]);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(calls.at(-1).options.body)), { content: 'A public update' });
  }
  const count = calls.length;
  for (const [path, method] of [['/api/v1/posts', 'GET'], ['/api/v1/posts/' + id, 'DELETE'], ['/api/v1/posts/' + id, 'POST'], ['/api/v1/posts/not-a-uuid', 'GET']]) assert.ok((await site.fetch(new Request('https://uficonnect.ai' + path, { method }))).status >= 400);
  assert.equal(calls.length, count);
});
