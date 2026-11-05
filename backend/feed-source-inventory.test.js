'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createFeedSourceInventory } = require('./feed-source-inventory');

async function database() {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE feed_posts_cache (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT, content TEXT, author_name TEXT,
    source_url TEXT, media_url TEXT, media_type TEXT, media_poster TEXT, topic TEXT,
    video_duration_seconds INTEGER, likes_count INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0,
    post_created_at TIMESTAMPTZ, fetched_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pg.query(`CREATE INDEX fpc_source_time_id_idx ON feed_posts_cache(source, post_created_at DESC, id DESC)`);
  return pg;
}

test('durable source totals cover retained history while samples stay bounded per source', async t => {
  const pg = await database(); t.after(() => pg.close());
  await pg.query(`INSERT INTO feed_posts_cache (id, source, title, post_created_at)
    SELECT 'hn_' || n, 'hackernews', 'Engineering article ' || n, NOW() - n * INTERVAL '1 minute'
    FROM generate_series(1, 25) AS n`);
  await pg.query(`INSERT INTO feed_posts_cache(id,source,post_created_at) VALUES
    ('arxiv_one','arxiv',NOW()), ('invented_fallback','arxiv',NOW()),
    ('social_fake','arxiv',NOW()), ('indeed_j12','indeed',NOW())`);
  await pg.query(`UPDATE feed_posts_cache SET title=repeat('Research ', 200), content=repeat('Detailed engineering report. ', 10000) WHERE id='hn_1'`);
  let queryCount = 0;
  const db = { isConnected: () => true, query: (...args) => { queryCount++; return pg.query(...args); } };
  const inventory = createFeedSourceInventory(db);
  const stored = await inventory.refresh();
  assert.equal(stored.count, 29);
  assert.equal(stored.bySource.hackernews.count, 25);
  assert.equal(stored.bySource.arxiv.feedCount, 1);
  assert.equal(stored.bySource.indeed.feedCount, 0);
  assert.equal(stored.status, 'ready');
  const sample = await inventory.samples(['hackernews', 'arxiv'], 3);
  assert.equal(sample.rows.filter(row => row.source === 'hackernews').length, 3);
  assert.deepEqual(sample.rows.filter(row => row.source === 'hackernews').map(row => row.id), ['hn_1', 'hn_2', 'hn_3']);
  assert.deepEqual(sample.rows.filter(row => row.source === 'arxiv').map(row => row.id), ['arxiv_one']);
  assert.equal(sample.rows.find(row => row.id === 'hn_1').content.length, 200);
  assert.equal(sample.rows.find(row => row.id === 'hn_1').title.length, 500);
  await Promise.all(Array.from({ length: 40 }, () => inventory.refresh()));
  await Promise.all(Array.from({ length: 40 }, () => inventory.samples(['arxiv', 'hackernews'], 3)));
  assert.equal(queryCount, 2, 'visitors share the aggregate and bounded sample snapshots');
});

test('concurrent first reads share one query and failures retain known counts without exposing errors', async () => {
  let time = Date.parse('2026-11-04T12:00:00Z'), calls = 0, release;
  let failing = false;
  const db = { isConnected: () => true, query: () => {
    calls++;
    if (failing) throw new Error('password=do-not-return host=private-database');
    return new Promise(resolve => { release = resolve; });
  } };
  const inventory = createFeedSourceInventory(db, { now: () => time });
  const readers = Array.from({ length: 20 }, () => inventory.refresh());
  assert.equal(calls, 1);
  release({ rows: [{ source: 'hackernews', count: 40648, feed_count: 40648, newest_fetched_at: new Date(time) }] });
  assert.ok((await Promise.all(readers)).every(snapshot => snapshot.count === 40648));
  time += 60_001; failing = true;
  const stale = await inventory.refresh();
  assert.equal(stale.count, 40648);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.lastCheckedAt, '2026-11-04T12:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(stale), /private-database|password/);
  await Promise.all(Array.from({ length: 20 }, () => inventory.refresh()));
  assert.equal(calls, 2, 'failed refreshes are retried after a backoff, not per visitor');
  time += 5_001;
  await inventory.refresh();
  assert.equal(calls, 3);
});

test('unknown storage is distinct from a successfully verified empty database', async () => {
  let connected = false, calls = 0;
  const inventory = createFeedSourceInventory({ isConnected: () => connected,
    query: async () => { calls++; return { rows: [] }; } });
  assert.equal((await inventory.refresh()).count, null);
  assert.equal(inventory.snapshot().status, 'unavailable');
  assert.equal(calls, 0);
  connected = true;
  const verified = await inventory.refresh({ force: true });
  assert.equal(verified.count, 0);
  assert.equal(verified.status, 'ready');
  assert.equal(verified.lastError, null);
});

test('sample read failure preserves only samples from the same source selection', async () => {
  let time = 0, failing = false;
  const inventory = createFeedSourceInventory({ isConnected: () => true,
    query: async () => { if (failing) throw new Error('outage'); return { rows: [{ id: 'hn_1', source: 'hackernews' }] }; },
  }, { now: () => time });
  await inventory.samples(['hackernews']);
  time += 60_001; failing = true;
  const stale = await inventory.samples(['hackernews']);
  assert.equal(stale.status, 'stale'); assert.equal(stale.rows[0].id, 'hn_1');
  const missing = await inventory.samples(['arxiv']);
  assert.equal(missing.status, 'unavailable'); assert.deepEqual(missing.rows, []);
});

