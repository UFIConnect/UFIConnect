'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAppHarness } = require('./test-support/app-harness');
const feedAuditModule = require('./feed-audit');
const pullLimits = require('./source-pull-limits');
const schedulerModule = require('./source-collection-scheduler');

// Exercise index.js's real collection, equalizer, admission, and cache paths.
// Only persistence and the clock are fixtures; no provider or deployment access.
async function fixture(t) {
  let time = Date.now();
  let policy = null;
  const blocked = new Map();
  const clock = () => time;
  const app = await createAppHarness({
    connected: true, clock, env: { SERVICE_ROLE: 'pipeline' },
    query: async (sql, params) => {
      if (sql.startsWith('INSERT INTO office_feed_policy')) policy ||= JSON.parse(params[0]);
      if (sql.startsWith('UPDATE office_feed_policy')) {
        const update = JSON.parse(params[0]);
        policy = { ...policy, ...update, sourcePullLimits: { ...policy.sourcePullLimits, ...update.sourcePullLimits } };
      }
      if (sql.startsWith('INSERT INTO office_feed_source_blocks')) {
        blocked.set(params[0], { source: params[0], reason: params[1], blocked_at: new Date(time).toISOString() });
      }
      if (sql.startsWith('DELETE FROM office_feed_source_blocks')) blocked.delete(params[0]);
      if (sql.startsWith('SELECT settings, updated_at')) return { rows: policy ? [{ settings: policy, updated_at: new Date(time) }] : [] };
      if (sql.startsWith('SELECT source, reason, blocked_at')) return { rows: [...blocked.values()] };
      return { rows: [], rowCount: 0 };
    },
    modules: {
      './feed-audit': { ...feedAuditModule, createFeedAudit: (db, options) => feedAuditModule.createFeedAudit(db, {
        ...options, now: clock, schedule: () => null, requirePolicy: true,
      }) },
      './source-pull-limits': { ...pullLimits, createSourcePullGate: options => pullLimits.createSourcePullGate({ ...options, now: clock }) },
      './source-collection-scheduler': { ...schedulerModule, createSourceCollectionScheduler: options => schedulerModule.createSourceCollectionScheduler({
        ...options, now: clock, schedule: () => ({ unref() {} }), cancel() {},
      }) },
    },
  });
  t.after(async () => { app.getSourceCollectionScheduler().stop(); await app.close(); });
  await app.feedAudit.initialize();
  return { app, clock, advance(ms) { time += ms; }, async advanceFresh(ms) { time += ms; await app.feedAudit.reload(); } };
}

function post(id, source = 'bluesky', author = id) {
  return { id: `${source}_${id}`, source, title: `Engineering field report ${id}`,
    content: `This engineering field report describes a distinct project and its practical result, reference ${id}.`,
    sourceUrl: `https://example.org/${source}/${id}`, isExternal: true,
    author: { id: `author_${author}`, name: `Writer ${author}` }, createdAt: '2026-10-01T12:00:00Z' };
}

function mediumPosts(app, count, sameAuthor = false) {
  return Array.from({ length: count }, (_, i) => app.rssPost({
    title: `Medium engineering field report ${i}`, desc: `An independent engineering article describes its practical findings in project ${i}.`,
    link: `https://medium.com/@fixture/report-${i}`, author: sameAuthor ? 'One Writer' : `Writer ${i}`,
    pubDate: '2026-10-01T12:00:00Z',
  }, 'medium', 'Medium', 'ext_medium', 'Medium', 'Technology', 'engineering'));
}

test('previously accepted IDs do not spend a new source quota after admission memo expiration', async t => {
  const f = await fixture(t), { app } = f;
  await app.feedAudit.configure({ maxPerSourcePerMinute: 1 });
  const accepted = post('original');
  assert.equal(app.addAndBroadcast([accepted]), 1);
  await f.advanceFresh(300001);
  assert.equal(app.addAndBroadcast([accepted, { ...accepted }]), 0);
  assert.equal(app.feedAudit.collectionState('bluesky').remaining, 1);
  assert.equal(app.addAndBroadcast([post('new')]), 1);
  assert.equal(app.globalFeedCache.posts.length, 2);
  assert.equal(app.feedAudit.summary().held, 0);
});

test('301 Bluesky candidates admit 300 and retain the final post until the next minute', async t => {
  const f = await fixture(t), { app } = f;
  const candidates = Array.from({ length: 301 }, (_, i) => post(i));
  app.pushToEqualizer('bluesky', candidates);
  assert.equal(app.buildEqualizerDrainPlan(['bluesky'])[0].quota, 300);
  assert.equal(app.globalFeedCache.posts.length, 0);
  app.runEqualizerDrain();
  assert.equal(app.globalFeedCache.posts.length, 300);
  assert.equal(app.agentSourceCache.get('bluesky').totalSeen, 300);
  assert.equal(app.agentSourceCache.get('bluesky').posts.length, 40, 'The source tab cache keeps its existing bounded size');
  assert.equal(app.equalizerBuffer.get('bluesky').length, 1);
  assert.equal(app.sourceCollectionState('bluesky').reason, 'source_flood');
  app.runEqualizerDrain();
  assert.equal(app.equalizerBuffer.get('bluesky').length, 1);
  assert.equal(app.feedAudit.summary().rejected, 0);
  await f.advanceFresh(60000);
  app.runEqualizerDrain();
  assert.equal(app.globalFeedCache.posts.length, 301);
  assert.equal(app.equalizerBuffer.has('bluesky'), false);
  assert.equal(app.feedAudit.summary().approved, 301);
});

test('actual RSS mapping gives 26 different Medium writers independent admission buckets', async t => {
  const { app } = await fixture(t);
  const candidates = mediumPosts(app, 26);
  assert.equal(new Set(candidates.map(candidate => candidate.author.id)).size, 26);
  app.pushToEqualizer('medium', candidates);
  app.runEqualizerDrain();
  assert.equal(app.globalFeedCache.posts.length, 26);
  assert.equal(app.equalizerBuffer.has('medium'), false);
  assert.equal(app.feedAudit.summary().held, 0);
});

test('the 26th post by one Medium writer stays queued and retries only after its author window', async t => {
  const f = await fixture(t), { app } = f;
  app.pushToEqualizer('medium', mediumPosts(app, 26, true));
  app.runEqualizerDrain();
  assert.equal(app.globalFeedCache.posts.length, 25);
  assert.equal(app.equalizerBuffer.get('medium').length, 1);
  assert.equal(app.feedAudit.summary().byReason.author_flood, 1);
  assert.equal(app.feedAudit.summary().rejected, 0);
  await f.advanceFresh(59999);
  assert.equal(app.buildEqualizerDrainPlan(['medium'])[0].quota, 0);
  app.runEqualizerDrain();
  assert.equal(app.globalFeedCache.posts.length, 25);
  await f.advanceFresh(1);
  app.runEqualizerDrain();
  assert.equal(app.globalFeedCache.posts.length, 26);
  assert.equal(app.equalizerBuffer.has('medium'), false);
  assert.equal(app.feedAudit.summary().held, 1, 'Repeated drains do not re-audit an item still waiting for its retry time');
});

test('collected candidates remain invisible to public cache reads until equalizer admission', async t => {
  const { app } = await fixture(t);
  let calls = 0;
  app.makeTopicCycler('bluesky', '', '', async () => { calls++; return [post('queued')]; }, key => key, { keys: ['engineering'] });
  const collected = await app.SOURCE_FETCHERS.bluesky();
  assert.equal(collected.deferred, false);
  assert.equal(calls, 1);
  assert.equal(app.equalizerBuffer.get('bluesky').length, 1);
  assert.equal(app.agentSourceCache.get('bluesky').posts.length, 0);
  assert.equal(app.feedAudit.summary().approved, 0, 'Raw fetches are not recorded as approved');
  const before = await app.fetchAllTopicPosts([], '', [], [], '', '', ['bluesky']);
  assert.equal(before.bluesky.length, 0);
  assert.equal(calls, 1, 'A public read cannot bypass the active provider pull ceiling');
  app.runEqualizerDrain();
  const after = await app.fetchAllTopicPosts([], '', [], [], '', '', ['bluesky']);
  assert.equal(after.bluesky.length, 1);
  assert.equal(after.bluesky[0].id, 'bluesky_queued');
  assert.equal(app.feedAudit.summary().approved, 1);
});

test('blocked and stale policy prevent provider access; manual retries obey screenshot pull spacing', async t => {
  const f = await fixture(t), { app } = f;
  let calls = 0;
  app.makeTopicCycler('bluesky', '', '', async () => { calls++; return []; }, key => key, { keys: ['engineering'] });
  await app.feedAudit.block('bluesky', 'Source investigation');
  assert.equal((await app.SOURCE_FETCHERS.bluesky()).reason, 'source_blocked');
  assert.equal(calls, 0);
  await app.feedAudit.unblock('bluesky');
  f.advance(30001);
  assert.equal((await app.SOURCE_FETCHERS.bluesky()).reason, 'policy_unavailable');
  assert.equal(calls, 0);
  await app.feedAudit.reload();
  assert.equal((await app.SOURCE_FETCHERS.bluesky()).deferred, false);
  assert.equal(calls, 1);
  const held = await app.SOURCE_FETCHERS.bluesky();
  assert.equal(held.reason, 'source_pull_limit');
  assert.equal(held.retryAt, f.clock() + 2500);
  f.advance(2499);
  assert.equal((await app.SOURCE_FETCHERS.bluesky()).reason, 'source_pull_limit');
  assert.equal(calls, 1);
  f.advance(1);
  assert.equal((await app.SOURCE_FETCHERS.bluesky()).deferred, false);
  assert.equal(calls, 2);
  assert.equal(app.getSourceCollectionScheduler().status().sources[0].failures, 0);
});

test('all four research sources have real catalog entries, collectors, and 20-second pull settings', async t => {
  const { app } = await fixture(t);
  app.refreshControl.mode = 'critical';
  app.startContinuousWorkers();
  app.startJobBoardSweeps();
  const state = app.getSourceCollectionScheduler().status();
  for (const source of ['crossref', 'datacite', 'zenodo', 'openalex']) {
    assert.ok(app.AGGREGATE_FEED_SOURCES.includes(source), `${source} belongs to the public feed catalog`);
    assert.ok(app.SOURCE_CONFIG[source], `${source} has a source configuration`);
    assert.equal(typeof app.SOURCE_FETCHERS[source], 'function');
    const collector = state.sources.find(candidate => candidate.id === source);
    assert.ok(collector, `${source} has a registered collector`);
    assert.equal(collector.minSpacingMs, 20000);
  }
  assert.equal(state.active, 0);
});

test('stale policy retains pending supply while an explicit source block frees its queue capacity', async t => {
  const f = await fixture(t), { app } = f;
  app.pushToEqualizer('bluesky', [post('pending-a'), post('pending-b')]);
  f.advance(30001);
  app.runEqualizerDrain();
  assert.equal(app.equalizerBuffer.get('bluesky').length, 2);
  assert.equal(app.globalFeedCache.posts.length, 0);
  assert.equal(app.feedAudit.summary().rejected, 0);
  await app.feedAudit.block('bluesky', 'Quarantine imported source');
  app.pushToEqualizer('medium', mediumPosts(app, 1));
  app.runEqualizerDrain();
  assert.equal(app.equalizerBuffer.has('bluesky'), false);
  assert.equal(app.feedAudit.summary().byReason.source_blocked, 2);
  assert.equal(app.globalFeedCache.posts.length, 1);
  assert.equal(app.globalFeedCache.posts[0].source, 'medium');
  await app.feedAudit.unblock('bluesky');
  assert.equal(app.sourceCollectionState('bluesky').allowed, true);
});
