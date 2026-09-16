const { screenPath } = require('./screenPolicy');
const ERROR_CODES = new Set(['script_error', 'unhandled_rejection', 'render_error', 'request_failed']);

function createServiceMetrics({ apiBase, fetcher, now = Date.now }) {
  let currentCategory = null, lastVisit = null, enabled = false, disposed = false;
  const inFlight = new Map(), lastErrors = new Map();
  function send(path, payload, optional = false) {
    if (disposed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    inFlight.set(controller, optional);
    Promise.resolve().then(() => {
      if (controller.signal.aborted || disposed || (optional && !enabled)) return;
      return fetcher(`${apiBase}${path}`, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
        cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal });
    }).catch(() => {}).finally(() => { clearTimeout(timer); inFlight.delete(controller); });
  }
  return {
    trackScreen(name, navigationKey) {
      const pathname = screenPath(name);
      if (!pathname) { currentCategory = null; return; }
      currentCategory = 'app_' + pathname.slice('/app/'.length).replaceAll('-', '_');
      const visit = `${currentCategory}:${typeof navigationKey === 'string' ? navigationKey : ''}`;
      if (visit === lastVisit) return;
      lastVisit = visit;
      send('/analytics/pageview', { category: currentCategory });
    },
    setPerformanceEnabled(value) {
      enabled = value === true;
      if (!enabled) for (const [controller, optional] of inFlight) if (optional) controller.abort();
    },
    reportError(code) {
      if (!enabled || !currentCategory || !ERROR_CODES.has(code)) return;
      const key = `${currentCategory}:${code}`, timestamp = now();
      if (lastErrors.has(key) && timestamp - lastErrors.get(key) < 60000) return;
      lastErrors.set(key, timestamp);
      send('/analytics/performance', { category: currentCategory, kind: 'client_error', code }, true);
    },
    dispose() { disposed = true; for (const controller of inFlight.keys()) controller.abort(); },
  };
}

function supportsErrorCollection(runtime) {
  return typeof runtime.addEventListener === 'function' ||
    (typeof runtime.ErrorUtils?.getGlobalHandler === 'function' && typeof runtime.ErrorUtils?.setGlobalHandler === 'function');
}

function installErrorCollection(runtime, report) {
  if (typeof runtime.addEventListener === 'function') {
    const error = () => report('script_error');
    const rejection = () => report('unhandled_rejection');
    runtime.addEventListener('error', error);
    runtime.addEventListener('unhandledrejection', rejection);
    return () => { runtime.removeEventListener('error', error); runtime.removeEventListener('unhandledrejection', rejection); };
  }
  const utils = runtime.ErrorUtils;
  if (!supportsErrorCollection(runtime)) return () => {};
  const original = utils.getGlobalHandler();
  const handler = (error, fatal) => {
    report('script_error');
    original?.(error, fatal);
  };
  utils.setGlobalHandler(handler);
  return () => { if (utils.getGlobalHandler() === handler) utils.setGlobalHandler(original); };
}

module.exports = { createServiceMetrics, supportsErrorCollection, installErrorCollection };
