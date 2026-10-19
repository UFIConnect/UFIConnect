export const MEDIA_PERMISSION_CHANGED = 'ufi-media-permission-changed';
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
  try { window.localStorage.setItem(key, JSON.stringify(saved)); sessionOnly.delete(key); }
  catch { persistent = false; sessionOnly.add(key); }
  window.dispatchEvent(new CustomEvent(MEDIA_PERMISSION_CHANGED, { detail: { accountId: accountId || 'guest' } }));
  return persistent;
}
