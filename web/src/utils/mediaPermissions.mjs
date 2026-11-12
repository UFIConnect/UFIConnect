export const MEDIA_PERMISSION_CHANGED = 'ufi-media-permission-changed';
export const MEDIA_PERMISSION_REQUEST = 'ufi-media-permission-request';
const sessionChoices = new Map();
const sessionOnly = new Set();
const keyFor = accountId => 'ufi:media-permissions:v1:' + encodeURIComponent(accountId || 'guest');
const valid = value => ['allow', 'block'].includes(value) ? value : 'ask';

export function readMediaPermissions(accountId) {
  const key = keyFor(accountId);
  let saved;
  try { saved = sessionOnly.has(key) ? sessionChoices.get(key) : JSON.parse(window.localStorage.getItem(key) || '{}'); }
  catch { saved = sessionChoices.get(key) || {}; }
  return { photos: valid(saved?.photos), camera: valid(saved?.camera) };
}

export function saveMediaPermission(accountId, kind, choice) {
  if (!['photos', 'camera'].includes(kind)) throw new Error('Unknown media permission');
  const key = keyFor(accountId);
  const saved = { ...readMediaPermissions(accountId), [kind]: valid(choice) };
  sessionChoices.set(key, saved);
  let persistent = true;
  try {
    const serialized = JSON.stringify(saved);
    window.localStorage.setItem(key, serialized);
    if (window.localStorage.getItem(key) !== serialized) throw new Error('Media choice was not saved.');
    sessionOnly.delete(key);
  }
  catch { persistent = false; sessionOnly.add(key); }
  window.dispatchEvent(new CustomEvent(MEDIA_PERMISSION_CHANGED, { detail: { accountId: accountId || 'guest' } }));
  return persistent;
}

// Browser capture shares the file picker's remembered choice and dialog.
// Cancellation resolves false, so a late answer cannot revive a closed camera.
export function requestMediaPermission(accountId, kind, { signal } = {}) {
  if (!['photos', 'camera'].includes(kind)) throw new Error('Unknown media permission');
  if (signal?.aborted) return Promise.resolve(false);
  if (readMediaPermissions(accountId)[kind] === 'allow') return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = allowed => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      resolve(allowed === true && !signal?.aborted && readMediaPermissions(accountId)[kind] === 'allow');
    };
    const cancel = () => finish(false);
    signal?.addEventListener('abort', cancel, { once: true });
    const event = new CustomEvent(MEDIA_PERMISSION_REQUEST, { cancelable: true,
      detail: { accountId: accountId || 'guest', kind, signal, respond: finish, opener: document.activeElement } });
    window.dispatchEvent(event);
    // Fail closed if the app's permission controller is not mounted.
    if (!event.defaultPrevented) finish(false);
  });
}
