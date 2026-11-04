'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { officeSourceReady, planOfficeActivation, activateOfficeAgents } = require('./office-agent-activation');
const { createAppHarness } = require('./test-support/app-harness');
const headers = { 'x-office-token': 'activation-test' };
test('activation permits missing-credential checks while respecting ownership, visibility and cooldowns', () => {
  assert.equal(officeSourceReady('reddit', {}), false);
  assert.equal(officeSourceReady('reddit', { REDDIT_CLIENT_ID: 'fixture', REDDIT_CLIENT_SECRET: 'fixture' }), true);
  assert.equal(officeSourceReady('twitter', { TWITTER_CLIENT_ID: 'fixture', TWITTER_CLIENT_SECRET: 'fixture' }), false);
  assert.equal(officeSourceReady('usajobs', { USAJOBS_API_KEY: 'fixture', USAJOBS_EMAIL: 'fixture' }), false);
  assert.equal(officeSourceReady('usajobs', { USAJOBS_API_KEY: 'fixture', USAJOBS_USER_AGENT: 'fixture' }), true);
  const agents = { reddit: { executionRole: 'pipeline', health: { paused: true, pauseUntil: 200 } },
    twitch: { executionRole: 'pipeline' }, linkedin: { executionRole: 'pipeline' }, hn: { executionRole: 'pipeline' },
    devto: { executionRole: 'pipeline', health: { status: 'healthy', lastSuccess: 90 } },
    community: { executionRole: 'both', health: { status: 'unknown' } },
    security: { executionRole: 'both', health: { status: 'healthy' } },
    ai: { executionRole: 'api' }, autofix: { executionRole: 'both' }, instagram: { executionRole: 'on-demand' } };
  const options = { agents, sourceIds: ['reddit', 'twitch', 'hn', 'devto', 'linkedin'], now: 100, sourceEnabled: id => id !== 'linkedin' };
  const pipeline = Object.fromEntries(planOfficeActivation({ ...options, role: 'pipeline' }).map(item => [item.id, item]));
  assert.equal(pipeline.reddit.status, 'skipped'); assert.match(pipeline.reddit.reason, /cooldown/);
  assert.equal(pipeline.twitch.status, 'queue');
  assert.equal(pipeline.linkedin.status, 'skipped'); assert.match(pipeline.linkedin.reason, /member-only/);
  assert.equal(pipeline.hn.status, 'queue'); assert.equal(pipeline.community.status, 'check');
  assert.equal(pipeline.devto.status, 'checked'); assert.match(pipeline.devto.reason, /no extra refresh/);
  assert.equal(pipeline.security.status, 'checked'); assert.equal(pipeline.autofix.status, 'skipped');
  assert.equal(pipeline.ai.status, 'skipped'); assert.equal(pipeline.instagram.status, 'skipped');
  const api = planOfficeActivation({ ...options, role: 'api' });
  assert.equal(api.filter(item => item.status === 'queue').length, 0);
  assert.equal(planOfficeActivation({ ...options, role: 'pipeline', critical: true }).find(item => item.id === 'hn').status, 'skipped');
});
test('activation reports queued, completed, deferred and failed checks without leaking errors', async () => {
  const plan = [ { id: 'ok', status: 'check' }, { id: 'bad', status: 'check' }, { id: 'waiting', status: 'check' },
    { id: 'no_task', status: 'check' }, { id: 'source1', status: 'queue' }, { id: 'source2', status: 'queue' } ];
  const result = await activateOfficeAgents({ role: 'pipeline', plan,
    checks: { ok: () => true, bad: () => { throw Error('private-provider-secret'); }, waiting: () => ({ skipped: true }) },
    enqueue: ids => { assert.deepEqual(ids, ['source1', 'source2']); return ['source1']; } });
  assert.equal(result.checked, 1); assert.equal(result.failed, 1); assert.equal(result.queued, 1); assert.equal(result.skipped, 3);
  assert.equal(JSON.stringify(result).includes('private-provider-secret'), false);
  assert.match(result.items.find(item => item.id === 'source1').reason, /queued/);
  assert.match(result.items.find(item => item.id === 'source2').reason, /already queued/);
});
test('Office activation is authenticated and audited; new source workers and AI agent are registered', async t => {
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: 'activation-test', OPENAI_API_KEY: '' } });
  t.after(() => app.close());
  assert.equal((await app.request('/office/controls/agents.activate-configured/execute', { method: 'POST', body: {} })).status, 401);
  const registry = await app.request('/office/agents', { headers });
  for (const id of ['twitch', 'cntraveler', 'weworkremotely', 'ai']) assert.ok(registry.data.agents[id]);
  assert.equal(registry.data.agents.ai.observation.status, 'ready');
  assert.equal(registry.data.agents.security.observation.status, 'healthy', 'actual startup check recorded');
  const activated = await app.request('/office/controls/agents.activate-configured/execute', { method: 'POST', headers, body: {} });
  assert.equal(activated.status, 200); assert.equal(activated.data.ok, true); assert.ok(activated.data.runId);
  assert.equal(activated.data.result.role, 'api'); assert.equal(activated.data.result.queued, 0);
  assert.ok(app.queries.some(query => /INSERT INTO office_control_runs/.test(query.sql)));
  const observed = await app.request('/office/agents/community/actions', { headers });
  assert.equal(observed.status, 200);
  const after = await app.request('/office/agents', { headers });
  assert.equal(after.data.agents.community.observation.status, 'healthy');
  assert.equal(after.data.agents.reddit.observation.status, 'unavailable', 'API never claims Pipeline source work');
});
