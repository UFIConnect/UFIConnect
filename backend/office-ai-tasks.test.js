'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeAITasks } = require('./office-ai-tasks');
const { createOfficeAIModel } = require('./office-ai');
const BASE = 'a'.repeat(40), CANDIDATE = 'c'.repeat(40);
const body = (overrides = {}) => ({ clientRequestId: randomUUID(), target: overrides.permissions?.operate ? 'office' : 'self-update', message: 'Improve the example and validate it.', permissions: { editCode: true, publish: true, deploy: true }, deployTargets: ['api'], ...overrides });
const call = (name, args) => ({ content: null, tool_calls: [{ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
async function invoke(handler, input = {}, id) {
  const res = { statusCode: 200, set() { return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body: input, params: { id } }, res);
  return { status: res.statusCode, body: res.body };
}
async function fixture(t, options = {}) {
  const pg = new PGlite(); await pg.waitReady;
  t.after(() => pg.close());
  const query = (sql, values) => sql === 'SELECT pg_advisory_xact_lock(813702494)' ? Promise.resolve({ rows: [] }) : pg.query(sql, values);
  const db = { query, isConnected: () => true, withClient: fn => fn({ query }) };
  const state = { edits: 0, candidates: 0, published: 0, checks: 0, conclusion: 'success' };
  const repo = { repository: 'UFIConnect/UFIConnect', configured: () => true, redact: text => String(text).replaceAll('private-token-value', '[credential redacted]'),
    head: async () => ({ sha: BASE }), listFiles: async () => ({ files: [{ path: 'backend/office-ai-example.js', sha: BASE }] }),
    readFile: async () => ({ path: 'backend/office-ai-example.js', sha: BASE, content: 'const value=1;' }),
    edit: async () => { state.edits++; return { path: 'backend/office-ai-example.js', originalSha: BASE, sha: CANDIDATE, before: 'const value=1;', content: 'const value=2;' }; },
    candidate: async ({ taskId }) => { state.candidates++; return { sha: CANDIDATE, baseSha: BASE, ref: `office-ai/${taskId}`, refType: 'tag', published: false, url: 'https://github.com/UFIConnect/UFIConnect/commit/' + CANDIDATE }; },
    checks: async (_candidate, { dispatch }) => { state.checks++; return [{ name: 'Verify', status: dispatch ? 'queued' : 'completed', conclusion: dispatch ? null : state.conclusion, sha: CANDIDATE }]; },
    publish: async candidate => { state.published++; return { ...candidate, published: true }; },
  };
  const responses = [call('repo_read', { path: 'backend/office-ai-example.js' }), call('repo_edit', { path: 'backend/office-ai-example.js', expectedSha: BASE, edits: [{ find: '=1', replace: '=2' }] }), call('repo_commit', { message: 'Improve example value' }), { content: 'The requested update is ready.' }];
  const service = createOfficeAITasks({ db, repository: repo, model: async () => responses.shift() || { content: 'Finished.' }, ...options });
  t.after(() => service.stop());
  return { pg, db, repo, state, service, responses };
}
async function finish(service, id, limit = 25) {
  let task;
  for (let i = 0; i < limit; i++) {
    await service.runOne(id);
    task = (await invoke(service.detail, {}, id)).body.task;
    if (['succeeded', 'failed', 'needs_confirmation', 'cancelled'].includes(task.status)) return task;
  }
  throw new Error(`Task did not finish: ${task.status}`);
}

test('idle requests never create work and preview asks use the hosted draft destination', async t => {
  let turns = 0;
  const { service, pg } = await fixture(t, { model: async () => { turns++; return { content: 'Must not run' }; } });
  for (const message of ['Hi', 'start task', 'do anything', 'what can you do?', 'yes']) {
    const result = await invoke(service.create, body({ message, target: 'auto', history: [{ role: 'user', content: 'Hello' }] }));
    assert.equal(result.status, 400); assert.match(result.body.error, /No task was started/);
  }
  assert.equal(turns, 0); assert.equal((await pg.query('SELECT count(*)::int AS count FROM office_ai_tasks')).rows[0].count, 0);
  const local = await invoke(service.create, body({ message: 'Update the local website heading.', target: 'auto' }));
  assert.equal(local.status, 202); assert.equal(local.body.task.route.target, 'hosted-web');
  assert.equal(local.body.task.permissions.publish, false); assert.equal(local.body.task.permissions.deploy, false);
  assert.equal(turns, 0);
});

test('public web destination rejects backend writes and never exposes Office operations', async t => {
  let turn = 0;
  const { service, state } = await fixture(t, { getControls: () => [{ id: 'health.security' }], executeControl: async () => { throw Error('No Office operation'); },
    model: async ({ tools, messages }) => {
      assert.equal(tools.some(tool => tool.function.name === 'office_command'), false);
      assert.match(messages[0].content, /public-web/);
      return ++turn === 1 ? call('repo_edit', { path: 'backend/office-ai-example.js', expectedSha: BASE, edits: [{ find: '=1', replace: '=2' }] })
        : { content: 'The requested file is outside the public website scope.' };
    } });
  const created = await invoke(service.create, body({ target: 'public-web', message: 'Update the public website.', deployTargets: ['web', 'api'] }));
  assert.equal(created.body.task.route.target, 'public-web'); assert.deepEqual(created.body.task.deployTargets, ['web']);
  const done = await finish(service, created.body.task.id);
  assert.equal(state.edits, 0); assert.equal(state.published, 0);
  assert.ok(done.events.some(event => event.status === 'failed' && event.detail.includes('outside the selected task destination')));
});

test('hosted website tasks write through workspace tools without repository or production changes', async t => {
  let turns = 0, writes = 0;
  const workspace = { workspace_write: { permission: 'editCode', description: 'Write a private hosted draft',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
    execute: async (args, context) => { writes++; assert.equal(context.task.route.target, 'hosted-web'); return { path: args.path,
      revision: 'b'.repeat(64), memoryId: '11111111-1111-4111-8111-111111111111', version: 1, bytes: Buffer.byteLength(args.content), status: 'saved', message: 'Private hosted draft saved.' }; } } };
  const { service, state } = await fixture(t, { adapters: workspace, model: async ({ tools }) => {
    const names = tools.map(tool => tool.function.name);
    assert.ok(names.includes('workspace_write'));
    for (const name of ['repo_edit', 'repo_commit', 'office_command', 'terminal_run', 'cloudflare_deploy']) assert.equal(names.includes(name), false, name);
    return ++turns === 1 ? call('workspace_write', { path: 'index.html', content: '<h1>My private draft</h1>' }) : { content: 'The private hosted draft was saved.' };
  } });
  const created = await invoke(service.create, body({ target: 'local-web', message: 'Create a website preview.' }));
  assert.equal(created.body.task.route.target, 'hosted-web');
  const done = await finish(service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(writes, 1);
  assert.equal(done.artifacts.length, 1); assert.equal(done.artifacts[0].memoryId, '11111111-1111-4111-8111-111111111111');
  assert.equal(done.artifacts[0].revision, 'b'.repeat(64)); assert.equal(done.artifacts[0].path, 'index.html');
  assert.equal(state.edits, 0); assert.equal(state.candidates, 0); assert.equal(state.published, 0);
  assert.deepEqual(done.deployTargets, []);
});

test('hosted write claims without a verified memory file receipt cannot succeed', async t => {
  for (const malformed of [false, true]) {
    let turns = 0;
    const adapters = malformed ? { workspace_write: { permission: 'editCode', parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({ path: 'index.html', message: 'Saved without a receipt' }) } } : {};
    const { service } = await fixture(t, { adapters, model: async () => malformed && ++turns === 1 ? call('workspace_write', {}) : { content: 'The hosted website has been saved.' } });
    const created = await invoke(service.create, body({ target: 'hosted-web', message: 'Create a website preview.' }));
    const done = await finish(service, created.body.task.id);
    assert.equal(done.status, 'failed'); assert.match(done.error, /No hosted file was confirmed/); assert.deepEqual(done.artifacts, []);
  }
});

test('ambiguous general requests can prepare permitted code without publishing it', async t => {
  const { service, state } = await fixture(t);
  const created = await invoke(service.create, body({ target: 'auto', message: 'Improve the example and validate it.' }));
  assert.equal(created.body.task.route.target, 'general'); assert.equal(created.body.task.permissions.publish, false);
  const done = await finish(service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(state.edits, 1); assert.equal(state.candidates, 1); assert.equal(state.published, 0);
  assert.equal(done.commit.published, false);
});

test('omitting a destination cannot bypass scoping on new task requests', async t => {
  const { service, state } = await fixture(t);
  const request = body({ message: 'Improve the example and validate it.' }); delete request.target;
  const created = await invoke(service.create, request);
  assert.equal(created.status, 202); assert.equal(created.body.task.route.target, 'general');
  assert.equal(created.body.task.permissions.publish, false); assert.equal(created.body.task.permissions.deploy, false);
  const done = await finish(service, created.body.task.id);
  assert.equal(done.commit.published, false); assert.equal(state.published, 0);
});

test('tasks recall dated memory and record actual tool receipts and final outcomes', async t => {
  let turn = 0; const writes = [], searches = [];
  const memory = { search: async query => { searches.push(query); return { entries: [{ id: 'memory-receipt', title: 'Previous check',
    createdAt: '2026-11-02T12:00:00Z', kind: 'execution', status: 'succeeded', referenceId: 'office-run-123', content: 'A prior check passed.' }] }; },
    record: async value => { writes.push(value); } };
  const { service } = await fixture(t, { memory, model: async ({ tools, messages }) => {
    assert.ok(tools.some(tool => tool.function.name === 'memory_search'));
    assert.match(JSON.stringify(messages), /memory-receipt/);
    return ++turn === 1 ? call('memory_search', { query: 'Previous check' }) : { content: 'The earlier check passed according to the dated receipt.' };
  } });
  const created = await invoke(service.create, body({ target: 'general', message: 'Explain the previous check.', permissions: {} }));
  const done = await finish(service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(done.memoryState.status, 'retrieved');
  assert.equal(done.memoryState.entries[0].referenceId, 'office-run-123'); assert.equal(searches.length, 2);
  assert.ok(writes.some(item => item.kind === 'conversation' && item.role === 'user'));
  assert.ok(writes.some(item => item.metadata.tool === 'memory_search' && item.status === 'tool-returned'));
  assert.ok(writes.some(item => item.kind === 'execution' && item.referenceId === done.id && item.status === 'succeeded'));
});

test('reusable knowledge receipts are traceable and memory opt-out disables the write tool', async t => {
  const memoryId = '22222222-2222-4222-8222-222222222222'; let turn = 0;
  const adapters = { memory_remember: { permission: 'read', parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false },
    execute: async () => ({ entry: { id: memoryId } }) } };
  const memory = { search: async () => ({ entries: [] }), record: async () => ({ id: randomUUID() }) };
  const { service } = await fixture(t, { memory, adapters, model: async () => ++turn === 1 ? call('memory_remember', { content: 'The operator prefers short headings.' }) : { content: 'Your preference has been saved.' } });
  const created = await invoke(service.create, body({ target: 'general', message: 'Remember that I prefer short headings.', permissions: {} }));
  const done = await finish(service, created.body.task.id);
  assert.deepEqual(done.memoryState.recordedIds, [memoryId]); assert.equal(done.artifacts.length, 0);
  const other = await fixture(t, { memory, adapters, model: async ({ tools }) => {
    assert.equal(tools.some(tool => ['memory_remember', 'memory_search'].includes(tool.function.name)), false);
    return { content: 'This request did not use memory.' };
  } });
  const disabled = await invoke(other.service.create, body({ target: 'general', message: 'Explain a short heading.', memory: false, permissions: {} }));
  assert.equal((await finish(other.service, disabled.body.task.id)).memoryState.status, 'disabled');
});

test('recovered tool failures remain in memory with their actual action and invocation reference', async t => {
  let turn = 0; const records = [];
  const memory = { search: async () => ({ entries: [] }), record: async entry => { records.push(entry); return { id: randomUUID() }; } };
  const { service } = await fixture(t, { memory, getControls: () => [{ id: 'health.security', available: true }],
    executeControl: async () => { throw Object.assign(new Error('Temporary check failure'), { publicMessage: 'Temporary check failure', status: 502 }); },
    model: async () => ++turn === 1 ? call('office_command', { id: 'health.security' }) : { content: 'The check failed; here is the available explanation.' } });
  const created = await invoke(service.create, body({ target: 'office', message: 'Run the security check and explain its result.', permissions: { operate: true } }));
  const done = await finish(service, created.body.task.id);
  assert.equal(done.status, 'succeeded');
  const failure = records.find(entry => entry.status === 'failed' && entry.metadata.tool === 'office_command');
  assert.ok(failure); assert.equal(failure.metadata.controlId, 'health.security');
  assert.match(failure.referenceId, /^[a-f0-9-]{36}:failed$/); assert.match(failure.content, /Temporary check failure/);
  assert.equal(failure.metadata.target, 'office');
  assert.ok(records.some(entry => entry.referenceId === done.id && entry.status === 'succeeded'));
});

test('creation is idempotent, rejects changed request IDs and never returns internal model state', async t => {
  const { service } = await fixture(t);
  const input = body();
  const first = await invoke(service.create, input), duplicate = await invoke(service.create, input);
  assert.equal(first.status, 202); assert.equal(duplicate.body.task.id, first.body.task.id);
  assert.equal('internal' in first.body.task, false);
  assert.equal((await invoke(service.create, { ...input, message: 'Different task' })).status, 409);
  assert.equal((await invoke(service.create, body({ permissions: { editCode: true, publish: true, deploy: false } }))).status, 400);
  assert.equal((await invoke(service.create, body({ message: 'Use private-token-value' }))).status, 400);
  const list = await invoke(service.list);
  assert.equal(list.body.tasks.length, 1);
  assert.equal(list.body.capabilities.publicationDeploys, true);
});

test('code tasks persist staged work, require actual candidate checks and publish only after success', async t => {
  const { service, state } = await fixture(t);
  const created = await invoke(service.create, body());
  const task = await finish(service, created.body.task.id);
  assert.equal(task.status, 'succeeded');
  assert.equal(state.edits, 1); assert.equal(state.candidates, 1); assert.equal(state.checks, 2); assert.equal(state.published, 1);
  assert.equal(task.commit.published, true);
  assert.equal(task.checks[0].conclusion, 'success');
  assert.equal(task.deployments[0].status, 'queued');
  assert.equal(task.changedFiles[0].status, 'published');
  assert.match(task.summary, /deployment was queued/);
});

test('failed verification prevents publication and an edit-only task retains its verified candidate', async t => {
  const { service, state } = await fixture(t); state.conclusion = 'failure';
  const created = await invoke(service.create, body());
  const failed = await finish(service, created.body.task.id);
  assert.equal(failed.status, 'failed'); assert.equal(state.published, 0);
  assert.match(failed.error, /Nothing was published/);
  const other = await fixture(t);
  const editOnly = await invoke(other.service.create, body({ permissions: { editCode: true, publish: false, deploy: false } }));
  const result = await finish(other.service, editOnly.body.task.id);
  assert.equal(result.status, 'succeeded'); assert.equal(other.state.published, 0); assert.equal(result.commit.published, false);
});

test('model calls cannot grant permissions or override exact destructive-command confirmation', async t => {
  let executions = 0;
  const responses = [call('repo_edit', { path: 'backend/office-ai-example.js', expectedSha: BASE, edits: [{ find: '1', replace: '2' }] }),
    call('office_command', { id: 'database.restore', inputs: { confirmed: true } }), { content: 'Done.' }];
  const { service, state } = await fixture(t, { model: async () => responses.shift(),
    getControls: () => [{ id: 'database.restore', label: 'Restore database', requiresConfirmation: true }],
    executeControl: async (_id, input) => { executions++; assert.equal(input.confirmed, true); return { runId: 'confirmed-run' }; } });
  const created = await invoke(service.create, body({ permissions: { editCode: false, publish: false, deploy: false, operate: true } }));
  const pending = await finish(service, created.body.task.id);
  assert.equal(pending.status, 'needs_confirmation'); assert.equal(state.edits, 0); assert.equal(executions, 0);
  assert.equal((await invoke(service.confirm, { confirmationId: randomUUID(), confirmed: true }, pending.id)).status, 409);
  const confirmed = await invoke(service.confirm, { confirmationId: pending.confirmation.id, confirmed: true }, pending.id);
  assert.equal(confirmed.status, 200);
  const done = await finish(service, pending.id);
  assert.equal(done.status, 'succeeded'); assert.equal(executions, 1);
  assert.equal((await invoke(service.confirm, { confirmationId: pending.confirmation.id, confirmed: true }, pending.id)).status, 200);
});

test('database leases prevent concurrent workers and cancellation aborts inference without executing tools', async t => {
  let entered, abortObserved = false;
  const started = new Promise(resolve => { entered = resolve; });
  const { service } = await fixture(t, { model: async ({ signal }) => new Promise((_resolve, reject) => {
    entered(); signal.addEventListener('abort', () => { abortObserved = true; reject(signal.reason); }, { once: true });
  }) });
  const created = await invoke(service.create, body()); const id = created.body.task.id;
  const running = service.runOne(id); await started;
  assert.equal(await service.runOne(id), false);
  assert.equal((await invoke(service.cancel, {}, id)).body.task.status, 'cancel_requested');
  await running;
  assert.equal(abortObserved, true);
  assert.equal((await invoke(service.detail, {}, id)).body.task.status, 'cancelled');
});

test('interrupted external writes are not replayed and ambiguous outcomes stay explicit', async t => {
  let writes = 0;
  const adapter = { description: 'Deploy a resource', permission: 'deploy', parameters: { type: 'object', properties: {}, additionalProperties: false }, execute: async () => { writes++; return { status: 'done' }; } };
  const { service, db, repo } = await fixture(t, { model: async () => call('external_change', {}), adapters: { external_change: adapter } });
  const created = await invoke(service.create, body()); const id = created.body.task.id;
  await service.runOne(id);
  await db.query(`UPDATE office_ai_tasks SET data=jsonb_set(data,'{internal,pendingCalls,0,started}','true'::jsonb) WHERE id=$1`, [id]);
  const resumed = createOfficeAITasks({ db, repository: repo, adapters: { external_change: adapter }, model: async () => ({ content: 'Done.' }) });
  await resumed.runOne(id);
  const task = (await invoke(resumed.detail, {}, id)).body.task;
  assert.equal(task.status, 'needs_confirmation'); assert.equal(task.confirmation.uncertain, true); assert.equal(writes, 0);
  assert.equal((await invoke(resumed.confirm, { confirmationId: task.confirmation.id, confirmed: true }, id)).status, 409);
});

test('interrupted idempotent hosted-file and knowledge writes recover without an external-action pause', async t => {
  for (const name of ['workspace_write', 'memory_remember']) {
    let writes = 0;
    const adapter = { permission: 'editCode', parameters: { type: 'object', properties: {}, additionalProperties: false }, execute: async () => {
      writes++; return name === 'workspace_write' ? { path: 'index.html', revision: 'b'.repeat(64), memoryId: '11111111-1111-4111-8111-111111111111', version: 1, bytes: 42 }
        : { id: '22222222-2222-4222-8222-222222222222' };
    } };
    const { service, db, repo } = await fixture(t, { model: async () => call(name, {}), adapters: { [name]: adapter } });
    const created = await invoke(service.create, body({ target: name === 'workspace_write' ? 'hosted-web' : 'general', message: 'Create the requested private result.' }));
    const id = created.body.task.id; await service.runOne(id);
    await db.query(`UPDATE office_ai_tasks SET data=jsonb_set(data,'{internal,pendingCalls,0,started}','true'::jsonb) WHERE id=$1`, [id]);
    const resumed = createOfficeAITasks({ db, repository: repo, adapters: { [name]: adapter }, model: async () => ({ content: 'The result has a memory receipt.' }) });
    await resumed.runOne(id);
    const task = (await invoke(resumed.detail, {}, id)).body.task;
    assert.equal(task.status, 'working'); assert.equal(writes, 1); assert.equal(task.confirmation, null);
    if (name === 'workspace_write') assert.equal(task.artifacts.length, 1);
    else assert.equal(task.memoryState.recordedIds.length, 1);
  }
});

test('terminal calls receive server-owned idempotency and revision values and await actual completion', async t => {
  let modelCalls = 0, received, statuses = 0;
  const sessionId = randomUUID();
  const run = { description: 'Run command', permission: 'editCode', parameters: { type: 'object', properties: { command: { type: 'string' }, clientRequestId: { type: 'string' }, ref: { type: 'string' } }, required: ['command', 'clientRequestId'], additionalProperties: false },
    execute: async args => { received = args; return { id: sessionId, status: 'queued' }; } };
  const status = { description: 'Read command', permission: 'read', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    execute: async () => ({ session: { id: sessionId, status: ++statuses < 2 ? 'running' : 'completed', exitCode: statuses < 2 ? null : 0 }, output: 'Actual test output.' }) };
  const { service } = await fixture(t, { adapters: { terminal_run: run, terminal_status: status }, model: async ({ tools }) => {
    const schema = tools.find(tool => tool.function.name === 'terminal_run').function.parameters;
    assert.equal('clientRequestId' in schema.properties, false);
    modelCalls++; return modelCalls === 1 ? call('terminal_run', { command: 'node --test example.test.js' }) : { content: 'Terminal finished.' };
  } });
  const created = await invoke(service.create, body()); const task = await finish(service, created.body.task.id);
  assert.match(received.clientRequestId, /^[a-f0-9-]{36}$/);
  assert.equal(received.ref, BASE); assert.equal(statuses, 2); assert.equal(modelCalls, 2);
  assert.equal(task.events.find(item => item.kind === 'terminal').status, 'succeeded');
});

test('task model uses only Cloudflare relay and hides credentials in responses and failures', async () => {
  const secret = 'r'.repeat(48), calls = [];
  const model = createOfficeAIModel({ env: { OFFICE_AI_RELAY_URL: 'https://office.owner.workers.dev', OFFICE_AI_RELAY_SECRET: secret }, fetcher: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ choices: [{ message: { content: secret } }] }));
  } });
  assert.equal((await model({ messages: [{ role: 'user', content: 'Hello' }] })).content, '[credential redacted]');
  assert.equal(calls[0].url, 'https://office.owner.workers.dev/chat');
  assert.equal(calls[0].options.headers['cf-aig-collect-log'], 'false');
  assert.equal(JSON.parse(calls[0].options.body).max_tokens, 8192);
});

test('read-only scope cannot execute Office commands and deployment destinations remain enforced', async t => {
  let executions = 0;
  const responses = [call('office_command', { id: 'feed.clear', inputs: { confirmed: true } }), { content: 'No action executed.' }];
  const readOnly = await fixture(t, { model: async () => responses.shift(),
    getControls: () => [{ id: 'feed.clear', label: 'Clear feed', requiresConfirmation: true }],
    executeControl: async () => { executions++; } });
  const created = await invoke(readOnly.service.create, body({ permissions: { editCode: false, publish: false, deploy: false, operate: false } }));
  const task = await finish(readOnly.service, created.body.task.id);
  assert.equal(task.status, 'succeeded'); assert.equal(task.confirmation, null); assert.equal(executions, 0);
  const deploymentResponses = [call('office_command', { id: 'deploy.api' }), call('cloudflare_deploy', { worker: 'uficonnect-office-ai' }), { content: 'Destinations were not selected.' }];
  const deployment = await fixture(t, { model: async () => deploymentResponses.shift(),
    getControls: () => [{ id: 'deploy.api', label: 'Deploy API', requiresConfirmation: false }], executeControl: async () => { executions++; },
    adapters: { cloudflare_deploy: { description: 'Deploy Worker', permission: 'deploy', parameters: { type: 'object', properties: { worker: { type: 'string' }, sha: { type: 'string' } }, required: ['worker', 'sha'], additionalProperties: false }, execute: async () => { executions++; } } } });
  const scoped = await invoke(deployment.service.create, body({ permissions: { editCode: false, publish: false, deploy: true, operate: true }, deployTargets: ['web'] }));
  const result = await finish(deployment.service, scoped.body.task.id);
  assert.equal(executions, 0);
  assert.equal(result.events.filter(item => item.status === 'failed').length, 2);
});

test('worker shutdown retains resumable state and finished tasks discard private execution context', async t => {
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const first = await fixture(t, { model: async ({ signal }) => new Promise((_resolve, reject) => {
    entered(); signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const created = await invoke(first.service.create, body()); const id = created.body.task.id;
  const pending = first.service.runOne(id); await started; first.service.stop(); await pending;
  assert.equal((await invoke(first.service.detail, {}, id)).body.task.status, 'planning');
  const resumed = createOfficeAITasks({ db: first.db, repository: first.repo, model: async () => ({ content: 'Resumed successfully.' }) });
  await resumed.runOne(id);
  const saved = (await first.db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [id])).rows[0].data;
  assert.equal(saved.status, 'succeeded');
  assert.deepEqual(saved.internal.messages, []); assert.deepEqual(saved.internal.files, []);
});

test('a persisted task cap rejects excess work and cancellation frees capacity', async t => {
  const { service } = await fixture(t);
  const tasks = [];
  for (let i = 0; i < 5; i++) tasks.push((await invoke(service.create, body())).body.task);
  assert.equal((await invoke(service.create, body())).status, 429);
  await invoke(service.cancel, {}, tasks[0].id); await service.runOne(tasks[0].id);
  assert.equal((await invoke(service.create, body())).status, 202);
});

test('partial command receipts survive an uncertain second-service outcome without replay', async t => {
  let executions = 0;
  const { service } = await fixture(t, { model: async () => call('office_command', { id: 'feed.refresh-both' }),
    getControls: () => [{ id: 'feed.refresh-both', label: 'Refresh both services', requiresConfirmation: false }],
    executeControl: async () => { executions++; throw Object.assign(new Error('Second service failed'), {
      publicMessage: 'The pipeline did not confirm its operation.', outcomeUnknown: true,
      receipts: [{ service: 'api', runId: 'control-confirmed-api', ok: true }],
    }); } });
  const created = await invoke(service.create, body({ permissions: { editCode: false, publish: false, deploy: false, operate: true } }));
  const task = await finish(service, created.body.task.id);
  assert.equal(task.status, 'needs_confirmation'); assert.equal(task.confirmation.uncertain, true);
  assert.equal(task.commands[0].results[0].runId, 'control-confirmed-api');
  assert.match(task.confirmation.detail, /control-confirmed-api/);
  assert.equal(await service.runOne(task.id), false); assert.equal(executions, 1);
});
