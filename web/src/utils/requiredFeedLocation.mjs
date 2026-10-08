let blockedToken = null;
const listeners = new Set();
export function subscribeToRequiredFeedLocation(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function feedLocationIsRequired(token) { return Boolean(token && blockedToken === token); }
export function clearRequiredFeedLocation() {
  blockedToken = null;
  for (const listener of listeners) listener();
}
export function requireFeedLocation(token) {
  if (!token || blockedToken === token) return;
  blockedToken = token;
  for (const listener of listeners) listener();
}
export function allowFeedLocation(token) {
  if (!token || blockedToken !== token) return;
  blockedToken = null;
  for (const listener of listeners) listener();
}
