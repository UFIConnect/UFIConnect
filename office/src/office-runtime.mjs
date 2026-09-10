export function createOfficeClient({ storage, fetcher, prompt, onTokenChange }) {
  const key = 'ufi_office_token';
  const prompted = new Set();
  const getToken = () => { try { return storage.getItem(key) || ''; } catch { return ''; } };
  async function request(url, options = {}) {
    const send = token => fetcher(url, { ...options, signal: options.signal || AbortSignal.timeout(20000), headers: { ...options.headers, ...(token ? { 'x-office-token': token } : {}) } });
    const token = getToken();
    const response = await send(token);
    if (response.status !== 401) return response;
    const updated = getToken();
    if (updated !== token) return send(updated);
    if (prompted.has(token)) return response;
    prompted.add(token);
    const entered = prompt('Office access token required:')?.trim();
    if (!entered) return response;
    try { storage.setItem(key, entered); } catch { return response; }
    onTokenChange();
    return send(entered);
  }
  return { request, getToken };
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
