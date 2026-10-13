const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { transformSync } = require('@babel/core');
const plugin = require('./website-transform.cjs');
const root = path.resolve(__dirname, '../..');
const component = path.join(root, 'web/src/components/SnapAvatar.jsx');
const asset = path.join(root, 'web/src/assets/snap-profile-default.svg');
const transform = (code, filename = component) => transformSync(code, {
  filename, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] }, plugins: [plugin],
}).code;
const compile = (source, filename = 'web/src/test.jsx') => transform(source, path.join(root, filename));

test('only explicit public configuration enters shared client code', () => {
  assert.match(compile('const api = import.meta.env.VITE_API_URL'), /https:\/\/api\.uficonnect\.org/);
  assert.throws(() => compile('const secret = import.meta.env.DATABASE_URL'), /Unsupported public website setting/);
});

test('root images and media use the Expo base while application routes stay unchanged', () => {
  const output = compile("const image=<img src='/uficonnect-mark.svg?v=2'/>; const video=`/media/${name}.mp4`; const route='/login';");
  assert.match(output, /ufiPublicAsset\('\/uficonnect-mark\.svg\?v=2'\)/);
  assert.match(output, /ufiPublicAsset\(`\/media\/\$\{name\}\.mp4`\)/);
  assert.match(output, /route = '\/login'/);
});

test('the website adapter does not rewrite legacy native source', () => {
  assert.doesNotMatch(compile("const value='/uficonnect-mark.svg'", 'mobile/App.js'), /ufiPublicAsset/);
});

test('Expo embeds the exact known fallback bytes without an external resource dependency', () => {
  const code = transform("import fallback from '../assets/snap-profile-default.svg'; globalThis.imageSource = fallback;");
  const context = {};
  vm.runInNewContext(code, context);
  assert.match(context.imageSource, /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(Buffer.from(context.imageSource.split(',')[1], 'base64'), fs.readFileSync(asset));
  assert.doesNotMatch(code, /(?:import|require)\b/);
});

test('Unrelated and remote asset imports keep the normal bundler behavior', () => {
  for (const specifier of ['../assets/other.svg', 'https://example.invalid/snap-profile-default.svg', asset.replaceAll('\\', '/')]) {
    const code = transform(`import fallback from ${JSON.stringify(specifier)}; globalThis.imageSource = fallback;`);
    assert.match(code, /import fallback from/);
    assert.doesNotMatch(code, /data:image/);
  }
});

test('The known fallback accepts a default image import only', () => {
  assert.throws(() => transform("import { icon } from '../assets/snap-profile-default.svg';"), /must use a default image import/);
  assert.throws(() => transform("import * as icon from '../assets/snap-profile-default.svg';"), /must use a default image import/);
});

test('The transform does not alter imports outside the shared website source', () => {
  const code = transform("import fallback from '../../web/src/assets/snap-profile-default.svg';", path.join(root, 'mobile/current-site/fixture.js'));
  assert.match(code, /import fallback from/);
  assert.doesNotMatch(code, /data:image/);
});

test('The regular shared website still imports its canonical SVG', () => {
  assert.match(fs.readFileSync(component, 'utf8'), /import defaultAvatar from '\.\.\/assets\/snap-profile-default\.svg'/);
});
