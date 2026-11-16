'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createUnknownTopicReview } = require('./unknown-topic-review');

const connectionString = process.env.HELD_GROUP_TEST_POSTGRES_URL;

test('independent PostgreSQL sessions protect the grouping lease and resume a killed transaction',
  { skip: !connectionString && 'Set HELD_GROUP_TEST_POSTGRES_URL to a disposable local PostgreSQL instance.', timeout: 30000 }, async t => {
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname), 'Use a local test database.');
    const schema = `held_groups_test_${randomUUID().replace(/-/g, '')}`;
    const admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); }
    });
    await pool.query(`CREATE TABLE feed_posts_cache(id TEXT PRIMARY KEY);
      CREATE TABLE feed_posts_staging(LIKE feed_posts_cache INCLUDING ALL);
      CREATE TABLE office_unknown_topic_review(post_id TEXT PRIMARY KEY,post JSONB NOT NULL,
        first_held_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_held_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),resolved_at TIMESTAMPTZ);
      INSERT INTO office_unknown_topic_review(post_id,post,first_held_at)
      SELECT 'old-'||n,'{"title":"Python Django tutorial"}',NOW()+n*INTERVAL '1 microsecond' FROM generate_series(1,611) n`);

    const db = { isConnected: () => true, query: pool.query.bind(pool), withClient: async work => {
      const client = await pool.connect();
      try { return await work(client); } finally { client.release(); }
    } };
    const makeService = (database = db) => createUnknownTopicReview({ db: database, topics: ['Python'] });
    const first = makeService(); await first.initialize();
    const second = makeService(); await second.initialize();
    assert.equal((await first.indexGroups()).processed, 200);

    const atCommit = Promise.withResolvers(), resume = Promise.withResolvers();
    let intercept = false;
    const instrumented = makeService({ ...db, withClient: work => db.withClient(async client => {
      if (!intercept) return work(client);
      const onTermination = () => {};
      client.on('error', onTermination);
      try {
        return await work({ query: async (sql, params) => {
          if (sql === 'COMMIT') {
            const disconnected = new Promise(resolve => client.once('end', resolve));
            atCommit.resolve({ pid: client.processID, disconnected });
            await resume.promise;
          }
          return client.query(sql, params);
        } });
      } finally { client.removeListener('error', onTermination); }
    }) });
    await instrumented.initialize();
    intercept = true;
    const inFlight = instrumented.indexGroups();
    const rejected = assert.rejects(inFlight, /terminated|terminating|connection/i);
    try {
      const { pid, disconnected } = await Promise.race([atCommit.promise, inFlight.then(() => assert.fail('Batch did not reach the commit boundary.'))]);
      assert.deepEqual(await second.indexGroups(), { ok: true, processed: 0, busy: true });
      assert.equal((await second.groupProgress()).indexed, 200);
      assert.equal((await admin.query('SELECT pg_terminate_backend($1, 5000) AS stopped', [pid])).rows[0].stopped, true);
      await disconnected;
    } finally { resume.resolve(); }
    await rejected;
    assert.equal((await pool.query('SELECT scan_after_id FROM office_held_group_state')).rows[0].scan_after_id, 'old-200');
    const restarted = makeService(); await restarted.initialize();
    const batches = [];
    for (let i = 0; i < 4; i++) batches.push((await restarted.indexGroups()).processed);
    assert.deepEqual(batches, [200, 200, 11, 0]);
    assert.equal((await restarted.groupProgress()).status, 'complete');
    assert.deepEqual((await pool.query(`SELECT COUNT(*)::int AS indexed,COUNT(DISTINCT indexed_generation)::int AS generations
      FROM office_unknown_topic_review_groups`)).rows[0], { indexed: 611, generations: 611 });

    await pool.query(`INSERT INTO office_unknown_topic_review(post_id,post) VALUES('locked','{"title":"Python"}'),('open','{"title":"Python"}')`);
    await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SELECT 1 FROM office_unknown_topic_review WHERE post_id='locked' FOR UPDATE");
        assert.equal((await restarted.indexGroups()).processed, 1);
        assert.equal((await restarted.groupProgress()).remaining, 1);
      } finally { await client.query('ROLLBACK'); }
    });
    assert.equal((await second.indexGroups()).processed, 1);
    assert.equal((await restarted.groupProgress()).status, 'complete');
  });
