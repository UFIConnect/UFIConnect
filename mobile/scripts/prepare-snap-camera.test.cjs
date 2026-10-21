const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { VERSION, JAVA_FILE, BEFORE_SHA256, AFTER_SHA256, patchSnapCamera, prepareSnapCamera } = require('./prepare-snap-camera.cjs');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const mobile = path.resolve(__dirname, '..');

function upstreamSource() {
  let source = fs.readFileSync(path.join(mobile, 'node_modules/react-native-webview', JAVA_FILE), 'utf8');
  if (hash(source) === AFTER_SHA256) {
    source = source.replace('        Intent videoIntent = null;\n', '')
      .replace('                videoIntent = getVideoIntent();', '                Intent videoIntent = getVideoIntent();')
      .replace('            chooserIntent = photoIntent != null ? photoIntent : videoIntent;', '            chooserIntent = photoIntent;');
  }
  assert.equal(hash(source), BEFORE_SHA256, 'Tests use the exact known npm source, never an invented dependency');
  return source;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ufi-snap-camera-'));
  t.after(() => {
    const resolved = path.resolve(root), temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(temporaryRoot) && path.basename(resolved).startsWith('ufi-snap-camera-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const packageRoot = path.join(root, 'node_modules/react-native-webview'), filename = path.join(packageRoot, JAVA_FILE);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, upstreamSource());
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'react-native-webview', version: VERSION }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/react-native-webview': { version: VERSION } } }));
  return { root, packageRoot, filename };
}

test('the pinned camera fix changes only intent scope/selection and is idempotent', () => {
  const before = upstreamSource(), after = patchSnapCamera(before);
  assert.equal(hash(after), AFTER_SHA256);
  assert.equal(patchSnapCamera(after), after);
  const methodStart = '    public boolean startPhotoPickerIntent(final String[]';
  const methodEnd = '    public void setDownloadRequest';
  assert.equal(after.slice(0, after.indexOf(methodStart)), before.slice(0, before.indexOf(methodStart)));
  assert.equal(after.slice(after.indexOf(methodEnd)), before.slice(before.indexOf(methodEnd)));
  const restored = after.replace('        Intent videoIntent = null;\n', '')
    .replace('                videoIntent = getVideoIntent();', '                Intent videoIntent = getVideoIntent();')
    .replace('            chooserIntent = photoIntent != null ? photoIntent : videoIntent;', '            chooserIntent = photoIntent;');
  assert.equal(restored, before, 'Permission checks, chooser behavior, URI grants and lifecycle are unchanged');
  assert.throws(() => patchSnapCamera(before + '\n'), /Unrecognized/);
  assert.throws(() => patchSnapCamera(after.replace('needsCameraPermission()', 'permissionBypass()')), /Unrecognized/);
});

test('preparation modifies only a temporary installation and check mode never writes', t => {
  const f = fixture(t), original = fs.readFileSync(f.filename, 'utf8');
  assert.throws(() => prepareSnapCamera({ directory: f.root }), /has not been installed/);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), original);
  assert.equal(prepareSnapCamera({ directory: f.root, apply: true }).changed, true);
  assert.equal(prepareSnapCamera({ directory: f.root, apply: true }).changed, false);
  assert.equal(prepareSnapCamera({ directory: f.root }).sha256, AFTER_SHA256);
});

test('unexpected package versions, lock versions and source edits fail without changing files', t => {
  const f = fixture(t), original = fs.readFileSync(f.filename, 'utf8');
  fs.writeFileSync(path.join(f.packageRoot, 'package.json'), JSON.stringify({ name: 'react-native-webview', version: '13.16.2' }));
  assert.throws(() => prepareSnapCamera({ directory: f.root, apply: true }), /installed.*version/);
  fs.writeFileSync(path.join(f.packageRoot, 'package.json'), JSON.stringify({ name: 'react-native-webview', version: VERSION }));
  fs.writeFileSync(path.join(f.root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/react-native-webview': { version: '13.16.2' } } }));
  assert.throws(() => prepareSnapCamera({ directory: f.root, apply: true }), /locked.*version/);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), original);
  fs.writeFileSync(path.join(f.root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/react-native-webview': { version: VERSION } } }));
  fs.writeFileSync(f.filename, original + '\n');
  assert.throws(() => prepareSnapCamera({ directory: f.root, apply: true }), /Unrecognized/);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), original + '\n');
});

test('preparation refuses to mutate a different workspace through linked node_modules', t => {
  const f = fixture(t), original = fs.readFileSync(f.filename, 'utf8');
  const linkedRoot = path.join(f.root, 'linked-workspace'); fs.mkdirSync(linkedRoot);
  fs.copyFileSync(path.join(f.root, 'package-lock.json'), path.join(linkedRoot, 'package-lock.json'));
  fs.symlinkSync(path.join(f.root, 'node_modules'), path.join(linkedRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareSnapCamera({ directory: linkedRoot, apply: true }), /linked or shared/);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), original);
});

test('native manifest adds camera intent visibility once without requesting camera permission', () => {
  const filename = path.join(mobile, 'plugins/withSecurity.js'), module = { exports: {} };
  const api = { withAndroidManifest: (config, mod) => mod(config), withDangerousMod: config => config,
    AndroidConfig: { Manifest: { getMainApplicationOrThrow: results => results.manifest.application[0] } } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, process: { env: {} }, require: name => {
    if (name === 'expo/config-plugins') return api;
    if (name === '../security/androidConfig') return require('../security/androidConfig');
    return require(name);
  } }, { filename });
  const priorQuery = { package: [{ $: { 'android:name': 'existing.visible.package' } }], intent: [{ action: [{ $: { 'android:name': 'existing.action' } }] }] };
  const manifest = { application: [{ $: {} }], queries: [priorQuery], 'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }] };
  const config = { modResults: { manifest } };
  module.exports(config); module.exports(config);
  const names = manifest.queries.flatMap(query => query.intent || []).flatMap(intent => intent.action || []).map(action => action.$['android:name']);
  assert.equal(names.filter(name => name === 'android.media.action.IMAGE_CAPTURE').length, 1);
  assert.equal(names.filter(name => name === 'android.media.action.VIDEO_CAPTURE').length, 1);
  assert.ok(names.includes('existing.action'));
  assert.equal(manifest.queries[0].package[0].$['android:name'], 'existing.visible.package');
  assert.deepEqual(manifest['uses-permission'], [{ $: { 'android:name': 'android.permission.INTERNET' } }]);
  assert.equal(manifest.application[0].$['android:allowBackup'], 'false');
  assert.equal(manifest.application[0].$['android:usesCleartextTraffic'], 'false');
  const fresh = { application: [{ $: {} }] };
  module.exports({ modResults: { manifest: fresh } });
  assert.equal(fresh.queries[0].intent.length, 2);
  assert.equal(fresh['uses-permission'], undefined);
});
