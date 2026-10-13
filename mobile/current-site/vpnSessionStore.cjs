'use strict';

// Keep Android's native tunnel tied to the same secure session as the shared
// interface. iOS keeps its existing external WireGuard lifecycle.
function createVpnSessionStore({ store, platform, disconnect }) {
  if (platform !== 'android') return store;
  let savedToken = null;
  return {
    async read() {
      savedToken = await store.read();
      if (!savedToken) await disconnect(null);
      return savedToken;
    },
    async write(token) {
      if (savedToken !== token) await disconnect(savedToken);
      await store.write(token);
      savedToken = token;
    },
    async clear() {
      const previous = savedToken;
      savedToken = null;
      const outcomes = await Promise.allSettled([disconnect(previous), store.clear()]);
      if (outcomes.some(result => result.status === 'rejected')) throw new Error('Device sign-out needs attention. Check device VPN settings and try again.');
    },
  };
}

module.exports = { createVpnSessionStore };
