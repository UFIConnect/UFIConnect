'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SOURCE_KEYS, officeSourceReadiness, officeSourceReady } = require('./office-agent-activation');
const { sanitizeSnapshot } = require('./office-agent-chat');
const { createAppHarness } = require('./test-support/app-harness');

const headers = { 'x-office-token': 'source-setup-test' };

test('collector readiness reports only missing setting names and recovers when complete', () => {
  for (const [id, keys] of Object.entries(SOURCE_KEYS)) {
    assert.deepEqual(officeSourceReadiness(id), { configured: false, missingEnv: keys, reason: 'setup_required' });
    const env = Object.fromEntries(keys.map(key => [key, 'private-fixture-value']));
    assert.deepEqual(officeSourceReadiness(id, env), { configured: true, missingEnv: [], reason: null });
    env[keys[0]] = '  ';
    assert.deepEqual(officeSourceReadiness(id, env).missingEnv, [keys[0]]);
    assert.equal(officeSourceReady(id, env), false);
    assert.ok(!JSON.stringify(officeSourceReadiness(id, env)).includes('private-fixture-value'));
  }
  assert.deepEqual(officeSourceReadiness('hn'), { configured: true, missingEnv: [], reason: null });
  assert.equal(officeSourceReadiness('youtube').configured, true, 'YouTube public channel feeds do not require the optional search key');
  assert.equal(officeSourceReady('twitter', { TWITTER_CLIENT_ID: 'member-client', TWITTER_CLIENT_SECRET: 'member-secret' }), false);
});

test('source observation sanitization keeps setup evidence without arbitrary strings or secrets', () => {
  const snapshot = sanitizeSnapshot({ agentId: 'twitter', diagnosticCapability: 'source-worker', status: 'degraded',
    metrics: { configured: false, setupRequired: true, missingEnv: ['TWITTER_BEARER_TOKEN', 'private-provider-error', 'OFFICE_TOKEN'] } });
  assert.deepEqual(snapshot.metrics, { configured: false, setupRequired: true, missingEnv: ['TWITTER_BEARER_TOKEN'] });
});

async function fixture(t, env = {}) {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'source-setup-test', SERVICE_ROLE: 'pipeline', ...env } });
  t.after(() => app.close());
  app.refreshControl.mode = 'critical';
  app.startContinuousWorkers();
  app.startJobBoardSweeps();
  return app;
}

test('missing provider setup is degraded across Office views and never launches pulls', async t => {
  const app = await fixture(t);
  const agents = (await app.request('/office/agents', { headers })).data.agents;
  const sources = (await app.request('/office/sources', { headers })).data.sources;
  const overview = (await app.request('/office/status', { headers })).data.sources;
  const scheduler = app.getSourceCollectionScheduler();
  const registered = scheduler.status().sources;
  for (const id of Object.keys(SOURCE_KEYS)) {
    assert.equal(agents[id].observation.status, 'degraded', id);
    assert.equal(agents[id].health.setupRequired, true, id);
    assert.equal(agents[id].health.configured, false, id);
    const sourceRow = sources.find(source => source.id === id);
    assert.equal(sourceRow.status, 'degraded', id);
    assert.equal(sourceRow.setupRequired, true, id);
    assert.equal(sourceRow.configured, false, id);
    assert.deepEqual(sourceRow.missingEnv, SOURCE_KEYS[id], id);
    assert.equal(sourceRow.collection.setupRequired, true, id);
    const row = overview.workers.find(source => source.id === id);
    assert.equal(row.status, 'degraded', id);
    assert.equal(row.setupRequired, true, id);
    assert.equal(row.fetchCount, 0, id);
    assert.equal(row.totalErrors, 0, 'Missing setup is not a fabricated provider error');
    assert.equal(registered.find(source => source.id === id).enabled, false, id);
    const request = await scheduler.request(id);
    assert.equal(request.deferred, true, id);
    assert.equal(request.reason, 'setup_required', id);
    assert.equal(app.sourceCollectionState(id).reason, 'setup_required', id);
  }
  assert.equal(scheduler.status().active, 0);
  assert.ok(overview.degraded >= Object.keys(SOURCE_KEYS).length);
});

test('configured collectors retain intentional policy disables separately from missing setup', async t => {
  const app = await fixture(t, { TWITTER_BEARER_TOKEN: 'private-fixture', SOURCE_TWITTER_ENABLED: 'false', LINKEDIN_TOKEN: 'private-fixture' });
  const agents = (await app.request('/office/agents', { headers })).data.agents;
  for (const id of ['twitter', 'linkedin']) {
    assert.equal(agents[id].observation.status, 'disabled', id);
    assert.equal(agents[id].health.configured, true, id);
    assert.equal(agents[id].health.setupRequired, false, id);
  }
  assert.equal(agents.hn.health.setupRequired, false);
  assert.ok(!JSON.stringify(agents).includes('private-fixture'));
});

test('the complete configured source inventory schedules pulls within twenty seconds including both job sweeps', async t => {
  const env = Object.fromEntries(Object.values(SOURCE_KEYS).flat().map(key => [key, 'private-fixture']));
  const app = await fixture(t, env);
  const status = app.getSourceCollectionScheduler().status();
  const sources = (await app.request('/office/sources', { headers })).data.sources;
  assert.equal(status.total, 44, 'Every configured worker registers with the shared collector');
  assert.equal(sources.length, 44);
  assert.equal(status.enabled, 43, 'LinkedIn remains intentionally disabled even with its token');
  for (const source of status.sources) {
    assert.ok(source.intervalMs > 0 && source.intervalMs <= 20000, `${source.id}: ${source.intervalMs}ms`);
    const reported = sources.find(row => row.id === source.id);
    assert.equal(reported.collectionIntervalMs, source.intervalMs, source.id);
    assert.equal(reported.configured, true, source.id);
    assert.equal(reported.setupRequired, false, source.id);
    assert.deepEqual(reported.missingEnv, [], source.id);
  }
  for (const id of ['remotive', 'muse']) {
    const source = status.sources.find(row => row.id === id);
    assert.equal(source.enabled, true, id);
    assert.equal(source.intervalMs, 20000, id);
  }
});
