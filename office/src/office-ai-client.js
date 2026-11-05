export function officeAIError(error) {
  if (error?.name === 'AbortError') return 'The request timed out. Refresh to check its actual status before retrying.';
  if (error?.name === 'TypeError') return 'The connection ended. Refresh to check the latest status.';
  return String(error?.message || 'The request could not be completed.').replace(/\bBearer\s+\S+/gi, '[credential omitted]').replace(/\b(?:sk-[a-zA-Z0-9_-]+|[a-z_]*(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+)/gi, '[credential omitted]').slice(0, 500);
}

export async function officeAIRequest(request, url, options = {}, controllers) {
  const { timeoutMs = 25000, ...requestOptions } = options;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), Math.min(220000, Math.max(1000, timeoutMs)));
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  controllers?.add(controller);
  try {
    const response = await request(url, { ...requestOptions, signal: controller.signal, ...(options.body ? { headers: { 'Content-Type': 'application/json', ...options.headers }, body: JSON.stringify(options.body) } : {}) });
    if (controller.signal.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
    let body;
    try { body = await response.json(); } catch {
      if (controller.signal.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
      throw Error('Office returned an unreadable response. Refresh to check the latest status.');
    }
    if (controller.signal.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
    if (!response.ok) { const error = Error(response.status === 401 ? 'Office access is unavailable. Reconnect to Office.' : body?.error || `The request failed (${response.status}).`); error.status = response.status; throw error; }
    return body;
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); controllers?.delete(controller); }
}

export const taskDate = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '';
export const taskState = value => String(value || 'unknown').replace(/_/g, ' ');
