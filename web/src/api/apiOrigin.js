import { validateApiBaseUrl } from './apiEndpointPolicy';

// Keep the public API hostname and the Render hostname separate. The public
// hostname is the stable, dual-stack route users should see; the Render URL
// remains a short-lived escape hatch while DNS, TLS, or an edge route recovers.
const PRIMARY_API_URL = import.meta.env.VITE_API_URL || '/api';
const FALLBACK_API_URL = import.meta.env.VITE_API_FALLBACK_URL || '';
const PROBE_TIMEOUT_MS = 1500;
const RECHECK_INTERVAL_MS = 60_000;

function normalizeBaseUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url === '/') return '';
  return url.replace(/\/+$/, '');
}

const apiOrigins = [...new Set([PRIMARY_API_URL, FALLBACK_API_URL]
  .map(value => validateApiBaseUrl(value, { production: import.meta.env.PROD, pageOrigin: window.location.origin }))
  .filter(Boolean))];

let activeApiOrigin = apiOrigins[0] || '/api';
let nextProbeAt = 0;
let resolvingOrigin = null;

export function withApiPath(origin, path) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${normalizeBaseUrl(origin)}${suffix}`;
}

async function probe(origin) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // /readyz is intentionally tiny. The /health fallback keeps a rolling
    // deploy safe while an older API instance is still serving traffic.
    let response = await fetch(withApiPath(origin, '/readyz'), {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (response.status === 404) {
      response = await fetch(withApiPath(origin, '/health'), {
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
    }
    return response.ok;
  } catch {
    // Older API instances exposed /health before CORS middleware. A normal
    // browser fetch correctly rejects that response, even though the Render
    // fallback itself is reachable and its application routes do allow CORS.
    // An opaque request can establish network reachability during a rolling
    // deploy; restrict it to the fallback so a misconfigured public origin is
    // never promoted merely because a CDN answered.
    if (origin !== apiOrigins[0]) {
      const reachabilityController = new AbortController();
      const reachabilityTimer = window.setTimeout(
        () => reachabilityController.abort(),
        PROBE_TIMEOUT_MS,
      );
      try {
        await fetch(withApiPath(origin, '/readyz'), {
          cache: 'no-store',
          credentials: 'omit',
          mode: 'no-cors',
          signal: reachabilityController.signal,
        });
        return true;
      } catch {
        return false;
      } finally {
        window.clearTimeout(reachabilityTimer);
      }
    }
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function getApiBaseUrl() {
  return activeApiOrigin;
}

export function isConfiguredApiBaseUrl(value) {
  return apiOrigins.includes(value);
}

// OAuth redirect URIs are registered with providers as an exact public URL.
// Never let a fast transport fallback select a different host for that flow.
export function getCanonicalApiBaseUrl() {
  return apiOrigins[0] || '/api';
}

export function getAlternateApiBaseUrl(origin = activeApiOrigin) {
  return apiOrigins.find((candidate) => candidate !== origin) || null;
}

export function markApiOriginHealthy(origin) {
  if (!apiOrigins.includes(origin)) return;
  activeApiOrigin = origin;
  nextProbeAt = Date.now() + RECHECK_INTERVAL_MS;
}

export function markApiOriginFailure(origin) {
  // Only promote the fallback when the public primary failed. If the fallback
  // itself has one dropped request, do not bounce the client back to a public
  // hostname that may still be the DNS problem we just escaped.
  const fallback = origin === apiOrigins[0] ? getAlternateApiBaseUrl(origin) : null;
  if (fallback) activeApiOrigin = fallback;
  // Do not re-probe a failing DNS route on every request. A later request
  // will test it again after the small recovery window has elapsed.
  nextProbeAt = Date.now() + RECHECK_INTERVAL_MS;
  return fallback;
}

export async function resolveApiBaseUrl({ force = false } = {}) {
  if (apiOrigins.length < 2 || (!force && Date.now() < nextProbeAt)) return activeApiOrigin;
  if (resolvingOrigin) return resolvingOrigin;

  resolvingOrigin = (async () => {
    // Race the routes instead of waiting for a regional DNS timeout before
    // trying the fallback. The first confirmed healthy route serves this
    // session; later checks still give the public route a chance to recover.
    try {
      activeApiOrigin = await Promise.any(apiOrigins.map(async (origin) => {
        if (await probe(origin)) return origin;
        throw new Error(`API origin unavailable: ${origin}`);
      }));
    } catch {
      // Keep the last working origin when neither probe can answer. A safe
      // request can still perform its one normal retry and surface a useful
      // offline state rather than selecting an arbitrary new hostname.
    }
    nextProbeAt = Date.now() + RECHECK_INTERVAL_MS;
    return activeApiOrigin;
  })().finally(() => {
    resolvingOrigin = null;
  });

  return resolvingOrigin;
}
