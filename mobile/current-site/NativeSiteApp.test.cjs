const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('@babel/core');
const compiled = transformSync(fs.readFileSync(path.join(__dirname, 'NativeSiteApp.jsx'), 'utf8'), {
  filename: path.join(__dirname, 'NativeSiteApp.jsx'), configFile: false, babelrc: false,
  plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;
const ROOT = 'file:///private/var/containers/Bundle/Application/FIXTURE/UFIConnect.app/www.bundle/';
const HTML = '8539e9980b054248b499ea83f6c44b00.html';
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute the actual native shell with dependency-injected native services and
// React hooks. This checks its startup wiring; it is not an iOS device test.
function harness({ development = false, present = true, platform = 'ios', providerRequests = false } = {}) {
  const slots = [], effects = [], directoryCalls = [], storageCalls = [];
  const browserCalls = [], authBrowserCalls = [], appStateListeners = new Set(), secureValues = new Map();
  let cursor = 0, networkCalls = 0, stateWrites = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
    useState(initial) { const index = cursor++; slots[index] ||= { value: initial }; return [slots[index].value, value => { stateWrites++; slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; slots[index] ||= { current: initial }; return slots[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn; },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { slots[index] = { ...slots[index], deps }; effects.push({ index, fn }); } },
  };
  class File { constructor(uri) { this.uri = uri; this.name = HTML; this.exists = true; } }
  class Directory {
    constructor(base, name) { directoryCalls.push({ base, name }); this.uri = platform === 'android' ? 'asset:///www.bundle/' : ROOT; this.exists = present; }
    list() { return [new File(this.uri + HTML)]; }
  }
  const bundle = { uri: platform === 'android' ? 'asset://' : ROOT.replace('www.bundle/', '') };
  const Website = function WebsiteFixture() {};
  const NativeYouTubeLayer = function NativeYouTubeLayerFixture() {};
  const AppState = { currentState: 'active', addEventListener: (_name, listener) => {
    appStateListeners.add(listener); return { remove: () => appStateListeners.delete(listener) };
  } };
  const browserOperation = (calls, url) => new Promise((resolve, reject) => calls.push({ url, resolve, reject }));
  const imports = {
    react: React,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Alert: { alert() {} }, AppState,
      Linking: { getInitialURL: async () => null }, Platform: { OS: platform }, Pressable: 'Pressable', StyleSheet: { create: value => value }, Text: 'Text', View: 'View', useColorScheme: () => 'light' },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'expo-secure-store': { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1, getItemAsync: async key => secureValues.get(key) || null,
      setItemAsync: async (key, value) => secureValues.set(key, value), deleteItemAsync: async key => secureValues.delete(key) },
    '@react-native-async-storage/async-storage': { removeItem: async key => { storageCalls.push(key); } },
    'expo-web-browser': { WebBrowserPresentationStyle: { PAGE_SHEET: 'page-sheet' },
      openBrowserAsync: url => browserOperation(browserCalls, url), openAuthSessionAsync: url => browserOperation(authBrowserCalls, url) },
    'expo-location': {}, 'expo-clipboard': {}, 'expo-sharing': {},
    'expo-crypto': { getRandomBytes: count => new Uint8Array(count).fill(1) },
    'expo-file-system': { File, Directory, Paths: { get bundle() { if (development) throw new Error('Development must not inspect bundle paths'); return bundle; } } },
    'expo-file-system/legacy': {}, 'expo/fetch': { fetch: async url => {
      networkCalls++;
      if (providerRequests && url === 'https://api.uficonnect.org/auth/providers/google/start') return new Response(JSON.stringify({ verifier: 'A'.repeat(32), authorizationUrl: 'https://accounts.google.com/fixture' }), { headers: { 'content-type': 'application/json' } });
      if (providerRequests && url === 'https://api.uficonnect.org/auth/providers/finish') return new Response(JSON.stringify({ token: 'e30.e30.fixture', profile: { id: 'provider-fixture' } }), { headers: { 'content-type': 'application/json' } });
      throw new Error('No networking in startup test');
    } },
    './Website': Website,
    './NativeYouTubeLayer': NativeYouTubeLayer,
    './AndroidVpnAccess': function AndroidVpnAccessFixture() {},
    '../native-vpn/client': { disconnectVpnSession: async () => ({ stopped: true, revoked: true }) },
    '../native-vpn/launchClient': { vpnLaunch: { open: () => false } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__DEV__', compiled)(name => Object.hasOwn(imports, name) ? imports[name] : require(path.resolve(__dirname, name)), module, module.exports, development);
  const NativeSite = module.exports.default().props.children.type;
  const render = () => { cursor = 0; return NativeSite(); };
  async function startup() {
    render();
    for (const { index, fn } of effects.splice(0)) { slots[index].cleanup?.(); slots[index].cleanup = fn(); }
    await tick();
    return render();
  }
  function find(tree, type) {
    if (!tree || typeof tree !== 'object') return null;
    if (tree.type === type) return tree;
    for (const child of [tree.props?.children].flat()) { const found = find(child, type); if (found) return found; }
    return null;
  }
  function text(tree) {
    if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
    return [tree?.props?.children].flat().map(child => child && typeof child === 'object' ? text(child) : typeof child === 'string' ? child : '').join(' ');
  }
  return { startup, render, find, text, Website, NativeYouTubeLayer, directoryCalls, storageCalls, browserCalls, authBrowserCalls,
    networkCalls: () => networkCalls, stateWrites: () => stateWrites,
    appState(state) { AppState.currentState = state; for (const listener of appStateListeners) listener(state); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    media() { const tree = render(); return { website: find(tree, Website)?.props.nativeAppActive, youtube: find(tree, NativeYouTubeLayer)?.props.active }; },
  };
}

test('native production startup mounts only a verified absolute local document and matching read scope', async () => {
  const h = harness();
  const tree = await h.startup(), website = h.find(tree, h.Website);
  assert.ok(website);
  assert.equal(h.directoryCalls.length, 1);
  assert.equal(h.directoryCalls[0].name, 'www.bundle');
  assert.equal(website.props.dom.overrideUri, ROOT + HTML);
  assert.equal(website.props.dom.allowingReadAccessToURL, ROOT);
  assert.equal(website.props.dom.allowUniversalAccessFromFileURLs, false);
  assert.equal(website.props.dom.onShouldStartLoadWithRequest({ url: ROOT + 'other.html', isTopFrame: true }), false);
  assert.equal(website.props.dom.onShouldStartLoadWithRequest({ url: 'about:blank', isTopFrame: true }), true);
  assert.equal(website.props.dom.onShouldStartLoadWithRequest({ url: ROOT + HTML, isTopFrame: true }), true);
  assert.equal(website.props.dom.onShouldStartLoadWithRequest({ url: 'about:blank', isTopFrame: true }), false);
  assert.equal(website.props.dom.onShouldStartLoadWithRequest({ url: 'https://uficonnect.org/', isTopFrame: true }), false);
  assert.equal(h.networkCalls(), 0);
});

test('native missing-document startup shows recovery before session restore or WebView mount', async () => {
  const h = harness({ present: false });
  const tree = await h.startup();
  assert.equal(h.find(tree, h.Website), null);
  assert.match(h.text(tree), /bundled page is missing.*APP_BUNDLE_MISSING/);
  assert.equal(h.storageCalls.length, 0);
  assert.equal(h.networkCalls(), 0);
});

test('Android startup uses the same shared interface with a verified APK document and restricted navigation', async () => {
  const h = harness({ platform: 'android' });
  const website = h.find(await h.startup(), h.Website);
  const assetRoot = 'file:///android_asset/www.bundle/';
  assert.ok(website);
  assert.equal(website.props.nativePlatform, 'android');
  assert.equal(h.directoryCalls[0].base.uri, 'asset://');
  assert.equal(website.props.dom.overrideUri, assetRoot + HTML);
  assert.equal(website.props.dom.allowUniversalAccessFromFileURLs, false);
  assert.equal(website.props.dom.unstable_useExpoModulesBridge, false);
  assert.equal(website.props.dom.onShouldStartLoadWithRequest({ url: assetRoot + HTML, isTopFrame: true }), true);
  assert.equal(website.props.dom.onShouldStartLoadWithRequest({ url: assetRoot + 'other.html', isTopFrame: true }), false);
  assert.equal(website.props.dom.onShouldStartLoadWithRequest({ url: 'https://uficonnect.org/', isTopFrame: true }), false);
  assert.equal(h.networkCalls(), 0);
});

test('native load errors show a safe code, and retry revalidates the packaged document', async () => {
  const h = harness();
  const website = h.find(await h.startup(), h.Website);
  website.props.dom.onError({ nativeEvent: { domain: 'NSURLErrorDomain', code: -1100, url: 'file:///private/sensitive', description: 'token=secret' } });
  const recovery = h.render();
  assert.match(h.text(recovery), /NSURLErrorDomain -1100/);
  assert.doesNotMatch(h.text(recovery), /sensitive|token|secret|file:\/\//);
  h.find(recovery, 'Pressable').props.onPress();
  assert.ok(h.find(await h.startup(), h.Website));
  assert.equal(h.directoryCalls.length, 2);
});

test('development startup leaves Expo Metro source selection intact', async () => {
  const h = harness({ development: true });
  const website = h.find(await h.startup(), h.Website);
  assert.ok(website);
  assert.equal(h.directoryCalls.length, 0);
  assert.equal(Object.hasOwn(website.props.dom, 'overrideUri'), false);
  assert.equal(website.props.dom.onShouldStartLoadWithRequest({ url: 'http://localhost:8081/_expo/@dom/test', isTopFrame: true }), true);
});

test('native safe area is applied once and media/theme chrome updates require the active capability', async () => {
  const h = harness();
  const website = h.find(await h.startup(), h.Website);
  const { nativeCapability, onAppearanceChange, dom } = website.props;
  assert.equal(dom.contentInsetAdjustmentBehavior, 'never');
  assert.equal(dom.automaticallyAdjustContentInsets, false);
  assert.equal(dom.automaticallyAdjustsScrollIndicatorInsets, false);
  for (const [mode, color, status] of [['video', '#080c12', 'light'], ['snap', '#080c12', 'light'], ['lightbox', '#000000', 'light'], ['dark', '#111d30', 'light'], ['light', '#ffffff', 'dark']]) {
    await onAppearanceChange(nativeCapability, mode);
    const tree = h.render(), surface = h.find(tree, 'SafeAreaView'), current = h.find(tree, h.Website);
    assert.deepEqual(surface.props.edges, ['top', 'bottom']);
    assert.equal(Object.assign({}, ...surface.props.style).backgroundColor, color);
    assert.equal(current.props.dom.style.backgroundColor, color);
    assert.equal(current.props.dom.containerStyle.backgroundColor, color);
    assert.equal(h.find(tree, 'StatusBar').props.style, status);
  }
  await assert.rejects(onAppearanceChange('untrusted-frame', 'video'));
  await assert.rejects(onAppearanceChange(nativeCapability, { backgroundColor: '#ff0000' }), /Invalid app appearance/);
  assert.equal(h.find(h.render(), 'StatusBar').props.style, 'dark');
});

test('iOS browser sheets pause both media layers until every overlapping operation settles', async () => {
  const h = harness(), website = h.find(await h.startup(), h.Website);
  const open = url => website.props.onOpenExternal(website.props.nativeCapability, url);
  assert.deepEqual(h.media(), { website: true, youtube: true });
  const first = open('https://uficonnect.org/sources');
  const second = open('https://example.invalid/post');
  assert.equal(h.browserCalls.length, 2);
  assert.deepEqual(h.media(), { website: false, youtube: false });
  h.appState('active');
  assert.deepEqual(h.media(), { website: false, youtube: false });
  h.browserCalls[0].resolve({ type: 'dismiss' }); await first;
  assert.deepEqual(h.media(), { website: false, youtube: false });
  const rejected = assert.rejects(second, /Browser presentation failed/);
  h.browserCalls[1].reject(new Error('Browser presentation failed')); await rejected;
  assert.deepEqual(h.media(), { website: true, youtube: true });
});

test('iOS browser dismissal never resumes media while the actual app remains backgrounded', async () => {
  const h = harness(), website = h.find(await h.startup(), h.Website);
  const operation = website.props.onOpenExternal(website.props.nativeCapability, 'https://example.invalid/post');
  h.appState('background');
  h.browserCalls[0].resolve({ type: 'dismiss' }); await operation;
  assert.deepEqual(h.media(), { website: false, youtube: false });
  h.appState('active');
  assert.deepEqual(h.media(), { website: true, youtube: true });
});

test('iOS auth browser pauses both layers and cannot override another open browser operation', async () => {
  const h = harness({ providerRequests: true }), website = h.find(await h.startup(), h.Website);
  const signIn = website.props.onProviderSignIn(website.props.nativeCapability, 'google', 'login');
  assert.deepEqual(h.media(), { website: false, youtube: false });
  await tick();
  assert.equal(h.authBrowserCalls.length, 1);
  const external = website.props.onOpenExternal(website.props.nativeCapability, 'https://example.invalid/post');
  h.authBrowserCalls[0].resolve({ type: 'success', url: 'uficonnect://auth/callback#code=' + 'B'.repeat(32) });
  assert.equal((await signIn).profile.id, 'provider-fixture');
  assert.deepEqual(h.media(), { website: false, youtube: false });
  h.browserCalls[0].resolve({ type: 'dismiss' }); await external;
  assert.deepEqual(h.media(), { website: true, youtube: true });
});

test('iOS browser completion after unmount does not write state or launch stale callbacks', async () => {
  const h = harness(), website = h.find(await h.startup(), h.Website);
  const operation = website.props.onOpenExternal(website.props.nativeCapability, 'https://example.invalid/post');
  h.unmount(); const writes = h.stateWrites();
  h.browserCalls[0].resolve({ type: 'dismiss' }); await operation;
  assert.equal(h.stateWrites(), writes);
  await assert.rejects(website.props.onOpenExternal(website.props.nativeCapability, 'https://example.invalid/other'), /Return to UFIConnect/);
  assert.equal(h.browserCalls.length, 1);
});

test('iOS canceled auth after unmount clears pending work without writing state', async () => {
  const h = harness({ providerRequests: true }), website = h.find(await h.startup(), h.Website);
  const operation = website.props.onProviderSignIn(website.props.nativeCapability, 'google', 'login');
  const canceled = assert.rejects(operation, /Sign-in was cancelled/);
  await tick(); h.unmount(); const writes = h.stateWrites();
  h.authBrowserCalls[0].resolve({ type: 'cancel' }); await canceled;
  assert.equal(h.stateWrites(), writes);
});

test('Android external browsers keep the existing AppState media behavior', async () => {
  const h = harness({ platform: 'android' }), website = h.find(await h.startup(), h.Website);
  const operation = website.props.onOpenExternal(website.props.nativeCapability, 'https://example.invalid/post');
  assert.deepEqual(h.media(), { website: true, youtube: true });
  h.appState('background');
  assert.deepEqual(h.media(), { website: false, youtube: false });
  h.browserCalls[0].resolve({ type: 'opened' }); await operation;
  assert.deepEqual(h.media(), { website: false, youtube: false });
  h.appState('active');
  assert.deepEqual(h.media(), { website: true, youtube: true });
});

test('Android auth keeps its existing website and isolated-player lifecycle', async () => {
  const h = harness({ platform: 'android', providerRequests: true }), website = h.find(await h.startup(), h.Website);
  const operation = website.props.onProviderSignIn(website.props.nativeCapability, 'google', 'login');
  const canceled = assert.rejects(operation, /Sign-in was cancelled/);
  assert.deepEqual(h.media(), { website: true, youtube: false });
  await tick(); h.appState('background');
  h.authBrowserCalls[0].resolve({ type: 'cancel' }); await canceled;
  assert.deepEqual(h.media(), { website: false, youtube: false });
  h.appState('active');
  assert.deepEqual(h.media(), { website: true, youtube: true });
});
