// EventSource cannot set Authorization headers. Fetch keeps the credential
// out of URL logs, history, and monitoring while retaining SSE messages.
export function createAuthenticatedStream(url, token) {
  const controller = new AbortController();
  const stream = { onopen: null, onmessage: null, onerror: null, close: () => controller.abort() };
  queueMicrotask(async () => {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('Live updates unavailable');
      }
      stream.onopen?.();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let data = [];
      while (!controller.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Live updates disconnected');
        pending += decoder.decode(chunk.value, { stream: true });
        if (pending.length > 1024 * 1024) throw new Error('Live update too large');
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline).replace(/\r$/, '');
          pending = pending.slice(newline + 1);
          if (!line) {
            if (data.length) stream.onmessage?.({ data: data.join('\n') });
            data = [];
          } else if (line.startsWith('data:')) {
            data.push(line.slice(5).replace(/^ /, ''));
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) stream.onerror?.(error);
    }
  });
  return stream;
}
