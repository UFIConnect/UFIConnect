// A bounded poll replaces browser-only streaming responses in native actions.
export function createNativeFeedPolling(token, { request, currentToken, document: page = globalThis.document,
  schedule = setTimeout, unschedule = clearTimeout, interval = 60000 } = {}) {
  const controller = new AbortController();
  let timer, opened = false;
  const current = () => !controller.signal.aborted && currentToken() === token;
  const stream = { onopen: null, onmessage: null, onerror: null, close() { controller.abort(); unschedule(timer); } };
  const poll = async () => {
    if (!current()) return;
    try {
      if (!page?.hidden) {
        const { data } = await request('/feed', { params: { limit: 20 }, headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, _ufiManagedRetry: true });
        if (!current()) return;
        if (!opened) { opened = true; stream.onopen?.(); }
        const posts = Array.isArray(data?.posts) ? data.posts : Array.isArray(data) ? data : [];
        stream.onmessage?.({ data: JSON.stringify({ posts }) });
      }
    } catch (error) { if (current()) stream.onerror?.(error); }
    finally { if (current()) timer = schedule(poll, interval); }
  };
  queueMicrotask(poll);
  return stream;
}
