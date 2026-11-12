import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as createViteServer } from '../web/node_modules/vite/dist/node/index.js';

test('a failed source request only clears a session after the canonical API rejects it', async t => {
  let sessionStatus = 200;
  const checks = [];
  const api = createServer((request, response) => {
    if (request.url === '/auth/session') {
      checks.push(request.headers.authorization);
      response.writeHead(sessionStatus, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify({ token: 'member-session', profile: { id: 'member' } }));
    }
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'The selected source is unavailable.' }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => { api.closeAllConnections(); api.close(); });
  const origin = `http://127.0.0.1:${api.address().port}`;
  globalThis.window = Object.assign(new EventTarget(), { location: { origin }, setTimeout });
  t.after(() => { delete globalThis.window; });
  const vite = await createViteServer({
    root: new URL('../web', import.meta.url).pathname, configFile: false, envDir: false, appType: 'custom',
    server: { middlewareMode: true, ws: false, watch: null },
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(origin), 'import.meta.env.VITE_API_FALLBACK_URL': '""' },
  });
  t.after(() => vite.close());
  const { default: client } = await vite.ssrLoadModule('/src/api/client.js');
  const { getAccessToken, setAccessToken, subscribeToSession } = await vite.ssrLoadModule('/src/auth/session.js');
  setAccessToken('member-session');
  const authCheck = async expected => {
    await assert.rejects(client.get('/source/reddit'), error => error.response?.status === 401);
    for (let attempt = 0; checks.length < expected && attempt < 50; attempt++) await delay(10);
    assert.equal(checks.length, expected);
  };
  await authCheck(1);
  assert.equal(getAccessToken(), 'member-session');

  sessionStatus = 401;
  // The source check runs in the background. Wait for its previous HTTP
  // response before exercising a second, now genuinely revoked session.
  await delay(50);
  const cleared = new Promise(resolve => {
    const unsubscribe = subscribeToSession(token => { if (!token) { unsubscribe(); resolve(); } });
  });
  await authCheck(2);
  await Promise.race([cleared, delay(1000).then(() => assert.fail('Revoked session was not cleared'))]);
  assert.equal(getAccessToken(), null);
  assert.deepEqual(checks, ['Bearer member-session', 'Bearer member-session']);
});
