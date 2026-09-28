import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalWebMiddleware, localWebWorkbench } from './local-web-workbench.mjs';
import { lineChanges } from '../office/src/line-changes.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'uficonnect-local-web-'));
  await mkdir(path.join(root, 'web/src'), { recursive: true });
  await mkdir(path.join(root, 'web/public'), { recursive: true });
  await mkdir(path.join(root, 'outside'), { recursive: true });
  await writeFile(path.join(root, 'web/src/App.jsx'), 'export default "initial";\n');
  await writeFile(path.join(root, 'web/index.html'), '<main>Website</main>');
  await writeFile(path.join(root, 'web/public/icon.svg'), '<svg/>');
  await writeFile(path.join(root, 'web/public/photo.png'), Buffer.from([0, 1, 2]));
  await writeFile(path.join(root, 'web/src/.env'), 'private');
  await writeFile(path.join(root, 'web/src/credentials.json'), 'private');
  await writeFile(path.join(root, 'outside/private.js'), 'outside');
  let handler;
  const server = createServer((request, response) => {
    handler(request, response, () => { response.writeHead(404); response.end('Not found'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createLocalWebMiddleware({ root, officeUrl: origin });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    // mkdtemp supplies the one exact temporary root owned by this test.
    await rm(root, { recursive: true, force: true });
  });
  const request = (endpoint, init) => fetch(`${origin}/__local-web/${endpoint}`, init);
  const load = async (file = 'web/src/App.jsx') => {
    const response = await request(`file?path=${encodeURIComponent(file)}`);
    return { response, body: await response.json() };
  };
  const save = (content, expectedRevision, options = {}) => request(`file?path=${encodeURIComponent(options.path || 'web/src/App.jsx')}`, {
    method: 'PUT', headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Local-Web-Editor': '1',
      ...options.headers,
    },
    body: JSON.stringify({ path: options.path || 'web/src/App.jsx', content, expectedRevision }),
  });
  return { root, origin, request, load, save };
}

test('the editor API is installed only in the local release development mode', () => {
  for (const mode of ['production', 'development', undefined]) {
    const plugin = localWebWorkbench({ mode });
    assert.equal(plugin.apply, 'serve');
    let installed = 0;
    plugin.configureServer({ middlewares: { use() { installed++; } } });
    assert.equal(installed, 0);
  }
  let installed = 0;
  localWebWorkbench({ mode: 'release-local' }).configureServer({ middlewares: { use() { installed++; } } });
  assert.equal(installed, 1);
  assert.throws(() => createLocalWebMiddleware({ officeUrl: 'http://0.0.0.0:4174' }), /loopback/);
});

test('lists allowed existing website files and saves full UTF-8 content with a new revision', async t => {
  const fixtureData = await fixture(t);
  const { root, request, load, save } = fixtureData;
  const status = await request('status');
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal(status.headers.get('access-control-allow-origin'), null);
  assert.equal((await status.json()).previewUrl, 'http://127.0.0.1:4173');
  const list = await request('files');
  assert.deepEqual((await list.json()).files.map(file => file.path), [
    'web/index.html', 'web/public/icon.svg', 'web/src/App.jsx',
  ]);
  const initial = await load();
  assert.equal(initial.response.status, 200);
  assert.match(initial.body.revision, /^[a-f0-9]{64}$/);
  const content = 'export default "New café ✨";\n';
  const response = await save(content, initial.body.revision);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.notEqual(saved.revision, initial.body.revision);
  assert.equal(saved.content, content);
  assert.equal(await readFile(path.join(root, 'web/src/App.jsx'), 'utf8'), content);
  assert.equal((await load()).body.revision, saved.revision);
  // A shorter or empty edit removes any old trailing bytes.
  assert.equal((await save('', saved.revision)).status, 200);
  assert.equal(await readFile(path.join(root, 'web/src/App.jsx'), 'utf8'), '');
});

test('stale saves preserve newer edits and two competing saves cannot both succeed', async t => {
  const { root, load, save } = await fixture(t);
  const first = await load();
  await writeFile(path.join(root, 'web/src/App.jsx'), 'external edit');
  const stale = await save('overwrite', first.body.revision);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'stale_revision');
  assert.equal(await readFile(path.join(root, 'web/src/App.jsx'), 'utf8'), 'external edit');
  const current = await load();
  const results = await Promise.all([
    save('first edit', current.body.revision),
    save('second edit', current.body.revision),
  ]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
});

test('denies hostile origins, DNS rebinding hosts, missing save header, and non-JSON requests', async t => {
  const { origin, request, load, save } = await fixture(t);
  const revision = (await load()).body.revision;
  for (const headers of [
    { Origin: 'https://hostile.example' },
    { Origin: 'null' },
    { Origin: '' },
    { 'X-Local-Web-Editor': '' },
  ]) {
    assert.equal((await save('bad', revision, { headers })).status, 403);
  }
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}/__local-web/files`, { headers: { Host: 'hostile.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await request('file?path=web/src/App.jsx', { headers: { Origin: 'http://127.0.0.1:4173' } })).status, 403);
  assert.equal((await save('bad', revision, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await load()).body.content, 'export default "initial";\n');
});

test('rejects traversal, unsupported files, credentials, new files, and symlink directories', async t => {
  const { root, request, load, save } = await fixture(t);
  for (const file of [
    '../outside/private.js', 'web/src/../../outside/private.js', '/web/src/App.jsx',
    'web\\src\\App.jsx', 'web/src/.env', 'web/src/credentials.json',
    'web/public/photo.png', 'web/src/App.jsx:secret', 'backend/index.js',
  ]) {
    assert.equal((await load(file)).response.status, 400, file);
  }
  assert.equal((await load('web/src/does-not-exist.js')).response.status, 404);
  const revision = (await load()).body.revision;
  assert.equal((await save('new', revision, { path: 'web/src/new.js' })).status, 404);
  await symlink(path.join(root, 'outside'), path.join(root, 'web/src/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await load('web/src/linked/private.js')).response.status, 403);
  assert.equal((await save('bad', revision, { path: 'web/src/linked/private.js' })).status, 403);
  const files = (await (await request('files')).json()).files;
  assert.equal(files.some(file => file.path.includes('linked')), false);
  assert.equal(await readFile(path.join(root, 'outside/private.js'), 'utf8'), 'outside');
});

test('rejects binary data and content larger than the editor limit', async t => {
  const { root, load, save } = await fixture(t);
  const revision = (await load()).body.revision;
  assert.equal((await save('a'.repeat(1024 * 1024 + 1), revision)).status, 413);
  assert.equal((await save('binary\0data', revision)).status, 413);
  await writeFile(path.join(root, 'web/src/binary.js'), Buffer.from([0xff, 0xfe]));
  assert.equal((await load('web/src/binary.js')).response.status, 415);
});

test('publication review lists only changed lines with nearby context', () => {
  const lines = count => Array.from({ length: count }, (_, index) => `line ${index + 1}`);
  const before = lines(40);
  const after = [...before];
  after[4] = 'line 5 edited';
  after.splice(30, 1);
  after.push('line 41');
  const result = lineChanges(before.join('\n'), after.join('\n'));
  assert.equal(result.added, 2);
  assert.equal(result.removed, 2);
  assert.deepEqual(result.hunks.map(hunk => hunk.line), [3, 29, 38]);
  assert.deepEqual(result.hunks[0].rows.map(row => [row.kind, row.text]), [
    ['same', 'line 3'], ['same', 'line 4'], ['removed', 'line 5'], ['added', 'line 5 edited'], ['same', 'line 6'], ['same', 'line 7'],
  ]);
  assert.deepEqual(result.hunks[1].rows.filter(row => row.kind !== 'same').map(row => [row.kind, row.text]), [['removed', 'line 31']]);
  assert.deepEqual(result.hunks[2].rows.map(row => [row.kind, row.text]), [['same', 'line 39'], ['same', 'line 40'], ['added', 'line 41']]);
  assert.deepEqual(lineChanges('same\n', 'same\n'), { hunks: [], added: 0, removed: 0, endings: '' });
});

test('publication review handles additions, removals and very large rewrites', () => {
  assert.deepEqual(lineChanges('', 'new').hunks[0].rows.map(row => row.kind), ['removed', 'added']);
  const removal = lineChanges('a\nb\nc', 'a\nc');
  assert.deepEqual([removal.added, removal.removed, removal.hunks[0].rows.map(row => row.kind)], [0, 1, ['same', 'removed', 'same']]);
  const before = Array.from({ length: 1200 }, (_, index) => `old ${index}`).join('\n');
  const after = Array.from({ length: 1200 }, (_, index) => `new ${index}`).join('\n');
  const rewrite = lineChanges(before, after);
  assert.equal(rewrite.removed, 1200);
  assert.equal(rewrite.added, 1200);
  assert.equal(rewrite.hunks.length, 1);
});

test('publication review reports a Windows line ending change once instead of every line', () => {
  assert.deepEqual(lineChanges('a\nb\n', 'a\r\nb\r\n'), { hunks: [], added: 0, removed: 0, endings: 'CRLF' });
  const edited = lineChanges('a\r\nb\r\nc\r\n', 'a\nB\nc\n');
  assert.equal(edited.endings, 'LF');
  assert.deepEqual([edited.added, edited.removed], [1, 1]);
  assert.deepEqual(edited.hunks[0].rows.map(row => row.text), ['a', 'b', 'B', 'c', '']);
});
