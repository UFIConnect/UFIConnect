const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('@babel/core');
const { clipRequest } = require('./nativeTwitch.cjs');
const compiled = transformSync(fs.readFileSync(path.join(__dirname, 'NativeTwitchPlayer.jsx'), 'utf8'), {
  filename: path.join(__dirname, 'NativeTwitchPlayer.jsx'), configFile: false, babelrc: false,
  plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;

function harness() {
  const slots = []; let cursor = 0, closed = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; slots[index] ||= { value: initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; slots[index] ||= { current: initial }; return slots[index]; },
    useEffect() { cursor++; },
  };
  const imports = {
    react: React,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', Pressable: 'Pressable', StyleSheet: { create: value => value }, Text: 'Text', View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'react-native-webview': { WebView: 'WebView' },
    './nativeTwitch.cjs': require('./nativeTwitch.cjs'),
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; }, module, module.exports);
  const player = clipRequest({ url: 'https://clips.twitch.tv/ExampleClip', title: 'Example title', creator: 'Example creator' });
  const render = () => { cursor = 0; return module.exports.default({ player, onClose: () => closed++ }); };
  function find(tree, type) {
    if (tree?.type === type) return tree;
    for (const child of [tree?.props?.children].flat()) { const found = child && typeof child === 'object' ? find(child, type) : null; if (found) return found; }
    return null;
  }
  return { render, find, player, closed: () => closed };
}

test('native Twitch viewer loads its real HTTPS parent without app authorization or a native message bridge', () => {
  const h = harness(), tree = h.render(), view = h.find(tree, 'WebView');
  assert.deepEqual(view.props.source, { uri: h.player.wrapperUrl });
  assert.deepEqual(view.props.originWhitelist, ['*'], 'All schemes reach our policy instead of React Native opening them externally');
  for (const flag of ['sharedCookiesEnabled', 'thirdPartyCookiesEnabled', 'allowFileAccess', 'allowFileAccessFromFileURLs', 'allowUniversalAccessFromFileURLs', 'javaScriptCanOpenWindowsAutomatically']) assert.equal(view.props[flag], false, flag);
  for (const absent of ['onMessage', 'injectedJavaScript', 'injectedJavaScriptBeforeContentLoaded']) assert.equal(view.props[absent], undefined, absent);
  assert.equal(view.props.allowsInlineMediaPlayback, true);
  assert.equal(view.props.allowsFullscreenVideo, true);
  assert.equal(view.props.mediaPlaybackRequiresUserAction, true);
  assert.equal(view.props.onShouldStartLoadWithRequest({ url: 'https://evil.example/', isTopFrame: true }), false);
  for (const url of ['twitch://open', 'mailto:test@example.com', 'file:///private', 'javascript:alert(1)', 'http://clips.twitch.tv/Example']) {
    assert.equal(view.props.onShouldStartLoadWithRequest({ url, isTopFrame: true }), false, url);
    assert.equal(view.props.onShouldStartLoadWithRequest({ url, isTopFrame: false }), false, url);
  }
  assert.equal(view.props.onShouldStartLoadWithRequest({ url: 'https://consent.example.com/frame', isTopFrame: false }), true);
  assert.equal(view.props.onShouldStartLoadWithRequest({ url: 'https://uficonnect.org/', isTopFrame: false }), true);
  assert.equal(h.closed(), 0);
  assert.equal(view.props.onShouldStartLoadWithRequest({ url: 'https://uficonnect.org/', isTopFrame: true }), false);
  assert.equal(h.closed(), 1);
  h.find(tree, 'Modal').props.onRequestClose();
  assert.equal(h.closed(), 2);
});

test('official Twitch links stay inside the viewer and a failed page unmounts until retry', () => {
  const h = harness(); let view = h.find(h.render(), 'WebView');
  view.props.onOpenWindow({ nativeEvent: { targetUrl: 'https://evil.example/' } });
  assert.equal(h.find(h.render(), 'WebView').props.source.uri, h.player.wrapperUrl);
  view.props.onOpenWindow({ nativeEvent: { targetUrl: 'https://www.twitch.tv/creator' } });
  view = h.find(h.render(), 'WebView');
  assert.equal(view.props.source.uri, 'https://www.twitch.tv/creator');
  view.props.onError();
  assert.equal(h.find(h.render(), 'WebView'), null);
});
