const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAppHarness } = require('./test-support/app-harness');

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

test('interrupted manual collection continues with the next topic instead of replaying the first', async () => {
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
    assert.equal(interrupted.deferred, true);
    assert.equal(interrupted.scannedTopics, 1);
    app.refreshControl.mode = 'pressure';
    const resumed = await app.SOURCE_FETCHERS.cursor_fixture();
    assert.equal(resumed.deferred, false);
    assert.equal(resumed.scannedTopics, 2);
    assert.deepEqual(topics, Array.from(app.FEED_TOPICS).slice(0, 3));
  } finally { await app.close(); }
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
