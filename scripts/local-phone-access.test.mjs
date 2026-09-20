import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createPhoneGateway } from './local-phone-access.mjs';

async function setup(t, kind = 'office') {
  const seen = [];
  const upstream = createServer((req, res) => { seen.push({ url: req.url, headers: req.headers }); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${upstream.address().port}`;
  const gateway = createPhoneGateway({ target, code: 'test-phone-code', kind, phoneStatus: () => ({ previewUrl: 'https://preview.trycloudflare.com', code: 'must-not-leak' }) });
  const origin = `https://${kind}.trycloudflare.com`;
  gateway.setOrigin(origin);
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { gateway.server.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([gateway.server, upstream].map(server => new Promise(resolve => server.close(resolve)))); });
  const request = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: gateway.server.address().port, path: url, method, headers: { Host: new URL(origin).host, ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject); req.end(body);
  });
  const pair = (code = 'test-phone-code') => request('/__phone/pair', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `code=${code}` });
  return { request, pair, origin, seen, target };
}

test('phone gateway requires pairing before exposing code or local endpoints', async t => {
  const { request, pair, seen } = await setup(t);
  const landing = await request('/');
  assert.equal(landing.status, 200); assert.ok(landing.text.includes('Connect your phone'));
  assert.equal(landing.headers['referrer-policy'], 'same-origin', 'Browser form posts retain the Origin required for pairing');
  assert.ok(!landing.text.includes('test-phone-code'));
  assert.equal((await request('/src/App.jsx')).status, 401);
  assert.equal((await request('/__local-web/files')).status, 401);
  assert.equal((await pair('wrong')).status, 403);
  assert.equal(seen.length, 0);
  const paired = await pair();
  assert.equal(paired.status, 303);
  assert.match(paired.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
});

test('paired requests preserve local origin guards and reject hostile origins and filesystem URLs', async t => {
  const { request, pair, origin, seen, target } = await setup(t);
  const cookie = (await pair()).headers['set-cookie'][0].split(';')[0];
  assert.equal((await request('/__local-web/file?path=web/src/App.jsx', { method: 'PUT', headers: { Cookie: cookie, Origin: origin, 'X-Local-Web-Editor': '1' }, body: '{}' })).status, 200);
  assert.equal(seen[0].headers.origin, target);
  assert.equal(seen[0].headers['x-local-web-editor'], '1');
  assert.ok(!seen[0].headers.cookie.includes('ufi_local_phone'));
  assert.equal((await request('/__local-web/file', { method: 'PUT', headers: { Cookie: cookie, Origin: 'https://hostile.example' } })).status, 403);
  assert.equal((await request('/__local-web/file', { method: 'PUT', headers: { Cookie: cookie } })).status, 403);
  assert.equal((await request('/@fs/secret', { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await request('//hostile.example/file', { headers: { Cookie: cookie } })).status, 400);
  assert.equal((await request('/__local-web/phone', { method: 'POST', headers: { Cookie: cookie, Origin: origin } })).status, 403);
  const status = JSON.parse((await request('/__local-web/status', { headers: { Cookie: cookie } })).text);
  assert.equal(status.previewUrl, 'https://preview.trycloudflare.com');
  assert.equal(status.phone.remote, true); assert.ok(!JSON.stringify(status).includes('must-not-leak'));
  await request('/__phone/disconnect', { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
  assert.equal((await request('/__local-web/files', { headers: { Cookie: cookie } })).status, 401);
});

test('website phone preview cannot reuse editor cookies or access file editing endpoints', async t => {
  const office = await setup(t), web = await setup(t, 'web');
  const officeCookie = (await office.pair()).headers['set-cookie'][0].split(';')[0];
  assert.equal((await web.request('/src/App.jsx', { headers: { Cookie: officeCookie } })).status, 401);
  const webCookie = (await web.pair()).headers['set-cookie'][0].split(';')[0];
  assert.equal((await web.request('/src/App.jsx', { headers: { Cookie: webCookie } })).status, 200);
  assert.equal((await web.request('/__local-web/files', { headers: { Cookie: webCookie } })).status, 404);
});
