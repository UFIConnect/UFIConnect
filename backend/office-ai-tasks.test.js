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
  const query = (sql, values) => /pg_advisory_xact_lock/.test(sql) ? Promise.resolve({ rows: [] }) : pg.query(sql, values);
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
  const revisions = options.checkpoints ? require('./office-ai-revisions').createOfficeAIRevisions({db,env:{OAUTH_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')}}) : undefined;
  const service = createOfficeAITasks({ db, repository: repo, revisions, model: async () => responses.shift() || { content: 'Finished.' }, ...options });
  t.after(() => service.stop());
  return { pg, db, repo, state, service, responses };
}
async function finish(service, id, limit = 25) {
  let task;
  for (let i = 0; i < limit; i++) {
    await service.runOne(id);
    task = (await invoke(service.detail, {}, id)).body.task;
    if (['succeeded', 'failed', 'needs_confirmation', 'needs_continuation', 'cancelled'].includes(task.status)) return task;
  }
  throw new Error(`Task did not finish: ${task.status}`);
}

test('one malformed tool response is regenerated within the model budget without replaying earlier work', async t => {
  const malformed = call('repo_edit', {}); malformed.tool_calls[0].function.arguments = '{invalid-provider-arguments';
  const responses = [call('repo_read', { path: 'backend/office-ai-example.js' }), malformed,
    call('repo_edit', { path: 'backend/office-ai-example.js', edits: [{ find: '=1', replace: '=2' }] }),
    call('repo_commit', { message: 'Improve example value' }), { content: 'The requested update is ready.' }];
  let turns = 0, reads = 0;
  const f = await fixture(t, { model: async ({ messages }) => {
    turns++;
    if (turns === 3) {
      assert.match(messages[0].content, /SERVER VALIDATION:.*No tool from that response was executed/);
      assert.ok(messages.some(message => message.role === 'tool'), 'Earlier completed tool receipts survive');
      assert.doesNotMatch(JSON.stringify(messages), /invalid-provider-arguments/, 'Malformed provider output is not reflected into the prompt');
    }
    return responses.shift() || { content: 'Done.' };
  } });
  const readFile = f.repo.readFile; f.repo.readFile = async (...args) => { reads++; return readFile(...args); };
  const created = await invoke(f.service.create, body()); const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(done.progress.modelTurns, 5); assert.equal(turns, 5);
  assert.equal(reads, 1); assert.equal(f.state.edits, 1); assert.equal(f.state.published, 1);
  assert.equal(done.events.filter(event => event.kind === 'model-response').length, 1);
});

test('a second malformed model response pauses the existing checkpoint without an unbounded retry', async t => {
  const malformed = call('repo_edit', {}); malformed.tool_calls[0].function.arguments = '{';
  const nonObject = call('repo_edit', {}); nonObject.tool_calls[0].function.arguments = '[]';
  const responses = [call('repo_read', { path: 'backend/office-ai-example.js' }), malformed, nonObject];
  let turns = 0;
  const f = await fixture(t, { model: async () => { turns++; return responses.shift() || { content: 'Should not be called again.' }; } });
  const created = await invoke(f.service.create, body()); const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'needs_continuation'); assert.equal(done.continuation.reason, 'model-response');
  assert.equal(done.progress.modelTurns, 3); assert.equal(done.progress.toolCalls, 1);
  assert.equal(f.state.edits, 0); assert.equal(f.state.candidates, 0); assert.equal(f.state.published, 0);
  const stored = (await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [done.id])).rows[0].data;
  assert.equal(stored.internal.baseSha, BASE); assert.equal(stored.internal.pendingCalls.length, 0);
  assert.ok(stored.internal.messages.some(message => message.role === 'tool'));
  assert.equal(await f.service.runOne(done.id), false); assert.equal(turns, 3);
});

test('a malformed sibling rejects the whole response before an otherwise valid edit can execute', async t => {
  const valid = call('repo_edit', { path: 'backend/office-ai-example.js', edits: [{ find: '=1', replace: '=2' }] });
  const malformed = call('repo_read', {}); malformed.tool_calls[0].function.arguments = '{';
  const responses = [call('repo_read', { path: 'backend/office-ai-example.js' }),
    { content: 'A valid edit followed by a malformed call', tool_calls: [...valid.tool_calls, ...malformed.tool_calls] },
    { content: 'The rejected response did not execute an edit.' }];
  const f = await fixture(t, { model: async () => responses.shift() || { content: 'Done.' } });
  const created = await invoke(f.service.create, body()); const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(done.progress.modelTurns, 3); assert.equal(done.progress.toolCalls, 1);
  assert.equal(f.state.edits, 0); assert.equal(f.state.candidates, 0); assert.equal(f.state.published, 0);
  assert.equal(done.changedFiles.length, 0);
  const stored = (await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [done.id])).rows[0].data;
  assert.equal(stored.internal.pendingCalls.length, 0);
  assert.equal(stored.internal.messages.some(message => message.tool_calls?.some(call => call.function.name === 'repo_edit')), false);
});

test('malformed-response repair cannot exceed the existing model-turn budget', async t => {
  const malformed = call('repo_read', {}); malformed.tool_calls[0].function.arguments = '{';
  let turns = 0;
  const f = await fixture(t, { env: { OFFICE_AI_MAX_MODEL_TURNS: '1' }, model: async () => { turns++; return malformed; } });
  const created = await invoke(f.service.create, body()); const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'needs_continuation'); assert.equal(done.continuation.reason, 'model-turns');
  assert.equal(done.progress.modelTurns, 1); assert.equal(turns, 1); assert.equal(done.progress.toolCalls, 0);
});

test('task list projects private context in the database before transfer while preserving public progress and continuation', async t => {
  const f = await fixture(t);
  const created = await invoke(f.service.create, body());
  const task = (await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [created.body.task.id])).rows[0].data;
  const marker = 'PRIVATE-CONTEXT-SHOULD-NOT-TRANSFER';
  task.status = 'needs_continuation'; task.continuation = { id: randomUUID(), reason: 'model-response', message: 'Resume the saved checkpoint.' };
  task.internal = { ...task.internal, turns: 22, calls: 31, budgetStartTurns: 10, budgetStartCalls: 20, resumes: 2, contextCompactions: 3,
    files: [{ path: 'backend/office-ai-example.js', content: marker + 'x'.repeat(1024 * 1024), sha: BASE }],
    messages: [{ role: 'user', content: marker }], contextSummary: marker };
  task.history = [{ role: 'user', content: marker }];
  task.changedFiles = [{ path: 'backend/office-ai-example.js', status: 'staged' }];
  task.plan = { steps: [{ id: 'inspect', title: 'Inspect the draft', status: 'completed' }] };
  task.recovery = { maxAttempts: 2, currentAttempt: 1, totalAttempts: 2 };
  task.backups = [{ id: randomUUID(), label: 'Draft checkpoint' }];
  task.review = { checks: [{ label: 'No unresolved file edit errors', passed: true }] };
  assert.ok(Buffer.byteLength(JSON.stringify(task)) > 1024 * 1024);
  await f.db.query('UPDATE office_ai_tasks SET status=$2,data=$3::jsonb WHERE id=$1', [task.id, task.status, JSON.stringify(task)]);
  const detail = (await invoke(f.service.detail, {}, task.id)).body.task;
  const query = f.db.query; let transferred;
  f.db.query = async (sql, values) => {
    const result = await query(sql, values);
    if (sql.includes('FROM office_ai_tasks ORDER BY created_at DESC LIMIT 30')) transferred = result.rows;
    return result;
  };
  const listed = await invoke(f.service.list);
  assert.equal(listed.status, 200); assert.ok(transferred, 'Capture actual database result before application view filtering');
  assert.ok(Buffer.byteLength(JSON.stringify(transferred)) < 12000, 'Database transport excludes megabytes of executable context');
  assert.equal(JSON.stringify(transferred).includes(marker), false);
  assert.equal(transferred[0].data.history, undefined);
  assert.equal(transferred[0].data.internal.files, undefined); assert.equal(transferred[0].data.internal.messages, undefined);
  assert.deepEqual(listed.body.tasks[0], detail, 'Public fields, counters and continuation match the full detail response');
  assert.deepEqual(listed.body.tasks[0].progress, { modelTurns: 12, toolCalls: 11, totalModelTurns: 22, totalToolCalls: 31, resumes: 2, contextCompactions: 3 });
  assert.equal(listed.body.tasks[0].resumable, true); assert.equal(listed.body.tasks[0].continuation.id, task.continuation.id);
  assert.deepEqual(listed.body.tasks[0].plan, task.plan); assert.deepEqual(listed.body.tasks[0].recovery, task.recovery);
  assert.deepEqual(listed.body.tasks[0].backups, task.backups); assert.deepEqual(listed.body.tasks[0].review, task.review);
});

test('published tasks wait for the exact deployment before reporting completion', async t => {
  const f = await fixture(t); let observed = 0;
  f.repo.deployments = async commit => ({ ready: ++observed > 2, deployments: [{ service: 'office', sha: commit.sha, status: observed > 2 ? 'live' : 'build_in_progress' }] });
  const created = await invoke(f.service.create, body());
  let waiting;
  for (let i = 0; i < 12 && !observed; i++) { await f.service.runOne(created.body.task.id); waiting = (await invoke(f.service.detail, {}, created.body.task.id)).body.task; }
  assert.equal(waiting.status, 'working'); assert.match(waiting.summary, /Waiting for the hosting/);
  assert.equal(f.state.published, 1); assert.equal(waiting.deployments[0].status, 'build_in_progress');
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(done.deployments[0].status, 'live'); assert.match(done.summary, /confirmed live/); assert.equal(f.state.published, 1);
});

test('deployment failure preserves the published commit and reports failure', async t => {
  const f = await fixture(t);
  f.repo.deployments = async commit => ({ failed: true, ready: false, deployments: [{ service: 'office', sha: commit.sha, status: 'build_failed' }] });
  const created = await invoke(f.service.create, body()); const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'failed'); assert.equal(done.commit.published, true); assert.match(done.error, /deployment failed/); assert.equal(f.state.published, 1);
});

test('edits use the server-recorded read revision without asking the model to copy a SHA', async t => {
  const { applyRepositoryEdit, blobSha } = require('./office-ai-repository');
  const original = { path: 'backend/office-ai-example.js', content: 'const value=1;' };
  original.sha = blobSha(original.content);
  let turn = 0;
  const f = await fixture(t, { model: async ({ tools }) => {
    const edit = tools.find(tool => tool.function.name === 'repo_edit');
    assert.equal(edit.function.parameters.properties.expectedSha, undefined);
    return [call('repo_read', { path: original.path }),
      call('repo_edit', { path: original.path, edits: [{ find: '=1', replace: '=2' }] }),
      { content: 'The edit is prepared.' }, { content: 'The change was verified.' }][turn++] || { content: 'Done.' };
  } });
  f.repo.readFile = async () => original;
  f.repo.edit = async ({ ref, ...input }, staged) => { assert.equal(input.expectedSha, original.sha); return applyRepositoryEdit(staged || original, input); };
  const created = await invoke(f.service.create, body());
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(done.changedFiles.length, 1); assert.equal(f.state.published, 1);
});

test('an unresolved rejected edit keeps a checkpoint instead of claiming success', async t => {
  let turn = 0;
  const f = await fixture(t, { model: async () => ++turn === 1
    ? call('repo_edit', { path: 'backend/office-ai-example.js', expectedSha: 'b'.repeat(40), edits: [{ find: '=1', replace: '=2' }] })
    : { content: 'Everything is fixed.' } });
  f.repo.edit = async () => { throw Object.assign(Error('Read the current file before editing.'), { publicMessage: 'Read the current file before editing.', status: 409 }); };
  const created = await invoke(f.service.create, body());
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'needs_continuation'); assert.equal(done.continuation.reason, 'edit-recovery');
  assert.match(done.summary, /not been saved/); assert.equal(f.state.published, 0);
});

test('a recorded read revision cannot create an edit without reading an existing file', async t => {
  const { applyRepositoryEdit, blobSha } = require('./office-ai-repository');
  const original = { path: 'backend/office-ai-example.js', content: 'const value=1;' };
  original.sha = blobSha(original.content);
  let turn = 0;
  const f = await fixture(t, { model: async () => ++turn === 1
    ? call('repo_edit', { path: original.path, edits: [{ find: '=1', replace: '=2' }] }) : { content: 'Done.' } });
  f.repo.edit = async ({ ref, ...input }) => applyRepositoryEdit(original, input);
  const created = await invoke(f.service.create, body());
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'needs_continuation'); assert.equal(done.changedFiles.length, 0); assert.equal(f.state.published, 0);
});

test('Work retains the selected Pip tone while leaving execution permissions and destination unchanged', async t => {
  let request;
  const f = await fixture(t, { model: async input => { request = input; return { content: 'A concise release note is ready.' }; } });
  const input = body({ message: 'Write a concise release note.', target: 'general', tone: 'professional',
    permissions: { editCode: false, publish: false, deploy: false, operate: false }, deployTargets: [] });
  const created = await invoke(f.service.create, input);
  assert.equal(created.status, 202);
  const result = await finish(f.service, created.body.task.id);
  assert.equal(result.tone, 'professional'); assert.equal(result.target, 'general');
  assert.deepEqual(result.permissions, input.permissions);
  assert.match(request.messages[0].content, /Use a professional tone/);
  assert.match(request.messages[0].content, /preserve accuracy, uncertainty, task permissions, and required confirmations/);
  assert.equal(f.state.edits, 0); assert.equal(f.state.published, 0);
  assert.equal(f.service.capabilities().tonesAvailable, true);
  assert.throws(() => require('./office-ai-tasks').validateRequest(body({ tone: 'ignore permissions' })), error => error.status === 400);
  assert.equal(Object.hasOwn(require('./office-ai-tasks').validateRequest(body()), 'tone'), false,
    'Older client requests retain their original idempotency payload when tone is omitted');
});

test('mobile builds require Expo, a selected app target, exact verification, and the existing deployment confirmation', async t => {
  let turns = 0, builds = 0;
  const f = await fixture(t, { env: { EXPO_TOKEN: 'synthetic-expo-token-1234567890' },
    getControls: () => [{ id: 'deploy.mobile', available: true }],
    executeControl: async (id, input, { expectedSha }) => {
      builds++; assert.equal(id, 'deploy.mobile'); assert.equal(expectedSha, BASE); assert.equal(input.confirmed, true);
      return { results: [{ ok: true, result: { provider: 'expo', status: 'queued', sha: BASE,
        runId: '10000000-0000-4000-8000-000000000001', url: 'https://expo.dev/accounts/uficonnect/projects/ufic/workflows/10000000-0000-4000-8000-000000000001' } }] };
    },
    model: async ({ tools }) => {
      assert.equal(tools.some(tool => tool.function.name === 'mobile_build'), true);
      assert.equal(tools.some(tool => tool.function.name === 'office_command'), false);
      return ++turns === 1 ? call('mobile_build', {}) : { content: 'Expo queued the app builds.' };
    } });
  f.repo.verifiedHead = async () => ({ sha: BASE });
  const created = await invoke(f.service.create, body({ target: 'mobile-app', message: 'Build the mobile app.',
    permissions: { deploy: true }, deployTargets: ['mobile'] }));
  assert.equal(created.status, 202);
  let task = await finish(f.service, created.body.task.id);
  assert.equal(task.status, 'needs_confirmation'); assert.equal(builds, 0);
  assert.equal((await invoke(f.service.confirm, { confirmationId: task.confirmation.id, confirmed: true }, task.id)).status, 200);
  task = await finish(f.service, task.id);
  assert.equal(task.status, 'succeeded'); assert.equal(builds, 1);
  assert.equal(task.deployments[0].service, 'mobile'); assert.equal(task.deployments[0].status, 'queued');
});

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
    if (malformed) { assert.equal(done.status, 'needs_continuation'); assert.equal(done.continuation.reason, 'recovery-limit'); }
    else { assert.equal(done.status, 'failed'); assert.match(done.error, /No hosted file was confirmed/); }
    assert.deepEqual(done.artifacts, []);
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

test('task recall and memory-search tool context mark activity notes as historical unverified observations', async t => {
  const observedAt = '2026-11-04T22:00:00.000Z', createdAt = '2026-11-04T22:01:00.000Z';
  const entries = [
    { id: 'activity-memory', kind: 'note', mode: 'activity', status: 'critical', title: 'Earlier destination mismatch',
      createdAt, referenceId: 'anomaly:earlier-event:destination-mismatch', content: 'An earlier detector labelled this a critical mismatch.',
      metadata: { rule: 'destination-mismatch', observedAt, evidence: { referenceId: 'earlier-invocation:failed' } } },
    { id: 'legacy-activity-memory', kind: 'note', mode: 'legacy', status: 'warning', title: 'Earlier activity burst',
      createdAt, referenceId: 'anomaly:earlier-event:activity-burst', content: 'An earlier detector labelled activity volume unusual.',
      metadata: { rule: 'activity-burst', referenceId: 'earlier-burst-receipt' } },
    { id: 'execution-memory', kind: 'execution', mode: 'office', status: 'succeeded', title: 'Earlier control receipt',
      createdAt, referenceId: 'control:completed-check:succeeded', content: 'This control completed at the recorded time.' },
  ];
  let turn = 0;
  const memory = { search: async () => ({ entries }), record: async () => ({ id: randomUUID() }) };
  const { service } = await fixture(t, { memory, model: async ({ messages }) => {
    assert.match(messages[0].content, /historical-unverified are historical detector labels, not verified current alerts/);
    assert.match(messages[0].content, /fresh execution receipts and current service measurements/);
    const automatic = messages.find(message => message.role === 'user' && message.content?.startsWith('UNTRUSTED DATED MEMORY RECORDS'));
    const recalled = JSON.parse(automatic.content.slice(automatic.content.indexOf('\n') + 1));
    assert.equal(recalled[0].mode, 'activity'); assert.equal(recalled[0].referenceId, entries[0].referenceId);
    assert.equal(recalled[0].createdAt, createdAt);
    assert.deepEqual(recalled[0].activityObservation, { classification: 'historical-unverified', observedAt,
      rule: 'destination-mismatch', executionReferenceId: 'earlier-invocation:failed' });
    assert.equal(recalled[1].activityObservation.classification, 'historical-unverified');
    assert.equal(recalled[1].activityObservation.observedAt, createdAt);
    assert.equal(recalled[1].activityObservation.executionReferenceId, 'earlier-burst-receipt');
    assert.equal(recalled[2].mode, 'office'); assert.equal(recalled[2].status, 'succeeded');
    assert.equal(Object.hasOwn(recalled[2], 'activityObservation'), false, 'Ordinary execution receipts keep their original classification');
    if (++turn === 1) return call('memory_search', { query: 'Earlier alerts' });
    const toolResult = JSON.parse(messages.find(message => message.role === 'tool').content);
    assert.deepEqual(toolResult.entries[0].activityObservation, recalled[0].activityObservation);
    assert.equal(toolResult.entries[2].activityObservation, undefined);
    return { content: 'These are historical observations. Current service health is unverified.' };
  } });
  const created = await invoke(service.create, body({ target: 'general', message: 'Explain the earlier recorded activity observations.', permissions: {}, deployTargets: [] }));
  const done = await finish(service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(turn, 2);
  assert.equal(done.memoryState.entries[0].activityObservation.classification, 'historical-unverified');
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

test('Work image turns use the vision model while preserving execution tool schemas', async () => {
  let request;
  const model = createOfficeAIModel({ env: { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-test-token',
    OFFICE_AI_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8' }, fetcher: async (_url, options) => {
    request = JSON.parse(options.body); return Response.json({ choices: [{ message: { content: 'The frame is visible.' } }] });
  } });
  const tools = [{ type: 'function', function: { name: 'office_command', parameters: { type: 'object' } } }];
  await model({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/' } }] }], tools });
  assert.equal(request.model, '@cf/google/gemma-4-26b-a4b-it');
  assert.deepEqual(request.tools, tools);
  assert.equal(request.chat_template_kwargs.enable_thinking, true);
});

test('Work receives real uploaded content, exposes metadata only, and clears uploads after completion', async t => {
  let messages;
  const { service, db } = await fixture(t, { model: async input => { messages = input.messages; return { content: 'The image is ready to discuss.' }; } });
  const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFioAAAAASUVORK5CYII=';
  const request = body({ message: 'Describe this photo', target: 'general', permissions: {}, deployTargets: [], attachments: [{ name: 'photo.png', type: 'image/png', data }] });
  const created = await invoke(service.create, request);
  assert.equal(created.status, 202);
  assert.deepEqual(created.body.task.attachments, [{ name: 'photo.png', type: 'image/png' }]);
  assert.equal(JSON.stringify(created.body).includes(data), false);
  assert.equal((await invoke(service.create, request)).body.task.id, created.body.task.id);
  const task = await finish(service, created.body.task.id);
  assert.equal(task.status, 'succeeded');
  assert.equal(messages.find(message => Array.isArray(message.content)).content.find(part => part.type === 'image_url').image_url.url, data);
  assert.equal(JSON.stringify((await db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [task.id])).rows[0]).includes(data), false);
  assert.equal((await invoke(service.create, body({ attachments: [{ name: 'note.txt', type: 'text/plain', data: 'Use private-token-value' }] }))).status, 400);
});


test('model failures recover twice and persistent failures pause without losing the task',async t=>{
 let attempts=0;const f=await fixture(t,{model:async()=>{if(++attempts<=2)throw Object.assign(Error('temporarily unavailable'),{status:502});return{content:'Verified answer.'};}});const created=await invoke(f.service.create,body({target:'general',permissions:{editCode:false,publish:false,deploy:false,operate:false},deployTargets:[]}));const done=await finish(f.service,created.body.task.id);assert.equal(attempts,3);assert.equal(done.status,'succeeded');assert.equal(done.recovery.totalAttempts,2);
 let failures=0;const g=await fixture(t,{model:async()=>{failures++;throw Object.assign(Error('still unavailable'),{status:502});}});const pending=await invoke(g.service.create,body());const paused=await finish(g.service,pending.body.task.id);assert.equal(failures,3);assert.equal(paused.status,'needs_continuation');assert.equal(paused.continuation.reason,'recovery-limit');
});
test('safe tools retry exactly twice with the same invocation; exhaustion pauses before redispatch',async t=>{
 let attempts=0,turn=0;const ids=[];const f=await fixture(t,{model:async()=>++turn===1?call('code_execute',{code:'return 323;'}):{content:'323'},adapters:{code_execute:{permission:'read',retrySafe:true,parameters:{type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:false},execute:async(_args,context)=>{attempts++;ids.push(context.invocationId);if(attempts<3)throw Object.assign(Error('busy'),{status:429});return{result:323};}}}});const created=await invoke(f.service.create,body({target:'general',permissions:{editCode:false,publish:false,deploy:false,operate:false},deployTargets:[]}));const done=await finish(f.service,created.body.task.id);assert.equal(done.status,'succeeded');assert.equal(attempts,3);assert.equal(new Set(ids).size,1);assert.equal(done.recovery.totalAttempts,2);assert.equal(done.review.checks.every(check=>check.passed),true);
 let rejected=0;const g=await fixture(t,{model:async()=>call('web_read',{url:'https://example.test'}),adapters:{web_read:{permission:'read',retrySafe:true,parameters:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false},execute:async()=>{rejected++;throw Object.assign(Error('unavailable'),{status:502});}}}});const second=await invoke(g.service.create,body());const paused=await finish(g.service,second.body.task.id);assert.equal(rejected,3);assert.equal(paused.continuation.reason,'recovery-limit');
});
test('plans remain progress metadata and paused encrypted drafts restore with a current continuation lease',async t=>{
 let turn=0;const f=await fixture(t,{checkpoints:true,model:async()=>[call('plan_update',{steps:[{id:'inspect',title:'Inspect the current file',status:'in_progress'},{id:'change',title:'Change and verify',status:'pending'}]}),call('repo_read',{path:'backend/office-ai-example.js'}),call('repo_edit',{path:'backend/office-ai-example.js',edits:[{find:'=1',replace:'=2'}]})][turn++]||{content:'Review the prepared draft.'}});
 const created=await invoke(f.service.create,body({permissions:{editCode:true,publish:false,deploy:false,operate:false},deployTargets:[]}));let task;for(let n=0;n<6;n++){await f.service.runOne(created.body.task.id);task=(await invoke(f.service.detail,{},created.body.task.id)).body.task;}assert.equal(task.plan.steps.length,2);assert.equal(task.backups.length,3);
 const stored=(await f.pg.query('SELECT data FROM office_ai_tasks WHERE id=$1',[task.id])).rows[0].data;stored.status='needs_continuation';stored.continuation={id:randomUUID(),reason:'review'};await f.pg.query('UPDATE office_ai_tasks SET status=$2,data=$3::jsonb WHERE id=$1',[task.id,stored.status,JSON.stringify(stored)]);
 const checkpointId=task.backups.at(-1).id;const res={statusCode:200,status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};await f.service.restoreCheckpoint({params:{id:task.id,checkpointId},body:{confirmed:true,continuationId:stored.continuation.id}},res);assert.equal(res.statusCode,200);assert.equal(res.body.task.changedFiles.length,0);assert.equal(res.body.task.status,'needs_continuation');assert.equal(res.body.task.permissions.publish,false);assert.notEqual(res.body.task.continuation.id,stored.continuation.id);
 const stale={...res,statusCode:200};await f.service.restoreCheckpoint({params:{id:task.id,checkpointId},body:{confirmed:true,continuationId:stored.continuation.id}},stale);assert.equal(stale.statusCode,409);
});

test('three unchanged logical failures or invalid tool requests pause instead of looping',async t=>{
 for(const invalid of [false,true]){let attempts=0;const f=await fixture(t,{model:async()=>call('code_execute',invalid?{wrong:true}:{code:'bad code'}),adapters:{code_execute:{permission:'read',retrySafe:true,parameters:{type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:false},execute:async()=>{attempts++;throw Object.assign(Error('syntax error'),{status:422,publicMessage:'Fix the syntax before trying again.'});}}}});const created=await invoke(f.service.create,body());const paused=await finish(f.service,created.body.task.id);assert.equal(paused.continuation.reason,'recovery-limit');assert.equal(attempts,invalid?0:3);if(!invalid)assert.equal(paused.recovery.currentAttempt,2);assert.equal(f.state.published,0);}
});

test('empty model responses recover twice and never become a successful empty result',async t=>{
 for(const persistent of [false,true]){let attempts=0;const f=await fixture(t,{model:async()=>++attempts<=2||persistent?{content:null}:{content:'The verified result is 323.'}});const created=await invoke(f.service.create,body({target:'general',memory:false,permissions:{editCode:false,publish:false,deploy:false,operate:false},deployTargets:[]}));const task=await finish(f.service,created.body.task.id);assert.equal(attempts,3);assert.equal(task.recovery.totalAttempts,2);assert.equal(task.status,persistent?'needs_continuation':'succeeded');if(persistent)assert.equal(task.continuation.reason,'recovery-limit');else assert.match(task.summary,/323/);}
});
test('an unfinished plan gets two completion reviews and pauses instead of reporting success',async t=>{
 let turn=0;const f=await fixture(t,{model:async()=>++turn===1?call('plan_update',{steps:[{id:'verify',title:'Execute and verify the calculation',status:'in_progress'}]}):{content:'Everything is done.'}});const created=await invoke(f.service.create,body({target:'general',permissions:{editCode:false,publish:false,deploy:false,operate:false},deployTargets:[]}));const task=await finish(f.service,created.body.task.id);assert.equal(task.status,'needs_continuation');assert.equal(task.continuation.reason,'completion-review');assert.equal(task.recovery.totalAttempts,2);assert.equal(task.review.checks.find(check=>check.label==='Work plan completed').passed,false);assert.equal(turn,4);
});
test('completion review can finish the remaining tools and plan without losing recorded results',async t=>{
 const steps=status=>[{id:'calculate',title:'Calculate and verify',status}];let turn=0,executions=0;const f=await fixture(t,{model:async()=>[call('plan_update',{steps:steps('in_progress')}),{content:'I have finished.'},call('code_execute',{code:'return 323;'}),call('plan_update',{steps:steps('completed')}),{content:'The executed result is 323.'}][turn++],adapters:{code_execute:{permission:'read',retrySafe:true,parameters:{type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:false},execute:async()=>{executions++;return{result:323};}}}});const created=await invoke(f.service.create,body({target:'general',permissions:{editCode:false,publish:false,deploy:false,operate:false},deployTargets:[]}));const task=await finish(f.service,created.body.task.id);assert.equal(task.status,'succeeded');assert.equal(executions,1);assert.equal(task.recovery.totalAttempts,1);assert.equal(task.review.checks.every(check=>check.passed),true);assert.match(task.summary,/323/);
});
