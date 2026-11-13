'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { createUnknownTopicReview, registerOfficeTopicReviewRoutes } = require('./unknown-topic-review');
const { createFeedRoutingFixture } = require('./test-support/feed-routing-fixture');

const topics = ['Python', 'Cybersecurity'];
const ids = async (pg, table) => (await pg.query(`SELECT id FROM ${table} ORDER BY id`)).rows.map(row => row.id);
const receipt = async (pg, id) => (await pg.query('SELECT processed_at FROM office_unknown_topic_manual_assignments WHERE post_id=$1', [id])).rows[0];

async function fixture(t, transfer) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE feed_posts_cache(id TEXT PRIMARY KEY,title TEXT,content TEXT,topic TEXT,source TEXT,source_url TEXT,
    post_created_at TIMESTAMPTZ DEFAULT NOW(),fetched_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE feed_posts_staging(LIKE feed_posts_cache INCLUDING ALL);
    CREATE TABLE office_unknown_topic_review(post_id TEXT PRIMARY KEY,post JSONB NOT NULL,reason TEXT DEFAULT 'ambiguous-topic',
      first_held_at TIMESTAMPTZ DEFAULT NOW(),last_held_at TIMESTAMPTZ DEFAULT NOW(),checked_at TIMESTAMPTZ,retry_at TIMESTAMPTZ DEFAULT NOW(),resolved_at TIMESTAMPTZ)`);
  let tail = Promise.resolve();
  const query = async (...args) => { const result = await pg.query(...args); return { ...result, rowCount: result.affectedRows }; };
  const db = { isConnected: () => true, query, withClient: work => {
    const result = tail.then(() => work({ query })); tail = result.catch(() => {}); return result;
  } };
  const service = createUnknownTopicReview({ db, topics, transfer });
  await service.initialize();
  return { pg, db, service };
}

async function hold(pg, service, id, { assign = true, topic = 'Python', ...extra } = {}) {
  const post = { id, source: 'reddit', title: `Retained Python article ${id}`, content: `Original retained content for ${id}.`, topic: null,
    source_url: `https://example.org/articles/${id}`, post_created_at: new Date().toISOString(), fetched_at: new Date().toISOString(), ...extra };
  await pg.query('INSERT INTO office_unknown_topic_review(post_id,post) VALUES($1,$2::jsonb)', [id, JSON.stringify(post)]);
  if (assign) await service.assign(id, { topic, confirmed: true, expectedVersion: (await service.detail(id)).item.version });
  return post;
}

test('distribution snapshots count assigned staging once across topics, excluding processed receipts, unassigned review and ordinary staging', async t => {
  const f = await fixture(t, async () => { throw new Error('Read-only status must not transfer'); });
  await hold(f.pg, f.service, 'python');
  await hold(f.pg, f.service, 'security', { topic: 'Cybersecurity' });
  await hold(f.pg, f.service, 'processed');
  await hold(f.pg, f.service, 'still-held', { assign: false });
  await f.pg.query("UPDATE office_unknown_topic_manual_assignments SET processed_at=NOW() WHERE post_id='processed'");
  await f.pg.query("INSERT INTO feed_posts_staging(id,title,content,topic) VALUES('ordinary','Other staged item','Separate intake','Python')");
  await f.pg.query(`INSERT INTO office_unknown_topic_manual_assignments(post_id,review_version,topic,original_post)
    SELECT post_id,repeat('f',64),topic,original_post FROM office_unknown_topic_manual_assignments WHERE post_id='python'`);
  const status = await f.service.distribution();
  assert.equal(status.ok, true); assert.equal(status.pending, 2);
  assert.match(status.through, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), ['ordinary', 'processed', 'python', 'security']);
  assert.equal((await f.service.detail('still-held')).item.pending, true);
});

test('distribution validates confirmation and exact snapshot timestamps before invoking promotion', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return {}; });
  const through = (await f.service.distribution()).through;
  for (const body of [undefined, {}, [], { confirmed: false, through }, { confirmed: 'true', through },
    { confirmed: true }, { confirmed: true, through: 42 }, { confirmed: true, through: '2026-11-05T00:00:00Z' },
    { confirmed: true, through: '2026-02-30T00:00:00.000000Z' }, { confirmed: true, through, topic: 'Python' }]) {
    await assert.rejects(f.service.distribute(body), { status: 400 });
  }
  assert.equal(calls, 0);
});

test('empty and busy distributions retain an honest pending count and never invent transferred posts', async t => {
  const calls = [];
  const f = await fixture(t, async options => { calls.push(options); return { skipped: true }; });
  const empty = await f.service.distribute({ confirmed: true, through: (await f.service.distribution()).through });
  assert.equal(empty.status, 'complete'); assert.equal(empty.remaining, 0); assert.equal(empty.transferred, 0); assert.equal(calls.length, 0);
  await hold(f.pg, f.service, 'waiting');
  const through = (await f.service.distribution()).through;
  await assert.rejects(f.service.distribute({ confirmed: true, through }), { status: 409 });
  assert.deepEqual(calls, [{ maxBatches: 1, reason: 'office-held-distribute', manualAssignmentsThrough: through }]);
  assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), ['waiting']);
  assert.equal((await receipt(f.pg, 'waiting')).processed_at, null);
  assert.equal((await f.service.distribution()).pending, 1);
});

test('partial promotion failures report committed totals and remaining work for the original snapshot', async t => {
  let f;
  f = await fixture(t, async () => {
    await f.pg.query("DELETE FROM feed_posts_staging WHERE id='first'");
    await f.service.markProcessed(['first']);
    return { error: 'Synthetic later-batch failure', transferred: 1, drained: 1 };
  });
  await hold(f.pg, f.service, 'first'); await hold(f.pg, f.service, 'second');
  const through = (await f.service.distribution()).through;
  const result = await f.service.distribute({ confirmed: true, through });
  assert.equal(result.ok, true); assert.equal(result.status, 'failed'); assert.equal(result.error, undefined);
  assert.equal(result.transferred, 1); assert.equal(result.drained, 1); assert.equal(result.remaining, 1); assert.equal(result.through, through);
  assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), ['second']);
  assert.equal((await receipt(f.pg, 'second')).processed_at, null);
});

test('bounded distribution requests keep one snapshot and report running until all its assigned posts are processed', async t => {
  let f;
  const calls = [];
  f = await fixture(t, async options => {
    calls.push(options);
    const id = calls.length === 1 ? 'first' : 'second';
    await f.pg.query('DELETE FROM feed_posts_staging WHERE id=$1', [id]);
    await f.service.markProcessed([id]);
    return { transferred: 1, drained: 1, screenedOut: 0, heldForReview: 0 };
  });
  await hold(f.pg, f.service, 'first'); await hold(f.pg, f.service, 'second');
  const through = (await f.service.distribution()).through;
  const first = await f.service.distribute({ confirmed: true, through });
  assert.equal(first.status, 'running'); assert.equal(first.remaining, 1); assert.equal(first.transferred, 1);
  const second = await f.service.distribute({ confirmed: true, through });
  assert.equal(second.status, 'complete'); assert.equal(second.remaining, 0); assert.equal(second.transferred, 1);
  assert.deepEqual(calls, [1, 2].map(() => ({ maxBatches: 1, reason: 'office-held-distribute', manualAssignmentsThrough: through })));
});

test('distribution routes authenticate reads and writes, use private responses and precede the opaque post-ID route', async t => {
  let calls = 0;
  const f = await fixture(t);
  const app = express(); app.use(express.json());
  const service = registerOfficeTopicReviewRoutes(app, { db: f.db, topics, transfer: async () => { calls++; return { skipped: true }; },
    requireOfficeToken: (req, res, next) => req.get('x-office-token') === 'fixture' ? next() : res.status(401).json({ message: 'Unauthorized' }) });
  await service.initialize();
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const [endpoint, method] of [['distribution', 'GET'], ['distribute', 'POST']]) {
    const denied = await fetch(`${base}/office/topic-review/${endpoint}`, { method, headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ confirmed: true, through: '2026-11-05T00:00:00.000000Z' }) } : {}) });
    assert.equal(denied.status, 401); assert.match(denied.headers.get('cache-control'), /private.*no-store/);
  }
  const headers = { 'x-office-token': 'fixture', 'Content-Type': 'application/json' };
  const status = await fetch(base + '/office/topic-review/distribution', { headers });
  assert.equal(status.status, 200); assert.match(status.headers.get('cache-control'), /private.*no-store/);
  const snapshot = await status.json(); assert.equal(snapshot.pending, 0);
  const invalid = await fetch(base + '/office/topic-review/distribute', { method: 'POST', headers, body: '{}' });
  assert.equal(invalid.status, 400);
  const complete = await fetch(base + '/office/topic-review/distribute', { method: 'POST', headers, body: JSON.stringify({ confirmed: true, through: snapshot.through }) });
  assert.equal(complete.status, 200); assert.match(complete.headers.get('cache-control'), /private.*no-store/);
  assert.equal((await complete.json()).status, 'complete'); assert.equal(calls, 0);
});

test('actual scoped promotion processes every assigned topic but leaves ordinary, unassigned and later receipt rows untouched', async t => {
  const f = await createFeedRoutingFixture(t, { guardian: true });
  const service = createUnknownTopicReview({ db: f.app.db, topics, transfer: options => f.app.transferStagedPosts(options) });
  await service.initialize();
  const original = await hold(f.pg, service, 'selected-python');
  await hold(f.pg, service, 'selected-security', { topic: 'Cybersecurity', title: 'Retained cybersecurity article' });
  const removed = await hold(f.pg, service, 'selected-deleted');
  await hold(f.pg, service, 'unassigned', { assign: false });
  await f.pg.query(`INSERT INTO feed_posts_staging(id,source,title,content,topic,source_url,post_created_at)
    VALUES('ordinary','reddit','Separate staged Python article','Separate intake remains staged.','Python','https://example.org/ordinary',NOW()),
      ('unrelated-tombstone','reddit','Removed source article','Unrelated cleanup must wait.','Python','https://example.org/deleted',NOW())`);
  await f.pg.query(`INSERT INTO feed_posts_archive(id,source,title,content,topic,source_url,post_created_at,archive_reason)
    VALUES('unrelated-tombstone','reddit','Removed source article','Unrelated cleanup must wait.','Python','https://example.org/deleted',NOW(),'source-deleted')`);
  await f.pg.query(`INSERT INTO feed_posts_archive(id,source,title,content,topic,source_url,post_created_at,archive_reason)
    VALUES('selected-deleted','reddit',$1,$2,'Python',$3,NOW(),'source-deleted')`, [removed.title, removed.content, removed.source_url]);
  const snapshot = await service.distribution(); assert.equal(snapshot.pending, 3);
  await hold(f.pg, service, 'later');
  // Distinguish exactly one microsecond after the snapshot, below JS Date precision.
  await f.pg.query("UPDATE office_unknown_topic_manual_assignments SET assigned_at=$1::timestamptz + INTERVAL '1 microsecond' WHERE post_id='later'", [snapshot.through]);
  const result = await service.distribute({ confirmed: true, through: snapshot.through });
  assert.equal(result.status, 'complete'); assert.equal(result.transferred, 2); assert.equal(result.drained, 3); assert.equal(result.screenedOut, 1); assert.equal(result.remaining, 0);
  assert.deepEqual(await ids(f.pg, 'feed_posts_cache'), ['selected-python', 'selected-security']);
  assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), ['later', 'ordinary', 'unrelated-tombstone']);
  assert.equal((await f.pg.query("SELECT content FROM feed_posts_cache WHERE id='selected-python'")).rows[0].content, original.content);
  assert.equal((await service.detail('unassigned')).item.pending, true);
  assert.ok((await receipt(f.pg, 'selected-python')).processed_at); assert.ok((await receipt(f.pg, 'selected-deleted')).processed_at);
  assert.equal((await receipt(f.pg, 'later')).processed_at, null);
  const repeated = await service.distribute({ confirmed: true, through: snapshot.through });
  assert.equal(repeated.transferred, 0); assert.equal(repeated.drained, 0); assert.equal(repeated.remaining, 0);
  assert.equal((await service.distribution()).pending, 1);
});

test('actual scoped promotion preserves a newer live copy and screens rejected source content before broadcasting', async t => {
  const f = await createFeedRoutingFixture(t, { guardian: true });
  const service = createUnknownTopicReview({ db: f.app.db, topics, transfer: options => f.app.transferStagedPosts(options) });
  await service.initialize();
  const original = await hold(f.pg, service, 'newer-live');
  await hold(f.pg, service, 'screened-out', { source_url: 'javascript:alert(1)' });
  await hold(f.pg, service, 'allowed');
  await f.pg.query(`INSERT INTO feed_posts_cache(id,source,title,content,topic,source_url,post_created_at)
    VALUES('newer-live','reddit','Newer live title','Newer live body','Cybersecurity',$1,NOW())`, [original.source_url]);
  const frames = []; f.app.sseClients.set('distribution-test', { feedViewerId: null, write: frame => frames.push(frame) });
  const result = await service.distribute({ confirmed: true, through: (await service.distribution()).through });
  assert.equal(result.status, 'complete'); assert.equal(result.transferred, 1); assert.equal(result.drained, 3);
  assert.equal(result.screenedOut, 1); assert.equal(result.remaining, 0);
  assert.equal((await f.pg.query("SELECT content FROM feed_posts_cache WHERE id='newer-live'")).rows[0].content, 'Newer live body');
  assert.deepEqual(await ids(f.pg, 'feed_posts_cache'), ['allowed', 'newer-live']);
  assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), []);
  assert.ok((await receipt(f.pg, 'screened-out')).processed_at);
  const preserved = (await f.pg.query("SELECT original_post FROM office_unknown_topic_manual_assignments WHERE post_id='screened-out'")).rows[0].original_post;
  assert.equal(preserved.source_url, 'javascript:alert(1)');
  await f.app.flushSSEBatch();
  assert.deepEqual(frames.flatMap(frame => JSON.parse(frame.slice(6).trim()).posts.map(post => post.id)), ['allowed']);
});

test('actual scoped promotion rolls back content and receipts together, then retries without duplicates', async t => {
  let failCommit = false, promotionWritten = false, failedCommits = 0;
  const f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async sql => {
    if (failCommit && sql.includes('INSERT INTO feed_posts_cache AS existing')) promotionWritten = true;
    if (failCommit && promotionWritten && sql === 'COMMIT') {
      // The earlier empty tombstone cleanup transaction must succeed. Fail
      // only after the real promotion has deleted staging, saved live content
      // and marked its receipt on the same transaction.
      assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), []);
      assert.deepEqual(await ids(f.pg, 'feed_posts_cache'), ['retry']);
      assert.ok((await receipt(f.pg, 'retry')).processed_at);
      failedCommits++;
      throw new Error('Synthetic distribution commit failure');
    }
  } });
  const service = createUnknownTopicReview({ db: f.app.db, topics, transfer: options => f.app.transferStagedPosts(options) });
  await service.initialize(); await hold(f.pg, service, 'retry');
  const through = (await service.distribution()).through;
  const frames = []; f.app.sseClients.set('distribution-retry-test', { feedViewerId: null, write: frame => frames.push(frame) });
  failCommit = true;
  const failed = await service.distribute({ confirmed: true, through });
  assert.equal(promotionWritten, true); assert.equal(failedCommits, 1);
  assert.equal(failed.status, 'failed'); assert.equal(failed.transferred, 0); assert.equal(failed.remaining, 1);
  assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), ['retry']); assert.deepEqual(await ids(f.pg, 'feed_posts_cache'), []);
  assert.equal((await receipt(f.pg, 'retry')).processed_at, null);
  await f.app.flushSSEBatch(); assert.equal(frames.length, 0);
  failCommit = false;
  const retry = await service.distribute({ confirmed: true, through });
  assert.equal(retry.status, 'complete'); assert.equal(retry.transferred, 1); assert.equal(retry.remaining, 0);
  assert.ok((await receipt(f.pg, 'retry')).processed_at);
  assert.deepEqual(await ids(f.pg, 'feed_posts_cache'), ['retry']);
  await f.app.flushSSEBatch();
  assert.deepEqual(frames.flatMap(frame => JSON.parse(frame.slice(6).trim()).posts.map(post => post.id)), ['retry']);
});

test('scoped tombstone deletion and receipt processing roll back together before a successful retry', async t => {
  let failCommit = false, deletionAttempted = false, failedCommits = 0;
  const f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async sql => {
    if (failCommit && sql.includes('DELETE FROM feed_posts_staging s') && sql.includes('RETURNING s.id')) deletionAttempted = true;
    if (failCommit && deletionAttempted && sql === 'COMMIT') {
      assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), []);
      assert.ok((await receipt(f.pg, 'deleted-retry')).processed_at);
      failedCommits++;
      throw new Error('Synthetic tombstone cleanup commit failure');
    }
  } });
  const service = createUnknownTopicReview({ db: f.app.db, topics, transfer: options => f.app.transferStagedPosts(options) });
  await service.initialize();
  const removed = await hold(f.pg, service, 'deleted-retry');
  await f.pg.query(`INSERT INTO feed_posts_archive(id,source,title,content,topic,source_url,post_created_at,archive_reason)
    VALUES($1,'reddit',$2,$3,'Python',$4,NOW(),'source-deleted')`, [removed.id, removed.title, removed.content, removed.source_url]);
  const through = (await service.distribution()).through;
  failCommit = true;
  const failed = await service.distribute({ confirmed: true, through });
  assert.equal(deletionAttempted, true); assert.equal(failedCommits, 1);
  assert.equal(failed.status, 'failed'); assert.equal(failed.transferred, 0); assert.equal(failed.drained, 0);
  assert.equal(failed.screenedOut, 0); assert.equal(failed.remaining, 1);
  assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), ['deleted-retry']);
  assert.equal((await receipt(f.pg, 'deleted-retry')).processed_at, null);
  assert.deepEqual(await ids(f.pg, 'feed_posts_cache'), []);
  failCommit = false;
  const retry = await service.distribute({ confirmed: true, through });
  assert.equal(retry.status, 'complete'); assert.equal(retry.transferred, 0); assert.equal(retry.drained, 1);
  assert.equal(retry.screenedOut, 1); assert.equal(retry.remaining, 0);
  assert.deepEqual(await ids(f.pg, 'feed_posts_staging'), []);
  assert.ok((await receipt(f.pg, 'deleted-retry')).processed_at);
  assert.deepEqual(await ids(f.pg, 'feed_posts_cache'), []);
});
