// Bearer credentials and member caches live only in this page's memory.
// The API may restore the bearer from its HttpOnly session cookie; JavaScript
// never writes credentials to localStorage, sessionStorage, or Cache Storage.
let accessToken = null;
const sessionValues = new Map();
const listeners = new Set();

export function getAccessToken() { return accessToken; }
export function setAccessToken(value) {
  accessToken = value || null;
  listeners.forEach((listener) => listener(accessToken));
}
export function subscribeToSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const privateSessionStorage = {
  getItem(key) { return sessionValues.get(key) ?? null; },
  setItem(key, value) { sessionValues.set(key, String(value)); },
  removeItem(key) { sessionValues.delete(key); },
};

export function clearLegacyPrivateStorage() {
  if (typeof window === 'undefined') return;
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[storageName];
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key === 'pc_token' || key?.startsWith('ufi_') || key?.startsWith('@@auth0spajs@@')) {
          storage.removeItem(key);
        }
      }
    } catch { /* Storage may be unavailable in private browsing. */ }
  }
}

export function clearSession() {
  sessionValues.clear();
  clearLegacyPrivateStorage();
  setAccessToken(null);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ufi-session-cleared'));
}

// Runs before the provider mounts, including when upgrading an existing tab.
clearLegacyPrivateStorage();
