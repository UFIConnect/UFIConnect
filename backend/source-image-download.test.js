const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createSourceImageDownloader, MAX_SOURCE_IMAGE_BYTES } = require('./source-image-download');
const url = 'https://i.redd.it/synthetic-image.png';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const allowed = raw => new URL(raw).hostname === 'i.redd.it';
function fixture({ status = 200, headers = { 'content-type': 'image/png' }, chunks = [png], stayOpen = false, requestError = false } = {}) {
  const response = new PassThrough(); response.statusCode = status; response.headers = headers;
  const request = new EventEmitter(); request.destroyed = false; request.destroy = () => { request.destroyed = true; };
  const get = (target, options, callback) => {
    assert.equal(target.href, url); assert.equal(options.headers['Accept-Encoding'], 'identity');
    queueMicrotask(() => {
      if (requestError) { request.emit('error', new Error('Private upstream error')); return; }
      callback(response);
      for (const chunk of chunks) { if (response.destroyed) break; response.write(chunk); }
      if (!stayOpen && !response.destroyed) response.end();
    });
    return request;
  };
  return { download: createSourceImageDownloader({ isAllowedUrl: allowed, get, timeoutMs: 20 }), response, request, get };
}

test('provider image downloads preserve validated image bytes and accurate extensions', async () => {
  const { download, request } = fixture({ headers: { 'content-type': 'image/png; charset=binary', 'content-length': String(png.length) } });
  const image = await download(url);
  assert.deepEqual(image.body, png); assert.equal(image.mimeType, 'image/png'); assert.equal(image.extension, 'png');
  assert.equal(request.destroyed, false);
});

test('image downloads reject arbitrary URLs before connecting and never follow redirects', async () => {
  let requests = 0;
  const download = createSourceImageDownloader({ isAllowedUrl: allowed, get: () => { requests++; throw new Error(); } });
  for (const raw of ['http://i.redd.it/image.png', 'https://127.0.0.1/image.png', 'https://[::1]/image.png', 'https://localhost/image.png', 'https://i.redd.it.attacker.invalid/image.png', 'https://user:secret@i.redd.it/image.png', 'https://i.redd.it:8443/image.png']) {
    await assert.rejects(download(raw), error => error.status === 400);
  }
  assert.equal(requests, 0);
  for (const status of [301, 302, 307, 404, 500]) {
    const value = fixture({ status, headers: { 'content-type': 'image/png', location: 'http://127.0.0.1/private' }, stayOpen: true });
    await assert.rejects(value.download(url), error => error.status === 502);
    assert.equal(value.response.destroyed, true); assert.equal(value.request.destroyed, true);
  }
});

test('declared and streamed image sizes are capped and rejected streams release their sockets', async () => {
  for (const options of [
    { headers: { 'content-type': 'image/png', 'content-length': String(MAX_SOURCE_IMAGE_BYTES + 1) }, stayOpen: true },
    { chunks: [png, Buffer.alloc(MAX_SOURCE_IMAGE_BYTES)], stayOpen: true },
  ]) {
    const value = fixture(options);
    await assert.rejects(value.download(url), error => error.status === 413);
    assert.equal(value.response.destroyed, true); assert.equal(value.request.destroyed, true);
  }
  for (const options of [
    { headers: { 'content-type': 'text/html' }, chunks: [Buffer.from('<html>content</html>')] },
    { headers: { 'content-type': 'image/png' }, chunks: [Buffer.from('<html>spoofed PNG</html>')] },
    { headers: { 'content-type': 'image/svg+xml' } },
    { headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' } },
    { headers: { 'content-type': 'image/png', 'content-length': '5' } },
  ]) await assert.rejects(fixture(options).download(url), error => error.status === 502);
});

test('download deadlines and client cancellation abort requests without exposing upstream errors', async () => {
  const hung = fixture({ chunks: [], stayOpen: true });
  await assert.rejects(hung.download(url), error => error.status === 504);
  assert.equal(hung.response.destroyed, true); assert.equal(hung.request.destroyed, true);
  const pending = fixture({ chunks: [], stayOpen: true }), controller = new AbortController();
  const result = pending.download(url, { signal: controller.signal });
  queueMicrotask(() => controller.abort());
  await assert.rejects(result, error => error.status === 499);
  assert.equal(pending.request.destroyed, true); assert.equal(pending.response.destroyed, true);
  await assert.rejects(fixture({ requestError: true }).download(url), error => error.status === 502 && !error.message.includes('Private upstream'));
});

test('the real Command Center route requires paid authentication and serves only bounded provider images', async t => {
  const { createAppHarness, member } = require('./test-support/app-harness');
  let next = {}, active, requests = 0;
  const app = await createAppHarness({ modules: {
    './source-image-download': { createSourceImageDownloader: options => createSourceImageDownloader({ ...options, timeoutMs: 30,
      get: (...args) => { requests++; active = fixture(next); return active.get(...args); } }) },
  } });
  t.after(() => app.close());
  const paid = 'source-image-paid', free = 'source-image-free';
  app.seedUser(member(paid, { plan: 'pro' })); app.seedUser(member(free));
  const route = value => '/command-center/your-content/download?' + new URLSearchParams({ url: value });
  assert.equal((await app.request(route(url))).status, 401);
  assert.equal((await app.request(route(url), { userId: free })).status, 403);
  for (const raw of ['https://127.0.0.1/private', 'https://i.redd.it.evil.invalid/image', 'https://user:secret@i.redd.it/image', 'https://cdn.dribbble.com/arbitrary/image.png']) {
    assert.equal((await app.request(route(raw), { userId: paid })).status, 400);
  }
  assert.equal(requests, 0, 'Authorization and the exact provider policy run before network access');
  const result = await fetch(app.base + route(url), { headers: { authorization: `Bearer ${app.token(paid)}` } });
  assert.equal(result.status, 200); assert.deepEqual(Buffer.from(await result.arrayBuffer()), png);
  assert.equal(result.headers.get('content-type'), 'application/octet-stream');
  assert.equal(result.headers.get('content-disposition'), 'attachment; filename="content.png"');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  next = { status: 302, headers: { 'content-type': 'image/png', location: 'http://127.0.0.1/private' }, stayOpen: true };
  assert.equal((await app.request(route(url), { userId: paid })).status, 502); assert.equal(active.request.destroyed, true);
  next = { chunks: [png, Buffer.alloc(MAX_SOURCE_IMAGE_BYTES)], stayOpen: true };
  assert.equal((await app.request(route(url), { userId: paid })).status, 413); assert.equal(active.response.destroyed, true);
  next = { chunks: [], stayOpen: true };
  assert.equal((await app.request(route(url), { userId: paid })).status, 504); assert.equal(active.request.destroyed, true);
});
