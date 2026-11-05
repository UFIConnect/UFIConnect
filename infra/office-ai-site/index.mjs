const ORIGIN = 'https://uficonnect-office-708r.onrender.com';
const HOST = 'uficonnect.ai';
const publicFiles = new Set(['/', '/index.html', '/icon.svg', '/robots.txt', '/health', '/health.json']);
const errorResponse = (status, text) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export function createSite(fetcher = fetch) {
  return {
    async fetch(request) {
      const incoming = new URL(request.url);
      if (incoming.hostname !== HOST) return errorResponse(404, 'Not found.');
      if (incoming.protocol !== 'https:') { incoming.protocol = 'https:'; return Response.redirect(incoming.href, 308); }
      if (!['GET', 'HEAD'].includes(request.method)) return errorResponse(405, 'Only static page requests are supported here.');
      if (!publicFiles.has(incoming.pathname) && !/^\/assets\/[a-zA-Z0-9._/-]+$/.test(incoming.pathname)) return errorResponse(404, 'Not found.');
      const target = new URL(ORIGIN);
      target.pathname = incoming.pathname;
      // Static hosting must never forward Office credentials, cookies, or URL parameters.
      const requestHeaders = new Headers();
      for (const name of ['accept', 'if-none-match', 'if-modified-since', 'range']) {
        const value = request.headers.get(name); if (value) requestHeaders.set(name, value);
      }
      try {
        const response = await fetcher(target, { method: request.method, headers: requestHeaders, redirect: 'manual', signal: AbortSignal.timeout(15000) });
        if (response.status >= 300 && response.status < 400 && response.status !== 304) return errorResponse(502, 'Office hosting returned an unexpected redirect.');
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete('set-cookie');
        responseHeaders.delete('access-control-allow-origin');
        responseHeaders.delete('access-control-allow-credentials');
        responseHeaders.set('strict-transport-security', 'max-age=31536000');
        responseHeaders.set('x-content-type-options', 'nosniff');
        responseHeaders.set('x-frame-options', 'SAMEORIGIN');
        responseHeaders.set('referrer-policy', 'strict-origin-when-cross-origin');
        if (!incoming.pathname.startsWith('/assets/')) responseHeaders.set('cache-control', 'no-cache, no-store, must-revalidate');
        return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: responseHeaders });
      } catch { return errorResponse(502, 'Office hosting is temporarily unavailable. Please retry.'); }
    },
  };
}
export default createSite();
