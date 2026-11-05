'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeAITasks } = require('./office-ai-tasks');
const { applyRepositoryEdit, blobSha, rangeOf } = require('./office-ai-repository');

const HEAD = 'a'.repeat(40), CANDIDATE = 'b'.repeat(40);
const SOURCE_PATH = 'backend/example.js';
const BEFORE = 'const timeout = 30;\nmodule.exports = { timeout };\n';
const AFTER = BEFORE.replace('timeout = 30', 'timeout = 90');
const input = extra => ({ clientRequestId: randomUUID(), target: 'full-access', memory: false,
  message: 'Adjust backend/example.js to use a 90-second timeout and check service health.',
  permissions: { editCode: true, operate: true }, ...extra });
const tool = (name, args = {}) => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const completion = (...calls) => ({ content: null, tool_calls: calls });
const read = () => tool('repo_read', { path: SOURCE_PATH });
const edit = () => tool('repo_edit', { path: SOURCE_PATH, edits: [{ find: 'timeout = 30', replace: 'timeout = 90' }] });

async function invoke(handler, body = {}, id) {
  assert.equal(typeof handler, 'function', 'The requested task handler must be available');
  const res = { code: 200, set() { return this; }, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
  await handler({ body, params: { id } }, res);
  return res;
}

async function fixture(t, { model = async () => ({ content: 'Recorded inspection complete.' }), ...options } = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  const query = (sql, params) => pg.query(sql, params);
  const db = { query, isConnected: () => true, withClient: fn => fn({ query }) };
  const source = { path: SOURCE_PATH, sha: blobSha(BEFORE), content: BEFORE, mode: '100644' };
  const state = { reads: 0, edits: 0, candidates: [], checks: 0, operations: [], published: 0 };
  let clock = Date.parse('2026-11-05T20:00:00Z');
  const repository = { repository: 'fixture/office', configured: () => true, redact: String,
    head: async () => ({ sha: HEAD }),
    readFile: async args => { assert.equal(args.path, SOURCE_PATH); assert.equal(args.ref, HEAD); state.reads++; return rangeOf(source); },
    edit: async ({ ref, ...args }, staged) => { assert.equal(ref, HEAD); state.edits++; return applyRepositoryEdit(staged || source, args); },
    candidate: async args => { state.candidates.push(structuredClone(args)); return { sha: CANDIDATE, baseSha: HEAD, published: false }; },
    checks: async candidate => { state.checks++; return [{ id: 123, status: 'completed', conclusion: 'success', sha: candidate.sha }]; },
    publish: async () => { state.published++; assert.fail('These tests never approve publication'); },
  };
  const service = createOfficeAITasks({ db, repository, env: {}, now: () => clock, model,
    getControls: () => [{ id: 'health.check', label: 'Check service health', target: 'api', available: true, requiresConfirmation: false }],
    executeControl: async (id, args) => {
      assert.equal(id, 'health.check');
      state.operations.push({ id, args });
      return { results: [{ service: 'api', runId: 'health-receipt-123', ok: true }] };
    }, ...options });
  t.after(() => service.stop());
  const raw = async id => (await query('SELECT data FROM office_ai_tasks WHERE id=$1', [id])).rows[0].data;
  const store = async task => query('UPDATE office_ai_tasks SET data=$2::jsonb,status=$3 WHERE id=$1', [task.id, JSON.stringify(task), task.status]);
  return { service, state, db, raw, store, advance: milliseconds => { clock += milliseconds; }, now: () => clock };
}

async function untilStopped(service, id, steps = 50) {
  for (let step = 0; step < steps; step++) {
    await service.runOne(id);
    const result = await invoke(service.detail, {}, id);
    if (['succeeded', 'failed', 'cancelled', 'needs_confirmation', 'needs_continuation'].includes(result.body.task.status)) return result.body.task;
  }
  assert.fail('The task did not reach a recorded result or review checkpoint');
}

test('a natural adjustment request cannot finish with promises before or after inspection', async t => {
  const { isExecutionRequest } = await import('../office/src/office-ai-intent.mjs');
  const message = 'Could you adjust backend/example.js to a 90-second timeout and check service health?';
  assert.equal(isExecutionRequest(message), true);
  let turn = 0, reviewed = 0;
  const f = await fixture(t, { model: async ({ messages }) => {
    turn++;
    if (turn === 1) return { content: 'I can help manage the timeout and check it for you.' };
    if (turn === 2) {
      assert.ok(messages.some(item => item.role === 'user' && /SERVER REVIEW/.test(item.content || '')));
      reviewed++;
      return completion(read());
    }
    if (turn === 3) return { content: 'I inspected the file and will adjust the timeout next.' };
    if (turn === 4) {
      assert.ok(messages.filter(item => /SERVER REVIEW/.test(item.content || '')).length >= 2);
      reviewed++;
      return completion(edit());
    }
    if (turn === 5) return completion(tool('office_command', { id: 'health.check' }));
    return { content: 'The timeout is 90 seconds and service health passed. The checked changes are ready for review.' };
  } });
  const created = await invoke(f.service.create, input({ message }));
  assert.equal(created.code, 202);
  const id = created.body.task.id;
  await f.service.runOne(id);
  assert.notEqual((await f.raw(id)).status, 'succeeded');
  assert.equal(f.state.reads, 0);
  await f.service.runOne(id);
  await f.service.runOne(id);
  await f.service.runOne(id);
  assert.notEqual((await f.raw(id)).status, 'succeeded', 'Inspection followed by another promise still leaves the change unfinished');
  assert.equal(f.state.reads, 1);
  assert.equal(f.state.edits, 0);
  const finished = await untilStopped(f.service, id);
  assert.equal(finished.status, 'succeeded');
  assert.equal(reviewed, 2);
  assert.equal(f.state.edits, 1);
  assert.equal(f.state.operations.length, 1);
  assert.equal(f.state.candidates.length, 1);
  assert.equal(f.state.candidates[0].files[0].content, AFTER);
  assert.equal(finished.changedFiles[0].before, BEFORE);
  assert.equal(finished.changedFiles[0].after, AFTER);
  assert.equal(finished.commands[0].results[0].runId, 'health-receipt-123');
  assert.equal(finished.checks[0].sha, CANDIDATE);
  assert.equal(finished.checks[0].conclusion, 'success');
  assert.equal(finished.commit.published, false);
  assert.equal(f.state.published, 0);
  assert.deepEqual(finished.permissions, { editCode: true, operate: true, publish: false, deploy: false });
});

test('an actual inspection can finish a management request when it establishes that no change is needed', async t => {
  let turn = 0;
  const f = await fixture(t, { model: async () => ++turn === 1 ? completion(read())
    : { content: 'No changes are needed: the existing timeout already matches the requested configuration.' } });
  const created = await invoke(f.service.create, input({ message: 'Manage the timeout configuration and change it only if necessary.' }));
  const finished = await untilStopped(f.service, created.body.task.id);
  assert.equal(finished.status, 'succeeded');
  assert.equal(f.state.reads, 1);
  assert.equal(f.state.edits, 0);
  assert.equal(f.state.candidates.length, 0);
});

test('natural work wording never grants editing or Office command permissions', async t => {
  const f = await fixture(t, { model: async ({ tools }) => {
    const names = tools.map(item => item.function.name);
    assert.equal(names.includes('repo_edit'), false);
    assert.equal(names.includes('office_command'), false);
    return completion(edit(), tool('office_command', { id: 'health.check' }));
  } });
  const created = await invoke(f.service.create, input({ permissions: {} }));
  assert.equal(created.code, 202);
  await f.service.runOne(created.body.task.id);
  await f.service.runOne(created.body.task.id);
  const saved = await f.raw(created.body.task.id);
  assert.deepEqual(saved.permissions, { editCode: false, operate: false, publish: false, deploy: false });
  assert.equal(f.state.edits, 0);
  assert.equal(f.state.operations.length, 0);
  assert.equal(f.state.candidates.length, 0);
  assert.notEqual(saved.status, 'succeeded');
});

test('the project lock prevents competing modifications, permits reads and releases after cancellation', async t => {
  const f = await fixture(t);
  const first = await invoke(f.service.create, input());
  assert.equal(first.code, 202);
  const competing = await invoke(f.service.create, input({ message: 'Refactor the same project files.' }));
  assert.equal(competing.code, 409);
  assert.match(competing.body.error, /lock|active|task/i);
  const observation = await invoke(f.service.create, input({ message: 'Inspect the repository configuration.', permissions: {} }));
  assert.equal(observation.code, 202, 'A project change lock does not prevent read-only tasks');
  const stopped = await invoke(f.service.cancel, {}, first.body.task.id);
  assert.equal(stopped.body.task.status, 'cancel_requested');
  await f.service.runOne(first.body.task.id);
  assert.equal((await f.raw(first.body.task.id)).status, 'cancelled');
  const next = await invoke(f.service.create, input({ message: 'Configure the project after the earlier task stopped.' }));
  assert.equal(next.code, 202);
});

test('expired-lease recovery retains staged work and does not replay an uncertain external operation', async t => {
  const f = await fixture(t, { model: async () => completion(read(), edit()) });
  const created = await invoke(f.service.create, input());
  const id = created.body.task.id;
  await f.service.runOne(id);
  await f.service.runOne(id);
  await f.service.runOne(id);
  const saved = await f.raw(id);
  assert.equal(saved.internal.files[0].content, AFTER);
  const invocationId = randomUUID();
  saved.internal.pendingCalls = [{ id: randomUUID(), name: 'office_command', args: { id: 'health.check' }, invocationId, started: true }];
  saved.commands = [{ id: 'health.check', invocationId: randomUUID(), results: [{ service: 'api', runId: 'earlier-confirmed-health', ok: true }] }];
  await f.store(saved);
  await f.db.query('UPDATE office_ai_tasks SET lease_id=$2,lease_until=$3,next_run_at=$4 WHERE id=$1',
    [id, randomUUID(), new Date(f.now() - 1000).toISOString(), new Date(f.now() + 3600000).toISOString()]);
  const recovered = await invoke(f.service.recover, { confirmed: true }, id);
  assert.ok([200, 202].includes(recovered.code));
  assert.equal(recovered.body.task.status, 'recovery_requested');
  assert.equal(await f.service.runOne(id), true, 'An expired lease permits the saved recovery checkpoint to resume');
  const retained = await f.raw(id);
  assert.equal(retained.status, 'working');
  assert.equal(retained.internal.files[0].content, AFTER);
  assert.equal(retained.internal.pendingCalls[0].invocationId, invocationId);
  assert.equal(retained.internal.pendingCalls[0].started, true);
  assert.deepEqual(retained.permissions, saved.permissions);
  assert.equal(retained.commands[0].results[0].runId, 'earlier-confirmed-health');
  const lease = (await f.db.query('SELECT lease_id,lease_until,next_run_at FROM office_ai_tasks WHERE id=$1', [id])).rows[0];
  assert.equal(lease.lease_id, null);
  assert.equal(lease.lease_until, null);
  assert.ok(new Date(lease.next_run_at).getTime() <= f.now());
  await f.service.runOne(id);
  const review = await f.raw(id);
  assert.equal(review.status, 'needs_confirmation');
  assert.equal(review.confirmation.uncertain, true);
  assert.equal(review.internal.files[0].content, AFTER);
  assert.equal(f.state.operations.length, 0, 'Recovery cannot blindly repeat the interrupted external command');
  assert.equal((await invoke(f.service.confirm, { confirmed: true, confirmationId: review.confirmation.id }, id)).code, 409);
});

test('recovery of a live lease requests cooperative handoff and cannot widen permissions', async t => {
  const f = await fixture(t);
  const created = await invoke(f.service.create, input());
  const id = created.body.task.id, leaseId = randomUUID();
  const leaseUntil = new Date(f.now() + 120000).toISOString();
  await f.db.query('UPDATE office_ai_tasks SET lease_id=$2,lease_until=$3 WHERE id=$1', [id, leaseId, leaseUntil]);
  assert.equal((await invoke(f.service.recover, { confirmed: true, permissions: { publish: true } }, id)).code, 400);
  assert.equal((await invoke(f.service.recover, { confirmed: false }, id)).code, 400);
  const recovered = await invoke(f.service.recover, { confirmed: true }, id);
  assert.equal(recovered.code, 202);
  assert.equal(recovered.body.task.status, 'recovery_requested');
  const current = (await f.db.query('SELECT lease_id,lease_until,data FROM office_ai_tasks WHERE id=$1', [id])).rows[0];
  assert.equal(current.lease_id, leaseId);
  assert.equal(new Date(current.lease_until).toISOString(), leaseUntil);
  assert.deepEqual(current.data.permissions, created.body.task.permissions);
  assert.equal(await f.service.runOne(id), false, 'A replacement executor cannot overlap the current live lease');
});
