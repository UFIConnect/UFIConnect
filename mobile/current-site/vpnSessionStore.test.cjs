const test = require('node:test');
const assert = require('node:assert/strict');
const { createVpnSessionStore } = require('./vpnSessionStore.cjs');

test('Android account replacement stops the previous tunnel before persisting new credentials', async () => {
  const calls = [];
  const store = createVpnSessionStore({ platform: 'android',
    store: { read: async () => 'first', write: async token => calls.push(['write', token]), clear: async () => calls.push(['clear']) },
    disconnect: async token => calls.push(['disconnect', token]),
  });
  assert.equal(await store.read(), 'first');
  await store.write('second');
  await store.clear();
  assert.deepEqual(calls, [['disconnect', 'first'], ['write', 'second'], ['disconnect', 'second'], ['clear']]);
});

test('Android sign-out still clears secure credentials when tunnel cleanup fails', async () => {
  let cleared = false;
  const store = createVpnSessionStore({ platform: 'android',
    store: { read: async () => 'first', write: async () => {}, clear: async () => { cleared = true; } },
    disconnect: async () => { throw new Error('Sensitive native diagnostic'); },
  });
  await store.read();
  await assert.rejects(store.clear(), error => /Device sign-out needs attention/.test(error.message) && !error.message.includes('Sensitive'));
  assert.equal(cleared, true);
});

test('an old Android tunnel cannot carry into a new account when disconnect fails', async () => {
  let writes = 0;
  const store = createVpnSessionStore({ platform: 'android',
    store: { read: async () => 'first', write: async () => writes++, clear: async () => {} },
    disconnect: async () => { throw new Error('Disconnect unavailable'); },
  });
  await store.read();
  await assert.rejects(store.write('second'));
  assert.equal(writes, 0);
});

test('Android without a saved session stops a stale tunnel; iOS store remains unchanged', async () => {
  const calls = [];
  const original = { read: async () => null };
  const options = { store: original, disconnect: async token => calls.push(token) };
  const android = createVpnSessionStore({ ...options, platform: 'android' });
  assert.equal(await android.read(), null);
  assert.deepEqual(calls, [null]);
  assert.equal(createVpnSessionStore({ ...options, platform: 'ios' }), original);
});
