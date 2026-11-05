const ORIGIN = 'https://uficonnect-office-708r.onrender.com';
const API_ORIGIN = 'https://api.uficonnect.org';
const HOST = 'uficonnect.ai';
const publicFiles = new Set(['/', '/index.html', '/icon.svg', '/robots.txt', '/health', '/health.json']);
const apiPaths = new Set(['/api/v1/topics', '/api/v1/feed']);
const apiGenerationPaths = new Set(['/api/v1/chat/completions', '/api/v1/images/generations', '/api/v1/videos/generations', '/api/v1/content/generations']);
const videoStatusPath = /^\/api\/v1\/videos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/content)?$/i;
const postPath = /^\/api\/v1\/posts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_API_BODY_BYTES = 64 * 1024;
const errorResponse = (status, text) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

async function boundedBody(request) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_API_BODY_BYTES)) return errorResponse(413, 'API requests may contain up to 64 KB of JSON.');
  const reader = request.body?.getReader();
  if (!reader) return errorResponse(400, 'Provide a valid JSON object.');
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_API_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return errorResponse(413, 'API requests may contain up to 64 KB of JSON.');
      }
      chunks.push(value);
    }
  } catch { return errorResponse(400, 'The API request body could not be read.'); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid JSON object.');
  } catch { return errorResponse(400, 'Provide a valid JSON object.'); }
  return bytes;
}

export function createSite(fetcher = fetch) {
  return {
    async fetch(request) {
      const incoming = new URL(request.url);
      if (incoming.hostname !== HOST) return errorResponse(404, 'Not found.');
      if (incoming.protocol !== 'https:') { incoming.protocol = 'https:'; return Response.redirect(incoming.href, 308); }
      const isGeneration = apiGenerationPaths.has(incoming.pathname);
      const isPostCreate = incoming.pathname === '/api/v1/posts';
      const isPost = postPath.test(incoming.pathname);
      const isApi = isGeneration || isPostCreate || isPost || apiPaths.has(incoming.pathname) || videoStatusPath.test(incoming.pathname);
      const allowedMethods = isGeneration || isPostCreate ? ['POST'] : isPost ? ['GET', 'HEAD', 'PATCH'] : ['GET', 'HEAD'];
      if (!allowedMethods.includes(request.method)) return errorResponse(405, `Use ${allowedMethods.join(' or ')} for this endpoint.`);
      if (!isApi && !publicFiles.has(incoming.pathname) && !/^\/assets\/[a-zA-Z0-9._/-]+$/.test(incoming.pathname)) return errorResponse(404, 'Not found.');
      const isJsonWrite = isGeneration || isPostCreate || (isPost && request.method === 'PATCH');
      let body;
      if (isJsonWrite) {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return errorResponse(415, 'Send API writes as application/json.');
        body = await boundedBody(request);
        if (body instanceof Response) return body;
      }
      const target = new URL(isApi ? API_ORIGIN : ORIGIN);
      target.pathname = incoming.pathname;
      // API keys are forwarded only to these exact, fixed-origin API routes.
      // Static hosting never forwards credentials or URL parameters.
      if (isApi && incoming.pathname === '/api/v1/feed') {
        for (const name of ['limit', 'cursor']) {
          const value = incoming.searchParams.get(name);
          if (value !== null) target.searchParams.set(name, value);
        }
      }
      const requestHeaders = new Headers();
      for (const name of isApi ? ['accept', 'authorization', ...(isJsonWrite ? ['content-type'] : [])] : ['accept', 'if-none-match', 'if-modified-since', 'range']) {
        const value = request.headers.get(name); if (value) requestHeaders.set(name, value);
      }
      try {
        const response = await fetcher(target, { method: request.method, headers: requestHeaders, ...(isJsonWrite ? { body } : {}), redirect: 'manual', signal: AbortSignal.timeout(isApi ? 240000 : 15000) });
        if (response.status >= 300 && response.status < 400 && response.status !== 304) return errorResponse(502, isApi ? 'The UFIConnect API returned an unexpected redirect.' : 'Office hosting returned an unexpected redirect.');
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete('set-cookie');
        responseHeaders.delete('access-control-allow-origin');
        responseHeaders.delete('access-control-allow-credentials');
        if (isApi) {
          responseHeaders.set('cache-control', 'private, no-store');
          responseHeaders.delete('cdn-cache-control');
          responseHeaders.delete('cloudflare-cdn-cache-control');
        }
        responseHeaders.set('strict-transport-security', 'max-age=31536000');
        responseHeaders.set('x-content-type-options', 'nosniff');
        responseHeaders.set('x-frame-options', 'SAMEORIGIN');
        responseHeaders.set('referrer-policy', 'strict-origin-when-cross-origin');
        if (!isApi && !incoming.pathname.startsWith('/assets/')) responseHeaders.set('cache-control', 'no-cache, no-store, must-revalidate');
        return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: responseHeaders });
      } catch { return errorResponse(502, isApi ? 'The UFIConnect API is temporarily unavailable. Please retry.' : 'Office hosting is temporarily unavailable. Please retry.'); }
    },
  };
}
export default createSite();
