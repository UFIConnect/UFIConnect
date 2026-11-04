'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceRateMetadata, sanitizeSourceRateMetadata } = require('./source-rate-metadata');
const { DEFAULT_POLICY } = require('./feed-audit');
const { createAppHarness, member } = require('./test-support/app-harness');

const headers = { 'x-office-token': 'source-rate-test' };

test('source rate metadata keeps ceiling, scheduler interval and query coverage distinct', () => {
  const policy = { sourcePullLimits: { hackernews: { windowSeconds: 40, maxPulls: 2 } } };
  assert.deepEqual(sourceRateMetadata('hn', policy, { intervalMs: 300000, expectedCycleMs: 900000 }), {
    pullLimit: { windowSeconds: 40, maxPulls: 2, minSpacingMs: 20000 }, pullLimitLabel: '2 pulls / 40s',
    collectionIntervalMs: 300000, cycleMinutes: 15,
  });
  const unknown = sourceRateMetadata('github');
  assert.equal(unknown.pullLimitLabel, '1 pull / 20s');
  assert.equal(unknown.collectionIntervalMs, null); assert.equal(unknown.cycleMinutes, null);
  assert.deepEqual(sanitizeSourceRateMetadata({ pullLimit: { windowSeconds: 30, maxPulls: 12, minSpacingMs: 1 } }), {});
  const safe = sanitizeSourceRateMetadata({ ...unknown, pullLimitLabel: 'secret arbitrary text', collectionIntervalMs: Infinity });
  assert.equal(safe.pullLimitLabel, '1 pull / 20s'); assert.equal(safe.collectionIntervalMs, null);
});

async function fixture(t, role = 'api') {
  let settings = structuredClone({ ...DEFAULT_POLICY, maxPerSourcePerMinute: 10000, duplicateWindowSeconds: 150, targetApprovalPct: 100 });
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: 'source-rate-test', SERVICE_ROLE: role },
    query: async (sql, params = []) => {
      if (sql.startsWith('SELECT settings')) return { rows: [{ settings: structuredClone(settings) }], rowCount: 1 };
      if (sql.startsWith('UPDATE office_feed_policy')) {
        const patch = JSON.parse(params[0]);
        settings = { ...settings, ...patch, sourcePullLimits: { ...settings.sourcePullLimits, ...patch.sourcePullLimits } };
      }
      return { rows: [], rowCount: 0 };
    } });
  t.after(() => app.close());
  await app.feedAudit.initialize();
  app.seedUser(member('source-rate-reader'));
  return app;
}

test('all source metadata endpoints reflect saved limits without a restart or fabricated scheduler measurements', async t => {
  const app = await fixture(t);
  const read = async path => {
    const response = await app.request(path, { headers, userId: path === '/feed/sources' ? 'source-rate-reader' : undefined });
    assert.equal(response.status, 200, path + ': ' + JSON.stringify(response.data));
    return response.data;
  };
  let agents = await read('/office/agents');
  assert.equal(agents.agents.bluesky.interval, '12 pulls / 30s');
  assert.equal(agents.agents.medium.interval, '14 pulls / 90s');
  assert.equal(agents.agents.github.interval, '1 pull / 20s');
  for (const id of ['remotive', 'muse', 'crossref', 'datacite', 'zenodo', 'openalex']) {
    assert.ok(agents.agents[id].pullLimit, id + ' is part of the common source metadata');
    assert.equal(agents.agents[id].observation.collectionIntervalMs, null);
    assert.equal(agents.agents[id].observation.status, 'unavailable');
  }
  const beforePolicy = app.feedAudit.policy();
  await app.feedAudit.configure({ sourcePullLimits: { bluesky: { windowSeconds: 60, maxPulls: 6 }, hn: { windowSeconds: 40, maxPulls: 2 } } });
  agents = await read('/office/agents');
  const overview = await read('/office/status');
  const officeSources = await read('/office/sources');
  const feedSources = await read('/feed/sources');
  const audit = await read('/office/feed-audit');
  const rows = [agents.agents.bluesky, agents.agents.bluesky.observation,
    overview.sources.workers.find(row => row.id === 'bluesky'), officeSources.sources.find(row => row.id === 'bluesky'),
    feedSources.sourceCatalog.find(row => row.id === 'bluesky'), audit.sources.find(row => row.id === 'bluesky')];
  for (const row of rows) {
    assert.deepEqual(row.pullLimit, { windowSeconds: 60, maxPulls: 6, minSpacingMs: 10000 });
    assert.equal(row.pullLimitLabel, '6 pulls / 60s');
    assert.equal(row.collectionIntervalMs, null); assert.equal(row.cycleMinutes, null);
  }
  assert.equal(agents.agents.hn.pullLimitLabel, '2 pulls / 40s');
  assert.equal(overview.sources.workers.find(row => row.id === 'hackernews').workerId, 'hn');
  assert.equal(feedSources.sourceCatalog.find(row => row.id === 'hackernews').pullLimitLabel, '2 pulls / 40s');
  assert.equal(officeSources.configuredSourceCount, 44); assert.equal(officeSources.sources.length, 44);
  assert.equal(overview.sources.workers.length, 44);
  assert.equal(feedSources.configuredSourceCount, 43); assert.equal(feedSources.sourceCatalog.length, 43);
  assert.equal(feedSources.totalSources, 0, 'Cached source counts stay separate from configured inventory');
  assert.ok(!feedSources.sourceCatalog.some(row => row.id === 'linkedin'));
  assert.ok(officeSources.sources.every(row => row.status === 'unavailable'));
  for (const key of ['maxPerSourcePerMinute', 'maxPerAuthorPerMinute', 'duplicateWindowSeconds', 'targetApprovalPct']) {
    assert.equal(app.feedAudit.policy()[key], beforePolicy[key], key + ' is unchanged');
  }
});

test('pipeline observations report actual intervals separately and mark missing source setup degraded', async t => {
  const app = await fixture(t, 'pipeline');
  app.refreshControl.mode = 'critical';
  app.startContinuousWorkers(); app.startJobBoardSweeps();
  const response = await app.request('/office/agents', { headers });
  assert.equal(response.status, 200);
  const agents = response.data.agents;
  const scheduled = app.getSourceCollectionScheduler().status().sources.find(source => source.id === 'github');
  assert.equal(agents.github.pullLimit.minSpacingMs, 20000);
  assert.equal(agents.github.collectionIntervalMs, scheduled.intervalMs);
  assert.equal(agents.github.cycleMinutes, Math.round(scheduled.expectedCycleMs / 6000) / 10);
  assert.equal(agents.github.observation.collectionIntervalMs, scheduled.intervalMs);
  assert.equal(agents.linkedin.observation.status, 'degraded');
  assert.equal(app.SOURCE_CONFIG.bluesky.minSpacingMs, 2500);
  assert.equal(app.SOURCE_CONFIG.medium.minSpacingMs, 6429);
  assert.equal(app.SOURCE_CONFIG.github.minSpacingMs, 20000);
  assert.equal(app.getSourceCollectionScheduler().status().active, 0);
  const reply = await app.request('/office/agents/github/chat', { method: 'POST', headers, body: { message: 'How often do you refresh?' } });
  assert.equal(reply.status, 200);
  assert.match(reply.data.reply, /Pull limit: 1 pull \/ 20s/);
  assert.ok(reply.data.reply.includes(`Scheduled interval: ${scheduled.intervalMs / 1000}s`));
});
