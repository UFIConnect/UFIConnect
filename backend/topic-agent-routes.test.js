'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const routing = require('./topic-routing-agents');
const { createAppHarness } = require('./test-support/app-harness');

const headers = { 'x-office-token': 'topic-agent-route-fixture' };
async function fixture(t, role = 'api') {
  const calls = [], state = { result: { ok: true, checked: 12, assigned: 9, resolved: 3 }, fault: null, snapshots: 0 };
  const definitions = routing.createTopicRoutingAgents({ db: { isConnected: () => false }, topics: ['Python'] }).definitions;
  const observation = { enabled: true, intervalMs: 15000, agents: definitions().map(agent => ({ ...agent,
    enabled: true, running: false, status: 'ready', topics: ['Python'], lastRun: new Date().toISOString(),
    checked: 120, assigned: 90, resolved: 30, lastChecked: 12, lastAssigned: 9, pending: 4, error: null,
  })) };
  const service = {
    definitions, currentSnapshot: () => observation,
    snapshot: async () => { state.snapshots++; if (state.fault === 'snapshot') throw new Error('private database credentials snapshot failure'); return observation; },
    runAgent: async (id, options) => {
      calls.push({ id, manual: options?.manual });
      if (state.fault === 'run') throw new Error('private database credentials run failure');
      return state.result;
    },
  };
  const app = await createAppHarness({ env: { SERVICE_ROLE: role, OFFICE_TOKEN: 'topic-agent-route-fixture' },
    modules: { './topic-routing-agents': { ...routing, createTopicRoutingAgents: () => service } } });
  t.after(() => app.close());
  return { app, state, calls };
}
const trigger = f => f.app.request('/office/agents/topic_router_1/trigger', { method: 'POST', headers, body: {} });

test('actual topic agent registry and trigger routes require Office authorization', async t => {
  const f = await fixture(t);
  assert.equal((await f.app.request('/office/agents')).status, 401);
  assert.equal((await f.app.request('/office/agents', { headers: { 'x-office-token': 'wrong' } })).status, 401);
  assert.equal((await f.app.request('/office/agents/topic_router_1/trigger', { method: 'POST', body: {} })).status, 401);
  assert.equal(f.state.snapshots, 0); assert.equal(f.calls.length, 0);
});

test('API registry exposes four observable topic agents and manual triggers invoke the owning service', async t => {
  const f = await fixture(t);
  const response = await f.app.request('/office/agents', { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const agents = Object.values(response.data.agents).filter(agent => /^topic_router_[1-4]$/.test(agent.id));
  assert.equal(agents.length, 4); assert.equal(f.state.snapshots, 1);
  for (const agent of agents) {
    assert.equal(agent.executionRole, 'api'); assert.equal(agent.serviceRole, 'api');
    assert.equal(agent.triggerable, true); assert.equal(agent.diagnosticCapability, 'runtime-metrics');
    assert.equal(agent.health.status, 'healthy'); assert.equal(agent.health.enabled, true);
    assert.equal(agent.health.totalChecked, 120); assert.equal(agent.health.totalFixed, 90);
    assert.equal(agent.health.lastChecked, 12); assert.equal(agent.health.lastFixed, 9);
    assert.equal(agent.health.pending, 4); assert.ok(Date.parse(agent.health.lastRun));
  }
  const result = await trigger(f);
  assert.equal(result.status, 200); assert.equal(result.data.triggered, 'topic_router_1');
  assert.equal(result.data.checked, 12); assert.equal(result.data.assigned, 9); assert.equal(result.data.resolved, 3);
  assert.deepEqual(f.calls, [{ id: 'topic_router_1', manual: true }]); assert.equal(f.state.snapshots, 2);
  assert.equal((await f.app.request('/office/agents/topic_router_5/trigger', { method: 'POST', headers, body: {} })).status, 404);
});

test('API topic triggers distinguish skipped work and unavailable work without exposing thrown errors', async t => {
  const f = await fixture(t);
  f.state.result = { ok: true, skipped: 'not-due-or-leased', checked: 0, assigned: 0, resolved: 0 };
  let result = await trigger(f);
  assert.equal(result.status, 202); assert.equal(result.data.skipped, 'not-due-or-leased');
  assert.equal(result.data.triggered, 'topic_router_1'); assert.equal(result.data.checked, 0);
  f.state.result = { ok: false, error: 'Topic routing could not finish; retained work will retry.', checked: 0, assigned: 0, resolved: 0 };
  result = await trigger(f);
  assert.equal(result.status, 503); assert.equal(result.data.ok, false); assert.equal(result.data.checked, 0);
  for (const fault of ['run', 'snapshot']) {
    f.state.fault = fault;
    result = await trigger(f);
    assert.equal(result.status, 503); assert.match(result.data.error, /temporarily unavailable/);
    assert.doesNotMatch(JSON.stringify(result.data), /private|credentials|database|stack/i);
  }
});

test('pipeline registry disables topic-agent triggers and rejects execution with the owning-role explanation', async t => {
  const f = await fixture(t, 'pipeline');
  const response = await f.app.request('/office/agents', { headers });
  assert.equal(response.status, 200);
  for (const id of ['topic_router_1', 'topic_router_2', 'topic_router_3', 'topic_router_4']) {
    const agent = response.data.agents[id];
    assert.equal(agent.executionRole, 'api'); assert.equal(agent.serviceRole, 'pipeline');
    assert.equal(agent.triggerable, false); assert.equal(agent.health.enabled, false);
    assert.equal(agent.health.status, 'unavailable');
  }
  const result = await trigger(f);
  assert.equal(result.status, 409); assert.match(result.data.error, /API service/); assert.equal(f.calls.length, 0);
});
