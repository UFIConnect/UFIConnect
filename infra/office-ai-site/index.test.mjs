import test from 'node:test';
import assert from 'node:assert/strict';
import { createSite } from './index.mjs';
test('static proxy fixes its origin and strips credentials and query strings', async () => {
  let received;
  const site = createSite(async (url, options) => { received = { url: String(url), options }; return new Response('<html>Office</html>', { headers: { 'content-type': 'text/html', 'set-cookie': 'private=1', 'content-security-policy': "default-src 'self'" } }); });
  const response = await site.fetch(new Request('https://uficonnect.ai/?token=never-forward', { headers: { authorization: 'Bearer secret', cookie: 'secret=1', 'x-office-token': 'secret', accept: 'text/html' } }));
  assert.equal(response.status, 200); assert.equal(received.url, 'https://uficonnect-office-708r.onrender.com/');
  assert.deepEqual([...received.options.headers], [['accept', 'text/html']]);
  assert.equal(response.headers.get('set-cookie'), null); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('content-security-policy'), "default-src 'self'");
});
test('unknown hosts, API paths and mutations never reach upstream', async () => {
  let requests = 0; const site = createSite(async () => { requests++; return new Response(''); });
  for (const [url, method, status] of [['https://attacker.example/', 'GET', 404], ['https://uficonnect.ai/office/status', 'GET', 404], ['https://uficonnect.ai//attacker.example/private', 'GET', 404], ['https://uficonnect.ai/', 'POST', 405]]) assert.equal((await site.fetch(new Request(url, { method }))).status, status);
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
