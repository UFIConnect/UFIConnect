const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveBundledDocument, documentLoadError } = require('./documentLoader.cjs');

const ROOT = 'file:///private/var/containers/Bundle/Application/FIXTURE/UFIConnect.app/www.bundle/';
const HTML = '8539e9980b054248b499ea83f6c44b00.html';
function fixture(overrides = {}) {
  const file = { name: HTML, uri: ROOT + HTML, exists: true, file: true };
  const directory = { uri: ROOT, exists: true, list: () => [file, { name: 'brand', uri: ROOT + 'brand/' }] };
  return { file, directory, options: { development: false, openDirectory: () => directory, isFile: item => item.file === true, ...overrides } };
}

test('production source and read access use the same verified native directory', () => {
  const f = fixture();
  assert.deepEqual(resolveBundledDocument(f.options), { documentUri: ROOT + HTML, readAccessUri: ROOT });
  f.directory.uri = ROOT.slice(0, -1);
  assert.equal(resolveBundledDocument(f.options).readAccessUri, ROOT);
  f.file.uri = f.file.uri.replace('/private/var/', '/var/');
  assert.throws(() => resolveBundledDocument(f.options), /APP_BUNDLE_INVALID/);
});

test('missing, ambiguous and non-file documents fail before mounting a WebView', () => {
  const f = fixture();
  f.directory.exists = false;
  assert.throws(() => resolveBundledDocument(f.options), /bundled page is missing.*APP_BUNDLE_MISSING/);
  f.directory.exists = true;
  f.directory.list = () => [];
  assert.throws(() => resolveBundledDocument(f.options), /APP_BUNDLE_MISSING/);
  f.directory.list = () => [f.file, { ...f.file, name: '1234567890abcdef1234567890abcdef.html' }];
  assert.throws(() => resolveBundledDocument(f.options), /APP_BUNDLE_AMBIGUOUS/);
  f.directory.list = () => [f.file];
  f.file.file = false;
  assert.throws(() => resolveBundledDocument(f.options), /APP_BUNDLE_INVALID/);
  f.file.file = true; f.file.exists = false;
  assert.throws(() => resolveBundledDocument(f.options), /APP_BUNDLE_MISSING/);
});

test('bundle validation never permits a network URI, traversal, other file scope or untrusted document URI', () => {
  for (const uri of ['https://uficonnect.org/www.bundle/', 'file://remote/www.bundle/', 'file:///app/../www.bundle/',
    'file:///app/%2e%2e/www.bundle/', 'file:///app/%2fother/www.bundle/', 'file:///app/www.bundle/?token=secret',
    'file:///app/www.bundle/#secret', 'file:///app/other/', 'file:///app/%00/www.bundle/']) {
    const f = fixture(); f.directory.uri = uri;
    assert.throws(() => resolveBundledDocument(f.options), /APP_BUNDLE_INVALID/);
  }
  for (const uri of ['https://uficonnect.org/' + HTML, 'file:///other/' + HTML, ROOT + HTML + '?token=secret']) {
    const f = fixture(); f.file.uri = uri;
    assert.throws(() => resolveBundledDocument(f.options), /APP_BUNDLE_INVALID/);
  }
});

test('development retains Metro and performs no bundled filesystem reads', () => {
  assert.equal(resolveBundledDocument({ development: true, openDirectory() { throw new Error('must not read'); } }), null);
});

test('Android verifies APK assets and maps the single packaged page to its WebView asset URL', () => {
  const storageRoot = 'asset:///www.bundle/';
  const file = { name: HTML, uri: storageRoot + HTML, exists: true, file: true };
  const directory = { uri: storageRoot, exists: true, list: () => [file] };
  const options = { development: false, platform: 'android', openDirectory: () => directory, isFile: value => value.file === true };
  assert.deepEqual(resolveBundledDocument(options), {
    documentUri: 'file:///android_asset/www.bundle/' + HTML,
    readAccessUri: 'file:///android_asset/www.bundle/',
  });
  for (const root of ['asset://remote/www.bundle/', 'asset:///other/', 'asset:///www.bundle/../',
    'asset:///www.bundle/%2e%2e/', 'asset:///www.bundle/?token=private', 'file:///android_asset/www.bundle/']) {
    directory.uri = root;
    assert.throws(() => resolveBundledDocument(options), /APP_BUNDLE_INVALID/);
  }
  directory.uri = storageRoot;
  file.uri = 'asset:///other/' + HTML;
  assert.throws(() => resolveBundledDocument(options), /APP_BUNDLE_INVALID/);
});

test('filesystem and WebView diagnostics omit device paths, URLs, descriptions and unknown native domains', () => {
  assert.throws(() => resolveBundledDocument({ development: false, openDirectory() { throw new Error('file:///private/secret?token=sensitive'); } }),
    error => error.code === 'APP_BUNDLE_UNREADABLE' && !/private|secret|token|sensitive/.test(error.message));
  assert.equal(documentLoadError({ nativeEvent: { domain: 'NSURLErrorDomain', code: -1100,
    description: 'file:///private/secret?token=sensitive', url: 'https://example.test/?token=sensitive' } }),
  'The app could not open. Please try again. (NSURLErrorDomain -1100)');
  assert.equal(documentLoadError({ nativeEvent: { domain: 'secret-token', code: Infinity } }),
    'The app could not open. Please try again. (WebView)');
  assert.equal(documentLoadError({ nativeEvent: { domain: 'WKErrorDomain', code: 4 } }),
    'The app could not open. Please try again. (WKErrorDomain 4)');
});
