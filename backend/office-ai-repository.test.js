'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfficeAIRepository, repositoryPath, applyRepositoryEdit, blobSha } = require('./office-ai-repository');
const BASE = 'a'.repeat(40), CANDIDATE = 'c'.repeat(40), TASK = '10000000-0000-0000-0000-000000000001';
const json = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
function provider(content = 'const answer = 1;\n') {
  const state = { head: BASE, tag: null, conclusion: 'success', run: false, calls: [], content };
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace('/repos/UFIConnect/UFIConnect', ''), body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({ path, method: options.method, body, options });
    if (path === '/git/ref/heads/main') return json({ object: { sha: state.head } });
    if (path.startsWith('/git/ref/tags/')) return state.tag ? json({ object: { sha: state.tag } }) : json({}, 404);
    if (path.startsWith('/git/trees/') && options.method === 'GET') return json({ tree: [{ path: 'backend/example.js', mode: '100644', type: 'blob', sha: blobSha(state.content), size: Buffer.byteLength(state.content) },
      { path: 'backend/link.js', mode: '120000', type: 'blob', sha: 'e'.repeat(40), size: 10 }, { path: 'backend/.env', mode: '100644', type: 'blob', sha: 'f'.repeat(40) }] });
    if (path.startsWith('/git/blobs/') && options.method === 'GET') return json({ encoding: 'base64', content: Buffer.from(state.content).toString('base64') });
    if (path === '/git/blobs') return json({ sha: blobSha(body.content) }, 201);
    if (path.startsWith('/git/commits/') && options.method === 'GET') return json({ sha: path.endsWith(BASE) ? BASE : CANDIDATE, tree: { sha: 'b'.repeat(40) }, parents: [{ sha: BASE }] });
    if (path === '/git/trees') return json({ sha: 'd'.repeat(40) }, 201);
    if (path === '/git/commits') return json({ sha: CANDIDATE }, 201);
    if (path === '/git/refs') { state.tag = body.sha; return json({ object: { sha: body.sha } }, 201); }
    if (path === '/git/refs/heads/main') { state.head = body.sha; return json({ object: { sha: state.head } }); }
    if (path.endsWith('/verify.yml/dispatches')) { state.run = true; return state.directReceipt ? json({ workflow_run_id: 123, html_url: 'https://untrusted.example/' }) : json(null, 204); }
    if (path === '/actions/runs/123') return json({ id: 123, head_sha: state.wrongSha || CANDIDATE, event: 'workflow_dispatch', path: '.github/workflows/verify.yml', status: 'completed', conclusion: state.conclusion });
    if (path.endsWith('/verify.yml/runs')) return json({ workflow_runs: state.run ? [{ id: 123, head_sha: state.wrongSha || CANDIDATE, event: 'workflow_dispatch', path: '.github/workflows/verify.yml', status: 'completed', conclusion: state.conclusion }] : [] });
    throw new Error(`Unexpected test route ${path}`);
  };
  const repo = createOfficeAIRepository({ env: { OFFICE_GITHUB_TOKEN: 'private-github-token' }, fetcher });
  return { state, fetcher, repo };
}
async function prepare(repo) {
  const source = await repo.readFile({ ref: BASE, path: 'backend/example.js' });
  const file = await repo.edit({ ref: BASE, path: source.path, expectedSha: source.sha, edits: [{ find: '= 1', replace: '= 2' }] });
  const candidate = await repo.candidate({ taskId: TASK, baseSha: BASE, files: [file], message: 'Update the example answer', createdAt: '2026-11-04T00:00:00Z' });
  return { file, candidate };
}

test('path policy excludes secrets, traversal, binaries, build output and symlink blobs', async () => {
  for (const path of ['../backend/a.js', 'backend/../a.js', '/backend/a.js', 'backend\\a.js', 'backend/.env', 'backend/secrets.json', 'backend/credentials.json', 'backend/node_modules/a.js', '.cache/task.js', 'backend/a.pem', 'backend/%2e%2e/a.js']) assert.equal(repositoryPath(path), null, path);
  const { repo } = provider();
  assert.deepEqual((await repo.listFiles({ ref: BASE })).files.map(file => file.path), ['backend/example.js']);
  await assert.rejects(repo.readFile({ ref: BASE, path: 'backend/.env' }), /approved/);
  await assert.rejects(repo.readFile({ ref: BASE, path: 'backend/link.js' }), /does not exist/);
});

test('reads pinned verified blobs by bounded ranges and requires an exact unique edit match', async () => {
  const { repo } = provider();
  const file = await repo.readFile({ ref: BASE, path: 'backend/example.js', startLine: 1, endLine: 1 });
  assert.equal(file.content, 'const answer = 1;');
  assert.equal(file.sha, blobSha('const answer = 1;\n'));
  await assert.rejects(repo.readFile({ ref: 'main', path: file.path }), /pinned/);
  await assert.rejects(repo.edit({ ref: BASE, path: file.path, expectedSha: 'e'.repeat(40), edits: [{ find: '= 1', replace: '= 2' }] }), /revision/);
  assert.throws(() => applyRepositoryEdit({ path: file.path, sha: file.sha, content: 'same same' }, { path: file.path, expectedSha: file.sha, edits: [{ find: 'same', replace: 'other' }] }), /exactly one/);
});

test('source credentials, known environment secrets and unexpected upstream failures never enter model output', async () => {
  const { repo } = provider('const token = "private-github-token";');
  await assert.rejects(repo.readFile({ ref: BASE, path: 'backend/example.js' }), /credential/);
  const key = provider('const token = "ghp_' + 'x'.repeat(32) + '";');
  await assert.rejects(key.repo.readFile({ ref: BASE, path: 'backend/example.js' }), /credential/);
  const bad = createOfficeAIRepository({ env: { OFFICE_GITHUB_TOKEN: 'secret-not-for-errors' }, fetcher: async (_url, options) => {
    assert.equal(options.redirect, 'error'); throw new Error('secret-not-for-errors');
  } });
  await assert.rejects(bad.head(), error => !error.message.includes('secret-not-for-errors') && !!error.publicMessage);
});

test('candidate publication uses an immutable tag, exact successful checks and a non-force main update', async () => {
  const { repo, state } = provider();
  const { candidate } = await prepare(repo);
  assert.equal(candidate.refType, 'tag');
  assert.equal(state.head, BASE);
  assert.deepEqual(state.calls.find(call => call.path === '/git/refs').body, { ref: `refs/tags/office-ai/${TASK}`, sha: CANDIDATE });
  await assert.rejects(repo.publish(candidate), /successful verification/);
  const queued = await repo.checks(candidate, { dispatch: true });
  assert.equal(queued[0].status, 'queued');
  const published = await repo.publish(candidate);
  assert.equal(published.published, true);
  assert.deepEqual(state.calls.find(call => call.method === 'PATCH').body, { sha: CANDIDATE, force: false });
  assert.equal((await repo.publish(candidate)).published, true);
  assert.equal(state.calls.filter(call => call.method === 'PATCH').length, 1);
});

test('failed checks, checks for a different commit and concurrent main changes block publication', async () => {
  for (const mode of ['failed', 'wrong-sha', 'moved-main']) {
    const { repo, state } = provider(); const { candidate } = await prepare(repo);
    state.run = true;
    if (mode === 'failed') state.conclusion = 'failure';
    if (mode === 'wrong-sha') state.wrongSha = 'f'.repeat(40);
    if (mode === 'moved-main') state.head = 'f'.repeat(40);
    await assert.rejects(repo.publish(candidate));
    assert.equal(state.calls.some(call => call.method === 'PATCH'), false, mode);
  }
});

test('candidate creation is repeatable and never moves an existing tag to another commit', async () => {
  const { repo, state } = provider(); const first = await prepare(repo); const second = await prepare(repo);
  assert.equal(first.candidate.sha, second.candidate.sha);
  assert.equal(state.calls.filter(call => call.path === '/git/refs').length, 1);
  state.tag = 'f'.repeat(40);
  await assert.rejects(prepare(repo), /different immutable candidate/);
  assert.equal(state.calls.some(call => call.method === 'DELETE' || call.body?.force), false);
});

test('anonymous repository reading never implies write access and task verification cannot replace itself', async () => {
  const { fetcher } = provider();
  const repo = createOfficeAIRepository({ env: {}, fetcher });
  assert.equal(repo.configured(), false);
  assert.equal((await repo.head()).sha, BASE);
  await assert.rejects(prepare(repo), /Connect GitHub/);
  const writable = provider().repo;
  await assert.rejects(writable.candidate({ taskId: TASK, baseSha: BASE, message: 'Skip all checks', createdAt: '2026-11-04', files: [{ path: '.github/workflows/verify.yml' }] }), /verification workflow/);
});

test('publication races preserve every competing main head and reconcile a lost success response without replay', async () => {
  for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'e']) {
    const original = provider(); let writes = 0;
    const repo = createOfficeAIRepository({ env: { OFFICE_GITHUB_TOKEN: 'test-github-token' }, fetcher: async (url, options) => {
      if (options.method === 'PATCH') {
        writes++; assert.equal(JSON.parse(options.body).force, false);
        original.state.head = digit.repeat(40);
        return json({ message: 'Reference update rejected' }, 409);
      }
      return original.fetcher(url, options);
    } });
    const { candidate } = await prepare(repo); original.state.run = true;
    await assert.rejects(repo.publish(candidate));
    assert.equal(original.state.head, digit.repeat(40)); assert.equal(writes, 1);
  }
  const original = provider(); let writes = 0;
  const repo = createOfficeAIRepository({ env: { OFFICE_GITHUB_TOKEN: 'test-github-token' }, fetcher: async (url, options) => {
    if (options.method === 'PATCH') { writes++; original.state.head = CANDIDATE; throw new Error('Response lost after accepted write'); }
    return original.fetcher(url, options);
  } });
  const { candidate } = await prepare(repo); original.state.run = true;
  assert.equal((await repo.publish(candidate)).published, true);
  assert.equal(writes, 1); assert.equal(original.state.head, CANDIDATE);
});

test('current GitHub dispatch receipts pin polling to the returned run and still verify its exact commit', async () => {
  const { repo, state } = provider(); state.directReceipt = true;
  const { candidate } = await prepare(repo);
  const queued = await repo.checks(candidate, { dispatch: true });
  assert.equal(queued[0].id, 123);
  assert.equal(queued[0].url, 'https://github.com/UFIConnect/UFIConnect/actions/runs/123');
  candidate.verificationRunId = queued[0].id;
  assert.equal((await repo.checks(candidate))[0].conclusion, 'success');
  assert.ok(state.calls.some(item => item.path === '/actions/runs/123'));
  state.wrongSha = BASE;
  await assert.rejects(repo.publish(candidate), /successful verification/);
});
