// EventSource cannot set Authorization headers. Fetch keeps the credential
// out of URL logs, history, and monitoring while retaining SSE messages.
import { isNativeRuntime, nativeApiPath } from '../nativeRuntime.mjs';
import { createNativeFeedPolling } from './nativePolling.mjs';
import { getAccessToken } from '../auth/session.js';

export function createAuthenticatedStream(url, token) {
  if (isNativeRuntime()) {
    if (nativeApiPath(url) !== '/feed/stream') throw new Error('Live updates are unavailable for this request.');
    return createNativeFeedPolling(token, {
      request: async (path, config) => {
        const { default: client } = await import('./client.js');
        return client.get(path, config);
      },
      currentToken: getAccessToken,
    });
  }
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
