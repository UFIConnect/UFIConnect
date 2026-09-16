const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { validateNewPassword, utf8ByteLength } = require('./passwordPolicy');
const { resolveApiBase } = require('./apiConfig');
const { createSessionStorage } = require('./sessionStorage');
const { secureApplicationManifest, DATA_EXTRACTION_RULES } = require('./androidConfig');
const { attachmentDetails } = require('./attachmentDetails');

test('native reveal preserves secure entry and uses only a non-selectable preview', () => {
  // Render the real component with minimal host/hook stubs. Native OS behavior
  // still requires device testing; this catches accidentally disabling secure
  // entry, which enables Android hardware-keyboard copy/cut commands.
  const filename = path.resolve(__dirname, '../components/PasswordInput.js');
  const transformed = require('@babel/core').transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const password = 'A synthetic native passphrase';
  function render(platform, revealed, overrides = {}) {
    const react = {
      createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat().filter(Boolean) }; },
      useEffect() {},
      useRef(value) { return { current: value }; },
      useState() { return [revealed, () => {}]; },
    };
    const native = {
      Platform: { OS: platform },
      StyleSheet: { create: styles => styles },
      Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', View: 'View',
    };
    const sandbox = {
      exports: {},
      require(name) {
        if (name === 'react') return react;
        if (name === 'react-native') return native;
        if (name === 'expo-clipboard') return {};
        if (name === '../theme') return { COLORS: {} };
        throw new Error(`Unexpected component import: ${name}`);
      },
    };
    vm.runInNewContext(transformed, sandbox, { filename });
    return sandbox.exports.default({ value: password, onChangeText() {}, ...overrides });
  }
  function nodes(tree) {
    return typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
  }
  for (const platform of ['ios', 'android']) {
    for (const revealed of [false, true]) {
      const tree = nodes(render(platform, revealed));
      const input = tree.find(node => node.type === 'TextInput');
      assert.equal(input.props.secureTextEntry, true);
      assert.equal(input.props.contextMenuHidden, true);
      assert.equal(input.props.autoComplete, 'current-password');
      const preview = tree.find(node => node.props.pointerEvents === 'none');
      assert.equal(Boolean(preview), revealed);
      if (preview) {
        const text = nodes(preview).find(node => node.type === 'Text' && node.children.includes(password));
        assert.equal(text.props.selectable, false);
      }
    }
    for (const overrides of [{ editable: false }, { value: '' }]) {
      const tree = nodes(render(platform, true, overrides));
      assert.equal(tree.some(node => node.props.pointerEvents === 'none'), false);
      assert.equal(tree.find(node => node.type === 'TextInput').props.secureTextEntry, true);
    }
  }
  const web = nodes(render('web', true));
  assert.equal(web.find(node => node.type === 'TextInput').props.secureTextEntry, false);
  assert.equal(web.some(node => node.props.pointerEvents === 'none'), false);
});

test('file details never include local paths, browser data URLs, or file contents', () => {
  for (const uri of ['file:///private/device/file.pdf', 'content://private/device/file', 'data:application/pdf;base64,c2VjcmV0', 'blob:https://example.test/private']) {
    const details = attachmentDetails({ name: 'document.pdf', mimeType: 'application/pdf', size: 16, uri, file: { contents: 'private' }, base64: 'private' });
    assert.deepEqual(details, { name: 'document.pdf', mimeType: 'application/pdf', size: 16 });
  }
  assert.throws(() => attachmentDetails(null));
  assert.equal(attachmentDetails({ name: 'empty.txt', size: 0 }).size, 0);
});

test('new passwords enforce 15 code points and a 72-byte UTF-8 ceiling without trimming', () => {
  assert.notEqual(validateNewPassword('a'.repeat(14)), '');
  assert.equal(validateNewPassword('a'.repeat(15)), '');
  assert.equal(validateNewPassword('a'.repeat(72)), '');
  assert.notEqual(validateNewPassword('a'.repeat(73)), '');
  assert.equal(validateNewPassword(' a long passphrase '), '');
  assert.notEqual(validateNewPassword('😀'.repeat(14)), '');
  assert.equal(validateNewPassword('😀'.repeat(18)), '');
  assert.notEqual(validateNewPassword('😀'.repeat(19)), '');
  assert.notEqual(validateNewPassword(null), '');
});

test('UTF-8 counting agrees with the server for ASCII, Unicode, and lone surrogates', () => {
  for (const value of ['hello world', 'café', '汉字', '🔑', '\ud800', 'a\ud800b', 'é'.repeat(36)]) {
    assert.equal(utf8ByteLength(value), Buffer.byteLength(value, 'utf8'));
  }
});

test('release API defaults to HTTPS and rejects cleartext and malformed origins', () => {
  assert.equal(resolveApiBase(), 'https://api.uficonnect.org');
  assert.equal(resolveApiBase('https://api.example.com:443/api/'), 'https://api.example.com:443/api');
  for (const value of ['http://localhost:3000', 'http://api.example.com', '//api.example.com',
    'https://name:password@api.example.com', 'https://api.example.com?token=secret',
    'https://api.example.com/#fragment', 'https://api.example.com:0', 'https://api.example.com:65536',
    'https://api.example.com\n', 'https://api.example.com\\evil', 'https:///example.com']) {
    assert.throws(() => resolveApiBase(value));
  }
});

test('development explicitly permits local HTTP APIs', () => {
  assert.equal(resolveApiBase('http://localhost:3000/', true), 'http://localhost:3000');
  assert.equal(resolveApiBase('http://192.168.1.8:3000', true), 'http://192.168.1.8:3000');
  assert.equal(resolveApiBase('http://[::1]:3000', true), 'http://[::1]:3000');
});

function storageFixture(platform = 'ios') {
  const calls = [];
  let secureValue = 'existing-secure-session';
  let legacyValue = 'legacy-plain-session';
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    async getItemAsync(key, options) { calls.push(['secureRead', key, options]); return secureValue; },
    async setItemAsync(key, value, options) { calls.push(['secureWrite', key, options]); secureValue = value; },
    async deleteItemAsync(key, options) { calls.push(['secureDelete', key, options]); secureValue = null; },
  };
  const legacyStorage = {
    async removeItem(key) { calls.push(['legacyDelete', key]); legacyValue = null; },
  };
  const storage = createSessionStorage({ platform, secureStore, legacyStorage });
  return { storage, secureStore, legacyStorage, calls, values: () => ({ secureValue, legacyValue }) };
}

test('native restore deletes legacy plaintext and reads only the OS store', async () => {
  const fixture = storageFixture();
  assert.equal(await fixture.storage.read(), 'existing-secure-session');
  assert.equal(fixture.values().legacyValue, null);
  assert.deepEqual(fixture.calls.map(([operation]) => operation), ['legacyDelete', 'secureRead']);
});

test('native saves use a device-only unlocked keychain option', async () => {
  const fixture = storageFixture('android');
  await fixture.storage.write('new-session');
  assert.deepEqual(fixture.values(), { secureValue: 'new-session', legacyValue: null });
  assert.deepEqual(fixture.calls[1][2], { keychainAccessible: fixture.secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
});

test('a secure storage failure never writes a plaintext fallback', async () => {
  const fixture = storageFixture();
  fixture.secureStore.setItemAsync = async () => { throw new Error('locked'); };
  await assert.rejects(fixture.storage.write('new-session'));
  assert.equal(fixture.values().legacyValue, null);
});

test('failure to remove legacy storage prevents session restoration and saving', async () => {
  const fixture = storageFixture();
  fixture.legacyStorage.removeItem = async () => { throw new Error('unavailable'); };
  await assert.rejects(fixture.storage.read());
  await assert.rejects(fixture.storage.write('new-session'));
  assert.deepEqual(fixture.calls, []);
});

test('Expo web never reads or writes a persistent bearer session', async () => {
  const fixture = storageFixture('web');
  assert.equal(await fixture.storage.read(), null);
  await fixture.storage.write('new-session');
  await fixture.storage.clear();
  assert.equal(fixture.values().legacyValue, null);
  assert.equal(fixture.calls.some(([operation]) => operation.startsWith('secure')), false);
});

test('sign-out removes native and legacy sessions', async () => {
  const fixture = storageFixture();
  await fixture.storage.clear();
  assert.deepEqual(fixture.values(), { secureValue: null, legacyValue: null });
});

test('sign-out still removes secure storage when legacy cleanup fails', async () => {
  const fixture = storageFixture();
  fixture.legacyStorage.removeItem = async () => { throw new Error('unavailable'); };
  await assert.rejects(fixture.storage.clear());
  assert.equal(fixture.values().secureValue, null);
});

test('invalid tokens are rejected before any persistence', async () => {
  const fixture = storageFixture();
  for (const value of [null, undefined, '', {}]) await assert.rejects(fixture.storage.write(value));
  assert.deepEqual(fixture.calls, []);
});

function loadAppConfig(env) {
  const filename = path.resolve(__dirname, '../app.config.js');
  const source = fs.readFileSync(filename, 'utf8').replace('export default', 'module.exports =');
  const sandbox = { require: createRequire(filename), process: { env }, module: { exports: {} } };
  vm.runInNewContext(source, sandbox, { filename });
  return sandbox.module.exports({ config: {} });
}

test('production Expo config fails closed on HTTP despite conflicting development flag', () => {
  assert.throws(() => loadAppConfig({ APP_ENV: 'development', EAS_BUILD_PROFILE: 'production', API_URL: 'http://api.example.com' }));
  const config = loadAppConfig({ APP_ENV: 'production' });
  assert.equal(config.android.allowBackup, false);
  assert.equal(config.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
  assert.equal(config.ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking, false);
  assert.equal(config.plugins.includes('./plugins/withSecurity'), true);
  assert.equal(config.updates.enabled, false);
});

test('native release manifest disables cleartext and backup even if previous defaults allowed them', () => {
  const application = { $: { 'android:allowBackup': 'true', 'android:usesCleartextTraffic': 'true' } };
  secureApplicationManifest(application);
  assert.equal(application.$['android:allowBackup'], 'false');
  assert.equal(application.$['android:usesCleartextTraffic'], 'false');
  assert.equal(application.$['android:fullBackupContent'], 'false');
  assert.equal(application.$['android:dataExtractionRules'], '@xml/security_data_extraction_rules');
});

test('backup rules exclude secure preferences and device transfer for both Android apps', () => {
  const twaRules = fs.readFileSync(path.resolve(__dirname, '../../android-twa/app/src/main/res/xml/security_data_extraction_rules.xml'), 'utf8');
  for (const xml of [DATA_EXTRACTION_RULES, twaRules]) {
    for (const tag of ['cloud-backup', 'device-transfer']) {
      const block = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1];
      assert.ok(block);
      for (const domain of ['root', 'file', 'database', 'sharedpref', 'external', 'device_sharedpref']) {
        assert.ok(block.includes(`domain="${domain}" path="."`));
      }
    }
  }
});
