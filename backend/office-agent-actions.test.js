'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agentActions, requestedActions } = require('./office-agent-actions');
const { buildOfficeControlCatalog } = require('./office-controls');
const { createAppHarness } = require('./test-support/app-harness');
const catalog = buildOfficeControlCatalog([{ id: 'reddit', label: 'Reddit' }]);
const snapshot = (agentId, diagnosticCapability = 'runtime-metrics') => ({ agentId, diagnosticCapability, serviceRole: 'api' });
test('tasks preserve canonical service ownership and confirmation requirements', () => {
  const source = agentActions(snapshot('reddit', 'source-worker'), catalog);
  assert.equal(source[0].id, 'source.refresh.reddit'); assert.equal(source[0].target, 'pipeline');
  assert.deepEqual(agentActions(snapshot('instagram', 'on-demand'), catalog).map(action => action.id), ['commit.web-frontend']);
  assert.deepEqual(agentActions(snapshot('constructor'), catalog), []);
  assert.equal(agentActions(snapshot('web_storage'), catalog)[0].target, 'pipeline');
  assert.equal(agentActions(snapshot('topic_fix'), catalog)[0].requiresConfirmation, true);
  assert.equal(agentActions(snapshot('deploy'), catalog).find(action => action.id === 'deploy.web').requiresConfirmation, true);
  const disabled = catalog.map(control => control.id === 'deploy.web' ? { ...control, available: false, unavailableReason: 'Needs setup.' } : control);
  assert.equal(agentActions(snapshot('deploy'), disabled).find(action => action.id === 'deploy.web').available, false);
  const web = agentActions(snapshot('security'), catalog).find(action => action.id === 'commit.web-frontend');
  assert.equal(web.target, 'api'); assert.equal(web.frontendTarget, 'web'); assert.equal(web.requiresConfirmation, true);
  assert.equal(agentActions(snapshot('security'), catalog).filter(action => action.id === web.id).length, 1, 'Repeated catalog reads cannot mutate task definitions');
});
test('typed tasks select only actions exposed by the selected agent', () => {
  const source = agentActions(snapshot('reddit', 'source-worker'), catalog);
  assert.deepEqual(requestedActions('Please refresh this source', source).map(action => action.id), ['source.refresh.reddit']);
  assert.deepEqual(requestedActions('Could you inspect the queue?', source).map(action => action.id), ['runtime.inspect-queues']);
  assert.equal(requestedActions('Why is the source slow?', source), null);
  assert.deepEqual(requestedActions('deploy web', source), []);
  assert.deepEqual(requestedActions('Run an arbitrary shell command', source), []);
  assert.deepEqual(requestedActions('enable autofix', agentActions(snapshot('autofix'), catalog)).map(action => action.id), ['automation.enable']);
  assert.deepEqual(requestedActions('Deploy the website', agentActions(snapshot('deploy'), catalog)).map(action => action.id), ['deploy.web']);
  assert.deepEqual(requestedActions('Update the homepage heading', source).map(action => action.id), ['commit.web-frontend']);
});
test('agent task routes require Office access, propose tasks without executing, and use audited controls', async t => {
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: 'office-actions-test', OFFICE_GITHUB_TOKEN: 'fixture-only', OPENAI_API_KEY: '' } });t.after(() => app.close());
  const headers = { 'x-office-token': 'office-actions-test' };
  assert.equal((await app.request('/office/agents/security/actions')).status, 401);
  assert.equal((await app.request('/office/agents/not_real/actions', { headers })).status, 404);
  const actions = await app.request('/office/agents/security/actions', { headers });
  assert.equal(actions.status, 200); assert.equal(actions.headers.get('cache-control'), 'no-store');
  assert.ok(actions.data.actions.some(action => action.id === 'health.security'));
  const count = app.queries.length;
  const proposed = await app.request('/office/agents/security/chat', { method: 'POST', headers, body: { message: 'Run the security check' } });
  assert.equal(proposed.status, 200); assert.equal(proposed.data.mode, 'diagnostics');
  assert.deepEqual(proposed.data.actions.map(action => action.id), ['health.security']);
  assert.match(proposed.data.reply, /No command was executed/); assert.equal(app.queries.length, count);
  const executed = await app.request('/office/controls/health.community/execute', { method: 'POST', headers, body: { contextId: 'agent-chat:api:community', contextLabel: 'Community task' } });
  assert.equal(executed.status, 200); assert.equal(executed.data.ok, true); assert.ok(executed.data.runId);
  assert.equal(typeof executed.data.result.groups, 'number');
  assert.ok(app.queries.some(query => /INSERT INTO office_control_runs/.test(query.sql)));
  assert.equal((await app.request('/office/controls/source.refresh.reddit/execute', { method: 'POST', headers, body: {} })).status, 409);
  assert.equal((await app.request('/office/controls/feed.apply-topic-fixes/execute', { method: 'POST', headers, body: {} })).status, 400);
  for (const content of ['OPENAI_API_KEY = "private-value"', '-----BEGIN PRIVATE KEY-----', 'sk-' + 'x'.repeat(24)]) {
    const blocked = await app.request('/office/controls/commit.web-frontend/execute', { method: 'POST', headers, body: { confirmed: true,
      filePath: 'web/index.html', content, expectedSha: 'a'.repeat(40), commitMessage: 'Fixture public web edit' } });
    assert.equal(blocked.status, 502); assert.match(blocked.data.error, /Potential server secret assignment/);
  }
});
