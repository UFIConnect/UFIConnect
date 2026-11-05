import { createOfficeRequestCoordinator } from './office-requests.mjs';

export function createOfficeClient({ storage, lockStorage, fetcher, prompt, onTokenChange = () => {}, pageUrl, serviceBases }) {
  const key = 'ufi_office_token';
  // Discard legacy persistent credentials; never recover them into a session.
  try { storage?.removeItem(key); } catch { /* Storage can be unavailable. */ }
  const prompted = new Set();
  const lockKey = 'ufi_office_locked';
  let locked = false;
  try { locked = lockStorage?.getItem(lockKey) === '1'; } catch { /* Storage can be unavailable. */ }
  let memoryToken = '', pendingAuth = null, pendingUnlock = null, authScope = 0;
  const getToken = () => memoryToken;
  const isLocked = () => locked;
  const lockedResponse = () => new Response('{"error":"Assistant access is locked. Unlock Office to continue."}', { status: 423, headers: { 'Content-Type': 'application/json' } });
  const reads = createOfficeRequestCoordinator({ fetcher, getScope: () => authScope, pageUrl, serviceBases });
  function lock() {
    locked = true; memoryToken = ''; authScope++;
    pendingAuth = null; pendingUnlock = null; prompted.clear(); reads.clear({ auth: true });
    try { lockStorage?.setItem(lockKey, '1'); } catch { /* The in-memory lock still applies. */ }
    onTokenChange();
  }
  async function unlock() {
    if (!locked) return Boolean(memoryToken);
    if (pendingUnlock) return pendingUnlock;
    const scope = authScope;
    const attempt = Promise.resolve().then(() => prompt('Office access token')).then(async value => {
      const entered = typeof value === 'string' ? value.trim() : '';
      if (!entered || scope !== authScope) return false;
      const base = serviceBases?.[0]?.url || '';
      const response = await reads.request(`${base.replace(/\/$/, '')}/office/status`, { method: 'GET', cache: 'reload', credentials: 'omit', redirect: 'error', headers: { 'x-office-token': entered } });
      if (scope !== authScope) return false;
      if (response.status < 200 || response.status >= 300) throw new Error('Office could not verify that access token. The assistant remains locked.');
      const result = await response.json().catch(() => null);
      if (scope !== authScope) return false;
      if (!result?.server || typeof result.server !== 'object' || Array.isArray(result.server)) throw new Error('Office could not verify access. The assistant remains locked.');
      memoryToken = entered; locked = false; authScope++; reads.clear({ auth: true }); prompted.clear();
      try { lockStorage?.removeItem(lockKey); } catch { /* The verified in-memory session is usable. */ }
      onTokenChange();
      return true;
    }).finally(() => { if (pendingUnlock === attempt) pendingUnlock = null; });
    pendingUnlock = attempt;
    return attempt;
  }
  async function authorize(token) {
    if (locked) return '';
    if (!pendingAuth) {
      if (prompted.has(token)) return '';
      prompted.add(token);
      const scope = authScope;
      const attempt = Promise.resolve().then(() => prompt('Office access token')).then(value => {
        const entered = value?.trim();
        if (locked || scope !== authScope) return '';
        if (entered) { memoryToken = entered; authScope++; reads.clear({ auth: true }); prompted.clear(); onTokenChange(); }
        return entered;
      }).finally(() => { if (pendingAuth === attempt) pendingAuth = null; });
      pendingAuth = attempt;
    }
    return pendingAuth;
  }
  async function request(url, options = {}) {
    if (locked) return lockedResponse();
    if (typeof url !== 'string' && !(url instanceof URL)) throw new TypeError('Office requests require a URL string or URL object.');
    const write = !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase());
    let token = getToken();
    // Establish access before sending a write. An unconfirmed write is never
    // replayed automatically after a 401, timeout or connection failure.
    if (write && !token) {
      token = await authorize(token);
      if (locked) return lockedResponse();
      if (!token) return new Response('{"error":"Office access is required."}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const send = value => {
      const headers = new Headers(options.headers);
      if (value) headers.set('x-office-token', value);
      else headers.delete('x-office-token');
      return reads.request(url, { ...options, credentials: 'omit', redirect: 'error', headers: Object.fromEntries(headers) });
    };
    const response = await send(token);
    if (response.status !== 401) return response;
    const updated = getToken();
    if (updated !== token) return write ? response : send(updated);
    const entered = await authorize(token);
    return !write && entered ? send(entered) : response;
  }
  request.getDiagnostics = reads.getDiagnostics;
  request.subscribeDiagnostics = reads.subscribeDiagnostics;
  request.invalidateReads = () => reads.clear();
  const transportRequest = (url, options = {}) => {
    if (locked) return Promise.resolve(lockedResponse());
    if (String(options.method || 'GET').toUpperCase() !== 'GET' || options.body != null) {
      return Promise.reject(new TypeError('Office stream transport accepts GET requests without a body.'));
    }
    const headers = new Headers(options.headers);
    headers.set('Accept', 'text/event-stream');
    const token = getToken();
    if (token) headers.set('x-office-token', token);
    else headers.delete('x-office-token');
    return reads.request(url, { ...options, method: 'GET', credentials: 'omit', redirect: 'error', headers: Object.fromEntries(headers) });
  };
  request.lock = lock; request.unlock = unlock; request.isLocked = isLocked;
  return { request, getToken, transportRequest, lock, unlock, isLocked,
    getDiagnostics: reads.getDiagnostics, subscribeDiagnostics: reads.subscribeDiagnostics };
}

export function createTrustedOfficeFetch({ baseUrls, pageUrl, development = false, fetcher }) {
  const page = new URL(pageUrl);
  const origins = new Set(baseUrls.map(base => {
    const url = new URL(base || '/', page.origin);
    const local = development && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
      throw new Error('Office requires a trusted HTTPS API URL.');
    }
    return url.origin;
  }));
  return (input, options) => {
    const url = new URL(input, page.origin);
    if (url.username || url.password || !origins.has(url.origin)) throw new Error('Office request destination is not trusted.');
    return fetcher(url.href, { ...options, credentials: 'omit', cache: 'no-store', redirect: 'error' });
  };
}

// EventSource cannot send authorization headers. This adapter uses fetch so
// administrative credentials never enter a URL, history, or proxy access log.
export function createOfficeEventSource({ fetcher, getToken }) {
  return class OfficeEventSource {
    constructor(url) {
      this.controller = new AbortController();
      this.closed = false;
      queueMicrotask(() => this.read(url));
    }
    async read(url) {
      let reader;
      try {
        const token = getToken();
        const response = await fetcher(url, {
          headers: { Accept: 'text/event-stream', ...(token ? { 'x-office-token': token } : {}) },
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: this.controller.signal,
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
          throw new Error('Office stream unavailable');
        }
        if (this.closed) return;
        this.onopen?.();
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!this.closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 1024 * 1024) throw new Error('Office stream event too large');
          let boundary;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (data && !this.closed) this.onmessage?.({ data });
          }
        }
        if (!this.closed) this.onerror?.();
      } catch { if (!this.closed) this.onerror?.(); }
      finally { reader?.releaseLock(); }
    }
    close() { this.closed = true; this.controller.abort(); }
  };
}

export function mergeOfficeLog(current, incoming) {
  const seen = new Set();
  return [...incoming, ...current].filter(entry => {
    if (!entry?.agentId || !Number.isFinite(Date.parse(entry.ts))) return false;
    const key = JSON.stringify([entry.service, entry.agentId, entry.ts, entry.msg, entry.emoji]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 300);
}

export function connectOfficeStreams({ bases, urlFor, EventSourceClass, onConnection, onData,
  subscribeToken, schedule = setTimeout, cancel = clearTimeout }) {
  let stopped = false;
  const streams = new Map(), timers = new Map(), active = new Set();
  const report = () => onConnection(active.size === bases.length);
  function connect(base) {
    if (stopped) return;
    timers.delete(base);
    const stream = new EventSourceClass(urlFor(base));
    streams.set(base, stream);
    const current = () => !stopped && streams.get(base) === stream;
    stream.onopen = () => { if (current()) { active.add(base); report(); } };
    stream.onerror = () => {
      if (!current()) return;
      streams.delete(base); stream.close(); active.delete(base); report();
      timers.set(base, schedule(() => connect(base), 4000));
    };
    stream.onmessage = event => {
      if (!current()) return;
      try {
        const data = JSON.parse(event.data);
        const rows = Array.isArray(data?.backlog) ? data.backlog : [data];
        onData(mergeOfficeLog([], rows.map(row => ({ ...row, service: base }))));
      } catch { /* Ignore malformed events; the stream remains usable. */ }
    };
  }
  function reset() {
    timers.forEach(cancel); timers.clear();
    streams.forEach(stream => stream.close()); streams.clear(); active.clear(); report();
    bases.forEach(connect);
  }
  const unsubscribe = subscribeToken(reset);
  reset();
  return () => {
    stopped = true; unsubscribe(); timers.forEach(cancel);
    streams.forEach(stream => stream.close()); streams.clear();
  };
}
