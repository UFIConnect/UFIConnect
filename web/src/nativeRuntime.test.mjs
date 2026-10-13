import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { configureNativeRuntime, getNativeRuntime, takeNativeInitialSession, persistNativeSession,
  nativeApiPath, nativeRequestHeaders, serializeNativeBody, nativeApiRequest, nativeFetch,
  bytesToBase64, base64ToBytes, NATIVE_FILE_LIMIT, nativeLocationNavigator, startNativeProviderSignIn,
  installNativeBrowserAdapters, continueSourceConnectionInBrowser, subscribeNativeForeground } from './nativeRuntime.mjs';
import { createNativeAxiosAdapter } from './api/nativeAdapter.mjs';
import { createNativeFeedPolling } from './api/nativePolling.mjs';
import { clearSession, clearSessionCaches, getAccessToken, setAccessToken, subscribeToSession, privateSessionStorage } from './auth/session.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const host = extra => ({ nativePlatform: 'ios', onApiRequest: async () => ({ status: 200, data: {} }), ...extra });
test.afterEach(() => { configureNativeRuntime(null); setAccessToken(null); });

test('native configuration and bootstrap remain memory-only and are consumed once', () => {
  assert.throws(() => configureNativeRuntime({ nativePlatform: 'web' }));
  const initialSession = { token: 'test-token', profile: { id: 'test-member' } };
  const runtime = host({ initialSession });
  configureNativeRuntime(runtime);
  assert.equal(takeNativeInitialSession(), initialSession);
  configureNativeRuntime({ ...runtime });
  assert.equal(takeNativeInitialSession(), null);
  configureNativeRuntime(null);
  assert.equal(getNativeRuntime(), null);
});

test('API bridge accepts only relative canonical paths', () => {
  assert.equal(nativeApiPath('/profile?view=private'), '/profile?view=private');
  assert.equal(nativeApiPath('https://api.uficonnect.org/feed?limit=20'), '/feed?limit=20');
  for (const value of ['//evil.example/profile', 'https://evil.example/profile', 'https://api.uficonnect.org.evil.example/profile', '/profile#token', ' /profile', '/a\\b', 'data:text/plain,hello', '/profile\n', '/feed/../profile', '/feed/%2e%2e/profile', '/profile%0a']) {
    assert.throws(() => nativeApiPath(value), value);
  }
});

test('bridge header allowlist drops cookies, origin, proxy headers and undefined values', () => {
  assert.deepEqual(nativeRequestHeaders({ Authorization: 'Bearer test-token', Cookie: 'private', Origin: 'null', 'X-Forwarded-Host': 'evil', Accept: 'application/json', 'Content-Type': undefined }), { Authorization: 'Bearer test-token', Accept: 'application/json' });
  assert.throws(() => nativeRequestHeaders({ Authorization: 'Bearer test\r\ninject' }));
});

test('multipart serialization preserves fields and bytes while removing boundary headers', async () => {
  const form = new FormData(); form.append('description', 'résumé'); form.append('file', new Blob([new Uint8Array([0, 255, 42])], { type: 'application/pdf' }), 'resume.pdf');
  let received;
  await nativeApiRequest({ url: '/profile/attachments', method: 'post', data: form, headers: { 'Content-Type': 'multipart/form-data', Authorization: 'Bearer test-token' } }, host({ onApiRequest: async request => { received = request; return { status: 201, data: { id: 1 } }; } }));
  assert.equal(received.method, 'POST');
  assert.equal(received.headers['Content-Type'], undefined);
  assert.deepEqual(received.data.fields[0], { name: 'description', value: 'résumé' });
  assert.deepEqual([...base64ToBytes(received.data.fields[1].file.base64)], [0, 255, 42]);
  assert.equal(received.data.fields[1].file.name, 'resume.pdf');
});

test('oversized and excessive multipart fields fail before calling native actions', async () => {
  const large = new FormData(); large.append('file', new Blob([new Uint8Array(NATIVE_FILE_LIMIT + 1)]), 'large.bin');
  await assert.rejects(serializeNativeBody(large), /25 MB/);
  const many = new FormData(); for (let index = 0; index < 129; index++) many.append(String(index), 'value');
  await assert.rejects(serializeNativeBody(many), /too many/);
  await assert.rejects(serializeNativeBody(new Blob(['raw'])), /upload control/);
});

test('binary bridge validation rejects corrupt bytes and invalid status', async () => {
  assert.equal(bytesToBase64(new Uint8Array([1, 2, 3])), 'AQID');
  for (const value of ['!', 'A', 'AQ===']) assert.throws(() => base64ToBytes(value));
  await assert.rejects(nativeApiRequest({ url: '/profile' }, host({ onApiRequest: async () => ({ status: 101 }) })), /invalid/);
  await assert.rejects(nativeApiRequest({ url: '/profile', method: 'TRACE' }, host()), /method/);
});

test('native fetch exposes JSON, binary and no-content responses without browser cookies', async () => {
  let received;
  const runtime = host({ onApiRequest: async request => { received = request; return { status: 200, data: { count: 1 }, headers: { 'content-type': 'application/json' } }; } });
  const response = await nativeFetch('https://api.uficonnect.org/analytics/pageview', { method: 'POST', body: '{}', credentials: 'include', headers: { Cookie: 'ignored' } }, runtime);
  assert.deepEqual(await response.json(), { count: 1 });
  assert.deepEqual(received.headers, {});
  const binary = await nativeFetch('/file', {}, host({ onApiRequest: async () => ({ status: 200, bodyType: 'base64', data: 'AQID' }) }));
  assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [1, 2, 3]);
  const empty = await nativeFetch('/file', {}, host({ onApiRequest: async () => ({ status: 204 }) }));
  assert.equal(await empty.text(), '');
});

test('session replacement persists new credential without transient null or browser storage', async () => {
  const persisted = [], notifications = [];
  configureNativeRuntime(host({ onPersistSession: async value => persisted.push(value) }));
  setAccessToken('old-token'); privateSessionStorage.setItem('member-cache', 'old-member');
  const unsubscribe = subscribeToSession(value => notifications.push(value));
  await persistNativeSession('new-token'); clearSessionCaches(); setAccessToken('new-token');
  assert.deepEqual(persisted, ['new-token']);
  assert.deepEqual(notifications, ['new-token']);
  assert.equal(privateSessionStorage.getItem('member-cache'), null);
  assert.equal(getAccessToken(), 'new-token');
  assert.equal(await clearSession(), true);
  assert.deepEqual(persisted, ['new-token', null]);
  unsubscribe();
});

test('secure storage writes serialize and logout wins an in-flight acceptance', async () => {
  const writes = []; let release;
  configureNativeRuntime(host({ onPersistSession: async value => { writes.push(value); if (value === 'new-token') await new Promise(resolve => { release = resolve; }); } }));
  const first = persistNativeSession('new-token'); const logout = persistNativeSession(null);
  await flush(); assert.deepEqual(writes, ['new-token']);
  release(); await Promise.all([first, logout]); assert.deepEqual(writes, ['new-token', null]);
  await assert.rejects(persistNativeSession('bad token'), /invalid/);
});

test('geolocation delegates to native permission action and rejects malformed coordinates', async () => {
  const result = { coords: { latitude: 30, longitude: 40, accuracy: 12 }, timestamp: Date.now() };
  const navigator = nativeLocationNavigator(host({ onRequestLocation: async () => result }));
  assert.equal(await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject)), result);
  const invalid = nativeLocationNavigator(host({ onRequestLocation: async () => ({ ...result, coords: { ...result.coords, latitude: 100 } }) }));
  await assert.rejects(new Promise((resolve, reject) => invalid.geolocation.getCurrentPosition(resolve, reject)), error => error.code === 1);
});

test('provider actions allow native Google/Apple login/signup/link only', async () => {
  const calls = []; const runtime = host({ onProviderSignIn: async (...args) => { calls.push(args); return { token: 'new-token' }; } });
  await startNativeProviderSignIn('google', 'link', runtime);
  await startNativeProviderSignIn('apple', 'signup', runtime);
  assert.deepEqual(calls, [['google', 'link'], ['apple', 'signup']]);
  await assert.rejects(startNativeProviderSignIn('evil', 'login', runtime));
  await assert.rejects(startNativeProviderSignIn('google', 'other', runtime));
});

test('Axios native adapter retains query params, JSON, status errors and binary responses', async () => {
  let received;
  const client = axios.create({ adapter: createNativeAxiosAdapter(async request => { received = request; return { status: 200, data: { id: 1 } }; }) });
  assert.deepEqual((await client.get('/profile', { params: { select: 'a b' } })).data, { id: 1 });
  assert.equal(received.url, '/profile?select=a+b');
  const denied = axios.create({ adapter: createNativeAxiosAdapter(async () => ({ status: 401, data: { error: 'expired' } })) });
  await assert.rejects(denied.get('/profile'), error => error.response.status === 401 && error.config.url === '/profile');
  const binary = axios.create({ adapter: createNativeAxiosAdapter(async () => ({ status: 200, data: 'AQID', bodyType: 'base64', headers: { 'content-type': 'application/pdf' } })) });
  const { data } = await binary.get('/file', { responseType: 'blob' });
  assert.equal(data.type, 'application/pdf'); assert.deepEqual([...new Uint8Array(await data.arrayBuffer())], [1, 2, 3]);
});

test('Axios abort and timeout stop delivering late native results', async () => {
  const client = axios.create({ adapter: createNativeAxiosAdapter(() => new Promise(() => {})) });
  const controller = new AbortController(); const pending = client.get('/profile', { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, error => axios.isCancel(error));
  await assert.rejects(client.get('/profile', { timeout: 5 }), error => error.code === 'ECONNABORTED');
});

test('Axios preserves generation and upload time budgets through the native action bridge', async () => {
  const requests = [];
  configureNativeRuntime(host({ onApiRequest: async input => { requests.push(input); return { status: 200, data: { ok: true } }; } }));
  const client = axios.create({ adapter: createNativeAxiosAdapter() });
  for (const timeout of [60000, 90000, 180000, 240000]) {
    await client.post('/command-center/content-draft', {}, { timeout });
    assert.equal(requests.at(-1).timeout, timeout);
  }
  for (const timeout of [-1, '180000', 0.5, Infinity, 240001]) {
    await assert.rejects(nativeApiRequest({ url: '/profile', timeout }), /Invalid application request timeout/);
  }
  assert.equal(requests.length, 4, 'Invalid requests never cross into the native host');
});

test('canceling while attachment bytes are being read prevents native upload dispatch', async () => {
  let finishRead, requests = 0;
  const form = new FormData(); form.append('file', new Blob(['attachment']), 'attachment.txt');
  form.get('file').arrayBuffer = () => new Promise(resolve => { finishRead = resolve; });
  const controller = new AbortController();
  const pending = nativeApiRequest({ url: '/profile/upload', method: 'POST', data: form, signal: controller.signal },
    host({ onApiRequest: async () => { requests++; return { status: 200, data: {} }; } }));
  await flush();
  controller.abort();
  finishRead(new TextEncoder().encode('attachment').buffer);
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(requests, 0);
});

test('a timed-out upload never dispatches after attachment serialization finally completes', async () => {
  let finishRead, requests = 0;
  configureNativeRuntime(host({ onApiRequest: async () => { requests++; return { status: 200, data: {} }; } }));
  const form = new FormData(); form.append('file', new Blob(['attachment']), 'attachment.txt');
  form.get('file').arrayBuffer = () => new Promise(resolve => { finishRead = resolve; });
  const client = axios.create({ adapter: createNativeAxiosAdapter() });
  await assert.rejects(client.post('/profile/upload', form, { timeout: 5 }), error => error.code === 'ECONNABORTED');
  finishRead(new TextEncoder().encode('attachment').buffer);
  await flush();
  assert.equal(requests, 0);
});

test('native polling stops on account changes and discards late results', async () => {
  let token = 'first', deliver, scheduled = 0, received = 0;
  const stream = createNativeFeedPolling(token, { currentToken: () => token, request: () => new Promise(resolve => { deliver = resolve; }), schedule: () => { scheduled++; }, unschedule: () => {} });
  stream.onmessage = () => received++;
  await flush(); token = 'second'; deliver({ data: { posts: [{ id: 'private' }] } }); await flush();
  assert.equal(received, 0); assert.equal(scheduled, 0); stream.close();
});

test('native polling pauses while hidden and preserves the feed message shape', async () => {
  let run, reads = 0, message;
  const page = { hidden: true };
  const stream = createNativeFeedPolling('token', { currentToken: () => 'token', document: page, request: async () => { reads++; return { data: { posts: [{ id: 'post' }] } }; }, schedule: callback => { run = callback; return 1; }, unschedule: () => {} });
  stream.onmessage = event => { message = JSON.parse(event.data); };
  await flush(); assert.equal(reads, 0); page.hidden = false; await run();
  assert.deepEqual(message, { posts: [{ id: 'post' }] }); stream.close();
});

test('browser adapters preserve ordinary website behavior when native runtime is absent', () => {
  let calls = 0; const window = { fetch() { calls++; } }; const original = window.fetch;
  installNativeBrowserAdapters({ window, document: {}, navigator: {}, host: null })();
  assert.equal(window.fetch, original); assert.equal(calls, 0);
});

test('native anchors, detached downloads and clipboard use host actions and clean up', async () => {
  const events = [], external = [], shared = [], copied = [];
  let click;
  class Anchor { constructor(href, download = null) { this.href = href; this.download = download; this.isConnected = false; } getAttribute(name) { return name === 'href' ? this.href : this.download; } hasAttribute() { return this.download !== null; } closest() { return this; } click() { throw new Error('DOM navigation must be intercepted'); } }
  const originalClick = Anchor.prototype.click;
  const window = { fetch: async () => new Response(new Blob(['content'], { type: 'text/plain' })), open() {}, HTMLAnchorElement: Anchor, dispatchEvent: event => { events.push(event); } };
  const document = { addEventListener: (_name, listener) => { click = listener; }, removeEventListener: () => { click = null; } };
  const navigator = {};
  const cleanup = installNativeBrowserAdapters({ window, document, navigator, host: host({ onOpenExternal: async url => external.push(url), onShareFile: async file => shared.push(file), onCopyText: async text => copied.push(text) }) });
  click({ target: new Anchor('/settings?tab=privacy'), button: 0, preventDefault() {} });
  assert.equal(events[0].detail.path, '/settings?tab=privacy');
  click({ target: new Anchor('/login'), button: 0, defaultPrevented: true, preventDefault() { throw new Error('Router-handled clicks must be preserved'); } });
  assert.equal(events.length, 1, 'A React Router click is not replaced by a path-only native event');
  click({ target: new Anchor('#email'), button: 0, preventDefault() {} });
  assert.equal(events[1].detail.path, '#email', 'Plain hash links go to the native router instead of changing the file document');
  new Anchor('https://example.org/article').click();
  new Anchor('https://uficonnect.org/downloads/client.exe', 'client.exe').click();
  new Anchor('blob:local-file', 'download.txt').click();
  await navigator.clipboard.writeText('test-copy'); await flush();
  assert.deepEqual(external, ['https://example.org/article', 'https://uficonnect.org/downloads/client.exe']); assert.deepEqual(copied, ['test-copy']);
  assert.equal(shared[0].name, 'download.txt'); assert.equal(atob(shared[0].base64), 'content');
  cleanup(); assert.equal(Anchor.prototype.click, originalClick); assert.equal(click, null); assert.equal(navigator.clipboard, undefined);
});

test('native social linking starts on website in system browser without a cookie-bound API request', async () => {
  const urls = []; let apiCalls = 0;
  configureNativeRuntime(host({ onApiRequest: async () => { apiCalls++; }, onOpenExternal: async url => urls.push(url) }));
  assert.equal(await continueSourceConnectionInBrowser('google'), true);
  assert.equal(await continueSourceConnectionInBrowser('mastodon'), true);
  assert.deepEqual(urls, ['https://uficonnect.org/connected-accounts', 'https://uficonnect.org/connected-accounts?connect=mastodon']);
  assert.equal(apiCalls, 0);
});

test('native creator-revenue handoff preserves explicit YouTube permissions without starting OAuth', async () => {
  const urls = []; let apiCalls = 0;
  configureNativeRuntime(host({ onApiRequest: async () => { apiCalls++; }, onOpenExternal: async url => urls.push(url) }));
  await continueSourceConnectionInBrowser('youtube', { analytics: true, monetization: true });
  await continueSourceConnectionInBrowser('youtube', { monetization: true });
  for (const value of urls) {
    const url = new URL(value);
    assert.equal(url.origin, 'https://uficonnect.org');
    assert.equal(url.pathname, '/connected-accounts');
    assert.equal(url.searchParams.get('analytics'), '1');
    assert.equal(url.searchParams.get('monetization'), '1');
    assert.equal(url.searchParams.size, 2);
  }
  assert.equal(apiCalls, 0, 'The browser must ask for authorization using its own cookie-bound flow');
});

test('native source connection does not add revenue permission to an ordinary or analytics-only connection', async () => {
  const urls = [];
  configureNativeRuntime(host({ onOpenExternal: async url => urls.push(url) }));
  await continueSourceConnectionInBrowser('youtube');
  await continueSourceConnectionInBrowser('youtube', { analytics: true });
  await continueSourceConnectionInBrowser('youtube', { analytics: '1', monetization: '1', interactions: '1' });
  assert.equal(new URL(urls[0]).search, '');
  assert.equal(new URL(urls[1]).search, '?analytics=1');
  assert.equal(new URL(urls[2]).search, '');
});

test('native handoff confines permission intent and never copies credentials or arbitrary return destinations', async () => {
  const urls = [];
  configureNativeRuntime(host({ onOpenExternal: async url => urls.push(url) }));
  await continueSourceConnectionInBrowser('mastodon', { analytics: true, monetization: true, interactions: true,
    returnTo: 'command-center', access_token: 'private-sentinel', server: 'https://private.example', scope: 'extra' });
  const url = new URL(urls[0]);
  assert.deepEqual(Object.fromEntries(url.searchParams), { connect: 'mastodon', interactions: '1', returnTo: 'command-center' });
  await continueSourceConnectionInBrowser('youtube', { returnTo: 'https://external.invalid/' });
  assert.equal(new URL(urls[1]).search, '');
  configureNativeRuntime(null);
  assert.equal(await continueSourceConnectionInBrowser('youtube', { monetization: true }), false, 'Website keeps its existing OAuth flow');
  assert.equal(urls.length, 2);
});

test('native visibility follows AppState and coalesces refresh signals without background work', async () => {
  const window = new EventTarget(); window.fetch = async () => new Response(''); window.open = () => {};
  const document = new EventTarget();
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
  const runtime = host({ nativeAppActive: true }); configureNativeRuntime(runtime);
  const cleanup = installNativeBrowserAdapters({ window, document, navigator: {}, host: runtime });
  let refreshes = 0;
  const unsubscribe = subscribeNativeForeground(() => { refreshes++; }, { window, document, host: runtime });
  assert.equal(document.hidden, false); assert.equal(document.visibilityState, 'visible');
  configureNativeRuntime({ ...runtime, nativeAppActive: false });
  assert.equal(document.hidden, true); assert.equal(document.visibilityState, 'hidden');
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(refreshes, 0);
  configureNativeRuntime({ ...runtime, nativeAppActive: true });
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(refreshes, 1);
  window.dispatchEvent(new Event('focus')); unsubscribe(); await flush();
  assert.equal(refreshes, 1, 'Unmount must discard a queued foreground refresh');
  cleanup(); assert.deepEqual(Object.getOwnPropertyDescriptor(document, 'hidden'), originalHidden);
  assert.equal(Object.hasOwn(document, 'visibilityState'), false);
});
