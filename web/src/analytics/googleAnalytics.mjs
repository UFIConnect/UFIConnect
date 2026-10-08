// This module never loads a Google script in the application document. Only
// fixed page categories cross into a sandbox on a different origin.
import { isPrivateTelemetryPath, setTelemetryRoute } from './telemetryPrivacy.mjs';
import categoryCatalog from '../../../shared/analytics-categories.json' with { type: 'json' };
export const GA_MEASUREMENT_ID = 'G-F68DRQ6CC5';
export const ANALYTICS_CONSENT_KEY = 'uficonnect.analytics.consent.v1';
export const ANALYTICS_CLIENT_KEY = 'uficonnect.analytics.client.v1';
export const ANALYTICS_CLIENT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export const PAGE_CATEGORIES = Object.freeze(Object.fromEntries(Object.entries(categoryCatalog).map(([category, page]) => [category, Object.freeze(page)])));

const exactPages = new Map(Object.values(PAGE_CATEGORIES).map(page => [page.path, page]));
const dynamicPages = [
  [/^\/groups\/[^/]+\/?$/, 'group'], [/^\/opportunities\/[^/]+\/?$/, 'opportunity'],
  [/^\/messages\/[^/]+\/?$/, 'conversation'], [/^\/p\/[^/]+\/?$/, 'post'], [/^\/u\/[^/]+\/?$/, 'member'],
  [/^\/centers\/[^/]+\/?$/, 'workspace_center'],
];

export function canonicalPage(value) {
  // Input is only used to select a constant. It is never returned or forwarded.
  const rawPath = typeof value === 'string' ? value.split(/[?#]/, 1)[0] : '';
  const path = rawPath === '/' ? '/' : rawPath.replace(/\/$/, '');
  if (exactPages.has(path)) return exactPages.get(path);
  if (path === '/global-scroll') return PAGE_CATEGORIES.global;
  if (path === '/hq' || path === '/agents') return PAGE_CATEGORIES.command_center;
  if (path === '/how-office-works') return PAGE_CATEGORIES.how_it_works;
  return PAGE_CATEGORIES[dynamicPages.find(([pattern]) => pattern.test(path))?.[1] || 'other'];
}

function randomClientId(window) {
  // This random analytics identifier never derives from an account or device ID.
  if (!window.crypto?.getRandomValues) return null;
  const bytes = window.crypto.getRandomValues(new Uint32Array(4));
  return Array.from(bytes, value => value.toString(16).padStart(8, '0')).join('');
}

export function createAnalyticsController({ window, document, bridgeUrl }) {
  let consent = null;
  let privacySignal = window.navigator?.globalPrivacyControl === true;
  let persistenceError = null;
  const storageErrorMessage = 'Google Analytics is off. This browser could not save your choice or clear stored analytics data. Check your choice after reloading.';
  function storageWritable() {
    // Merely rewriting the existing grant cannot prove that storage changed:
    // some restricted storage implementations silently ignore writes. Probe
    // with an alternating constant, verify it, then remove it. No identifier.
    const key = `${ANALYTICS_CONSENT_KEY}.writable`;
    try {
      const storage = window.localStorage;
      const value = storage.getItem(key) === '1' ? '2' : '1';
      storage.setItem(key, value);
      if (storage.getItem(key) !== value) return false;
      storage.removeItem(key);
      return storage.getItem(key) === null;
    } catch { return false; }
  }
  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    if (value === 'denied') consent = value;
    if (value === 'granted') {
      // A readable old grant must not resurrect collection when a previous
      // opt-out could not overwrite/remove it because storage was blocked.
      consent = storageWritable() ? 'granted' : 'denied';
      if (consent === 'denied') persistenceError = storageErrorMessage;
    }
  } catch { persistenceError = storageErrorMessage; }
  let frame = null;
  let ready = false;
  let clientId = null;
  let latest = null;
  let visit = 0;
  let lastSent = 0;
  const pending = [];
  let disposed = false;
  const listeners = new Set();
  const retiringFrames = new Set();
  const target = new URL(bridgeUrl, window.location.origin);
  const pageOrigin = new URL(window.location.origin);
  const isLoopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const secure = target.protocol === 'https:' || (target.protocol === 'http:' && isLoopback(target) && isLoopback(pageOrigin));
  if (!secure || target.origin === pageOrigin.origin || target.search || target.hash || target.username || target.password
      || target.pathname !== '/analytics-bridge.html') throw new Error('Analytics bridge must use a secure, separate origin and a static path.');

  function removeFrame(targetFrame) {
    targetFrame.remove();
    retiringFrames.delete(targetFrame);
    activate();
  }

  function stop({ clearIdentifier = true } = {}) {
    // The bridge disables collection and deletes its scoped analytics cookies
    // before acknowledging. A blocked bridge is removed after a short timeout.
    if (frame) {
      const previousFrame = frame;
      if (clearIdentifier && ready) {
        retiringFrames.add(previousFrame);
        previousFrame.contentWindow.postMessage({ type: 'ufi-analytics-stop', version: 1 }, target.origin);
        window.setTimeout(() => removeFrame(previousFrame), 500);
      } else previousFrame.remove();
    }
    frame = null;
    ready = false;
    clientId = null;
    lastSent = 0;
    pending.length = 0;
    if (clearIdentifier) {
      try {
        window.localStorage.removeItem(ANALYTICS_CLIENT_KEY);
        if (window.localStorage.getItem(ANALYTICS_CLIENT_KEY) !== null) persistenceError = storageErrorMessage;
      } catch { persistenceError = storageErrorMessage; }
    }
  }

  function suspendPrivatePage() {
    // Remove the bridge immediately, including a frame awaiting opt-out ack.
    // Preserve the user's choice; entering Vault is not a consent change.
    latest = null;
    stop({ clearIdentifier: false });
    retiringFrames.forEach(previousFrame => previousFrame.remove());
    retiringFrames.clear();
  }

  function consentedClientId() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(ANALYTICS_CLIENT_KEY));
      if (/^[a-f0-9]{32}$/.test(stored?.id) && Number.isFinite(stored.expiresAt) && stored.expiresAt > Date.now()
          && stored.expiresAt <= Date.now() + ANALYTICS_CLIENT_LIFETIME_MS) return stored.id;
    } catch {}
    const id = randomClientId(window);
    if (id) { try { window.localStorage.setItem(ANALYTICS_CLIENT_KEY, JSON.stringify({ id, expiresAt: Date.now() + ANALYTICS_CLIENT_LIFETIME_MS })); } catch {} }
    return id;
  }

  function queueLatest() {
    if (!latest || latest.visit === lastSent || pending.at(-1)?.visit === latest.visit) return;
    // Preserve consented SPA navigation while the isolated document loads.
    // The queue contains constants, not source URLs; it cannot grow unbounded
    // when a content blocker or unavailable analytics host delays readiness.
    pending.push({ category: latest.page.category, visit: latest.visit });
    if (pending.length > 100) pending.shift();
  }

  function sendLatest() {
    if (isPrivateTelemetryPath(window.location.pathname)) { suspendPrivatePage(); return; }
    if (window.navigator?.globalPrivacyControl === true) { updateConsent('denied', true); return; }
    if (!ready || consent !== 'granted') return;
    while (pending.length) {
      const page = pending.shift();
      frame.contentWindow.postMessage({ type: 'ufi-analytics-page', version: 1,
        clientId, category: page.category, visit: page.visit }, target.origin);
      lastSent = page.visit;
    }
  }

  function activate() {
    if (isPrivateTelemetryPath(window.location.pathname)) { suspendPrivatePage(); return; }
    if (window.navigator?.globalPrivacyControl === true && consent !== 'denied') { updateConsent('denied', true); return; }
    if (disposed || consent !== 'granted' || !latest) return;
    queueLatest();
    if (retiringFrames.size) return;
    if (!frame) {
      clientId = consentedClientId();
      if (!clientId) return;
      frame = document.createElement('iframe');
      // allow-same-origin is safe only because the URL above must be a
      // different origin. The browser prevents this frame reading the app.
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('title', 'Optional page analytics');
      frame.setAttribute('tabindex', '-1');
      frame.hidden = true;
      frame.src = target.href;
      document.body.appendChild(frame);
    }
    sendLatest();
  }

  function onMessage(event) {
    if (event.origin !== target.origin) return;
    if (event.data?.type === 'ufi-analytics-stopped' && event.data?.version === 1) {
      for (const previousFrame of retiringFrames) if (event.source === previousFrame.contentWindow) removeFrame(previousFrame);
      return;
    }
    if (!frame || event.source !== frame.contentWindow
        || event.data?.type !== 'ufi-analytics-ready' || event.data?.version !== 1) return;
    ready = true;
    sendLatest();
  }

  function updateConsent(value, persist) {
    if (disposed || (value !== 'granted' && value !== 'denied' && value !== null)) return;
    const previousConsent = consent;
    const previousError = persistenceError;
    const previousSignal = privacySignal;
    privacySignal = window.navigator?.globalPrivacyControl === true;
    if (privacySignal) value = 'denied';
    consent = value;
    persistenceError = null;
    if (value === 'granted' && !storageWritable()) {
      consent = 'denied';
      persistenceError = storageErrorMessage;
    }
    if (persist) {
      try {
        window.localStorage.setItem(ANALYTICS_CONSENT_KEY, consent);
        if (window.localStorage.getItem(ANALYTICS_CONSENT_KEY) !== consent) throw Error('Choice was not stored');
      } catch {
        consent = 'denied';
        persistenceError = storageErrorMessage;
        // Absence of consent also disables collection after reload. Try this
        // when quota or browser restrictions prevent replacing an old grant.
        try { window.localStorage.removeItem(ANALYTICS_CONSENT_KEY); } catch {}
      }
    }
    if (consent === 'granted') activate(); else stop();
    if (previousConsent !== consent || previousError !== persistenceError || previousSignal !== privacySignal) listeners.forEach(listener => listener());
  }

  function onStorage(event) {
    if (event.key === ANALYTICS_CONSENT_KEY || event.key === null) {
      const value = event.key === null ? null : event.newValue;
      updateConsent(value === 'granted' || value === 'denied' ? value : null, false);
    }
  }

  window.addEventListener('message', onMessage);
  window.addEventListener('storage', onStorage);
  const onPrivacySignal = () => {
    if (privacySignal !== (window.navigator?.globalPrivacyControl === true)) updateConsent(consent, true);
  };
  window.addEventListener('focus', onPrivacySignal);
  window.addEventListener('pageshow', onPrivacySignal);
  if (privacySignal) updateConsent('denied', true);
  if (consent !== 'granted') { try { window.localStorage.removeItem(ANALYTICS_CLIENT_KEY); } catch {} }
  return Object.freeze({
    available: true,
    getConsent: () => consent,
    getPrivacySignal: () => privacySignal,
    getPersistenceError: () => persistenceError,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setConsent(value) { if (value === 'granted' || value === 'denied') updateConsent(value, true); },
    trackPage(path, navigationKey = path) {
      setTelemetryRoute(path);
      if (isPrivateTelemetryPath(path)) { suspendPrivatePage(); return; }
      if (disposed || (latest && latest.navigationKey === navigationKey && latest.sourcePath === path)) return;
      latest = { page: canonicalPage(path), sourcePath: path, navigationKey, visit: ++visit };
      activate();
    },
    dispose() { disposed = true; stop({ clearIdentifier: false }); retiringFrames.forEach(removeFrame); listeners.clear(); window.removeEventListener('message', onMessage); window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onPrivacySignal); window.removeEventListener('pageshow', onPrivacySignal); },
  });
}
