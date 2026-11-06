'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeAITasks } = require('./office-ai-tasks');
const { createOfficeAIModel } = require('./office-ai');
const RETRY_SAMPLE = 25;
const BASE = 'a'.repeat(40), CANDIDATE = 'c'.repeat(40);
const body = (overrides = {}) => ({ clientRequestId: randomUUID(), target: overrides.permissions?.operate ? 'office' : 'self-update', message: 'Improve the example and validate it.', permissions: { editCode: true, publish: true, deploy: true }, deployTargets: ['api'], ...overrides });
const call = (name, args) => ({ content: null, tool_calls: [{ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
async function invoke(handler, input = {}, id, query = {}) {
  const res = { statusCode: 200, set() { return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body: input, params: { id }, query }, res);
  return { status: res.statusCode, body: res.body };
}
async function fixture(t, options = {}) {
  const pg = new PGlite(); await pg.waitReady;
  t.after(() => pg.close());
  const query = (sql, values) => /pg_advisory_xact_lock/.test(sql) ? Promise.resolve({ rows: [] }) : pg.query(sql, values);
  const db = { query, isConnected: () => true, withClient: fn => fn({ query }) };
  const state = { edits: 0, candidates: 0, published: 0, checks: 0, conclusion: 'success' };
  const repo = { repository: 'UFIConnect/UFIConnect', configured: () => true, redact: text => String(text).replaceAll('private-token-value', '[credential redacted]'),
    head: async () => ({ sha: BASE }), verifiedHead: async () => ({ sha: BASE }), listFiles: async () => ({ files: [{ path: 'backend/office-ai-example.js', sha: BASE }] }),
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
// Most existing cases exercise execution after an explicit simulated operator
// approval. Approval-boundary cases disable this helper behavior below.
async function finish(service, id, limit = 100, approvePublication = true) {
  let task;
  for (let i = 0; i < limit; i++) {
    await service.runOne(id);
    task = (await invoke(service.detail, {}, id)).body.task;
    if (approvePublication && task.status === 'needs_confirmation' && task.confirmation?.action?.name === 'repo_publish') {
      assert.equal((await invoke(service.confirm, { confirmationId: task.confirmation.id, confirmed: true }, id)).status, 200);
      continue;
    }
    if (['succeeded', 'failed', 'needs_confirmation', 'needs_continuation', 'cancelled'].includes(task.status)) return task;
  }
  throw new Error(`Task did not finish: ${task.status}`);
}

async function sample(service, id, steps = RETRY_SAMPLE * 2 + 3) {
  let task;
  for (let i = 0; i < steps; i++) {
    await service.runOne(id);
    task = (await invoke(service.detail, {}, id)).body.task;
  }
  assert.ok(['planning', 'working', 'waiting_checks'].includes(task.status), 'Unfinished retries remain active without false success');
  return task;
}
async function cancelSample(service, id) {
  await invoke(service.cancel, {}, id);
  const stopped = await finish(service, id);
  assert.equal(stopped.status, 'cancelled');
  return stopped;
}

test('one ask prepares and verifies the full access candidate then requires final exact source approval', async t => {
  const f = await fixture(t);
  assert.equal(f.service.capabilities().deploymentApprovalRequired, true, 'Clients can require the server-enforced approval contract during rolling upgrades');
  const created = await invoke(f.service.create, body({ target: 'full-access' }));
  const pending = await finish(f.service, created.body.task.id, 25, false);
  assert.equal(pending.status, 'needs_confirmation'); assert.equal(f.state.published, 0);
  assert.equal(f.state.edits, 1); assert.equal(f.state.candidates, 1);
  assert.equal(pending.confirmation.kind, 'deployment'); assert.equal(pending.confirmation.sha, CANDIDATE);
  assert.deepEqual(pending.confirmation.targets, ['api', 'pipeline', 'web', 'office', 'cloudflare-site']);
  assert.deepEqual(pending.confirmation.action.arguments.selectedTargets, ['api']);
  assert.equal(pending.confirmation.checks[0].sha, CANDIDATE);
  assert.equal(pending.confirmation.checks[0].conclusion, 'success');
  assert.equal(await f.service.runOne(pending.id), false); assert.equal(f.state.published, 0);
  assert.equal((await invoke(f.service.confirm, { confirmationId: randomUUID(), confirmed: true }, pending.id)).status, 409);
  const approval = { confirmationId: pending.confirmation.id, confirmed: true };
  assert.equal((await invoke(f.service.confirm, approval, pending.id)).body.task.status, 'waiting_checks');
  assert.equal((await invoke(f.service.confirm, approval, pending.id)).status, 200);
  const done = await finish(f.service, pending.id, 25, false);
  assert.equal(done.status, 'succeeded'); assert.equal(f.state.published, 1);
  assert.equal((await invoke(f.service.confirm, approval, pending.id)).status, 200);
  assert.equal(await f.service.runOne(pending.id), false); assert.equal(f.state.published, 1);
});

test('an approval saved while a worker still holds its lease wins over the stale worker save', async t => {
  const f = await fixture(t); const created = await invoke(f.service.create, body());
  const pending = await finish(f.service, created.body.task.id, 25, false);
  // Simulate a paused worker that persisted needs_confirmation with its lease
  // renewal still in flight, the exact state an operator returning to a task
  // would see. The confirm handler must take over the lease in one statement.
  await f.db.query(`UPDATE office_ai_tasks SET lease_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',lease_until=$1 WHERE id=$2`,
    [new Date(Date.now() + 120000).toISOString(), pending.id]);
  const leased = (await f.db.query('SELECT lease_id FROM office_ai_tasks WHERE id=$1', [pending.id])).rows[0];
  assert.equal(leased.lease_id, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  const approval = { confirmationId: pending.confirmation.id, confirmed: true };
  assert.equal((await invoke(f.service.confirm, approval, pending.id)).body.task.status, 'waiting_checks');
  const saved = (await f.db.query('SELECT lease_id,lease_until FROM office_ai_tasks WHERE id=$1', [pending.id])).rows[0];
  assert.equal(saved.lease_id, null); assert.equal(saved.lease_until, null);
  // The unwinding worker still holds the old lease token. Its guarded save must
  // match zero rows so the approved record cannot be rolled back to the stale
  // needs_confirmation snapshot.
  const stale = await f.db.query(`UPDATE office_ai_tasks SET data='{}'::jsonb WHERE id=$1
    AND lease_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND lease_until>$2 RETURNING id`,
  [pending.id, new Date().toISOString()]);
  assert.equal(stale.rows.length, 0);
  assert.equal((await invoke(f.service.detail, {}, pending.id)).body.task.status, 'waiting_checks');
  const done = await finish(f.service, pending.id, 25, true);
  assert.equal(done.status, 'succeeded'); assert.equal(f.state.published, 1);
});

test('stopping a finished candidate before final approval prevents publication and rejects approval', async t => {
  const f = await fixture(t); const created = await invoke(f.service.create, body());
  const pending = await finish(f.service, created.body.task.id, 25, false);
  await invoke(f.service.cancel, {}, pending.id);
  assert.equal((await invoke(f.service.confirm, { confirmationId: pending.confirmation.id, confirmed: true }, pending.id)).status, 409);
  const done = await finish(f.service, pending.id, 25, false);
  assert.equal(done.status, 'cancelled'); assert.equal(f.state.published, 0);
});

test('an approved candidate still cannot publish with stale exact source verification', async t => {
  const f = await fixture(t); const created = await invoke(f.service.create, body());
  const pending = await finish(f.service, created.body.task.id, 25, false);
  await invoke(f.service.confirm, { confirmationId: pending.confirmation.id, confirmed: true }, pending.id);
  f.repo.checks = async () => [{ status: 'completed', conclusion: 'success', sha: BASE }];
  const done = await finish(f.service, pending.id, 25, false);
  assert.equal(done.status, 'needs_continuation'); assert.equal(done.continuation.reason, 'verification');
  assert.equal(f.state.published, 0);
});

test('rebasing an approved candidate requires new checks and fresh final approval', async t => {
  const f = await fixture(t); const next = 'd'.repeat(40); let publishes = 0;
  f.repo.checks = async candidate => [{ id: candidate.sha === next ? 82 : 81, status: 'completed', conclusion: 'success', sha: candidate.sha }];
  f.repo.publish = async candidate => {
    publishes++;
    if (candidate.sha === CANDIDATE) throw Object.assign(Error('Main moved'), { status: 409, code: 'MAIN_MOVED' });
    return { ...candidate, published: true };
  };
  f.repo.rebase = async candidate => ({ ...candidate, sha: next, baseSha: 'e'.repeat(40), published: false });
  const created = await invoke(f.service.create, body());
  const first = await finish(f.service, created.body.task.id, 25, false);
  await invoke(f.service.confirm, { confirmationId: first.confirmation.id, confirmed: true }, first.id);
  const second = await finish(f.service, first.id, 25, false);
  assert.equal(second.status, 'needs_confirmation'); assert.equal(second.confirmation.sha, next);
  assert.notEqual(second.confirmation.id, first.confirmation.id); assert.equal(publishes, 1);
  assert.equal(second.confirmation.checks[0].sha, next); assert.equal(second.commit.published, false);
  await invoke(f.service.confirm, { confirmationId: first.confirmation.id, confirmed: true }, first.id);
  assert.equal(await f.service.runOne(first.id), false); assert.equal(publishes, 1);
  await invoke(f.service.confirm, { confirmationId: second.confirmation.id, confirmed: true }, second.id);
  const done = await finish(f.service, second.id, 25, false);
  assert.equal(done.status, 'succeeded'); assert.equal(done.commit.sha, next); assert.equal(publishes, 2);
});

test('a changed task target selection invalidates the same candidate approval', async t => {
  const f = await fixture(t); const created = await invoke(f.service.create, body({ target: 'full-access' }));
  const first = await finish(f.service, created.body.task.id, 25, false);
  await invoke(f.service.confirm, { confirmationId: first.confirmation.id, confirmed: true }, first.id);
  await f.db.query("UPDATE office_ai_tasks SET data=jsonb_set(data,'{deployTargets}','[\"office\"]'::jsonb) WHERE id=$1", [first.id]);
  const second = await finish(f.service, first.id, 25, false);
  assert.equal(second.status, 'needs_confirmation'); assert.notEqual(second.confirmation.id, first.confirmation.id);
  assert.deepEqual(second.confirmation.action.arguments.selectedTargets, ['office']); assert.equal(f.state.published, 0);
});

test('direct deployment source drift renews final approval before any external write', async t => {
  for (const driftDuringExecution of [false, true]) await t.test(driftDuringExecution ? 'during execution preparation' : 'while approval was pending', async t => {
    let current = BASE, reads = 0, writes = 0, turn = 0; const next = 'd'.repeat(40);
    const f = await fixture(t, { model: async () => ++turn === 1 ? call('office_command', { id: 'deploy.api' }) : { content: 'Deployed.' },
      getControls: () => [{ id: 'deploy.api', available: true, requiresConfirmation: false }],
      executeControl: async (_id, input, { expectedSha }) => { writes++; assert.equal(input.confirmed, true); assert.equal(expectedSha, next); return { results: [{ runId: 'direct-approved' }] }; } });
    f.repo.verifiedHead = async () => {
      reads++; if (driftDuringExecution && reads === 3) current = next;
      return { sha: current, check: { sha: current, conclusion: 'success' } };
    };
    const created = await invoke(f.service.create, body({ target: 'full-access', permissions: { operate: true, deploy: true }, deployTargets: ['api'] }));
    const first = await finish(f.service, created.body.task.id, 25, false);
    assert.equal(first.confirmation.sha, BASE); assert.equal(writes, 0);
    await invoke(f.service.confirm, { confirmationId: first.confirmation.id, confirmed: true }, first.id);
    if (!driftDuringExecution) current = next;
    const second = await finish(f.service, first.id, 25, false);
    assert.equal(second.status, 'needs_confirmation'); assert.equal(second.confirmation.sha, next);
    assert.notEqual(second.confirmation.id, first.confirmation.id); assert.equal(writes, 0);
    await invoke(f.service.confirm, { confirmationId: second.confirmation.id, confirmed: true }, second.id);
    const done = await finish(f.service, second.id, 25, false);
    assert.equal(done.status, 'succeeded'); assert.equal(writes, 1);
  });
});

test('deployment adapters without a confirmation flag receive only server pinned source after explicit approval and never replay unknown writes', async t => {
  let writes = 0, turn = 0;
  const f = await fixture(t, { model: async () => ++turn === 1 ? call('custom_deploy', { sha: CANDIDATE }) : { content: 'Done.' },
    adapters: { custom_deploy: { permission: 'deploy', parameters: { type: 'object', properties: { sha: { type: 'string' } }, required: ['sha'], additionalProperties: false },
      execute: async (args, context) => {
        writes++; assert.equal(args.sha, BASE); assert.deepEqual(args.targets, ['api']);
        assert.deepEqual(context.approvedDeployment, { sha: BASE, targets: ['api'] });
        throw Object.assign(Error('Unknown provider outcome'), { status: 502, outcomeUnknown: true });
      } } } });
  const created = await invoke(f.service.create, body({ target: 'full-access', permissions: { deploy: true }, deployTargets: ['api'] }));
  const pending = await finish(f.service, created.body.task.id, 25, false);
  assert.equal(pending.status, 'needs_confirmation'); assert.equal(pending.confirmation.sha, BASE); assert.equal(writes, 0);
  await invoke(f.service.confirm, { confirmationId: pending.confirmation.id, confirmed: true }, pending.id);
  const unknown = await finish(f.service, pending.id, 25, false);
  assert.equal(unknown.status, 'needs_confirmation'); assert.equal(unknown.confirmation.uncertain, true); assert.equal(writes, 1);
  assert.equal((await invoke(f.service.confirm, { confirmationId: unknown.confirmation.id, confirmed: true }, unknown.id)).status, 409);
  assert.equal(await f.service.runOne(unknown.id), false); assert.equal(writes, 1);
});

test('operate-only and full access cannot enable or invoke legacy automatic publication outside final source approval', async t => {
  for (const target of ['office', 'full-access']) await t.test(target, async t => {
    let turn = 0, executions = 0;
    const f = await fixture(t, {
      getControls: () => ['automation.enable', 'automation.audit'].map(id => ({ id, available: true, requiresConfirmation: id === 'automation.enable' })),
      executeControl: async () => { executions++; },
      model: async ({ messages }) => {
        assert.equal(messages[0].content.includes('"id":"automation.enable"'), false);
        assert.equal(messages[0].content.includes('"id":"automation.audit"'), false);
        return [call('office_command', { id: 'automation.enable' }), call('office_command', { id: 'automation.audit' }),
          { content: 'Review the legacy automatic publishing policy in Office controls.' }][turn++];
      },
    });
    const created = await invoke(f.service.create, body({ target, permissions: { operate: true }, deployTargets: [] }));
    const done = await finish(f.service, created.body.task.id, 25, false);
    assert.equal(done.status, 'succeeded'); assert.equal(executions, 0); assert.equal(f.state.published, 0);
    assert.equal(done.events.filter(event => event.kind === 'office_command' && event.status === 'failed').length, 2);
    assert.ok(done.events.some(event => /Autofix/.test(event.detail)));
  });
});

test('long task instructions are stored and reach the model intact without granting capabilities', async t => {
  const message = `Write a release note using this background. ${'Background detail. '.repeat(1400)}End of instructions.`;
  assert.ok(message.length > 24000);
  let request;
  const f = await fixture(t, { model: async input => { request = input; return { content: 'The release note is ready.' }; } });
  const history = [{ role: 'user', content: `Earlier requirements. ${'Context. '.repeat(3000)}End of earlier requirements.` }];
  assert.ok(history[0].content.length > 24000);
  const input = body({ message, history, target: 'general', memory: false,
    permissions: { editCode: false, publish: false, deploy: false, operate: false }, deployTargets: [] });
  const created = await invoke(f.service.create, input);
  assert.equal(created.status, 202);
  const stored = (await f.pg.query('SELECT data FROM office_ai_tasks WHERE id=$1', [created.body.task.id])).rows[0].data;
  assert.equal(stored.message, message);
  const result = await finish(f.service, created.body.task.id);
  assert.equal(result.status, 'succeeded');
  assert.ok(request.messages.some(item => item.role === 'user' && item.content === message));
  assert.ok(request.messages.some(item => typeof item.content === 'string' && item.content.includes(JSON.stringify(history))));
  assert.deepEqual(result.permissions, input.permissions);
  assert.equal(f.state.edits, 0); assert.equal(f.state.published, 0);
});

test('removing the task prompt cap retains malformed input and total request capacity checks', () => {
  const { validateRequest } = require('./office-ai-tasks');
  for (const message of ['', '   ', 12001]) assert.throws(() => validateRequest(body({ message })), { status: 400 });
  assert.throws(() => validateRequest(body({ message: 'x'.repeat(3 * 1024 * 1024) })), { status: 413 });
  assert.throws(() => validateRequest(body({ history: [{ role: 'user', content: 'x'.repeat(48001) }] })), { status: 400 });
  assert.throws(() => validateRequest(body({ history: [{ role: 'user', content: '\u6f22'.repeat(32000) }] })), { status: 400 });
});

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

test('malformed model responses keep recovering beyond former limits and retain the existing checkpoint', async t => {
  const malformed = call('repo_edit', {}); malformed.tool_calls[0].function.arguments = '{';
  const nonObject = call('repo_edit', {}); nonObject.tool_calls[0].function.arguments = '[]';
  let turns = 0;
  const f = await fixture(t, { model: async () => ++turns === 1 ? call('repo_read', { path: 'backend/office-ai-example.js' }) : turns % 2 ? nonObject : malformed });
  const created = await invoke(f.service.create, body());
  const done = await sample(f.service, created.body.task.id, RETRY_SAMPLE + 4);
  assert.ok(done.progress.modelTurns > RETRY_SAMPLE); assert.equal(done.progress.toolCalls, 1);
  assert.equal(f.state.edits, 0); assert.equal(f.state.candidates, 0); assert.equal(f.state.published, 0);
  const stored = (await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [done.id])).rows[0].data;
  assert.equal(stored.internal.baseSha, BASE); assert.equal(stored.internal.pendingCalls.length, 0);
  assert.ok(stored.internal.messages.some(message => message.role === 'tool'));
  const count = turns; await cancelSample(f.service, done.id); assert.equal(turns, count);
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
  const f = await fixture(t, { env: { OFFICE_AI_MAX_MODEL_TURNS: '1', OFFICE_AI_AUTOMATIC_CONTINUATIONS: '0' }, model: async () => { turns++; return malformed; } });
  const created = await invoke(f.service.create, body()); const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'needs_continuation'); assert.equal(done.continuation.reason, 'model-turns');
  assert.equal(done.progress.modelTurns, 1); assert.equal(turns, 1); assert.equal(done.progress.toolCalls, 0);
});

test('valid model turns reset the consecutive malformed-response allowance', async t => {
  const malformed = call('repo_read', {}); malformed.tool_calls[0].function.arguments = '{';
  const responses = [...Array(RETRY_SAMPLE).fill(malformed), call('repo_list', {}),
    ...Array(RETRY_SAMPLE).fill(malformed), { content: 'The requested repository read finished.' }];
  let turns = 0, reads = 0;
  const f = await fixture(t, { model: async () => { turns++; return responses.shift(); } });
  f.repo.listFiles = async () => { reads++; return { files: [] }; };
  const created = await invoke(f.service.create, body({ target: 'general', permissions: {}, deployTargets: [] }));
  const done = await finish(f.service, created.body.task.id, 60);
  assert.equal(done.status, 'succeeded'); assert.equal(reads, 1);
  assert.equal(turns, 2 * RETRY_SAMPLE + 2);
  assert.equal(done.progress.resumes, 0);
});

test('successful tool calls reset consecutive argument and logical correction failures', async t => {
  for (const invalid of [true, false]) await t.test(invalid ? 'invalid arguments' : 'logical failure', async t => {
    const rejected = () => call('code_execute', invalid ? { wrong: true } : { code: 'bad' });
    const accepted = () => call('code_execute', { code: 'good' });
    const responses = [...Array.from({ length: RETRY_SAMPLE }, rejected), accepted(),
      ...Array.from({ length: RETRY_SAMPLE }, rejected), accepted(), { content: 'Both corrected steps completed.' }];
    let executions = 0, successes = 0;
    const f = await fixture(t, { model: async () => responses.shift(), adapters: {
      code_execute: { permission: 'read', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false },
        execute: async ({ code }) => {
          executions++;
          if (code === 'bad') throw Object.assign(Error('Correct the syntax.'), { status: 422 });
          successes++; return { result: 323 };
        } },
    } });
    const created = await invoke(f.service.create, body({ target: 'general', permissions: {}, deployTargets: [] }));
    const done = await finish(f.service, created.body.task.id, 150);
    assert.equal(done.status, 'succeeded'); assert.equal(successes, 2);
    assert.equal(executions, invalid ? 2 : 2 * RETRY_SAMPLE + 2);
    assert.equal(done.progress.resumes, 0);
  });
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
  assert.deepEqual(listed.body.tasks[0].progress, { modelTurns: 12, toolCalls: 11, totalModelTurns: 22, totalToolCalls: 31, resumes: 2, automaticContinuations: 0, contextCompactions: 3 });
  assert.equal(listed.body.tasks[0].resumable, true); assert.equal(listed.body.tasks[0].continuation.id, task.continuation.id);
  assert.deepEqual(listed.body.tasks[0].plan, task.plan); assert.deepEqual(listed.body.tasks[0].recovery, task.recovery);
  assert.deepEqual(listed.body.tasks[0].backups, task.backups); assert.deepEqual(listed.body.tasks[0].review, task.review);
});

test('compact history polling excludes source previews and old receipts before transfer while detail and legacy clients retain them', async t => {
  const f = await fixture(t);
  const created = await invoke(f.service.create, body());
  const task = (await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1',[created.body.task.id])).rows[0].data;
  const hidden='UNRELATED-HISTORY-PREVIEW';
  task.message='Task instructions '.repeat(5000);task.summary='Completed details '.repeat(1000);
  task.changedFiles=[{path:'office/src/Sample.jsx',status:'staged',bytes:20000,before:hidden.repeat(1000),after:hidden.repeat(1000)+'new',diff:hidden}];
  task.events=[{id:randomUUID(),kind:'repo_read',status:'succeeded',detail:hidden.repeat(1000)},
    {id:randomUUID(),kind:'task',status:'succeeded',label:'Completed',at:new Date().toISOString()}];
  task.memoryState={entries:[{content:hidden.repeat(1000)}]};task.candidateHistory=[{source:hidden.repeat(1000)}];
  await f.db.query('UPDATE office_ai_tasks SET data=$2::jsonb WHERE id=$1',[task.id,JSON.stringify(task)]);
  const full=(await invoke(f.service.list)).body.tasks[0];
  const detail=(await invoke(f.service.detail,{},task.id)).body.task;
  assert.deepEqual(full,detail,'Default public list remains compatible');
  const query=f.db.query;let transferred;
  f.db.query=async(sql,values)=>{const result=await query(sql,values);if(sql.includes('FROM office_ai_tasks ORDER BY'))transferred=result.rows;return result;};
  const compact=(await invoke(f.service.list,{},undefined,{summary:'1'})).body.tasks[0];
  assert.equal(compact.listSummary,true);assert.equal(compact.message.length,240);assert.equal(compact.summary.length,600);
  assert.equal(JSON.stringify(transferred).includes(hidden),false,'Database transport excludes previews and old event bodies');
  assert.ok(Buffer.byteLength(JSON.stringify(compact))<Buffer.byteLength(JSON.stringify(full))/10);
  assert.deepEqual(compact.events,[task.events.at(-1)]);
  assert.deepEqual(compact.changedFiles,[{path:'office/src/Sample.jsx',status:'staged',bytes:20000}]);
  assert.equal(compact.memoryState,undefined);assert.equal(compact.candidateHistory,undefined);
  assert.deepEqual(compact.progress,detail.progress);assert.deepEqual(compact.permissions,detail.permissions);
  assert.equal(detail.changedFiles[0].before,task.changedFiles[0].before);
});

test('persisted task timings distinguish model work, failed tools, verification and publication without arguments', async t => {
  let clock=Date.now(),turn=0;
  const f=await fixture(t,{now:()=>clock,model:async()=>{clock+=1000;return[call('repo_read',{path:'backend/office-ai-example.js'}),
    call('repo_edit',{path:'backend/office-ai-example.js',edits:[{find:'=1',replace:'=2'}]}),
    call('repo_commit',{message:'Improve example value'}),{content:'Done.'}][turn++];}});
  f.repo.readFile=async()=>{clock+=250;return{path:'backend/office-ai-example.js',sha:BASE,content:'const value=1;'};};
  const edit=f.repo.edit;f.repo.edit=async(...args)=>{clock+=400;return edit(...args);};
  const checks=f.repo.checks;f.repo.checks=async(...args)=>{clock+=50;return checks(...args);};
  const publish=f.repo.publish;f.repo.publish=async(...args)=>{clock+=75;return publish(...args);};
  const created=await invoke(f.service.create,body());
  const done=await finish(f.service,created.body.task.id);
  assert.equal(done.status,'succeeded');assert.equal(done.performance.phases.model.count,4);
  assert.equal(done.performance.phases.model.totalMs,4000);assert.equal(done.performance.phases.tool.totalMs,650);
  assert.equal(done.performance.phases.verification.count,3);assert.equal(done.performance.phases.verification.totalMs,150);
  assert.equal(done.performance.phases.publication.totalMs,75);
  assert.ok(done.performance.phases.queue.count>0);assert.ok(done.performance.phases.connection.count>0);
  const persisted=(await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1',[done.id])).rows[0].data;
  assert.deepEqual(persisted.performance,done.performance);
  assert.equal(JSON.stringify(done.performance).includes('backend/'),false);assert.equal(JSON.stringify(done.performance).includes('arguments'),false);
  const failed=await fixture(t,{now:()=>clock,model:async()=>{clock+=200;throw Object.assign(Error('Provider failed'),{status:502});}});
  const pending=await invoke(failed.service.create,body());await failed.service.runOne(pending.body.task.id);
  const result=(await invoke(failed.service.detail,{},pending.body.task.id)).body.task;
  assert.equal(result.performance.phases.model.totalMs,200,'Failed provider work remains measured');assert.equal(result.recovery.currentAttempt,1);
});

test('existing file correction guidance requires edits and preserves exact revision and replacement validation', async t => {
  let captured;
  const f=await fixture(t,{model:async input=>{captured=input;return{content:'Read-only explanation.'};}});
  const created=await invoke(f.service.create,body());await f.service.runOne(created.body.task.id);
  const edit=captured.tools.find(tool=>tool.function.name==='repo_edit').function;
  assert.match(edit.description,/EXISTING[\s\S]*edits:[\s\S]*OMIT content/);
  assert.match(edit.parameters.properties.content.description,/New files only/);
  assert.equal(edit.parameters.additionalProperties,false);
  assert.deepEqual(edit.parameters.properties.edits.items.required,['find','replace']);
});

test('published tasks wait for the exact deployment before reporting completion', async t => {
  const f = await fixture(t); let observed = 0;
  f.repo.deployments = async commit => ({ ready: ++observed > 2, deployments: [{ service: 'office', sha: commit.sha, status: observed > 2 ? 'live' : 'build_in_progress' }] });
  const created = await invoke(f.service.create, body());
  const approval = await finish(f.service, created.body.task.id, 25, false);
  assert.equal(approval.status, 'needs_confirmation');
  await invoke(f.service.confirm, { confirmationId: approval.confirmation.id, confirmed: true }, approval.id);
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
    if (turn < 3) assert.equal(edit.function.parameters.properties.expectedSha, undefined);
    else assert.equal(edit, undefined, 'Published code scope cannot request another edit in the same task');
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
  const done = await sample(f.service, created.body.task.id);
  assert.match(done.summary, /not been saved/); assert.equal(f.state.published, 0);
  await cancelSample(f.service, done.id);
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
  const done = await sample(f.service, created.body.task.id);
  assert.equal(done.changedFiles.length, 0); assert.equal(f.state.published, 0);
  await cancelSample(f.service, done.id);
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

test('Work creative freedom survives persistence without broadening execution scope', async t => {
  let request;
  const f = await fixture(t, { model: async input => { request = input; return { content: 'An original story is ready.' }; } });
  const input = body({ message: 'Write a story with original characters.', target: 'general', creativity: 'creative',
    permissions: { editCode: false, publish: false, deploy: false, operate: false }, deployTargets: [] });
  const created = await invoke(f.service.create, input);
  assert.equal(created.status, 202);
  const result = await finish(f.service, created.body.task.id);
  assert.equal(result.creativity, 'creative');
  assert.deepEqual(result.permissions, input.permissions);
  assert.match(request.messages[0].content, /Creative freedom: creative/);
  assert.match(request.messages[0].content, /never authorizes invented factual claims/);
  assert.equal(f.state.edits, 0); assert.equal(f.state.published, 0);
  for (const creativity of ['constructor', '__proto__', {}, null]) {
    assert.throws(() => require('./office-ai-tasks').validateRequest(body({ creativity })), error => error.status === 400);
  }
  assert.equal(Object.hasOwn(require('./office-ai-tasks').validateRequest(body()), 'creativity'), false);
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
  const done = await sample(service, created.body.task.id);
  assert.equal(state.edits, 0); assert.equal(state.published, 0);
  assert.ok(done.events.some(event => event.status === 'failed' && event.detail.includes('outside the selected task destination')));
  await cancelSample(service, done.id);
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
    const done = malformed ? await sample(service, created.body.task.id) : await finish(service, created.body.task.id);
    if (malformed) { await cancelSample(service, done.id); }
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
  assert.equal(state.edits, 1); assert.equal(state.candidates, 1); assert.equal(state.checks, 3); assert.equal(state.published, 1);
  assert.equal(task.commit.published, true);
  assert.equal(task.checks[0].conclusion, 'success');
  assert.equal(task.deployments[0].status, 'queued');
  assert.equal(task.changedFiles[0].status, 'published');
  assert.match(task.summary, /deployment was queued/);
});

test('failed verification prevents publication and an edit-only task retains its verified candidate', async t => {
  const { service, state } = await fixture(t); state.conclusion = 'failure';
  const created = await invoke(service.create, body());
  const failed = await sample(service, created.body.task.id);
  assert.equal(state.published, 0);
  assert.equal(failed.verificationHistory[0].checks[0].conclusion, 'failure');
  assert.equal(failed.commit.published, false);
  await cancelSample(service, failed.id);
  const other = await fixture(t);
  const editOnly = await invoke(other.service.create, body({ permissions: { editCode: true, publish: false, deploy: false } }));
  const result = await finish(other.service, editOnly.body.task.id);
  assert.equal(result.status, 'succeeded'); assert.equal(other.state.published, 0); assert.equal(result.commit.published, false);
});

test('failed CI is corrected in the same task with a new candidate and exact successful checks', async t => {
  const next = 'd'.repeat(40), checked = [], published = [];
  const responses = [call('repo_read', { path: 'backend/office-ai-example.js' }),
    call('repo_edit', { path: 'backend/office-ai-example.js', edits: [{ find: '=1', replace: '=2' }] }),
    call('repo_commit', { message: 'Prepare initial candidate' }),
    call('repo_read', { path: 'backend/office-ai-example.js' }),
    call('repo_edit', { path: 'backend/office-ai-example.js', edits: [{ find: '=2', replace: '=3' }] }),
    { content: 'The CI correction is staged.' }, { content: 'The corrected change passed checks and was published.' }];
  let turns = 0, diagnostics = 0;
  const f = await fixture(t, { model: async ({ messages }) => {
    if (++turns === 4) {
      assert.ok(messages.some(message => message.content?.includes('backend regression tests')));
      assert.ok(messages.some(message => message.content?.includes('Do not rerun the unchanged failed source')));
    }
    return responses.shift();
  } });
  f.repo.edit = async (_args, staged) => {
    f.state.edits++;
    return { path: 'backend/office-ai-example.js', originalSha: BASE, sha: staged ? next : CANDIDATE,
      before: 'const value=1;', content: staged ? 'const value=3;' : 'const value=2;' };
  };
  f.repo.candidate = async ({ files }) => {
    f.state.candidates++;
    return { sha: files[0].content.includes('=3') ? next : CANDIDATE, baseSha: BASE, published: false };
  };
  f.repo.checks = async (candidate, { dispatch }) => {
    checked.push({ sha: candidate.sha, dispatch });
    return [{ id: candidate.sha === next ? 2 : 1, name: 'Verify', status: 'completed', conclusion: candidate.sha === next ? 'success' : 'failure', sha: candidate.sha }];
  };
  f.repo.verificationFailure = async candidate => {
    diagnostics++; assert.equal(candidate.sha, CANDIDATE);
    return { sha: candidate.sha, runId: 1, failedJobs: [{ name: 'Backend', steps: [{ name: 'backend regression tests', conclusion: 'failure' }] }] };
  };
  f.repo.publish = async candidate => { published.push(candidate.sha); return { ...candidate, published: true }; };
  const created = await invoke(f.service.create, body()); const done = await finish(f.service, created.body.task.id, 40);
  assert.equal(done.status, 'succeeded'); assert.equal(done.progress.resumes, 0);
  assert.deepEqual(checked, [{ sha: CANDIDATE, dispatch: true }, { sha: next, dispatch: true }, { sha: next, dispatch: false }]);
  assert.deepEqual(published, [next]); assert.equal(diagnostics, 1); assert.equal(f.state.edits, 2);
  assert.equal(done.candidateHistory[0].sha, CANDIDATE);
  assert.equal(done.verificationHistory[0].checks[0].conclusion, 'failure');
  assert.equal(done.checks[0].sha, next); assert.equal(done.checks[0].conclusion, 'success');
});

test('verification recovery continues across more than twenty-five different failed source revisions', async t => {
  let turns = 0, revisions = 0, checks = 0;
  const f = await fixture(t, { model: async () => ++turns % 2
    ? call('repo_edit', { path: 'backend/office-ai-example.js', edits: [{ find: 'value', replace: 'correctedValue' }] })
    : call('repo_commit', { message: 'Correct candidate verification' }) });
  f.repo.edit = async () => ({ path: 'backend/office-ai-example.js', originalSha: BASE,
    sha: String(++revisions).padStart(40, '0'), before: 'const value=1;', content: 'const value=' + (revisions + 1) + ';' });
  f.repo.candidate = async ({ files }) => ({ sha: files[0].sha, baseSha: BASE, published: false });
  f.repo.checks = async candidate => { checks++; return [{ id: checks, status: 'completed', conclusion: 'failure', sha: candidate.sha }]; };
  const created = await invoke(f.service.create, body()); const done = await sample(f.service, created.body.task.id, RETRY_SAMPLE * 6);
  assert.ok(checks > RETRY_SAMPLE); assert.ok(revisions > RETRY_SAMPLE);
  assert.ok(done.verificationHistory.length >= RETRY_SAMPLE); assert.equal(f.state.published, 0);
  await cancelSample(f.service, done.id);
});

test('unchanged failed candidates and stale successful checks cannot be published', async t => {
  for (const stale of [false, true]) await t.test(stale ? 'stale successful check' : 'unchanged failed source', async t => {
    let turns = 0, checks = 0;
    const f = await fixture(t, { model: async () => {
      turns++;
      return turns === 1 ? call('repo_edit', { path: 'backend/office-ai-example.js', edits: [{ find: '=1', replace: '=2' }] })
        : call('repo_commit', { message: 'Try the candidate' });
    } });
    f.repo.checks = async () => { checks++; return [{ id: 1, status: 'completed', conclusion: stale ? 'success' : 'failure', sha: stale ? BASE : CANDIDATE }]; };
    const created = await invoke(f.service.create, body());
    const done = stale ? await finish(f.service, created.body.task.id, 60) : await sample(f.service, created.body.task.id, 60);
    if (stale) assert.equal(done.status, 'needs_continuation');
    assert.equal(f.state.published, 0);
    assert.equal(f.state.candidates, 1); assert.equal(checks, 1);
    await cancelSample(f.service, done.id);
  });
});

test('selected full access runs authorized Office commands without repeated confirmations', async t => {
  const executed = [], requests = [];
  const responses = [call('office_command', { id: 'feed.clear', inputs: { confirmed: false } }),
    call('office_command', { id: 'source.disable' }), { content: 'Both requested commands completed.' }];
  const f = await fixture(t, { model: async input => { requests.push(input); return responses.shift(); },
    getControls: () => ['feed.clear', 'source.disable'].map(id => ({ id, label: id, requiresConfirmation: true })),
    executeControl: async (id, input) => { executed.push(id); assert.equal(input.confirmed, true); return { runId: 'receipt-' + id }; } });
  const created = await invoke(f.service.create, body({ target: 'full-access', message: 'Clear the feed and disable the source.',
    permissions: { operate: true }, deployTargets: [] }));
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(done.confirmation, null);
  assert.deepEqual(executed, ['feed.clear', 'source.disable']);
  assert.equal(done.events.some(event => event.kind === 'confirmation' && event.status === 'pending'), false);
  assert.match(requests[0].messages[0].content, /operator selected those capabilities in advance/i);
  assert.match(requests[0].messages[0].content, /"id":"feed.clear".*"requiresConfirmation":false/);
  assert.equal(requests[0].tools.some(tool => tool.function.name === 'office_command'), true);
  assert.equal(requests[0].tools.some(tool => tool.function.name === 'repo_edit'), false, 'Full access does not grant unselected editing permission');
  assert.equal(f.service.capabilities().fullAccess, true);
  assert.equal(f.service.capabilities().defaultDestination, 'full-access');
  assert.equal(f.service.capabilities().destinations.includes('full-access'), true);
});

test('full access prepares each server, mobile and Worker deployment and waits for final exact source approval', async t => {
  const executions = [], workerArgs = []; let verified = 0;
  const responses = [call('office_command', { id: 'deploy.api' }), call('mobile_build', {}),
    call('cloudflare_deploy', { worker: 'uficonnect-office-ai' }), { content: 'Requested deployments have receipts.' }];
  const f = await fixture(t, { env: { EXPO_TOKEN: 'synthetic-expo-token-1234567890' }, model: async ({ tools }) => {
    for (const name of ['office_command', 'mobile_build', 'cloudflare_deploy']) assert.equal(tools.some(tool => tool.function.name === name), true, name);
    return responses.shift();
  }, getControls: () => ['deploy.api', 'deploy.mobile'].map(id => ({ id, label: id, available: true, requiresConfirmation: true })),
  executeControl: async (id, input, { expectedSha }) => {
    executions.push(id); assert.equal(input.confirmed, true); assert.equal(expectedSha, BASE);
    return { results: [{ ok: true, result: id === 'deploy.mobile' ? { provider: 'expo', status: 'queued', sha: BASE } : { sha: BASE } }] };
  }, adapters: { cloudflare_deploy: { permission: 'deploy', requiresConfirmation: true,
    parameters: { type: 'object', properties: { worker: { type: 'string' }, sha: { type: 'string' } }, required: ['worker', 'sha'], additionalProperties: false },
    execute: async args => { workerArgs.push(args); return { service: 'cloudflare-ai', sha: args.sha, status: 'live' }; } } } });
  f.repo.verifiedHead = async () => { verified++; return { sha: BASE }; };
  const created = await invoke(f.service.create, body({ target: 'full-access', message: 'Deploy the API, build the mobile app, and deploy the AI Worker.',
    permissions: { operate: true, deploy: true }, deployTargets: ['api', 'mobile', 'cloudflare-ai'] }));
  for (const [index, target] of ['api', 'mobile', 'cloudflare-ai'].entries()) {
    const pending = await finish(f.service, created.body.task.id);
    assert.equal(pending.status, 'needs_confirmation'); assert.equal(pending.confirmation.kind, 'deployment');
    assert.equal(pending.confirmation.sha, BASE); assert.deepEqual(pending.confirmation.targets, [target]);
    assert.equal(executions.length + workerArgs.length, index);
    assert.equal((await invoke(f.service.confirm, { confirmationId: pending.confirmation.id, confirmed: true }, pending.id)).status, 200);
  }
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(done.confirmation, null); assert.equal(verified, 8);
  assert.deepEqual(executions, ['deploy.api', 'deploy.mobile']);
  assert.deepEqual(workerArgs, [{ worker: 'uficonnect-office-ai', sha: BASE }]);
  assert.equal(done.deployments.some(item => item.service === 'mobile'), true);
  assert.equal(done.deployments.some(item => item.service === 'cloudflare-ai'), true);
});

test('full access retains unselected capability and deployment target enforcement', async t => {
  let executions = 0;
  const responses = [call('office_command', { id: 'deploy.api' }), call('cloudflare_deploy', { worker: 'uficonnect-office-ai' }), { content: 'No unselected deployments ran.' }];
  const f = await fixture(t, { env: { EXPO_TOKEN: 'synthetic-expo-token-1234567890' }, model: async ({ tools }) => {
    assert.equal(tools.some(tool => tool.function.name === 'mobile_build'), false);
    assert.equal(tools.some(tool => tool.function.name === 'repo_edit'), false);
    return responses.shift();
  }, getControls: () => [{ id: 'deploy.api', label: 'Deploy API', requiresConfirmation: true }],
  executeControl: async () => { executions++; }, adapters: { cloudflare_deploy: { permission: 'deploy', requiresConfirmation: true,
    parameters: { type: 'object', properties: { worker: { type: 'string' }, sha: { type: 'string' } }, required: ['worker', 'sha'], additionalProperties: false },
    execute: async () => { executions++; } } } });
  const created = await invoke(f.service.create, body({ target: 'full-access', permissions: { operate: true, deploy: true }, deployTargets: ['web'] }));
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(executions, 0); assert.equal(done.confirmation, null);
  assert.equal(done.events.filter(event => event.status === 'failed').length, 2);
});

test('full access edits across project paths while failed exact-candidate verification prevents publication', async t => {
  const paths = ['backend/feed.js', 'web/src/App.jsx', 'mobile/App.js'];
  const responses = paths.flatMap(path => [call('repo_read', { path }), call('repo_edit', { path, edits: [{ find: '=1', replace: '=2' }] })]);
  responses.push(call('repo_commit', { message: 'Update requested project components' }), { content: 'Ready.' });
  const edited = [];
  const f = await fixture(t, { model: async () => responses.shift() || { content: 'Ready.' } });
  f.repo.edit = async args => { edited.push(args.path); return { path: args.path, originalSha: BASE, sha: CANDIDATE, before: 'const value=1;', content: 'const value=2;' }; };
  f.state.conclusion = 'failure';
  const created = await invoke(f.service.create, body({ target: 'full-access', message: 'Update the feed, public website and mobile app.',
    permissions: { editCode: true, publish: true, deploy: true, operate: true }, deployTargets: ['api', 'web', 'mobile'] }));
  const done = await sample(f.service, created.body.task.id, 50);
  assert.deepEqual(edited, paths); assert.equal(f.state.candidates, 1);
  assert.equal(f.state.published, 0); assert.equal(done.commit.published, false);
  assert.equal(done.verificationHistory[0].checks[0].conclusion, 'failure');
  await cancelSample(f.service, done.id);
});

test('full access still stops unconfirmed external outcomes and refuses replay', async t => {
  let executions = 0;
  const f = await fixture(t, { model: async () => call('office_command', { id: 'feed.refresh' }),
    getControls: () => [{ id: 'feed.refresh', label: 'Refresh feed', requiresConfirmation: true }],
    executeControl: async (_id, input) => { executions++; assert.equal(input.confirmed, true); throw Object.assign(Error('Receipt missing'), {
      outcomeUnknown: true, publicMessage: 'The service did not confirm the result.' }); } });
  const created = await invoke(f.service.create, body({ target: 'full-access', message: 'Refresh the feed.', permissions: { operate: true }, deployTargets: [] }));
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'needs_confirmation'); assert.equal(done.confirmation.uncertain, true); assert.equal(executions, 1);
  assert.equal((await invoke(f.service.confirm, { confirmationId: done.confirmation.id, confirmed: true }, done.id)).status, 409);
  assert.equal(await f.service.runOne(done.id), false); assert.equal(executions, 1);
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
  const created = await invoke(readOnly.service.create, body({ target: 'full-access', permissions: { editCode: false, publish: false, deploy: false, operate: false } }));
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
  for (let i = 0; i < 5; i++) tasks.push((await invoke(service.create, body({ permissions: {}, target: 'general' }))).body.task);
  assert.equal((await invoke(service.create, body({ permissions: {}, target: 'general' }))).status, 429);
  await invoke(service.cancel, {}, tasks[0].id); await service.runOne(tasks[0].id);
  assert.equal((await invoke(service.create, body({ permissions: {}, target: 'general' }))).status, 202);
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


test('model failures recover beyond former retry limits and persistent failures remain cancellable', async t => {
  let attempts = 0;
  const f = await fixture(t, { model: async () => { if (++attempts <= RETRY_SAMPLE) throw Object.assign(Error('temporarily unavailable'), { status: 502 }); return { content: 'Verified answer.' }; } });
  const created = await invoke(f.service.create, body({ target: 'general', permissions: {}, deployTargets: [] }));
  const done = await finish(f.service, created.body.task.id);
  assert.equal(attempts, RETRY_SAMPLE + 1); assert.equal(done.status, 'succeeded'); assert.equal(done.recovery.totalAttempts, RETRY_SAMPLE);
  let failures = 0; const g = await fixture(t, { model: async () => { failures++; throw Object.assign(Error('still unavailable'), { status: 502 }); } });
  const pending = await invoke(g.service.create, body()); const active = await sample(g.service, pending.body.task.id);
  assert.ok(failures > RETRY_SAMPLE); assert.equal(active.recovery.limit, 'unlimited');
  const count = failures; await cancelSample(g.service, active.id); assert.equal(failures, count);
});

test('safe tools retry beyond former limits with the same invocation and persistent errors remain cancellable', async t => {
  let attempts = 0, turn = 0; const ids = [];
  const f = await fixture(t, { model: async () => ++turn === 1 ? call('code_execute', { code: 'return 323;' }) : { content: '323' }, adapters: {
    code_execute: { permission: 'read', retrySafe: true, parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false },
      execute: async (_args, context) => { attempts++; ids.push(context.invocationId); if (attempts <= RETRY_SAMPLE) throw Object.assign(Error('busy'), { status: 429 }); return { result: 323 }; } } } });
  const created = await invoke(f.service.create, body({ target: 'general', permissions: {}, deployTargets: [] })); const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(attempts, RETRY_SAMPLE + 1); assert.equal(new Set(ids).size, 1); assert.equal(done.recovery.totalAttempts, RETRY_SAMPLE);
  assert.equal(done.review.checks.every(check => check.passed), true);
  let rejected = 0; const g = await fixture(t, { model: async () => call('web_read', { url: 'https://example.test' }), adapters: {
    web_read: { permission: 'read', retrySafe: true, parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false }, execute: async () => { rejected++; throw Object.assign(Error('unavailable'), { status: 502 }); } } } });
  const second = await invoke(g.service.create, body()); const active = await sample(g.service, second.body.task.id);
  assert.ok(rejected > RETRY_SAMPLE); const count = rejected; await cancelSample(g.service, active.id); assert.equal(rejected, count);
});

test('plans remain progress metadata and paused encrypted drafts restore with a current continuation lease',async t=>{
 let turn=0;const f=await fixture(t,{checkpoints:true,model:async()=>[call('plan_update',{steps:[{id:'inspect',title:'Inspect the current file',status:'in_progress'},{id:'change',title:'Change and verify',status:'pending'}]}),call('repo_read',{path:'backend/office-ai-example.js'}),call('repo_edit',{path:'backend/office-ai-example.js',edits:[{find:'=1',replace:'=2'}]})][turn++]||{content:'Review the prepared draft.'}});
 const created=await invoke(f.service.create,body({permissions:{editCode:true,publish:false,deploy:false,operate:false},deployTargets:[]}));let task;for(let n=0;n<6;n++){await f.service.runOne(created.body.task.id);task=(await invoke(f.service.detail,{},created.body.task.id)).body.task;}assert.equal(task.plan.steps.length,2);assert.equal(task.backups.length,3);
 const stored=(await f.pg.query('SELECT data FROM office_ai_tasks WHERE id=$1',[task.id])).rows[0].data;stored.status='needs_continuation';stored.continuation={id:randomUUID(),reason:'review'};await f.pg.query('UPDATE office_ai_tasks SET status=$2,data=$3::jsonb WHERE id=$1',[task.id,stored.status,JSON.stringify(stored)]);
 const checkpointId=task.backups.at(-1).id;const res={statusCode:200,status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};await f.service.restoreCheckpoint({params:{id:task.id,checkpointId},body:{confirmed:true,continuationId:stored.continuation.id}},res);assert.equal(res.statusCode,200);assert.equal(res.body.task.changedFiles.length,0);assert.equal(res.body.task.status,'needs_continuation');assert.equal(res.body.task.permissions.publish,false);assert.notEqual(res.body.task.continuation.id,stored.continuation.id);
 const stale={...res,statusCode:200};await f.service.restoreCheckpoint({params:{id:task.id,checkpointId},body:{confirmed:true,continuationId:stored.continuation.id}},stale);assert.equal(stale.statusCode,409);
});

test('logical failures and invalid tool requests keep correcting without executing invalid arguments', async t => {
  for (const invalid of [false, true]) {
    let attempts = 0; const f = await fixture(t, { model: async () => call('code_execute', invalid ? { wrong: true } : { code: 'bad code' }), adapters: {
      code_execute: { permission: 'read', retrySafe: true, parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false },
        execute: async () => { attempts++; throw Object.assign(Error('syntax error'), { status: 422, publicMessage: 'Fix the syntax before trying again.' }); } } } });
    const created = await invoke(f.service.create, body()); const active = await sample(f.service, created.body.task.id, RETRY_SAMPLE * 2 + 4);
    assert.equal(attempts, invalid ? 0 : RETRY_SAMPLE + 2); assert.equal(f.state.published, 0);
    if (!invalid) assert.ok(active.recovery.currentAttempt > RETRY_SAMPLE);
    const count = attempts; await cancelSample(f.service, active.id); assert.equal(attempts, count);
  }
});

test('empty model responses recover beyond former limits and never become a successful empty result', async t => {
  for (const persistent of [false, true]) {
    let attempts = 0; const f = await fixture(t, { model: async () => ++attempts <= RETRY_SAMPLE || persistent ? { content: null } : { content: 'The verified result is 323.' } });
    const created = await invoke(f.service.create, body({ target: 'general', memory: false, permissions: {}, deployTargets: [] }));
    const task = persistent ? await sample(f.service, created.body.task.id) : await finish(f.service, created.body.task.id);
    assert.ok(attempts > RETRY_SAMPLE);
    if (persistent) { assert.equal(task.recovery.limit, 'unlimited'); await cancelSample(f.service, task.id); }
    else { assert.equal(task.status, 'succeeded'); assert.equal(task.recovery.totalAttempts, RETRY_SAMPLE); assert.match(task.summary, /323/); }
  }
});

test('an unfinished plan keeps receiving completion reviews instead of reporting success', async t => {
  let turn = 0; const f = await fixture(t, { model: async () => ++turn === 1 ? call('plan_update', { steps: [{ id: 'verify', title: 'Execute and verify the calculation', status: 'in_progress' }] }) : { content: 'Everything is done.' } });
  const created = await invoke(f.service.create, body({ target: 'general', permissions: {}, deployTargets: [] })); const task = await sample(f.service, created.body.task.id);
  assert.ok(task.recovery.totalAttempts > RETRY_SAMPLE); assert.equal(task.review.checks.find(check => check.label === 'Work plan completed').passed, false);
  assert.ok(turn > RETRY_SAMPLE); const count = turn; await cancelSample(f.service, task.id); assert.equal(turn, count);
});

test('completion review can finish the remaining tools and plan without losing recorded results',async t=>{
 const steps=status=>[{id:'calculate',title:'Calculate and verify',status}];let turn=0,executions=0;const f=await fixture(t,{model:async()=>[call('plan_update',{steps:steps('in_progress')}),{content:'I have finished.'},call('code_execute',{code:'return 323;'}),call('plan_update',{steps:steps('completed')}),{content:'The executed result is 323.'}][turn++],adapters:{code_execute:{permission:'read',retrySafe:true,parameters:{type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:false},execute:async()=>{executions++;return{result:323};}}}});const created=await invoke(f.service.create,body({target:'general',permissions:{editCode:false,publish:false,deploy:false,operate:false},deployTargets:[]}));const task=await finish(f.service,created.body.task.id);assert.equal(task.status,'succeeded');assert.equal(executions,1);assert.equal(task.recovery.totalAttempts,1);assert.equal(task.review.checks.every(check=>check.passed),true);assert.match(task.summary,/323/);
});

test('automatic budget checkpoints keep working without replaying successful calls or changing capabilities', async t => {
  let turn = 0;
  const f = await fixture(t, { env: { OFFICE_AI_MAX_MODEL_TURNS: '1', OFFICE_AI_MAX_TOOL_CALLS: '1' },
    model: async () => ++turn <= 3 ? call('repo_list', {}) : { content: 'All requested reads completed.' } });
  const created = await invoke(f.service.create, body({ permissions: {}, target: 'general', deployTargets: [] }));
  let reads = 0; f.repo.listFiles = async () => { reads++; return { files: [] }; };
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(turn, 4); assert.equal(reads, 3);
  assert.equal(done.progress.totalModelTurns, 4); assert.equal(done.progress.totalToolCalls, 3);
  assert.equal(done.progress.automaticContinuations, 3); assert.equal(done.progress.resumes, 0);
  assert.deepEqual(done.permissions, { editCode: false, publish: false, deploy: false, operate: false });
  assert.equal(done.events.filter(event => event.status === 'continued').length, 3);
});

test('automatic continuation keeps renewing saved checkpoints beyond the former finite cap', async t => {
  let turns = 0;
  const f = await fixture(t, { env: { OFFICE_AI_MAX_MODEL_TURNS: '1', OFFICE_AI_AUTOMATIC_CONTINUATIONS: '2' }, model: async () => { turns++; return call('repo_list', {}); } });
  const created = await invoke(f.service.create, body({ permissions: {}, target: 'general' })); const active = await sample(f.service, created.body.task.id, RETRY_SAMPLE * 3 + 3);
  assert.ok(active.progress.automaticContinuations > RETRY_SAMPLE); assert.ok(turns > RETRY_SAMPLE);
  assert.equal(active.limits.automaticContinuations, 'unlimited');
  const raw = (await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [active.id])).rows[0].data;
  assert.equal(raw.internal.turns, turns); assert.equal(raw.internal.automaticContinuations, active.progress.automaticContinuations);
  const count = turns; await cancelSample(f.service, active.id); assert.equal(turns, count);
});

test('automatic tool budget rollover executes only the saved pending call', async t => {
  let turns = 0, reads = 0;
  const f = await fixture(t, { env: { OFFICE_AI_MAX_TOOL_CALLS: '1' }, model: async () => ++turns === 1
    ? { content: null, tool_calls: [...call('repo_list', {}).tool_calls, ...call('repo_list', {}).tool_calls] }
    : { content: 'Both reads finished.' } });
  f.repo.listFiles = async () => { reads++; return { files: [] }; };
  const created = await invoke(f.service.create, body({ permissions: {}, target: 'general' }));
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(reads, 2); assert.equal(turns, 2);
  assert.equal(done.progress.automaticContinuations, 1); assert.equal(done.progress.totalToolCalls, 2);
});

test('truncated model batches execute no sibling tools and preserve earlier completed command receipts', async t => {
  let turns = 0, executions = 0;
  const f = await fixture(t, { model: async ({ messages }) => {
    if (++turns === 1) return call('office_command', { id: 'feed.refresh' });
    if (turns === 2) return { ...call('office_command', { id: 'feed.refresh' }), truncated: true, content: 'The rest of the requested result was cut off' };
    assert.ok(messages.some(message => message.content?.includes('None of its tool calls executed')));
    assert.ok(messages.some(message => message.content?.includes('recorded-feed-refresh')));
    return { content: 'The requested refresh completed once and the full explanation is ready.' };
  }, getControls: () => [{ id: 'feed.refresh', label: 'Refresh feed', requiresConfirmation: false }],
  executeControl: async () => { executions++; return { runId: 'recorded-feed-refresh' }; } });
  const created = await invoke(f.service.create, body({ target: 'full-access', message: 'Refresh the feed and explain the result.', permissions: { operate: true } }));
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(turns, 3); assert.equal(executions, 1);
  assert.equal(done.commands.length, 1); assert.equal(done.commands[0].results[0].runId, 'recorded-feed-refresh');
  assert.equal(done.output.status, 'complete'); assert.equal(done.output.recoveryAttempts, 1);
  assert.equal(done.progress.toolCalls, 1); assert.equal(f.state.published, 0);
});

test('provider-length truncation recovers through a complete saved artifact without retaining private reasoning', async t => {
  let turns = 0, written;
  const model = createOfficeAIModel({ env: { OFFICE_AI_RELAY_URL: 'https://office.owner.workers.dev', OFFICE_AI_RELAY_SECRET: 'private-test-relay-secret-00000000000000' },
    fetcher: async () => {
      const message = ++turns === 1 ? { content: '<think>private hidden analysis</think>Beginning of an unfinished report.', reasoning_content: 'private hidden reasoning' }
        : turns === 2 ? call('workspace_write', { path: 'reports/complete.md', content: 'The complete requested report, including its final section.' })
          : { content: 'Saved the complete report to reports/complete.md and verified its file receipt.' };
      return Response.json({ choices: [{ finish_reason: turns === 1 ? 'length' : turns === 2 ? 'tool_calls' : 'stop', message }] });
    } });
  const f = await fixture(t, { model, adapters: { workspace_write: { permission: 'editCode',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', maxLength: 70000 } }, required: ['path', 'content'], additionalProperties: false },
    execute: async args => { written = args.content; return { path: args.path, revision: 'b'.repeat(64), memoryId: randomUUID(), version: 1, bytes: Buffer.byteLength(args.content) }; } } } });
  const created = await invoke(f.service.create, body({ target: 'hosted-web', message: 'Create and save the complete requested report.', permissions: { editCode: true } }));
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(turns, 3);
  assert.equal(written, 'The complete requested report, including its final section.');
  assert.equal(done.artifacts[0].path, 'reports/complete.md'); assert.equal(done.output.status, 'complete');
  assert.doesNotMatch(JSON.stringify((await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [done.id])).rows[0].data), /private hidden/);
  assert.equal(f.state.published, 0);
});

test('oversized complete answers are saved in full before a concise result instead of silently sliced', async t => {
  const full = 'Requested content. '.repeat(1100) + 'UNIQUE_FINAL_SECTION';
  let turns = 0, written;
  const f = await fixture(t, { model: async ({ messages }) => {
    if (++turns === 1) return { content: full };
    if (turns === 2) {
      assert.ok(messages.some(message => message.role === 'assistant' && message.content === full), 'The complete draft, including its tail, remains available for file saving');
      return call('workspace_write', { path: 'reports/full.txt', content: full });
    }
    return { content: 'The full deliverable is saved to reports/full.txt, including the final requested section.' };
  }, adapters: { workspace_write: { permission: 'editCode',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', maxLength: 70000 } }, required: ['path', 'content'], additionalProperties: false },
    execute: async args => { written = args.content; return { path: args.path, revision: 'b'.repeat(64), memoryId: randomUUID(), version: 1, bytes: Buffer.byteLength(args.content) }; } } } });
  const created = await invoke(f.service.create, body({ target: 'hosted-web', message: 'Create and save the complete requested deliverable.', permissions: { editCode: true } }));
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(written, full); assert.equal(done.artifacts[0].bytes, Buffer.byteLength(full));
  assert.equal(done.output.recoveryAttempts, 1); assert.match(done.summary, /final requested section/);
});

test('persistent truncated output keeps recovering without new capabilities and finishes after provider recovery', async t => {
  let turns = 0, repaired = false;
  const f = await fixture(t, { model: async () => { turns++; return repaired ? { content: 'The complete requested answer.' } : { content: 'The unfinished public draft.', truncated: true }; } });
  const created = await invoke(f.service.create, body({ target: 'general', message: 'Explain the requested process completely.', permissions: {}, deployTargets: [] }));
  const active = await sample(f.service, created.body.task.id, RETRY_SAMPLE + 3);
  assert.ok(turns > RETRY_SAMPLE); assert.equal(active.output.status, 'incomplete'); assert.ok(active.output.recoveryAttempts > RETRY_SAMPLE);
  assert.equal(active.events.some(event => event.kind === 'task' && event.status === 'succeeded'), false);
  const raw = (await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [active.id])).rows[0].data;
  assert.equal(raw.internal.outputDraft.content, 'The unfinished public draft.');
  repaired = true; const done = await finish(f.service, active.id);
  assert.equal(done.status, 'succeeded'); assert.equal(done.output.status, 'complete');
  assert.equal(done.permissions.editCode, false); assert.equal(done.permissions.deploy, false); assert.equal(f.state.published, 0);
});

test('cancellation stops automatic output completion before another model or tool request', async t => {
  let turns = 0;
  const f = await fixture(t, { model: async () => { turns++; return { content: 'An interrupted answer.', truncated: true }; } });
  const created = await invoke(f.service.create, body({ target: 'general', message: 'Explain this completely.', permissions: {}, deployTargets: [] }));
  await f.service.runOne(created.body.task.id);
  assert.equal((await invoke(f.service.detail, {}, created.body.task.id)).body.task.status, 'working');
  await invoke(f.service.cancel, {}, created.body.task.id);
  const stopped = await finish(f.service, created.body.task.id);
  assert.equal(stopped.status, 'cancelled'); assert.equal(turns, 1); assert.equal(f.state.published, 0);
});

test('a safe main advance creates a new candidate and verifies its exact SHA before publication', async t => {
  const f = await fixture(t); const next = 'd'.repeat(40); let published = 0, rebased = 0; const checks = [];
  f.repo.publish = async candidate => {
    if (++published === 1) throw Object.assign(Error('Main advanced'), { status: 409, code: 'MAIN_MOVED' });
    assert.equal(candidate.sha, next); assert.equal(candidate.verificationRunId, 82);
    return { ...candidate, published: true };
  };
  f.repo.rebase = async (candidate, files) => {
    rebased++; assert.equal(candidate.sha, CANDIDATE); assert.equal(files.length, 1);
    return { ...candidate, sha: next, baseSha: 'e'.repeat(40), published: false };
  };
  f.repo.checks = async (candidate, { dispatch }) => {
    checks.push({ sha: candidate.sha, dispatch });
    return [{ id: candidate.sha === next ? 82 : 81, status: 'completed', conclusion: 'success', sha: candidate.sha }];
  };
  const created = await invoke(f.service.create, body()); const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(rebased, 1); assert.equal(published, 2);
  assert.equal(done.commit.sha, next); assert.equal(done.commit.published, true);
  assert.deepEqual(checks, [{ sha: CANDIDATE, dispatch: true }, { sha: CANDIDATE, dispatch: false }, { sha: next, dispatch: true }, { sha: next, dispatch: false }]);
  assert.equal(done.candidateHistory[0].sha, CANDIDATE);
});

test('an overlapping main change cannot be automatically published', async t => {
  const f = await fixture(t); let publishes = 0;
  f.repo.publish = async () => { publishes++; throw Object.assign(Error('Main advanced'), { status: 409, code: 'MAIN_MOVED' }); };
  f.repo.rebase = async () => { throw Object.assign(Error('Edited path changed'), { status: 409, publicMessage: 'Edited path changed on main; review the conflict.' }); };
  const created = await invoke(f.service.create, body()); const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'failed'); assert.equal(publishes, 1); assert.equal(done.commit.published, false);
  assert.match(done.error, /review the conflict/);
});

test('verified private candidates can accept a corrected edit under a new immutable identity', async t => {
  let turn = 0; const candidateIds = []; const shas = [CANDIDATE, 'd'.repeat(40)];
  const f = await fixture(t, { model: async () => [
    call('repo_read', { path: 'backend/office-ai-example.js' }),
    call('repo_edit', { path: 'backend/office-ai-example.js', edits: [{ find: '=1', replace: '=2' }] }),
    call('repo_commit', { message: 'First private candidate' }),
    call('repo_edit', { path: 'backend/office-ai-example.js', edits: [{ find: '=2', replace: '=3' }] }),
    { content: 'Both edits are now verified.' }, { content: 'The corrected private candidate is verified.' },
  ][turn++] || { content: 'Complete.' } });
  f.repo.candidate = async ({ taskId, files }) => {
    candidateIds.push(taskId); const sha = shas[candidateIds.length - 1];
    assert.equal(files.length, 1); return { sha, baseSha: BASE, published: false };
  };
  f.repo.checks = async candidate => [{ id: candidate.sha === CANDIDATE ? 1 : 2, status: 'completed', conclusion: 'success', sha: candidate.sha }];
  const created = await invoke(f.service.create, body({ permissions: { editCode: true } }));
  const done = await finish(f.service, created.body.task.id);
  assert.equal(done.status, 'succeeded'); assert.equal(f.state.edits, 2); assert.equal(candidateIds.length, 2);
  assert.equal(candidateIds[0], done.id); assert.notEqual(candidateIds[1], candidateIds[0]);
  assert.equal(done.candidateHistory[0].sha, CANDIDATE); assert.equal(done.commit.sha, shas[1]);
  assert.equal(done.commit.published, false); assert.equal(f.state.published, 0);
});

test('persisted immutable-candidate edit errors get a real correction rather than another continue loop', async t => {
  let turn = 0;
  const f = await fixture(t, { model: async ({ messages }) => {
    if (++turn === 1) return { content: 'The draft is ready.' };
    assert.ok(messages.some(message => message.content?.includes('SERVER REVIEW: An attempted edit is still unresolved')));
    return turn === 2 ? call('repo_edit', { path: 'office/src/PostPipeline.jsx', edits: [{ find: 'Modify', replace: 'Modifying' }] }) : { content: 'The corrected draft is verified.' };
  } });
  f.repo.edit = async ({ path }) => { f.state.edits++; return { path, sha: 'd'.repeat(40), originalSha: BASE, before: 'Modify', content: 'Modifying' }; };
  const created = await invoke(f.service.create, body({ target: 'general', permissions: { editCode: true } }));
  const raw = (await f.db.query('SELECT data FROM office_ai_tasks WHERE id=$1', [created.body.task.id])).rows[0].data;
  raw.status = 'working'; raw.commit = { sha: CANDIDATE, baseSha: BASE, published: false };
  raw.internal.baseSha = BASE; raw.internal.files = [{ path: 'backend/office-ai-example.js', sha: CANDIDATE, originalSha: BASE, before: 'const value=1;', content: 'const value=2;' }];
  raw.changedFiles = [{ path: 'backend/office-ai-example.js', status: 'committed' }];
  raw.internal.editFailures = { 'office/src/PostPipeline.jsx': 'This task already has an immutable candidate. Start a follow-up task for further code edits.' };
  await f.db.query('UPDATE office_ai_tasks SET status=$2,data=$3::jsonb WHERE id=$1', [raw.id, raw.status, JSON.stringify(raw)]);
  const done = await finish(f.service, raw.id);
  assert.equal(done.status, 'succeeded'); assert.equal(f.state.edits, 1); assert.equal(f.state.candidates, 1);
  assert.ok(done.candidateHistory.length); assert.equal(done.events.some(event => event.step === 'Checkpoint saved'), false);
  assert.deepEqual(done.changedFiles.map(file => file.path), ['backend/office-ai-example.js', 'office/src/PostPipeline.jsx']);
  assert.equal(done.permissions.publish, false); assert.equal(done.permissions.deploy, false); assert.equal(f.state.published, 0);
});

test('permanent inference connection or billing rejection fails promptly without continuation retries', async t => {
  let attempts = 0, failures = 0;
  const f = await fixture(t, { checkpoints: true, model: async () => {
    if (++attempts === 1) return call('repo_read', { path: 'backend/office-ai-example.js' });
    if (attempts === 2) return call('repo_edit', { path: 'backend/office-ai-example.js', edits: [{ find: '=1', replace: '=2' }] });
    failures++; throw Object.assign(Error('Connection rejected'), {
    status: 502, noModelFallback: true, publicMessage: 'Cloudflare rejected the request. Check its connection, credits, and model context.',
  }); } });
  const created = await invoke(f.service.create, body({ permissions: { editCode: true }, target: 'general' }));
  const task = await finish(f.service, created.body.task.id);
  assert.equal(task.status, 'failed'); assert.equal(failures, 1); assert.equal(attempts, 3); assert.equal(task.resumable, false);
  assert.match(task.error, /connection, credits, and model context/);
  assert.ok(task.backups.length >= 2); assert.equal(f.state.edits, 1); assert.equal(f.state.published, 0);
  const retained = await invoke(f.service.checkpoints, {}, task.id);
  assert.equal(retained.status, 200); assert.ok(retained.body.checkpoints.length >= 2, 'Encrypted draft history survives the permanent failure');
});

test('recovery requested between the final state read and save survives atomic persistence', async t => {
  let turn = 0, reads = 0, injected = false, recoveryRequest;
  const f = await fixture(t, { model: async () => ++turn === 1 ? call('repo_list', {}) : { content: 'The requested inspection completed.' } });
  f.repo.listFiles = async () => { reads++; return { files: [] }; };
  const created = await invoke(f.service.create, body({ message: 'Inspect the current repository.', target: 'general', permissions: {}, deployTargets: [] }));
  const id = created.body.task.id;
  const originalQuery = f.db.query;
  f.db.query = async (sql, values) => {
    if (!injected && /data=CASE WHEN status='cancel_requested'/.test(sql)) {
      injected = true;
      const response = await invoke(f.service.recover, { confirmed: true }, id);
      assert.equal(response.status, 202);
      assert.equal(response.body.task.status, 'recovery_requested');
      recoveryRequest = response.body.task.recoveryRequest;
    }
    return originalQuery(sql, values);
  };
  await f.service.runOne(id);
  assert.equal(injected, true);
  const stored = (await f.db.query('SELECT status,data,lease_id FROM office_ai_tasks WHERE id=$1', [id])).rows[0];
  assert.equal(stored.status, 'recovery_requested'); assert.equal(stored.data.status, 'recovery_requested');
  assert.deepEqual(stored.data.recoveryRequest, recoveryRequest); assert.equal(stored.lease_id, null);
  assert.equal(stored.data.internal.pendingCalls[0].name, 'repo_list'); assert.equal(reads, 0);
  assert.deepEqual(stored.data.permissions, created.body.task.permissions);
  const done = await finish(f.service, id);
  assert.equal(done.status, 'succeeded'); assert.equal(reads, 1); assert.equal(turn, 2);
});

test('inline editing and equations finish with their requested deliverable instead of requiring external changes', async t => {
  for (const [message, answer] of [
    ['Edit this sentence: The backend API is works good.', 'The backend API works well.'],
    ['Adjust the tone of this paragraph: Your website is broken and your code is bad.', 'Your website needs attention, and the code could benefit from improvements.'],
    ['Resolve the equation x + 2 = 5.', 'x = 3.'],
    ['Fix the grammar in this sentence: The pipeline have five worker.', 'The pipeline has five workers.'],
  ]) await t.test(message, async t => {
    let turns = 0;
    const f = await fixture(t, { model: async () => { turns++; return { content: answer }; } });
    const created = await invoke(f.service.create, body({ message, target: 'general', permissions: {}, deployTargets: [] }));
    const done = await finish(f.service, created.body.task.id, 3);
    assert.equal(done.status, 'succeeded'); assert.equal(turns, 1);
    assert.ok(done.summary.startsWith(answer));
    assert.equal(done.changedFiles.length, 0); assert.equal(f.state.edits, 0); assert.equal(f.state.published, 0);
  });
});

test('scheduler advances a fast task while another task is blocked and limits concurrent inference', async t => {
  let releaseSlow, enteredSlow, completedFast;
  const slowStarted = new Promise(resolve => { enteredSlow = resolve; });
  const fastCompleted = new Promise(resolve => { completedFast = resolve; });
  const blocked = new Promise(resolve => { releaseSlow = resolve; });
  let active = 0, peak = 0;
  const f = await fixture(t, { model: async ({ messages }) => {
    active++; peak = Math.max(peak, active);
    try {
      if (messages.some(message => message.content === 'Complete the slow request.')) { enteredSlow(); await blocked; }
      else completedFast();
      return { content: 'Completed.' };
    } finally { active--; }
  } });
  const slow = await invoke(f.service.create, body({ message: 'Complete the slow request.', permissions: {}, target: 'general' }));
  const fast = await invoke(f.service.create, body({ message: 'Complete the fast request.', permissions: {}, target: 'general' }));
  f.service.start();
  try {
    await Promise.race([Promise.all([slowStarted, fastCompleted]), new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(Error('The fast request was blocked behind slow inference.')), 5000); timeout.unref();
    })]);
    assert.equal(active, 1, 'The slow inference is still active after the fast task progressed'); assert.equal(peak, 2);
  } finally { releaseSlow(); }
  for (let i = 0; i < 50; i++) {
    const rows = await f.db.query('SELECT status FROM office_ai_tasks WHERE id=ANY($1::uuid[])', [[slow.body.task.id, fast.body.task.id]]);
    if (rows.rows.every(row => row.status === 'succeeded')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  f.service.stop();
  assert.equal((await invoke(f.service.detail, {}, slow.body.task.id)).body.task.status, 'succeeded');
  assert.equal((await invoke(f.service.detail, {}, fast.body.task.id)).body.task.status, 'succeeded');
});
