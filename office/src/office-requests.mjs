const POLICIES = new Map([
  ['/office/status', { ttlMs: 2000, maxBytes: 512 * 1024, query: [] }],
  ['/office/agents', { ttlMs: 3000, maxBytes: 1024 * 1024, query: [] }],
  ['/office/versions', { ttlMs: 60000, maxBytes: 128 * 1024, query: [] }],
  ['/office/setup', { ttlMs: 2000, maxBytes: 256 * 1024, query: [] }],
  ['/office/controls', { ttlMs: 2000, maxBytes: 256 * 1024, query: [] }],
  ['/office/topics', { ttlMs: 5000, maxBytes: 1024 * 1024, query: [] }],
  ...['pageviews', 'geography', 'traffic', 'requests', 'comparison'].map(name => [`/office/analytics/${name}`,
    { ttlMs: 5000, maxBytes: 1024 * 1024, query: ['detail', 'from', 'to', 'platform', 'category', 'type', 'viewType', 'country', 'city', 'limit'] }]),
]);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const abortError = () => new DOMException('The Office read was cancelled.', 'AbortError');
const familyOf = path => {
  if (path === '/office/status') return 'Service status';
  if (/^\/office\/analytics(?:\/|$)/.test(path)) return 'Analytics';
  if (/^\/office\/agents(?:\/|$)/.test(path)) return 'Agents';
  if (/^\/office\/(?:users|members|user-usage)(?:\/|$)/.test(path)) return 'Members';
  if (/^\/office\/(?:post-pipeline|feed-audit|topic-transfer|topics)(?:\/|$)/.test(path)) return 'Content flow';
  if (/^\/office\/(?:controls|setup|versions|deploy|autofix|recovery)(?:\/|$)/.test(path)) return 'Operations';
  if (/^\/office\/(?:ai|connections)(?:\/|$)/.test(path)) return 'Office AI';
  if (/^\/office\/reports(?:\/|$)/.test(path)) return 'Reports';
  return 'Other';
};
const knownLength = response => {
  const value = response?.headers?.get?.('content-length');
  if (value === null || value === undefined || value === '') return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
};

export function createOfficeRequestCoordinator({ fetcher, getScope = () => 0, pageUrl = 'https://office.invalid/',
  serviceBases = [], now = () => performance.now(), clock = Date.now, maxEntries = 24, maxBytes = 4 * 1024 * 1024 }) {
  const pending = new Map(), cache = new Map(), rows = new Map(), listeners = new Set();
  let cacheBytes = 0, generation = 0, revision = 0, notification = false;
  let diagnosticSnapshot = { scope: 'This Office session', startedAt: new Date(clock()).toISOString(), revision, rows: [] };
  const bases = serviceBases.map(({ service, url }) => ({ service: service === 'pipeline' ? 'Pipeline' : 'API', url: new URL(url || '/', pageUrl) }))
    .sort((a, b) => b.url.pathname.length - a.url.pathname.length);
  function descriptor(input, options) {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, pageUrl); } catch { return { family: 'Other', service: 'Other', method: 'OTHER' }; }
    const target = bases.find(item => item.url.origin === url.origin && (item.url.pathname === '/' || url.pathname === item.url.pathname || url.pathname.startsWith(item.url.pathname.replace(/\/$/, '') + '/')));
    const path = target && target.url.pathname !== '/' ? url.pathname.slice(target.url.pathname.replace(/\/$/, '').length) || '/' : url.pathname;
    const method = String(options.method || 'GET').toUpperCase();
    const policy = POLICIES.get(path);
    return { url, path, family: familyOf(path), service: target?.service || (bases.length ? 'Other' : 'API'),
      method: METHODS.has(method) ? method : 'OTHER', policy: policy && [...url.searchParams.keys()].every(key => policy.query.includes(key)) ? policy : null };
  }
  function record(meta, event, values = {}) {
    if (meta.scope !== getScope()) return;
    const key = `${meta.service}:${meta.family}:${meta.method}`;
    let row = rows.get(key);
    if (!row) {
      if (rows.size >= 216) return;
      row = { service: meta.service, family: meta.family, method: meta.method, calls: 0, networkRequests: 0,
        cacheHits: 0, coalesced: 0, failures: 0, cancelled: 0, completed: 0, inFlight: 0,
        knownResponseBytes: 0, measuredResponses: 0, totalDurationMs: 0, lastDurationMs: null, lastStatus: null };
      rows.set(key, row);
    }
    if (event === 'call') row.calls++;
    if (event === 'cache') row.cacheHits++;
    if (event === 'shared') row.coalesced++;
    if (event === 'cancel') row.cancelled++;
    if (event === 'start') { row.networkRequests++; row.inFlight++; }
    if (event === 'end') {
      row.inFlight = Math.max(0, row.inFlight - 1); row.completed++;
      row.lastDurationMs = Math.max(0, Math.round(values.durationMs)); row.totalDurationMs += row.lastDurationMs;
      row.lastStatus = Number.isInteger(values.status) ? values.status : null;
      if (!values.aborted && (!values.status || values.status >= 400)) row.failures++;
      if (Number.isSafeInteger(values.bytes) && values.bytes >= 0) { row.knownResponseBytes += values.bytes; row.measuredResponses++; }
    }
    row.observedAt = new Date(clock()).toISOString();
    diagnosticSnapshot = { ...diagnosticSnapshot, revision: ++revision, rows: [...rows.values()].map(item => ({ ...item,
      averageDurationMs: item.completed ? Math.round(item.totalDurationMs / item.completed) : null })) };
    if (!notification) { notification = true; queueMicrotask(() => { notification = false; listeners.forEach(listener => listener()); }); }
  }
  function evict() {
    for (const [key, entry] of cache) if (entry.expiresAt <= clock()) { cache.delete(key); cacheBytes -= entry.bytes.length; }
    while (cache.size && (cache.size > maxEntries || cacheBytes > maxBytes)) {
      const key = cache.keys().next().value, entry = cache.get(key);
      cache.delete(key); cacheBytes -= entry.bytes.length;
    }
  }
  function clear({ auth = false } = {}) {
    generation++; cache.clear(); cacheBytes = 0;
    if (auth) {
      pending.forEach(entry => entry.controller.abort()); pending.clear(); rows.clear();
      diagnosticSnapshot = { scope: 'This Office session', startedAt: new Date(clock()).toISOString(), revision: ++revision, rows: [] };
      listeners.forEach(listener => listener());
    }
  }
  const fromCache = entry => new Response(entry.bytes, { status: entry.status, statusText: entry.statusText, headers: entry.headers });
  async function buffered(response, policy) {
    if (!response?.ok || !response.clone || !response.body || !/application\/json/i.test(response.headers.get('content-type') || '')) return null;
    const length = knownLength(response);
    if (length !== null && length > policy.maxBytes) return null;
    const reader = response.clone().body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > policy.maxBytes) { reader.cancel().catch(() => {}); return null; }
        chunks.push(value);
      }
    } catch { reader.cancel().catch(() => {}); return null; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length; });
    const headers = new Headers(response.headers);
    // Body bytes are already decoded by fetch; do not repeat wire encodings.
    headers.delete('content-encoding'); headers.delete('content-length');
    return { bytes, status: response.status, statusText: response.statusText, headers };
  }
  async function network(input, options, meta, scope, signal) {
    const start = now(); record(meta, 'start');
    try {
      const response = await fetcher(input, { ...options, signal });
      if (scope !== getScope()) throw abortError();
      record(meta, 'end', { status: response.status, durationMs: now() - start, bytes: knownLength(response) });
      return response;
    } catch (error) {
      record(meta, 'end', { durationMs: now() - start, aborted: signal?.aborted || error?.name === 'AbortError' });
      throw error;
    }
  }
  async function request(input, options = {}) {
    if (typeof input !== 'string' && !(input instanceof URL)) throw new TypeError('Office requests require a URL string or URL object.');
    const meta = descriptor(input, options), scope = getScope(), callerSignal = options.signal;
    meta.scope = scope;
    record(meta, 'call');
    if (callerSignal?.aborted) { record(meta, 'cancel'); throw callerSignal.reason || abortError(); }
    const read = meta.method === 'GET';
    if (!read && meta.method !== 'HEAD') clear();
    const requestHeaders = new Headers(options.headers);
    const policy = read && !options.body && meta.policy && !requestHeaders.has('authorization') && !requestHeaders.get('accept')?.includes('event-stream') ? meta.policy : null;
    if (!policy || pending.size >= 32) return network(input, options, meta, scope, callerSignal || AbortSignal.timeout(20000));
    const headers = [...new Headers(options.headers).entries()].filter(([key]) => !['x-office-token', 'authorization'].includes(key));
    const key = JSON.stringify([scope, generation, meta.url.href, headers]);
    evict();
    const bypass = ['reload', 'no-store', 'no-cache'].includes(options.cache);
    if (!bypass && cache.has(key)) { record(meta, 'cache'); return fromCache(cache.get(key)); }
    let entry = pending.get(key);
    if (entry) record(meta, 'shared');
    else {
      const controller = new AbortController(), version = generation;
      entry = { controller, users: 0, settled: false };
      entry.promise = network(input, options, meta, scope, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])).then(async response => {
        const data = await buffered(response, policy);
        if (scope !== getScope()) throw abortError();
        if (data) {
          response.body.cancel().catch(() => {});
          if (version === generation && !controller.signal.aborted) {
            if (cache.has(key)) cacheBytes -= cache.get(key).bytes.length;
            cache.set(key, { ...data, expiresAt: clock() + policy.ttlMs }); cacheBytes += data.bytes.length; evict();
          }
          return () => fromCache(data);
        }
        return last => last || !response.clone ? response : response.clone();
      }).finally(() => { entry.settled = true; if (pending.get(key) === entry) pending.delete(key); });
      pending.set(key, entry);
    }
    entry.users++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return false;
        finished = true; callerSignal?.removeEventListener('abort', abort); entry.users--;
        if (!entry.users && !entry.settled) { entry.controller.abort(); if (pending.get(key) === entry) pending.delete(key); }
        return true;
      };
      const abort = () => { if (release()) { record(meta, 'cancel'); reject(callerSignal.reason || abortError()); } };
      callerSignal?.addEventListener('abort', abort, { once: true });
      entry.promise.then(makeResponse => { if (release()) resolve(makeResponse(entry.users === 0)); }, error => { if (release()) reject(error); });
      if (callerSignal?.aborted) abort();
    });
  }
  return { request, clear, getDiagnostics: () => diagnosticSnapshot,
    subscribeDiagnostics(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
