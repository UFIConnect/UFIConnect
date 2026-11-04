'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { OFFICE_TOPIC_SCHEMA } = require('./office-topic-transfer');
const { createUnknownTopicGuardian } = require('./unknown-topic-guardian');
const TOPICS = ['Python', 'JavaScript', 'Cybersecurity'];

async function fixture(t, { beforeInitialize, schedule, cancel } = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE feed_posts_cache (
    id TEXT PRIMARY KEY,title TEXT,content TEXT,topic TEXT,source TEXT,source_url TEXT,
    author_name TEXT,media_url TEXT,media_type TEXT,media_poster TEXT,likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,post_created_at TIMESTAMPTZ DEFAULT NOW(),
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),location TEXT,group_id TEXT,
    author_avatar_url TEXT,author_profile_url TEXT,video_duration_seconds INTEGER);
    CREATE TABLE feed_posts_staging(LIKE feed_posts_cache INCLUDING ALL)`);
  for (const sql of OFFICE_TOPIC_SCHEMA) await pg.exec(sql);
  let tail = Promise.resolve(), failurePredicate = null;
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (failurePredicate?.(sql)) throw new Error('Synthetic storage failure');
    const result = await pg.query(sql, params);
    return { ...result, rowCount: result.affectedRows };
  };
  const db = { isConnected: () => true, query, withClient: work => {
    const result = tail.then(() => work({ query })); tail = result.catch(() => {}); return result;
  } };
  const changes = [];
  const service = createUnknownTopicGuardian({ db, topics: TOPICS, onChanged: values => changes.push(values), ...(schedule ? { schedule } : {}), ...(cancel ? { cancel } : {}) });
  const f = { pg, db, service, changes, queries, fail: predicate => { failurePredicate = predicate; } };
  if (beforeInitialize) await beforeInitialize(f);
  await service.initialize();
  t.after(() => service.stop());
  return f;
}

async function insert(f, post, table = 'feed_posts_cache') {
  const columns = Object.keys(post);
  assert.ok(['feed_posts_cache', 'feed_posts_staging'].includes(table));
  assert.ok(columns.every(column => /^[a-z_]+$/.test(column)));
  return f.db.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')})`, Object.values(post));
}
const unknownCount = async f => (await f.pg.query("SELECT count(*)::int count FROM feed_posts_cache WHERE lower(btrim(coalesce(topic,''))) IN ('','unknown','unclassified','uncategorized','general','none','null')")).rows[0].count;
const held = async (f, id) => (await f.pg.query('SELECT * FROM office_unknown_topic_review WHERE post_id=$1', [id])).rows[0];

test('legacy backlog classifies evidence in place and preserves every field of ambiguous posts before removing them from live', async t => {
  const ambiguous = { id: 'ambiguous', title: 'An ordinary afternoon', content: 'A short update with no topic evidence.', topic: null,
    source: 'mastodon', source_url: 'https://example.test/posts/ambiguous', author_name: 'Example author', media_url: 'https://example.test/photo.jpg',
    media_type: 'image', media_poster: 'https://example.test/poster.jpg', likes: 41, comments: 7, location: 'Example city', group_id: 'group-one',
    author_avatar_url: 'https://example.test/avatar.png', author_profile_url: 'https://example.test/author', video_duration_seconds: 24 };
  const f = await fixture(t, { beforeInitialize: async f => {
    await insert(f, ambiguous);
    await insert(f, { id: 'classifiable', title: 'Python Django tutorial', content: 'Build a Python application.', topic: null, source: 'mastodon' });
    await insert(f, { id: 'existing-known', title: 'Already classified', topic: 'Cybersecurity' });
  } });
  const result = await f.service.run({ maxBatches: 1 });
  assert.equal(result.checked, 2);
  assert.equal(result.classified, 1);
  assert.equal(result.held, 1);
  assert.equal(await unknownCount(f), 0);
  assert.equal((await f.pg.query("SELECT topic FROM feed_posts_cache WHERE id='classifiable'")).rows[0].topic, 'Python');
  assert.equal((await f.pg.query("SELECT topic FROM feed_posts_cache WHERE id='existing-known'")).rows[0].topic, 'Cybersecurity');
  const review = await held(f, ambiguous.id);
  for (const [key, value] of Object.entries(ambiguous)) assert.deepEqual(review.post[key], value, key);
  assert.ok(review.post.fetched_at);
  assert.ok(review.post.post_created_at);
  assert.equal((await f.pg.query("SELECT count(*)::int count FROM feed_posts_staging")).rows[0].count, 0, 'Ambiguous content stays out of the promotion queue');
});

test('database admission holds new unknowns even without a running agent and stale unknown upserts preserve known topics', async t => {
  const f = await fixture(t);
  await insert(f, { id: 'known', title: 'Original title', content: 'Original body', topic: 'Python', likes: 2 });
  await f.db.query(`INSERT INTO feed_posts_cache(id,title,content,topic,likes)
    VALUES('known','Refreshed title','Refreshed body',NULL,19)
    ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,topic=EXCLUDED.topic,likes=EXCLUDED.likes`);
  const known = (await f.pg.query("SELECT topic,title,content,likes FROM feed_posts_cache WHERE id='known'")).rows[0];
  assert.deepEqual(known, { topic: 'Python', title: 'Refreshed title', content: 'Refreshed body', likes: 19 });
  await f.db.query(`INSERT INTO feed_posts_cache(id,title,content,topic)
    SELECT 'incoming-' || n,'No topical information','Plain update',NULL FROM generate_series(1,1001) n`);
  assert.equal(await unknownCount(f), 0);
  assert.equal((await f.pg.query('SELECT count(*)::int count FROM office_unknown_topic_review')).rows[0].count, 1001);
  assert.equal(await held(f, 'known'), undefined);
  const restarted = createUnknownTopicGuardian({ db: f.db, topics: TOPICS });
  await restarted.initialize();
  assert.equal((await f.pg.query('SELECT count(*)::int count FROM office_unknown_topic_review')).rows[0].count, 1001, 'Initialization is idempotent and retains review bodies');
});

test('updates of legacy unknowns preserve the newest body through subsequent draining', async t => {
  const f = await fixture(t, { beforeInitialize: f => insert(f, { id: 'legacy-update', title: 'Earlier title', content: 'Earlier body', topic: null }) });
  await f.db.query("UPDATE feed_posts_cache SET title='Latest title',content='Latest complete body',likes=73,fetched_at=NOW()+INTERVAL '1 minute' WHERE id='legacy-update'");
  await f.service.run({ maxBatches: 1 });
  assert.equal(await unknownCount(f), 0);
  const row = await held(f, 'legacy-update');
  assert.equal(row.post.title, 'Latest title');
  assert.equal(row.post.content, 'Latest complete body');
  assert.equal(row.post.likes, 73);
});

test('bounded runs drain a 15000-post backlog to zero while retaining every ambiguous post for review', async t => {
  const f = await fixture(t, { beforeInitialize: f => f.db.query(`INSERT INTO feed_posts_cache(id,title,content,topic)
    SELECT 'legacy-' || lpad(n::text,5,'0'),'Plain update','No topical information',NULL FROM generate_series(1,15000) n`) });
  const first = await f.service.run({ maxBatches: 1 });
  assert.equal(first.checked, 500);
  assert.equal(first.held, 500);
  assert.equal(await unknownCount(f), 14500);
  for (let n = 0; n < 3 && await unknownCount(f); n++) await f.service.run({ maxBatches: 20 });
  assert.equal(await unknownCount(f), 0);
  assert.equal((await f.pg.query('SELECT count(*)::int count FROM office_unknown_topic_review')).rows[0].count, 15000);
  const repeat = await f.service.run({ maxBatches: 1 });
  assert.equal(repeat.checked, 0);
  assert.equal(repeat.held, 0);
});

test('confident review retries restore into staging for screening and do not directly republish', async t => {
  const f = await fixture(t);
  await insert(f, { id: 'retry', title: 'Earlier ambiguous title', content: 'Earlier body', topic: null, source: 'mastodon', likes: 11 });
  await f.db.query(`UPDATE office_unknown_topic_review SET post=post || '{"title":"Python Django tutorial","content":"Build a Python application."}'::jsonb,
    retry_at=NOW()-INTERVAL '1 second' WHERE post_id='retry'`);
  const result = await f.service.run({ maxBatches: 1 });
  assert.equal(result.restored, 1);
  assert.equal((await f.pg.query("SELECT count(*)::int count FROM feed_posts_cache WHERE id='retry'")).rows[0].count, 0);
  const restored = (await f.pg.query("SELECT topic,title,likes FROM feed_posts_staging WHERE id='retry'")).rows[0];
  assert.deepEqual(restored, { topic: 'Python', title: 'Python Django tutorial', likes: 11 });
  assert.equal(await held(f, 'retry'), undefined);
});

test('an unknown upsert of a legacy unknown never replaces its newer preserved body with the older live snapshot', async t => {
  const f = await fixture(t, { beforeInitialize: f => insert(f, { id: 'legacy-upsert', title: 'Earlier title', content: 'Earlier body', topic: null,
    fetched_at: '2026-11-01T00:00:00Z' }) });
  await f.db.query(`INSERT INTO feed_posts_cache(id,title,content,topic,likes,fetched_at)
    VALUES('legacy-upsert','Newer title','Newer complete body',NULL,97,'2026-11-02T00:00:00Z')
    ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,topic=EXCLUDED.topic,likes=EXCLUDED.likes,fetched_at=EXCLUDED.fetched_at`);
  await f.service.run({ maxBatches: 1 });
  assert.equal(await unknownCount(f), 0);
  const review = await held(f, 'legacy-upsert');
  assert.equal(review.post.title, 'Newer title');
  assert.equal(review.post.content, 'Newer complete body');
  assert.equal(review.post.likes, 97);
});

test('failed preservation rolls back classification and removal and a later run recovers safely', async t => {
  const f = await fixture(t, { beforeInitialize: async f => {
    await insert(f, { id: 'must-keep', title: 'Plain update', content: 'No topical evidence', topic: null });
    await insert(f, { id: 'also-rollback', title: 'Python Django tutorial', content: 'Build a Python application.', topic: null });
  } });
  await f.pg.query("ALTER TABLE office_unknown_topic_review ADD CONSTRAINT synthetic_preservation_failure CHECK(post_id<>'must-keep')");
  await assert.rejects(f.service.run({ maxBatches: 1 }));
  assert.equal(await unknownCount(f), 2);
  assert.equal((await f.pg.query('SELECT count(*)::int count FROM office_unknown_topic_review')).rows[0].count, 0);
  assert.equal(f.changes.length, 0, 'No cache callback advertises rolled-back changes');
  const failure = await f.service.snapshot();
  assert.equal(failure.status, 'degraded');
  assert.equal(failure.totalHeld, 0);
  assert.equal(failure.totalClassified, 0);
  await f.pg.query('ALTER TABLE office_unknown_topic_review DROP CONSTRAINT synthetic_preservation_failure');
  const recovered = await f.service.run({ maxBatches: 1 });
  assert.equal(recovered.classified, 1);
  assert.equal(recovered.held, 1);
  assert.equal(await unknownCount(f), 0);
  assert.equal((await f.service.snapshot()).status, 'ready');
});

test('one recovery timer runs automatically and can be stopped and restarted', async () => {
  let scheduled = 0, cancelled = 0, callback;
  const service = createUnknownTopicGuardian({ db: { isConnected: () => false }, topics: TOPICS,
    schedule: (fn, ms) => { assert.equal(ms, 15000); callback = fn; return ++scheduled; },
    cancel: value => { assert.equal(value, scheduled); cancelled++; } });
  service.start(); service.start();
  assert.equal(scheduled, 1);
  assert.equal(typeof callback, 'function');
  callback();
  service.stop(); service.stop();
  assert.equal(cancelled, 1);
  service.start();
  assert.equal(scheduled, 2);
  service.stop();
  assert.equal(cancelled, 2);
});

test('an older held snapshot cannot requeue over a newer known live post', async t => {
  const f = await fixture(t);
  await insert(f, { id: 'superseded', title: 'Python Django tutorial', content: 'Earlier body', topic: null,
    fetched_at: '2026-11-01T00:00:00Z' });
  await insert(f, { id: 'superseded', title: 'Latest classified body', content: 'Newer complete content', topic: 'Cybersecurity',
    fetched_at: '2026-11-02T00:00:00Z' });
  await f.service.run({ maxBatches: 1 });
  assert.equal((await f.pg.query("SELECT count(*)::int count FROM feed_posts_staging WHERE id='superseded'")).rows[0].count, 0);
  assert.equal((await f.pg.query("SELECT content FROM feed_posts_cache WHERE id='superseded'")).rows[0].content, 'Newer complete content');
  assert.equal((await f.service.snapshot()).heldForReview, 0, 'Already live posts are no longer pending review');
  assert.ok((await held(f, 'superseded')).resolved_at, 'The earlier full payload remains preserved as history');
});
