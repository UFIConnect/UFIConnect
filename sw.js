// Change this with each web release so installed clients discard obsolete
// app-shell assets as soon as the updated worker activates.
const CACHE_NAME = 'uficonnect-v13';
const API_ORIGINS = new Set([
  'https://api.uficonnect.org',
  'https://uficonnect-api-708r.onrender.com',
]);

const SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/uficonnect-mark.svg',
  '/uficonnect-icon-192.png',
  '/uficonnect-icon-512.png',
  '/uficonnect-icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('uficonnect-v') && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET, chrome-extension, and SSE streams
  if (request.method !== 'GET') return;
  if (url.pathname.endsWith('/feed/stream')) return;

  // API calls — network-first, no caching; return 503 on failure so callers treat it as an error
  if (API_ORIGINS.has(url.origin) || url.pathname.startsWith('/api/') || request.headers.has('Authorization')) {
    e.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
    );
    return;
  }

  // Navigation requests — serve cached shell or network
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() =>
        caches.match('/').then((r) => r || caches.match('/index.html'))
      )
    );
    return;
  }

  // Cache only the published shell and bundled assets. User uploads, signed
  // links, and responses with query strings must never enter offline storage.
  const cacheableAsset = url.origin === self.location.origin && !url.search
    && (SHELL_ASSETS.includes(url.pathname) || url.pathname.startsWith('/assets/'));
  if (!cacheableAsset) return;

  // Static assets — cache-first
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && !/no-store|private/i.test(response.headers.get('Cache-Control') || '')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// Payload is whatever JSON.stringify({ title, body, url }) sendPushToUser
// sends server-side (see backend's sendPushToUser) — url is where a click
// on this notification should land, not part of the visual notification
// itself.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'UFIconnect', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'UFIconnect';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/uficonnect-icon-192.png',
      badge: '/uficonnect-icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

// Focuses an already-open tab on the target URL instead of always opening a
// new one — most people already have the app open in a tab somewhere.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let targetUrl = '/';
  try {
    const candidate = new URL(e.notification.data?.url || '/', self.location.origin);
    if (candidate.origin === self.location.origin && /^https?:$/.test(candidate.protocol)) targetUrl = candidate.href;
  } catch { /* Ignore malformed notification links. */ }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification-click', url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
