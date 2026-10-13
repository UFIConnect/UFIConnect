const MAX_BYTES = 25 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const MAX_REQUEST_TIMEOUT = 240000;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function validToken(token) { return typeof token === 'string' && token.length <= 16384 && TOKEN.test(token); }
function utf8Bytes(value) {
  let size = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 128) size++;
    else if (code < 2048) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { size += 4; index++; }
    else size += 3;
  }
  return size;
}
function apiPath(value) {
  if (typeof value !== 'string' || value.length > 8192 || !/^\/(?!\/)/.test(value)
    || /[\\#\s\u0000-\u001f]/.test(value) || /%(?:00|0a|0d|5c)/i.test(value)) throw new Error('Invalid API request path.');
  const path = value.split('?')[0];
  if (path.split('/').some(part => { try { return ['.', '..'].includes(decodeURIComponent(part)); } catch { return true; } })) throw new Error('Invalid API request path.');
  return value;
}
function bytesToBase64(bytes) {
  const chunks = [];
  for (let start = 0; start < bytes.length; start += 12288) {
    let result = '';
    for (let i = start; i < Math.min(start + 12288, bytes.length); i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      result += BASE64[a >> 2] + BASE64[((a & 3) << 4) | ((b || 0) >> 4)]
        + (i + 1 < bytes.length ? BASE64[((b & 15) << 2) | ((c || 0) >> 6)] : '=')
        + (i + 2 < bytes.length ? BASE64[c & 63] : '=');
    }
    chunks.push(result);
  }
  return chunks.join('');
}
function base64Bytes(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BYTES / 3) * 4 || value.length % 4
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid file data.');
  return value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}
function safeFileName(value) {
  return String(value || 'download').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 120) || 'download';
}
function validateMultipart(data) {
  if (!data || data.__ufiMultipart !== true || !Array.isArray(data.fields) || data.fields.length > 128) throw new Error('Invalid upload.');
  let total = 0;
  for (const field of data.fields) {
    if (typeof field.name !== 'string' || !field.name || field.name.length > 120 || /[\r\n]/.test(field.name)) throw new Error('Invalid upload field.');
    if (field.file) {
      if (typeof field.file.type !== 'string' || field.file.type.length > 150 || /[\r\n]/.test(field.file.type)) throw new Error('Invalid upload type.');
      total += base64Bytes(field.file.base64);
    } else if (typeof field.value === 'string') total += utf8Bytes(field.value);
    else throw new Error('Invalid upload field.');
    if (total > MAX_BYTES) throw new Error('Choose files smaller than 25 MB in total.');
  }
  return data;
}

function createNativeApiBridge({ apiBase, fetch: fetchRequest, store, multipart }) {
  if (!/^https:\/\/api\.uficonnect\.org$/.test(apiBase)) throw new Error('Untrusted API origin.');
  let token = null, generation = 0, writes = Promise.resolve();
  const issued = new Set();
  const write = operation => { const next = writes.catch(() => {}).then(operation); writes = next; return next; };
  async function persistSession(next) {
    if (next !== null && !validToken(next)) throw new Error('Invalid session.');
    if (next !== null && next !== token && !issued.has(next)) throw new Error('Unrecognized session. Sign in again.');
    const operation = ++generation;
    // Logout closes access immediately. A new sign-in becomes active only
    // after Keychain has accepted it, matching the shared UI's atomic update.
    if (next === null) token = null;
    return write(async () => {
      try { await (next ? store.write(next) : store.clear()); }
      catch (error) { if (next) issued.delete(next); throw error; }
      if (operation === generation) { token = next; issued.clear(); }
    });
  }
  async function request(input) {
    const url = apiPath(input?.url), method = String(input.method || 'GET').toUpperCase();
    if (!METHODS.has(method)) throw new Error('Unsupported request method.');
    const timeoutMs = input.timeout == null || input.timeout === 0 ? 30000 : input.timeout;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_REQUEST_TIMEOUT) throw new Error('Invalid request timeout.');
    const started = generation;
    const assertCurrent = () => { if (started !== generation) throw new Error('The session changed. Please try again.'); };
    const headers = { accept: 'application/json' };
    for (const [key, value] of Object.entries(input.headers || {})) {
      const lower = key.toLowerCase();
      if (!['authorization', 'content-type', 'accept', 'x-ufi-device-location'].includes(lower)) continue;
      if (typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 20000) throw new Error('Invalid request header.');
      if (lower === 'authorization' && value !== `Bearer ${token}`) throw new Error('The session changed. Please try again.');
      headers[lower] = value;
    }
    if (url === '/auth/session' && method === 'GET') {
      if (!token) return { status: 401, data: { message: 'Sign in to continue.' }, headers: { 'content-type': 'application/json' } };
      const sessionToken = token, sessionGeneration = generation;
      const result = await request({ url: '/profile', method: 'GET', timeout: timeoutMs, headers: { Authorization: `Bearer ${sessionToken}` } });
      if (sessionGeneration !== generation || sessionToken !== token) throw new Error('The session changed. Please try again.');
      return result.status === 200 ? { ...result, data: { token: sessionToken, profile: result.data.profile || result.data } } : result;
    }
    let body, timeout, cleanup = async () => {};
    try {
      if (input.data != null && !['GET', 'HEAD'].includes(method)) {
        if (input.data?.__ufiMultipart) {
          const upload = await multipart(validateMultipart(input.data)); body = upload.body; cleanup = upload.cleanup;
          delete headers['content-type'];
        } else {
          body = typeof input.data === 'string' ? input.data : JSON.stringify(input.data);
          if (utf8Bytes(body) > MAX_BYTES) throw new Error('This request is too large.');
          headers['content-type'] ||= 'application/json';
        }
      }
      // Preparing an upload writes temporary files asynchronously. Never send an
      // old account's bearer if sign-out or account replacement happened meanwhile.
      assertCurrent();
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetchRequest(apiBase + url, { method, headers, body, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
      assertCurrent();
      // Native transports vary in redirect support; check the final address too.
      if (response.url && !response.url.startsWith(apiBase + '/')) throw new Error('Untrusted API response.');
      const type = response.headers.get('content-type') || '';
      if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('This download exceeds 25 MB.');
      const responseHeaders = {};
      for (const key of ['content-type', 'content-disposition', 'retry-after']) { const value = response.headers.get(key); if (value) responseHeaders[key] = value; }
      const bytes = new Uint8Array(await response.arrayBuffer());
      assertCurrent();
      if (bytes.byteLength > MAX_BYTES) throw new Error('This response exceeds 25 MB.');
      let data, bodyType;
      if (/json|text\//i.test(type) || !bytes.length) {
        const text = new TextDecoder().decode(bytes);
        try { data = /json/i.test(type) && text ? JSON.parse(text) : text; } catch { throw new Error('The server returned an invalid response.'); }
      } else { data = bytesToBase64(bytes); bodyType = 'base64'; }
      if (started === generation && response.status < 300 && /^\/auth\/(?:login|register|phone\/(?:verify|complete-signup)|providers\/finish)$/.test(url) && validToken(data?.token)) {
        issued.add(data.token);
        if (issued.size > 4) issued.delete(issued.values().next().value);
      }
      return { status: response.status, data, headers: responseHeaders, ...(bodyType ? { bodyType } : {}) };
    } finally { clearTimeout(timeout); await cleanup(); assertCurrent(); }
  }
  async function restore() {
    const readGeneration = generation;
    const saved = await store.read();
    if (readGeneration !== generation) throw new Error('The session changed. Please try again.');
    if (!saved) return null;
    if (!validToken(saved)) { await store.clear(); return null; }
    token = saved;
    const restoredGeneration = generation;
    const result = await request({ url: '/profile', headers: { Authorization: `Bearer ${saved}` } });
    if (generation !== restoredGeneration || token !== saved) throw new Error('The session changed. Please try again.');
    if ([401, 403].includes(result.status)) { await persistSession(null); return null; }
    if (result.status !== 200 || !(result.data.profile || result.data)?.id) throw new Error('Could not restore your session. Check your connection and try again.');
    return { token: saved, profile: result.data.profile || result.data };
  }
  return { request, persistSession, restore, getToken: () => token, getGeneration: () => generation };
}

function allowDocumentNavigation(url, { development = false, documentUrl, bundleRoot } = {}) {
  if (url === 'about:blank') return !documentUrl;
  if (documentUrl) return url.split('#')[0] === documentUrl.split('#')[0];
  let decoded;
  try { decoded = decodeURIComponent(url); } catch { return false; }
  if (bundleRoot && decoded.startsWith(bundleRoot) && !decoded.split('/').includes('..') && /^file:\/\/[^?#]+\/[^/]+\.html(?:[?#].*)?$/.test(decoded)) return true;
  return development && /^http:\/\/(?:localhost|127\.0\.0\.1):\d+\//.test(url);
}
function externalUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\\]/.test(value)) throw new Error('This link cannot be opened.');
  if (/^https:\/\/[^/@?#]+(?:[/?#]|$)/i.test(value) || /^mailto:[^?]+(?:\?[^\r\n]*)?$/i.test(value) || /^tel:\+?[\d()-]+$/i.test(value)) return value;
  throw new Error('This link cannot be opened.');
}
function assertNativeCapability(expected, received) {
  if (typeof expected !== 'string' || expected.length < 40 || typeof received !== 'string' || received !== expected) throw new Error('Untrusted app request.');
}
module.exports = { MAX_BYTES, MAX_REQUEST_TIMEOUT, validToken, apiPath, bytesToBase64, base64Bytes, safeFileName, validateMultipart, createNativeApiBridge, allowDocumentNavigation, externalUrl, assertNativeCapability };
