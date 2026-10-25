const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

test('React DevTools shell quoting preserves arguments and rejects newlines after comments', () => {
  const fromDevTools = createRequire(require.resolve('react-devtools-core/package.json'));
  const { parse, quote } = fromDevTools('shell-quote');
  const argumentsToQuote = ['code', 'a file.js', "a'b.js", 'literal$variable'];
  assert.deepEqual(parse(quote(argumentsToQuote)), argumentsToQuote);
  for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(() => quote(['code', { comment: 'end' }, `file${terminator}name`]), TypeError);
  }
});

test('Expo XML dependencies preserve Android manifest round trips', async () => {
  const { XML: xml } = require('expo/config-plugins');
  const input = fs.readFileSync(path.resolve(__dirname, '../../android-twa/app/src/main/AndroidManifest.xml'), 'utf8');
  const parsed = await xml.parseXMLAsync(input);
  const reparsed = await xml.parseXMLAsync(xml.format(parsed));
  assert.deepEqual(reparsed, parsed);
  assert.equal(reparsed.manifest.application[0].$['android:allowBackup'], 'false');
});

test('Expo DOM parser preserves iOS property list parsing and generation', () => {
  const plist = require('@expo/plist').default;
  const settings = {
    CFBundleIdentifier: 'org.uficonnect.app',
    NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
    example: 'Text with & < > characters',
    count: 15,
  };
  const parsed = plist.parse(plist.build(settings));
  // Current Expo plist intentionally uses null prototypes to prevent pollution.
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), settings);
});

test('Expo resolves patched semver 7 while preserving SDK range semantics', () => {
  const fromExpo = createRequire(require.resolve('@expo/config/package.json'));
  const semver = fromExpo('semver');
  assert.ok(semver.gte(fromExpo('semver/package.json').version, '7.5.2'));
  assert.equal(semver.satisfies('57.0.23', '~57.0.0'), true);
  assert.equal(semver.satisfies('58.0.0', '~57.0.0'), false);
  assert.equal(semver.valid('1'.repeat(10000)), null);
});

test('patched send preserves local development file serving and range requests', async () => {
  const send = require('send');
  const server = http.createServer((request, response) => {
    send(request, request.url, { root: __dirname }).on('error', () => {
      response.statusCode = 404;
      response.end('Not found');
    }).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/passwordPolicy.js`, { headers: { Range: 'bytes=0-4' } });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'const');
    const missing = await fetch(`${base}/missing-file.txt`);
    assert.equal(missing.status, 404);
    await missing.text();
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('Xcode project identifiers remain unique and use secure UUID generation', (t) => {
  const xcode = require('xcode');
  const project = xcode.project('compatibility-fixture.pbxproj');
  project.hash = { project: { objects: {} } };
  const ids = new Set(Array.from({ length: 100 }, () => project.generateUuid()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[A-F0-9]{24}$/);
  const fromXcode = createRequire(require.resolve('xcode'));
  const xcodePackage = fromXcode('./package.json');
  if (xcodePackage.dependencies?.uuid) {
    const uuid = fromXcode('uuid');
    assert.throws(() => uuid.v3('example', uuid.v3.DNS, new Uint8Array(2)), RangeError);
  } else {
    assert.equal(xcodePackage.version, '4.0.0');
    const crypto = require('node:crypto');
    const values = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    const randomUUID = t.mock.method(crypto, 'randomUUID', () => values.shift());
    project.hash.project.objects.PBXGroup = { AAAAAAAAAAAA4AAA8AAAAAAA: {} };
    assert.equal(project.generateUuid(), 'BBBBBBBBBBBB4BBB8BBBBBBB');
    assert.equal(randomUUID.mock.callCount(), 2, 'existing project identifiers are regenerated');
  }
});
