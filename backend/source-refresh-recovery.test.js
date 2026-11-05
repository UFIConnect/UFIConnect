const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAppHarness } = require('./test-support/app-harness');

test('a completed setup check leaves the manual queue without claiming successful refresh throughput', async () => {
  const app = await createAppHarness({ env: { SERVICE_ROLE: 'pipeline' } });
  try {
    app.SOURCE_FETCHERS.setup_fixture = async () => ({ skipped: 'setup_required', deferred: false });
    app.sourceRefreshQueue.pendingIds.add('setup_fixture');
    app.sourceRefreshQueue.batchTotal = 1;
    await app.drainSourceRefreshQueue();
    assert.equal(app.sourceRefreshQueue.pendingIds.size, 0);
    assert.equal(app.sourceRefreshQueue.batchDone, 1);
    assert.equal(app.sourceRefreshQueue.recentCompletions.length, 0);
  } finally { await app.close(); }
});

test('critical pressure retains and deduplicates requested sources without inflating completion', async () => {
  const app = await createAppHarness({ env: { SERVICE_ROLE: 'pipeline' } });
  try {
    let calls = 0;
    app.SOURCE_FETCHERS.recovery_fixture = async () => { calls++; };
    app.refreshControl.mode = 'critical';
    app.enqueueSourceRefresh(['recovery_fixture', 'recovery_fixture']);
    app.enqueueSourceRefresh(['recovery_fixture']);
    await app.drainSourceRefreshQueue();
    assert.equal(calls, 0);
    assert.equal(app.sourceRefreshQueue.pendingIds.size, 1);
    assert.equal(app.sourceRefreshQueue.batchTotal, 1);
    assert.equal(app.sourceRefreshQueue.batchDone, 0);
    assert.equal(app.refreshControl.skippedFetches, 0);
    app.setSourceRefreshWait(async () => {});
    app.refreshControl.mode = 'pressure';
    await app.drainSourceRefreshQueue();
    assert.equal(calls, 1);
    assert.equal(app.sourceRefreshQueue.pendingIds.size, 0);
    assert.equal(app.sourceRefreshQueue.batchDone, 1);
    assert.equal(app.sourceRefreshQueue.recentCompletions.length, 1);
  } finally { await app.close(); }
});

test('manual collection runs one bounded query and reports protection before attempting another', async () => {
  const app = await createAppHarness({ env: { SERVICE_ROLE: 'pipeline', PRESSURE_MANUAL_TOPIC_LIMIT: '2' } });
  try {
    app.setSourceRefreshWait(async () => {});
    const topics = [];
    app.makeTopicCycler('cursor_fixture', '', '', async topic => {
      topics.push(topic);
      if (topics.length === 1) app.refreshControl.mode = 'critical';
      return [];
    }, topic => topic);
    const interrupted = await app.SOURCE_FETCHERS.cursor_fixture();
    assert.equal(interrupted.deferred, false, 'A provider request that finished was actually checked');
    assert.equal(interrupted.scannedTopics, 1);
    const protectedRequest = await app.SOURCE_FETCHERS.cursor_fixture();
    assert.equal(protectedRequest.deferred, true);
    assert.equal(protectedRequest.reason, 'protected');
    assert.deepEqual(topics, Array.from(app.FEED_TOPICS).slice(0, 1));
  } finally { await app.close(); }
});

test('all public collectors share one scheduler; website and member-only sources are not treated as public feeds', async () => {
  const app = await createAppHarness({ env: { SERVICE_ROLE: 'pipeline' } });
  try {
    app.refreshControl.mode = 'critical'; // Inspect registrations without contacting providers.
    app.startContinuousWorkers();
    app.startJobBoardSweeps();
    const state = app.getSourceCollectionScheduler().status();
    assert.equal(Object.keys(app.PLATFORMS).length, 103, 'The installed catalog includes the separate Hashnode publishing account');
    assert.equal(state.total, 44, '38 original sources, four research sources, and two category job collectors');
    assert.equal(state.maxConcurrency, 4);
    assert.equal(state.active, 0);
    for (const source of app.AGGREGATE_FEED_SOURCES) {
      const workerId = source === 'hackernews' ? 'hn' : source;
      assert.ok(state.sources.some(worker => worker.id === workerId), source + ' has a registered collector');
      assert.equal(typeof app.SOURCE_FETCHERS[workerId], 'function');
    }
    assert.ok(!app.AGGREGATE_FEED_SOURCES.includes('linkedin'), 'Member-only LinkedIn access stays private');
    assert.ok(!app.AGGREGATE_FEED_SOURCES.includes('hashnode_blog'), 'A private publishing connection is not a public feed');
    assert.ok(!app.SOURCE_FETCHERS.hashnode_blog, 'Hashnode publication writes do not create a public collector');
    assert.ok(!app.SOURCE_FETCHERS.airbnb, 'An account website does not invent a feed adapter');
    for (const id of ['weworkremotely', 'cntraveler', 'twitch', 'techcrunch', 'github', 'hn', 'remoteok', 'stackoverflow']) {
      const worker = state.sources.find(source => source.id === id);
      assert.equal(worker.keyCount, 1, id + ' collects a whole inventory once');
      assert.equal(worker.expectedCycleMs, require('./source-pull-limits').sourcePullLimit(id).minSpacingMs);
    }
    const youtube = state.sources.find(source => source.id === 'youtube');
    assert.ok(youtube.keyCount > 1 && youtube.keyCount < app.FEED_TOPICS.length);
    assert.ok(youtube.expectedCycleMs <= 600000, 'YouTube channels are deduplicated without expensive keyword searches');
  } finally { app.getSourceCollectionScheduler().stop(); await app.close(); }
});

test('real pipeline startup registers later-declared job inventories without a cold-start initialization error', async () => {
  // The real startup branch runs; the harness blocks all external network,
  // database initialization and deployment-secret loading.
  const app = await createAppHarness({ env: { SERVICE_ROLE: 'pipeline', AUTOFIX_SMOKE_TEST: '0' } });
  try {
    await new Promise(resolve => setImmediate(resolve));
    const state = app.getSourceCollectionScheduler().status();
    assert.equal(state.total, 44);
    assert.ok(state.sources.some(source => source.id === 'remotive'));
    assert.ok(state.sources.some(source => source.id === 'muse'));
    assert.equal(state.active, 0, 'Staggered requests have not contacted providers during startup');
    assert.deepEqual(app.errors, []);
  } finally { app.getSourceCollectionScheduler().stop(); await app.close(); }
});

test('a source interrupted by pressure remains queued and is not reported as completed', async () => {
  const app = await createAppHarness({ env: { SERVICE_ROLE: 'pipeline', SOURCE_REFRESH_WORKER_COUNT: '1' } });
  try {
    app.SOURCE_FETCHERS.interrupted_fixture = async () => {
      app.refreshControl.mode = 'critical';
      return { deferred: true };
    };
    app.sourceRefreshQueue.pendingIds.add('interrupted_fixture');
    app.sourceRefreshQueue.batchTotal = 1;
    await app.drainSourceRefreshQueue();
    assert.equal(app.sourceRefreshQueue.pendingIds.has('interrupted_fixture'), true);
    assert.equal(app.sourceRefreshQueue.batchDone, 0);
    assert.equal(app.sourceRefreshQueue.recentCompletions.length, 0);
    assert.equal(app.sourceRefreshQueue.running, false);
    assert.ok(app.sourceRefreshQueue.currentIds.every(id => id === null));
  } finally { await app.close(); }
});
