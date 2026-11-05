// The bundled DOM app receives these capabilities from its native host. Normal
// website builds leave this module unconfigured and keep browser behavior.
import { sourceConnectionPath } from './components/sourceConnectionPath.mjs';

export const NATIVE_FILE_LIMIT = 25 * 1024 * 1024;
export const NATIVE_API_ORIGIN = 'https://api.uficonnect.org';
let runtime = null;
let initialSession = null;
let persistence = Promise.resolve();

export function configureNativeRuntime(value) {
  if (!value) { runtime = null; initialSession = null; return; }
  if (!['ios', 'android'].includes(value.nativePlatform) || typeof value.onApiRequest !== 'function') {
    throw new Error('The native application connection is unavailable.');
  }
  if (!runtime) initialSession = value.initialSession || null;
  runtime = value;
}
export function getNativeRuntime() { return runtime; }
export async function continueSourceConnectionInBrowser(platform, intent = {}) {
  if (!runtime) return false;
  // Provider callbacks bind to a browser cookie: start and finish there.
  // Keep only explicitly requested permission intent. No credentials, handles,
  // arbitrary return URLs, or provider authorization parameters cross here.
  const path = sourceConnectionPath(platform, { publishing: intent?.publishing === true, returnTo: intent?.returnTo });
  const params = new URLSearchParams(path.split('?')[1]);
  if (intent?.interactions === true) params.set('interactions', '1');
  if (platform === 'youtube' && (intent?.analytics === true || intent?.monetization === true)) params.set('analytics', '1');
  if (platform === 'youtube' && intent?.monetization === true) params.set('monetization', '1');
  const query = params.size ? `?${params}` : '';
  try {
    if (typeof runtime.onOpenExternal !== 'function') throw new Error('Unavailable');
    reportNativeError('Complete the connection in your browser, then return here to check its status.');
    await runtime.onOpenExternal(`https://uficonnect.org/connected-accounts${query}`);
    // iOS browser sheets may leave AppState active throughout. Their dismissal
    // still needs the same refresh signal as returning from an external app.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('focus'));
  } catch { reportNativeError('The browser could not be opened. Please try again.'); }
  return true;
}
export function isNativeRuntime() { return runtime !== null; }
export function subscribeNativeForeground(refresh, { window: win = globalThis.window, document: doc = globalThis.document,
  host = runtime } = {}) {
  if (!host || !win || !doc) return () => {};
  let active = true, queued = false;
  const schedule = () => {
    if (doc.hidden || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (active && !doc.hidden) refresh(); });
  };
  win.addEventListener('focus', schedule);
  doc.addEventListener('visibilitychange', schedule);
  return () => { active = false; win.removeEventListener('focus', schedule); doc.removeEventListener('visibilitychange', schedule); };
}
export async function nativeExternalOpen(value) {
  if (!runtime) { window.location.assign(value); return; }
  const url = new URL(value, 'https://uficonnect.org');
  if (url.username || url.password || !['https:', 'mailto:', 'tel:', 'uficonnect-vpn:'].includes(url.protocol)) throw new Error('This link cannot be opened.');
  if (url.origin === 'https://uficonnect.org' && !url.pathname.startsWith('/downloads/')) {
    window.dispatchEvent(new CustomEvent('ufi-native-navigate', { detail: { path: url.pathname + url.search + url.hash } }));
    return;
  }
  if (typeof runtime.onOpenExternal !== 'function') throw new Error('This link cannot be opened.');
  return runtime.onOpenExternal(url.href);
}
export function takeNativeInitialSession() {
  const session = initialSession;
  initialSession = null;
  return session;
}
export function reportNativeError(message = 'This device action could not complete. Please try again.') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ufi-native-error', { detail: { message } }));
}
export function persistNativeSession(token) {
  const host = runtime;
  if (!host) return Promise.resolve();
  if (token !== null && (typeof token !== 'string' || !token || token.length > 8192 || /\s/.test(token))) {
    return Promise.reject(new Error('The account session was invalid. Please sign in again.'));
  }
  const operation = persistence.catch(() => {}).then(async () => {
    if (runtime !== host && runtime?.onPersistSession !== host.onPersistSession) throw new Error('The application session changed.');
    if (typeof host.onPersistSession !== 'function') throw new Error('Secure account storage is unavailable.');
    await host.onPersistSession(token);
  });
  persistence = operation;
  return operation;
}

export function nativeApiPath(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || value !== value.trim() || /[\\\u0000-\u0020\u007f]/.test(value)
    || /%(?:00|0a|0d|5c)/i.test(value)) {
    throw new Error('Invalid application request.');
  }
  if (value.startsWith(NATIVE_API_ORIGIN + '/')) value = value.slice(NATIVE_API_ORIGIN.length);
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('#')) throw new Error('Invalid application request.');
  if (value.split('?')[0].split('/').some(part => { try { return ['.', '..'].includes(decodeURIComponent(part)); } catch { return true; } })) throw new Error('Invalid application request.');
  const url = new URL(value, NATIVE_API_ORIGIN);
  if (url.origin !== NATIVE_API_ORIGIN || url.pathname.startsWith('//')) throw new Error('Invalid application request.');
  return url.pathname + url.search;
}
export function nativeRequestHeaders(input = {}) {
  const result = {};
  const entries = typeof input.entries === 'function' ? input.entries() : Object.entries(input);
  for (const [name, value] of entries) {
    if (!/^(?:accept|content-type|authorization|x-ufi-device-location|if-none-match)$/i.test(name)) continue;
    if (value === undefined || value === null || value === false) continue;
    if (typeof value !== 'string' || /[\r\n\u0000]/.test(value) || value.length > 16384) throw new Error('Invalid application headers.');
    result[name] = value;
  }
  return result;
}

function sizeError() { return new Error('Choose files totaling 25 MB or less for this app action.'); }
export function bytesToBase64(bytes) {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) value += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(value);
}
export function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(NATIVE_FILE_LIMIT / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('The downloaded file is invalid or larger than 25 MB.');
  }
  const decoded = atob(value);
  if (decoded.length > NATIVE_FILE_LIMIT) throw sizeError();
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
export async function serializeNativeBody(data) {
  if (data === undefined || data === null) return data ?? null;
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    const fields = [];
    let total = 0;
    for (const [name, value] of data.entries()) {
      if (fields.length >= 128 || !name || name.length > 120 || /[\r\n\u0000]/.test(name)) throw new Error('This upload has too many fields.');
      if (typeof value === 'string') {
        total += new TextEncoder().encode(value).length;
        if (total > NATIVE_FILE_LIMIT) throw sizeError();
        fields.push({ name, value });
      } else {
        total += value.size;
        if (!Number.isFinite(value.size) || total > NATIVE_FILE_LIMIT) throw sizeError();
        const bytes = new Uint8Array(await value.arrayBuffer());
        if (bytes.length !== value.size) throw new Error('The selected file changed. Please select it again.');
        fields.push({ name, file: { name: String(value.name || 'attachment').replace(/[\\/\r\n\u0000]/g, '_').slice(0, 180),
          type: value.type || 'application/octet-stream', base64: bytesToBase64(bytes) } });
      }
    }
    return { __ufiMultipart: true, fields };
  }
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) return data.toString();
  if (typeof Blob !== 'undefined' && data instanceof Blob) throw new Error('Use the file upload control for this action.');
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  if (new TextEncoder().encode(serialized).length > NATIVE_FILE_LIMIT) throw sizeError();
  return data;
}
export async function nativeApiRequest({ url, method = 'GET', data = null, headers = {}, responseType, timeout, signal } = {}, host = runtime) {
  if (!host || typeof host.onApiRequest !== 'function') throw new Error('The native application connection is unavailable.');
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const verb = String(method).toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(verb)) throw new Error('Invalid application request method.');
  if (timeout != null && (!Number.isInteger(timeout) || timeout < 0 || timeout > 240000)) throw new Error('Invalid application request timeout.');
  const payload = await serializeNativeBody(data);
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const cleanHeaders = nativeRequestHeaders(headers);
  if (payload?.__ufiMultipart) for (const name of Object.keys(cleanHeaders)) if (name.toLowerCase() === 'content-type') delete cleanHeaders[name];
  const result = await host.onApiRequest({ url: nativeApiPath(url), method: verb, data: payload, headers: cleanHeaders,
    ...(timeout != null ? { timeout } : {}),
    ...(['blob', 'arraybuffer'].includes(responseType) ? { responseType } : {}) });
  if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 599) throw new Error('The server response was invalid.');
  return result;
}

export function nativeLocationNavigator(host = runtime) {
  if (!host) return globalThis.navigator;
  return { geolocation: { getCurrentPosition(success, failure) {
    Promise.resolve().then(() => {
      if (typeof host.onRequestLocation !== 'function') throw new Error('Device location is unavailable.');
      return host.onRequestLocation();
    }).then(result => {
      const { latitude, longitude, accuracy } = result?.coords || {};
      if (![latitude, longitude, accuracy, result?.timestamp].every(Number.isFinite)
        || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) throw new Error('Device location is unavailable.');
      success(result);
    }).catch(() => failure?.({ code: 1, message: 'Location could not be obtained. Check this app’s device permissions.' }));
  } } };
}
export function startNativeProviderSignIn(provider, mode, host = runtime) {
  if (!host || !['google', 'apple'].includes(provider) || !['login', 'signup', 'link'].includes(mode)
    || typeof host.onProviderSignIn !== 'function') return Promise.reject(new Error('This sign-in method is unavailable.'));
  return host.onProviderSignIn(provider, mode);
}

export function nativeFetch(input, options = {}, host = runtime) {
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
  return nativeApiRequest({ url: String(input), method: options.method || 'GET', data: options.body,
    headers: options.headers || {}, signal }, host).then(result => {
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const body = [101, 204, 205, 304].includes(result.status) ? null : result.bodyType === 'base64'
      ? base64ToBytes(result.data) : typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? null);
    return new Response(body, { status: result.status, headers: result.headers || {} });
  });
}

export function installNativeBrowserAdapters({ window: win = globalThis.window, document: doc = globalThis.document,
  navigator: browser = globalThis.navigator, host = runtime } = {}) {
  if (!host || !win || !doc) return () => {};
  const originalFetch = win.fetch.bind(win);
  const originalOpen = win.open;
  const anchorPrototype = win.HTMLAnchorElement?.prototype;
  const originalAnchorClick = anchorPrototype?.click;
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(browser, 'clipboard');
  const visibilityDescriptors = Object.fromEntries(['hidden', 'visibilityState'].map(name => [name, Object.getOwnPropertyDescriptor(doc, name)]));
  for (const name of ['hidden', 'visibilityState']) {
    try { Object.defineProperty(doc, name, { configurable: true, get() {
      const activeHost = runtime?.onApiRequest === host.onApiRequest ? runtime : host;
      const hidden = activeHost.nativeAppActive === false;
      return name === 'hidden' ? hidden : hidden ? 'hidden' : 'visible';
    } }); } catch { /* Hosts without configurable visibility keep native DOM state. */ }
  }
  let disposed = false;
  const report = () => reportNativeError();
  const navigate = path => win.dispatchEvent(new CustomEvent('ufi-native-navigate', { detail: { path } }));
  const external = async value => {
    const url = new URL(value, 'https://uficonnect.org');
    if (url.username || url.password || !['https:', 'mailto:', 'tel:', 'uficonnect-vpn:'].includes(url.protocol)) throw new Error('This link cannot be opened.');
    if (url.origin === 'https://uficonnect.org' && !url.pathname.startsWith('/downloads/')) { navigate(url.pathname + url.search + url.hash); return; }
    if (typeof host.onOpenExternal !== 'function') throw new Error('This link cannot be opened.');
    await host.onOpenExternal(url.href);
  };
  const share = async (href, name) => {
    if (typeof host.onShareFile !== 'function') throw new Error('File sharing is unavailable.');
    const response = href.startsWith(NATIVE_API_ORIGIN + '/') ? await nativeFetch(href, {}, host) : await originalFetch(href);
    if (!response.ok) throw new Error('The file could not be downloaded.');
    if (Number(response.headers.get('content-length')) > NATIVE_FILE_LIMIT) throw sizeError();
    const blob = await response.blob();
    if (blob.size > NATIVE_FILE_LIMIT) throw sizeError();
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    if (!disposed) await host.onShareFile({ name: String(name || 'download').replace(/[\\/\r\n\u0000]/g, '_').slice(0, 180),
      type: blob.type || 'application/octet-stream', base64 });
  };
  const onClick = event => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || event.defaultPrevented || event.button > 0) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    if (href.startsWith('#')) {
      navigate(href);
    } else if (/^https:\/\/uficonnect\.org\/downloads\//.test(href) || href.startsWith('/downloads/')) {
      void external(href).catch(report);
    } else if (anchor.hasAttribute('download') || href.startsWith('blob:')) {
      void share(anchor.href, anchor.getAttribute('download')).catch(error => reportNativeError(error.message === sizeError().message ? error.message : 'The file could not be saved. Please try again.'));
    } else void external(href).catch(report);
  };
  // Let React Router and component click handlers run first so Link state,
  // replace navigation and unsaved-work guards remain intact. This bubbling
  // listener still cancels the browser's default navigation for plain anchors.
  doc.addEventListener('click', onClick);
  // Several export controls click detached anchors. They never bubble to the
  // document listener, so route those clicks through the same file handoff.
  if (anchorPrototype && originalAnchorClick) anchorPrototype.click = function () {
    if (this.isConnected) return originalAnchorClick.call(this);
    onClick({ target: this, button: 0, defaultPrevented: false, preventDefault() {} });
  };
  win.open = url => { void external(String(url)).catch(report); return null; };
  win.fetch = (input, options = {}) => typeof input === 'string' && input.startsWith(NATIVE_API_ORIGIN + '/')
    ? nativeFetch(input, options, host) : originalFetch(input, options);
  try {
    Object.defineProperty(browser, 'clipboard', { configurable: true, value: { writeText: async text => {
      if (typeof text !== 'string' || text.length > 1024 * 1024 || typeof host.onCopyText !== 'function') throw new Error('Clipboard is unavailable.');
      await host.onCopyText(text);
    } } });
  } catch { /* Unsupported host APIs remain unavailable; no insecure fallback. */ }
  return () => {
    disposed = true;
    doc.removeEventListener('click', onClick);
    win.fetch = originalFetch;
    win.open = originalOpen;
    if (anchorPrototype && originalAnchorClick) anchorPrototype.click = originalAnchorClick;
    for (const name of ['hidden', 'visibilityState']) {
      try { if (visibilityDescriptors[name]) Object.defineProperty(doc, name, visibilityDescriptors[name]); else delete doc[name]; } catch {}
    }
    try { if (clipboardDescriptor) Object.defineProperty(browser, 'clipboard', clipboardDescriptor); else delete browser.clipboard; } catch {}
  };
}
