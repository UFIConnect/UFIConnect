const SESSION_KEY = 'uficonnect.session';

// Dependency injection keeps the storage guarantees testable without a device.
function createSessionStorage({ platform, secureStore, legacyStorage }) {
  const options = { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

  async function read() {
    // Discard old unencrypted sessions. Users sign in again to establish a new one.
    await legacyStorage.removeItem('token');
    if (platform === 'web') return null;
    return secureStore.getItemAsync(SESSION_KEY, options);
  }

  async function write(token) {
    if (typeof token !== 'string' || !token) throw new Error('Missing session token.');
    await legacyStorage.removeItem('token');
    // The Expo web preview holds the token in React memory for this page only.
    if (platform !== 'web') await secureStore.setItemAsync(SESSION_KEY, token, options);
  }

  async function clear() {
    // Attempt both removals even when one storage provider is unavailable.
    const operations = [legacyStorage.removeItem('token')];
    if (platform !== 'web') operations.push(secureStore.deleteItemAsync(SESSION_KEY, options));
    const results = await Promise.allSettled(operations);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('Could not clear saved sign-in data on this device.');
    }
  }

  return { read, write, clear };
}

module.exports = { createSessionStorage };
