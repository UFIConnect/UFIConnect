export function createOfficeClient({ storage, fetcher, prompt, onTokenChange }) {
  const key = 'ufi_office_token';
  // Discard legacy persistent credentials; never recover them into a session.
  try { storage?.removeItem(key); } catch { /* Storage can be unavailable. */ }
  const prompted = new Set();
  let memoryToken = '', pendingAuth = null;
  const getToken = () => memoryToken;
  async function request(url, options = {}) {
    const send = token => fetcher(url, { ...options, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: options.signal || AbortSignal.timeout(20000), headers: { ...options.headers, ...(token ? { 'x-office-token': token } : {}) } });
    const token = getToken();
    const response = await send(token);
    if (response.status !== 401) return response;
    const updated = getToken();
    if (updated !== token) return send(updated);
    if (!pendingAuth) {
      if (prompted.has(token)) return response;
      prompted.add(token);
      pendingAuth = Promise.resolve().then(() => prompt('Office access token')).then(value => {
        const entered = value?.trim();
        if (entered) { memoryToken = entered; prompted.clear(); onTokenChange(); }
        return entered;
      }).finally(() => { pendingAuth = null; });
    }
    const entered = await pendingAuth;
    return entered ? send(entered) : response;
  }
  return { request, getToken };
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
