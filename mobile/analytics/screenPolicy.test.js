const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SCREEN_PATHS, screenPath, createScreenTracker } = require('./screenPolicy');

test('every rendered mobile screen has a fixed analytics name', () => {
  const source = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  const screens = [...source.matchAll(/<\w+\.Screen\s+name="([^"]+)"\s+component=\{(\w+)\}/g)]
    .filter(([, , component]) => component.endsWith('Screen')).map(([, name]) => name);
  assert.equal(screens.length, 12);
  assert.deepEqual(screens.sort(), Object.keys(SCREEN_PATHS).sort());
  assert.equal(new Set(Object.values(SCREEN_PATHS)).size, screens.length);
});

test('mobile analytics ignores route parameters, display titles, and unknown screen names', () => {
  const events = [];
  const track = createScreenTracker({ trackPage: value => events.push(value) });
  track('Conversation', { name: 'private person', message: 'private message', token: 'secret' });
  track('GroupDetail', { group: { id: 'private-id', name: 'private group' } });
  for (const value of ['someone@example.test', 'Login?token=secret', '__proto__', 'constructor', {}, null, undefined]) {
    track(value);
    assert.equal(screenPath(value), null);
  }
  assert.deepEqual(events, ['/app/conversation', '/app/group']);
});

test('native collector remains unavailable without Firebase app configurations', async () => {
  const filename = path.join(__dirname, 'analyticsClient.native.js');
  const source = fs.readFileSync(filename, 'utf8');
  const { createMobileAnalytics } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const controller = createMobileAnalytics();
  assert.equal(controller.available, false);
  assert.equal(controller.getConsent(), 'unavailable');
  controller.setConsent('granted');
  assert.equal(controller.getConsent(), 'unavailable');
  controller.trackPage('/app/login');
  controller.subscribe(() => assert.fail('native collector must not activate'))();
  controller.dispose();
});

test('analytics provider recreates its controller after a Strict Mode effect cleanup', () => {
  const filename = path.join(__dirname, 'AnalyticsProvider.js');
  const transformed = require('@babel/core').transformFileSync(filename, {
    babelrc: false, configFile: false,
    plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const effects = [];
  const controllers = [];
  const react = {
    createContext() { return { Provider: 'Provider' }; },
    createElement(type, props, ...children) { return { type, props: props || {}, children }; },
    useContext() {},
    useEffect(effect) { effects.push(effect); },
    useMemo(create) { return create(); },
    useRef(value) { return { current: value }; },
    useState(value) { return [value, () => {}]; },
  };
  const sandbox = { exports: {}, require(name) {
    if (name === 'react') return react;
    if (name === 'react-native') return { Modal: 'Modal', Text: 'Text', View: 'View', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: styles => styles } };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === './screenPolicy') return { createScreenTracker };
    if (name === '../theme') return { COLORS: {} };
    if (name === './analyticsClient') return { createMobileAnalytics() {
      const controller = { available: true, disposed: false, events: [],
        getConsent: () => 'granted', subscribe: () => () => {},
        trackPage(value) { assert.equal(this.disposed, false); this.events.push(value); },
        dispose() { this.disposed = true; },
      };
      controllers.push(controller);
      return controller;
    } };
    throw new Error(`Unexpected component import: ${name}`);
  } };
  vm.runInNewContext(transformed, sandbox, { filename });
  const tree = sandbox.exports.default({ children: null });
  tree.props.value.trackScreen('Login');
  const firstCleanup = effects[0]();
  firstCleanup();
  const secondCleanup = effects[0]();
  tree.props.value.trackScreen('Security');
  assert.equal(controllers.length, 2);
  assert.equal(controllers[0].disposed, true);
  assert.equal(controllers[1].disposed, false);
  assert.deepEqual(controllers[1].events, ['/app/login', '/app/security']);
  secondCleanup();
  assert.equal(controllers[1].disposed, true);
});
