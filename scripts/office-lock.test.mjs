import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeClient } from '../office/src/office-runtime.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function fixture({ prompt = async () => 'valid-access', fetcher, lockStorage } = {}) {
  const calls = [], changes = [];
  const client = createOfficeClient({ pageUrl: 'https://office.example.test', serviceBases: [{ service: 'api', url: 'https://api.example.test' }],
    lockStorage, prompt, storage: { removeItem: () => {} },
    fetcher: async (url, options) => { calls.push({ url, options }); return fetcher ? fetcher(url, options) : json({ server: {} }, options.headers['x-office-token'] === 'valid-access' ? 200 : 401); },
    onTokenChange: () => changes.push({ token: client.getToken(), locked: client.isLocked() }),
  });
  return { client, calls, changes };
}

test('locking removes access and blocks reads, writes and streams without reauthentication or network requests', async () => {
  let prompts = 0;
  const f = fixture({ prompt: async () => { prompts++; return 'valid-access'; } });
  assert.equal((await f.client.request('https://api.example.test/office/status')).status, 200);
  assert.equal(f.client.getToken(), 'valid-access');
  f.client.lock();
  assert.equal(f.client.getToken(), ''); assert.equal(f.client.isLocked(), true);
  const callCount = f.calls.length;
  for (const response of [await f.client.request('https://api.example.test/office/status'), await f.client.request('https://api.example.test/office/ai/tasks', { method: 'POST', body: '{}' }), await f.client.transportRequest('https://api.example.test/office/agents/stream')]) {
    assert.equal(response.status, 423); assert.match((await response.json()).error, /locked/);
  }
  assert.equal(f.calls.length, callCount); assert.equal(prompts, 1);
  assert.deepEqual(f.changes.at(-1), { token: '', locked: true });
});

test('unlock keeps the workspace locked until a fresh token passes its authenticated status check', async () => {
  const verification = deferred(), started = deferred(); let prompts = 0;
  const f = fixture({ prompt: async () => { prompts++; return 'valid-access'; }, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.example.test/office/status'); assert.equal(options.headers['x-office-token'], 'valid-access');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); started.resolve();
    return verification.promise;
  } });
  f.client.lock();
  const first = f.client.unlock(), second = f.client.unlock();
  await started.promise;
  assert.equal(f.client.isLocked(), true); assert.equal(f.client.getToken(), ''); assert.equal(prompts, 1);
  verification.resolve(json({ server: {} }));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(f.client.isLocked(), false); assert.equal(f.client.getToken(), 'valid-access');
  assert.equal(f.calls.length, 1);
});

test('failed verification and cancelled unlock leave the assistant locked and allow another explicit attempt', async () => {
  const values = ['', 'wrong-access', 'valid-access'];
  const f = fixture({ prompt: async () => values.shift() }); f.client.lock();
  assert.equal(await f.client.unlock(), false); assert.equal(f.calls.length, 0);
  await assert.rejects(f.client.unlock(), /remains locked/);
  assert.equal(f.client.isLocked(), true); assert.equal(f.client.getToken(), '');
  assert.equal(await f.client.unlock(), true); assert.equal(f.client.isLocked(), false);
});

test('a sign-in prompt opened before locking cannot restore credentials after the lock', async () => {
  const entered = deferred(), prompted = deferred();
  const f = fixture({ prompt: () => { prompted.resolve(); return entered.promise; } });
  const request = f.client.request('https://api.example.test/office/status');
  await prompted.promise; f.client.lock(); entered.resolve('valid-access');
  assert.equal((await request).status, 401);
  assert.equal(f.client.isLocked(), true); assert.equal(f.client.getToken(), '');
  assert.deepEqual(f.changes, [{ token: '', locked: true }]);
});

test('a login page or unrelated successful response cannot unlock the private workspace', async () => {
  for (const response of [new Response('<html>Sign in</html>', { status: 200 }), json({ ok: true }), json({ server: [] })]) {
    const f = fixture({ fetcher: async () => response }); f.client.lock();
    await assert.rejects(f.client.unlock(), /remains locked/);
    assert.equal(f.client.isLocked(), true); assert.equal(f.client.getToken(), '');
  }
});

test('locking during token verification invalidates the response and does not reopen the workspace', async () => {
  const verification = deferred(), started = deferred();
  const f = fixture({ fetcher: async () => { started.resolve(); return verification.promise; } });
  f.client.lock(); const unlocking = f.client.unlock(); await started.promise;
  f.client.lock(); verification.resolve(json({ server: {} }));
  await assert.rejects(unlocking, { name: 'AbortError' });
  assert.equal(f.client.isLocked(), true); assert.equal(f.client.getToken(), '');
});

test('only the lock flag survives a tab reload and verified unlock removes it', async () => {
  const persisted = new Map();
  const lockStorage = { getItem: key => persisted.get(key), setItem: (key, value) => persisted.set(key, value), removeItem: key => persisted.delete(key) };
  const first = fixture({ lockStorage }); first.client.lock();
  assert.deepEqual([...persisted], [['ufi_office_locked', '1']]);
  const reloaded = fixture({ lockStorage });
  assert.equal(reloaded.client.isLocked(), true); assert.equal(reloaded.client.getToken(), '');
  assert.equal((await reloaded.client.request('https://api.example.test/office/status')).status, 423);
  assert.equal(reloaded.calls.length, 0);
  await reloaded.client.unlock();
  assert.equal(persisted.size, 0); assert.equal(reloaded.client.getToken(), 'valid-access');
});
