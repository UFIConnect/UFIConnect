// Vault routes never participate in page counts or optional diagnostics.
// This contains route state only; it never reads Vault storage or form fields.
const listeners = new Set();
let routeSuppressed = false;

export function isPrivateTelemetryPath(value) {
  if (typeof value !== 'string') return false;
  let path = value.split(/[?#]/, 1)[0];
  try { path = decodeURIComponent(path); } catch { /* Keep malformed input literal. */ }
  return /^(?:\/UFIConnect)?\/(?:vault|auth|oauth)(?:\/|$)/i.test(path);
}

export function telemetrySuppressed(path) {
  return routeSuppressed || isPrivateTelemetryPath(path)
    || isPrivateTelemetryPath(globalThis.location?.pathname);
}

export function setTelemetryRoute(path) {
  const next = isPrivateTelemetryPath(path);
  if (next === routeSuppressed) return;
  routeSuppressed = next;
  listeners.forEach(listener => listener(next));
}

export function subscribeTelemetryPrivacy(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
