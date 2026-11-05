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

test('Office and web static security headers are editable without admitting other extensionless or private files', () => {
  for (const file of ['office/public/_headers', 'web/public/_headers']) assert.equal(repositoryPath(file), file);
  for (const file of ['office/.env', 'office/public/.env', 'office/public/_credentials', 'office/public/../_headers', 'backend/_headers', '.github/_headers'])
    assert.equal(repositoryPath(file), null);
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

test('task editing and candidate upload cannot weaken the exact-source verification decision helper', async () => {
  const { repo, state } = provider();
  for (const path of ['.github/workflows/verify.yml', 'scripts/verify-release-reuse.mjs', 'scripts/verify-release-reuse.test.mjs']) {
    await assert.rejects(repo.edit({ref:BASE,path,expectedSha:null,content:'return true;'}), /verification workflow/);
    await assert.rejects(repo.candidate({taskId:TASK,baseSha:BASE,message:'Bypass verification',createdAt:'2026-11-04',files:[{path}]}), /verification workflow/);
  }
  assert.equal(state.calls.some(call=>call.method==='POST'), false);
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

test('repeated immutable source reads reuse verified source and cancellation still stops a cached read', async () => {
  const { repo, state } = provider();
  await repo.listFiles({ ref: BASE });
  const first = await repo.readFile({ ref: BASE, path: 'backend/example.js' });
  await repo.readFile({ ref: BASE, path: first.path });
  await repo.search({ ref: BASE, paths: [first.path], query: 'answer' });
  await repo.edit({ ref: BASE, path: first.path, expectedSha: first.sha, edits: [{ find: '= 1', replace: '= 2' }] });
  assert.equal(state.calls.filter(call => call.path.startsWith('/git/trees/')).length, 1);
  assert.equal(state.calls.filter(call => call.path.startsWith('/git/blobs/')).length, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(repo.readFile({ ref: BASE, path: first.path }, controller.signal), { name: 'AbortError' });
  // Many pinned revisions cannot keep growing the resident tree set forever.
  for (const digit of '1234567') await repo.listFiles({ ref: digit.repeat(40) });
  await repo.listFiles({ ref: BASE });
  assert.equal(state.calls.filter(call => call.path === `/git/trees/${BASE}`).length, 2);
});

test('failed verification diagnostics retain exact-source receipts and bounded failed step names without another dispatch', async () => {
  const original = provider();
  const repo = createOfficeAIRepository({ env: { OFFICE_GITHUB_TOKEN: 'private-github-token' }, fetcher: async (url, options) => {
    if (new URL(url).pathname.endsWith('/actions/runs/123/jobs')) return json({ total_count: 103, jobs: [
      { id: 456, run_id: 123, name: 'backend private-github-token\nchecks', conclusion: 'failure', steps: [
        { name: 'Install', conclusion: 'success' }, { name: 'npm test', conclusion: 'failure' },
      ] },
      { id: 789, run_id: 123, name: 'Office', conclusion: 'success', steps: [] },
      { id: 999, run_id: 987, name: 'Wrong run', conclusion: 'failure', steps: [] },
    ] });
    return original.fetcher(url, options);
  } });
  const { candidate } = await prepare(repo); original.state.run = true; original.state.conclusion = 'failure';
  const result = await repo.verificationFailure(candidate);
  assert.equal(result.sha, CANDIDATE); assert.equal(result.runId, 123); assert.equal(result.truncated, true);
  assert.equal(result.failedJobs.length, 1); assert.equal(result.failedJobs[0].steps.length, 1);
  assert.equal(result.failedJobs[0].steps[0].name, 'npm test');
  assert.doesNotMatch(JSON.stringify(result), /private-github-token|Wrong run/);
  assert.equal(result.failedJobs[0].url, 'https://github.com/UFIConnect/UFIConnect/actions/runs/123/job/456');
  assert.equal(original.state.calls.some(item => item.path.endsWith('/dispatches')), false);
  original.state.wrongSha = BASE;
  await assert.rejects(repo.verificationFailure(candidate), /matches this candidate/);
});

test('rotating or removing the repository credential discards cached private source', async () => {
  const { state, fetcher } = provider();
  const env = { OFFICE_GITHUB_TOKEN: 'first-private-token' };
  const repo = createOfficeAIRepository({ env, fetcher });
  const input = { ref: BASE, path: 'backend/example.js' };
  await repo.readFile(input);
  env.OFFICE_GITHUB_TOKEN = 'next-private-token';
  await repo.readFile(input);
  delete env.OFFICE_GITHUB_TOKEN;
  await repo.readFile(input);
  assert.equal(state.calls.filter(call => call.path.startsWith('/git/trees/')).length, 3);
  assert.equal(state.calls.filter(call => call.path.startsWith('/git/blobs/')).length, 3);
  assert.equal(state.calls.at(-1).options.headers.Authorization, undefined);
});

test('a connection change during a source fetch cannot return or retain its old private result', async () => {
  const original = provider(), env = { OFFICE_GITHUB_TOKEN: 'initial-private-token' };
  let rotate = true;
  const repo = createOfficeAIRepository({ env, fetcher: async (url, options) => {
    const response = await original.fetcher(url, options);
    if (rotate && url.includes('/git/blobs/')) { env.OFFICE_GITHUB_TOKEN = 'replacement-private-token'; rotate = false; }
    return response;
  } });
  await assert.rejects(repo.readFile({ ref: BASE, path: 'backend/example.js' }), /connection changed/);
  await repo.readFile({ ref: BASE, path: 'backend/example.js' });
  assert.equal(original.state.calls.filter(call => call.path.startsWith('/git/blobs/')).length, 2);
});

test('bad blob integrity never poisons a later source read and larger verified files reuse the bounded source cache', async () => {
  const original = provider(); let corrupt = true;
  const repo = createOfficeAIRepository({ env: {}, fetcher: async (url, options) => {
    if (url.includes('/git/blobs/') && corrupt) { corrupt = false; return json({ encoding: 'base64', content: Buffer.from('wrong content').toString('base64') }); }
    return original.fetcher(url, options);
  } });
  await assert.rejects(repo.readFile({ ref: BASE, path: 'backend/example.js' }), /integrity/);
  assert.equal((await repo.readFile({ ref: BASE, path: 'backend/example.js' })).content, original.state.content);
  const large = provider('a'.repeat(100) + '\n' + 'line\n'.repeat(54000));
  for (let i = 0; i < 2; i++) await large.repo.readFile({ ref: BASE, path: 'backend/example.js', startLine: 1, endLine: 1 });
  assert.equal(large.state.calls.filter(call => call.path.startsWith('/git/blobs/')).length, 1);
});

test('section reads and exact edits of a large entrypoint share one verified blob request', async () => {
  const content = 'const timeout = 30;\n' + '// source detail\n'.repeat(115000);
  assert.ok(Buffer.byteLength(content) > 1800000);
  const { repo, state } = provider(content);
  const first = await repo.readFile({ ref: BASE, path: 'backend/example.js', startLine: 1, endLine: 1 });
  const later = await repo.readFile({ ref: BASE, path: first.path, startLine: 10000, endLine: 10003 });
  assert.equal(later.sha, first.sha); assert.equal(later.content, Array(4).fill('// source detail').join('\n'));
  const edited = await repo.edit({ ref: BASE, path: first.path, expectedSha: first.sha, edits: [{ find: 'const timeout = 30;', replace: 'const timeout = 90;' }] });
  assert.equal(edited.originalSha, first.sha); assert.equal(edited.sha, blobSha(content.replace('const timeout = 30;', 'const timeout = 90;')));
  await assert.rejects(repo.edit({ ref: BASE, path: first.path, expectedSha: 'f'.repeat(40), edits: [{ find: 'const timeout = 30;', replace: 'const timeout = 90;' }] }), /revision/);
  assert.equal(state.calls.filter(call => call.path.startsWith('/git/trees/')).length, 1);
  assert.equal(state.calls.filter(call => call.path.startsWith('/git/blobs/')).length, 1, 'Two section reads and an exact edit avoid two complete source downloads');
});

test('caching larger verified entrypoints does not grow the four-MiB total cache budget', async () => {
  const source = Array.from({ length: 3 }, (_, i) => ({ path: `backend/large-${i}.js`, content: `const index = ${i};\n` + '// source detail\n'.repeat(99000) }));
  const calls = [];
  const repo = createOfficeAIRepository({ env: {}, fetcher: async url => {
    const pathname = new URL(url).pathname; calls.push(pathname);
    if (pathname.includes('/git/trees/')) return json({ tree: source.map(item => ({ path: item.path, sha: blobSha(item.content), mode: '100644', type: 'blob', size: Buffer.byteLength(item.content) })) });
    const item = source.find(item => pathname.endsWith(blobSha(item.content)));
    assert.ok(item); return json({ encoding: 'base64', content: Buffer.from(item.content).toString('base64') });
  } });
  const read = index => repo.readFile({ ref: BASE, path: source[index].path, startLine: 1, endLine: 1 });
  await read(0); await read(1); await read(0);
  assert.equal(calls.filter(path=>path.includes('/git/blobs/')).length, 2, 'Two entrypoints fit and the first remains cached');
  await read(2); await read(1);
  assert.equal(calls.filter(path=>path.includes('/git/blobs/')).length, 4, 'A third large entrypoint evicts the least recently used source within the same total budget');
});

test('candidate source validation finishes before any blob upload', async () => {
  const { repo, state } = provider();
  const source = await repo.readFile({ ref: BASE, path: 'backend/example.js' });
  const file = await repo.edit({ ref: BASE, path: source.path, expectedSha: source.sha, edits: [{ find: '= 1', replace: '= 2' }] });
  await assert.rejects(repo.candidate({ taskId: TASK, baseSha: BASE, files: [file, { ...file, path: 'backend/other.js', originalSha: 'f'.repeat(40) }], message: 'Validate every source before upload', createdAt: '2026-11-04' }), /pinned source/);
  assert.equal(state.calls.some(call => call.path === '/git/blobs'), false);
});

test('multi-file search and candidate upload overlap independent blobs with a four-request bound', async () => {
  const original = provider();
  const source = Array.from({ length: 8 }, (_, i) => ({ path: `backend/example-${i}.js`, content: `const answer = ${i};\n` }));
  let reads = 0, writes = 0, maxReads = 0, maxWrites = 0;
  const repo = createOfficeAIRepository({ env: { OFFICE_GITHUB_TOKEN: 'private-github-token' }, fetcher: async (url, options) => {
    const path = new URL(url).pathname.replace('/repos/UFIConnect/UFIConnect', '');
    if (path.startsWith('/git/trees/')) return json({ tree: source.map(item => ({ path: item.path, sha: blobSha(item.content), mode: '100644', type: 'blob', size: Buffer.byteLength(item.content) })) });
    if (path.startsWith('/git/blobs/')) {
      reads++; maxReads = Math.max(maxReads, reads);
      await new Promise(resolve => setTimeout(resolve, 5)); reads--;
      const item = source.find(item => path.endsWith(blobSha(item.content)));
      return json({ encoding: 'base64', content: Buffer.from(item.content).toString('base64') });
    }
    if (path === '/git/blobs') {
      writes++; maxWrites = Math.max(maxWrites, writes);
      await new Promise(resolve => setTimeout(resolve, 5)); writes--;
    }
    return original.fetcher(url, options);
  } });
  const found = await repo.search({ ref: BASE, paths: source.map(item => item.path), query: 'answer' });
  assert.deepEqual(found.hits.map(item => item.path), source.map(item => item.path));
  const files = source.map(item => ({ ...item, originalSha: blobSha(item.content), content: item.content + '// updated\n', sha: blobSha(item.content + '// updated\n') }));
  await repo.candidate({ taskId: TASK, baseSha: BASE, files, message: 'Update all eight source files', createdAt: '2026-11-04' });
  assert.ok(maxReads > 1 && maxReads <= 4); assert.ok(maxWrites > 1 && maxWrites <= 4);
});

test('search and candidate upload start later source files while an earlier request is still pending', async t => {
  for (const operation of ['search', 'candidate']) await t.test(operation, async () => {
    const original = provider(), source = Array.from({ length: 8 }, (_, i) => ({ path: `backend/lane-${i}.js`, content: `const answer = ${i};\n` }));
    let releaseFirst, startedFifth, active = 0, peak = 0, dispatched = 0;
    const stalled = new Promise(resolve => { releaseFirst = resolve; }), fifth = new Promise(resolve => { startedFifth = resolve; });
    const repo = createOfficeAIRepository({ env: { OFFICE_GITHUB_TOKEN: 'private-github-token' }, fetcher: async (url, options) => {
      const pathname = new URL(url).pathname.replace('/repos/UFIConnect/UFIConnect', '');
      if (pathname.startsWith('/git/trees/')) return json({ tree: source.map(item => ({ path: item.path, sha: blobSha(item.content), mode: '100644', type: 'blob', size: Buffer.byteLength(item.content) })) });
      if (operation==='search' && pathname.startsWith('/git/blobs/') || operation==='candidate' && pathname==='/git/blobs') {
        const index=operation==='search' ? source.findIndex(item=>pathname.endsWith(blobSha(item.content))) : source.findIndex(item=>JSON.parse(options.body).content.startsWith(item.content));
        assert.ok(index>=0); active++; peak=Math.max(peak,active); dispatched++;
        if(index===4)startedFifth();
        if(index===0)await stalled;
        active--;
        if(operation==='search')return json({ encoding:'base64',content:Buffer.from(source[index].content).toString('base64') });
      }
      return original.fetcher(url,options);
    } });
    const pending=operation==='search'
      ?repo.search({ref:BASE,paths:source.map(item=>item.path),query:'answer'})
      :repo.candidate({taskId:TASK,baseSha:BASE,files:source.map(item=>({...item,originalSha:blobSha(item.content),content:item.content+'// adjusted\n',sha:blobSha(item.content+'// adjusted\n')})),message:'Adjust all eight source files',createdAt:'2026-11-04'});
    let deadline;
    try {
      await Promise.race([fifth,new Promise((_resolve,reject)=>{deadline=setTimeout(()=>reject(Error('Free request lanes waited for the stalled first source')),1000);})]);
      assert.ok(dispatched>=5); assert.ok(active>=1); assert.ok(peak<=4);
    } finally {clearTimeout(deadline);releaseFirst();}
    const result=await pending;
    if(operation==='search')assert.deepEqual(result.hits.map(item=>item.path),source.map(item=>item.path));
    else assert.equal(result.published,false);
    assert.equal(dispatched,8);
  });
});

test('a failed parallel source read stops additional dispatch and settles already started requests', async () => {
  const source = Array.from({ length: 8 }, (_, i) => ({ path: `backend/failure-${i}.js`, content: `const answer = ${i};\n` }));
  let dispatches=0, active=0, releaseOthers;
  const waiting=new Promise(resolve=>{releaseOthers=resolve;});
  const repo=createOfficeAIRepository({env:{},fetcher:async url=>{
    const pathname=new URL(url).pathname;
    if(pathname.includes('/git/trees/'))return json({tree:source.map(item=>({path:item.path,sha:blobSha(item.content),mode:'100644',type:'blob',size:Buffer.byteLength(item.content)}))});
    dispatches++;active++;
    if(pathname.endsWith(blobSha(source[0].content))){active--;releaseOthers();return json({error:'Read unavailable'},502);}
    await waiting;active--;
    const item=source.find(item=>pathname.endsWith(blobSha(item.content)));return json({encoding:'base64',content:Buffer.from(item.content).toString('base64')});
  }});
  await assert.rejects(repo.search({ref:BASE,paths:source.map(item=>item.path),query:'answer'}),/could not complete/);
  assert.equal(active,0,'All requests already started are settled before reporting failure');
  assert.ok(dispatches<=4,'No later batch starts after the initial read failure');
});

function rebaseProvider({ conflict = false, alreadyPublished = false } = {}) {
  const original = provider(), tags = new Map();
  const moved = 'f'.repeat(40), rebased = 'e'.repeat(40);
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace('/repos/UFIConnect/UFIConnect', ''), body = options.body ? JSON.parse(options.body) : null;
    if (path.startsWith('/git/ref/tags/')) return tags.has(path.slice('/git/ref/tags/'.length)) ? json({ object: { sha: tags.get(path.slice('/git/ref/tags/'.length)) } }) : json({}, 404);
    if (path === '/git/refs') { tags.set(body.ref.slice('refs/tags/'.length), body.sha); return json({ object: { sha: body.sha } }, 201); }
    if (path.startsWith('/compare/')) return json({ merge_base_commit: { sha: alreadyPublished ? CANDIDATE : BASE } });
    if (path === '/git/commits' && body.parents[0] === moved) return json({ sha: rebased }, 201);
    if (path === `/git/commits/${CANDIDATE}`) return json({ sha: CANDIDATE, tree: { sha: 'b'.repeat(40) }, parents: [{ sha: BASE }], message: 'office-ai: Preserve the example change', author: { date: '2026-11-04T00:00:00Z' } });
    if (conflict && path === `/git/trees/${moved}`) return json({ tree: [{ path: 'backend/example.js', mode: '100644', type: 'blob', sha: 'd'.repeat(40), size: 20 }] });
    return original.fetcher(url, options);
  };
  return { ...original, repo: createOfficeAIRepository({ env: { OFFICE_GITHUB_TOKEN: 'private-github-token' }, fetcher }), tags, moved, rebased };
}

test('main movement rebases only untouched edited paths into a new immutable candidate requiring new checks', async () => {
  const { repo, state, tags, moved, rebased } = rebaseProvider();
  const { candidate, file } = await prepare(repo); state.run = true; state.head = moved;
  await assert.rejects(repo.publish(candidate), error => error.code === 'MAIN_MOVED');
  const next = await repo.rebase(candidate, [file]);
  assert.equal(next.sha, rebased); assert.equal(next.baseSha, moved);
  assert.equal(next.rebasedFrom, candidate.sha); assert.equal(next.published, false);
  assert.notEqual(next.ref, candidate.ref); assert.equal(tags.get(candidate.ref), candidate.sha);
  assert.equal(tags.get(next.ref), rebased);
  assert.equal(next.verificationRunId, undefined);
  assert.deepEqual(await repo.rebase(candidate, [file]), next);
  await assert.rejects(repo.publish(next), /successful verification/);
  assert.equal(state.calls.some(call => call.method === 'PATCH'), false);
});

test('changed edited paths block automatic rebase and already accepted publication is reconciled without new writes', async () => {
  const conflicting = rebaseProvider({ conflict: true });
  const { candidate, file } = await prepare(conflicting.repo); conflicting.state.head = conflicting.moved;
  await assert.rejects(conflicting.repo.rebase(candidate, [file]), /conflict review/);
  assert.equal(conflicting.tags.size, 1);
  conflicting.state.head = candidate.sha;
  assert.equal((await conflicting.repo.rebase(candidate, [file])).published, true);
  assert.equal(conflicting.tags.size, 1);
});

test('lost publication responses followed by later main changes or reverts cannot replay an accepted candidate', async () => {
  const previous = rebaseProvider({ alreadyPublished: true });
  const { candidate, file } = await prepare(previous.repo); previous.state.head = previous.moved;
  await assert.rejects(previous.repo.rebase(candidate, [file]), /already in main history/);
  assert.equal(previous.tags.size, 1);
});
