const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { OFFICE_TOPIC_SCHEMA, createOfficeTopicTransfer } = require('./office-topic-transfer');
const { createTopicRoutingAgents, laneForTopic, INTERVAL_MS, PHASE_LIMIT, RULE_VERSION } = require('./topic-routing-agents');
const topics = ['Python', 'JavaScript', 'Cybersecurity', 'AI & Machine Learning'];
const agentFor = topic => `topic_router_${laneForTopic(topic) + 1}`;
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE feed_posts_staging(id TEXT PRIMARY KEY,title TEXT,content TEXT,topic TEXT,fetched_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE feed_posts_cache(LIKE feed_posts_staging INCLUDING ALL)`);
  for (const sql of OFFICE_TOPIC_SCHEMA) await pg.exec(sql);
  let tail = Promise.resolve(), failAssignment = false;
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (failAssignment && sql.includes('INSERT INTO office_feed_topic_assignments')) throw new Error('Synthetic write failure');
    const value = await pg.query(sql, params); return { ...value, rowCount: value.affectedRows };
  };
  const db = { isConnected: () => true, query, withClient: work => {
    const result = tail.then(() => work({ query })); tail = result.catch(() => {}); return result;
  } };
  const changes = [], service = createTopicRoutingAgents({ db, topics, onClassified: values => changes.push(...values) });
  await service.initialize();
  return { pg, db, service, changes, queries, fail: value => { failAssignment = value; } };
}
async function insert(f, post, table = 'feed_posts_staging') {
  await f.db.query(`INSERT INTO ${table}(id,title,content,topic,fetched_at) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,NOW()))`, [post.id,post.title || '',post.content || '',post.topic || null,post.fetched_at || null]);
}
async function classify(f, posts, targetTable = 'feed_posts_staging') {
  return f.db.withClient(async queryRunner => {
    await queryRunner.query('BEGIN');
    try { const result = await f.service.classifyPersisted(posts, { targetTable, queryRunner }); await queryRunner.query('COMMIT'); return result; }
    catch (error) { await queryRunner.query('ROLLBACK'); throw error; }
  });
}
async function ready(f, topic) {
  await f.db.query("UPDATE office_topic_agent_state SET lease_until=NOW()-INTERVAL '1 second',next_run_at=NOW()-INTERVAL '1 second' WHERE lane=$1", [laneForTopic(topic)]);
}
test('four durable topic assignments survive restarts and the loop schedules only one recovery timer', async t => {
  const f = await fixture(t);
  const before = (await f.pg.query('SELECT topic,lane FROM office_topic_agent_assignments ORDER BY topic')).rows;
  assert.equal(before.length, topics.length + 1);
  const other = createTopicRoutingAgents({ db: f.db, topics }); await other.initialize();
  assert.deepEqual((await f.pg.query('SELECT topic,lane FROM office_topic_agent_assignments ORDER BY topic')).rows, before);
  assert.equal(other.definitions().length, 4);
  const observations = await other.snapshot(); assert.equal(observations.agents.flatMap(agent => agent.topics).length, topics.length + 1);
  assert.equal(other.currentSnapshot(), observations);
  let scheduled = 0, cancelled = 0;
  const idle = createTopicRoutingAgents({ db: { isConnected: () => false }, topics, schedule: (_fn, ms) => { assert.equal(ms, INTERVAL_MS); scheduled++; return 123; }, cancel: value => { assert.equal(value, 123); cancelled++; } });
  idle.start(); idle.start(); idle.stop(); assert.equal(scheduled, 1); assert.equal(cancelled, 1);
});
test('the first topic report assigns every observed legacy topic and preserves cached snapshots when assignments already exist', async t => {
  const f = await fixture(t);
  const before = await f.service.snapshot();
  const legacy = Array.from({ length: 105 }, (_, index) => ({ id: `legacy-${index}`, topic: `Legacy topic ${index}` }));
  for (const [index, table] of ['feed_posts_staging', 'feed_posts_cache'].entries()) {
    await f.db.query(`INSERT INTO ${table}(id,topic)
      SELECT id,topic FROM jsonb_to_recordset($1::jsonb) AS x(id TEXT,topic TEXT)`, [JSON.stringify(legacy.filter((_, n) => n % 2 === index))]);
  }
  await insert(f, { id: 'legacy-unknown', topic: 'unclassified' });
  const office = createOfficeTopicTransfer({ db: f.db, topics, topicAgents: f.service });
  const report = await office.report();
  assert.notEqual(report.routing, before, 'New assignments invalidate a previously cached snapshot');
  for (const row of report.topics) assert.equal(row.agentId, agentFor(row.topic), `${row.topic} should have an agent on its first report`);
  assert.equal(report.topics.length, topics.length + legacy.length + 1);
  const stored = (await f.pg.query('SELECT topic,lane FROM office_topic_agent_assignments')).rows;
  assert.equal(stored.length, report.topics.length, 'Unknown aliases share the canonical Unknown assignment');
  for (const row of stored) assert.equal(Number(row.lane), laneForTopic(row.topic));
  assert.equal((await office.report()).routing, report.routing, 'An unchanged topic inventory retains the cached snapshot');
  assert.equal(await f.service.observeTopics(['Unknown', null, 'unclassified']), 0);
});

test('a report waits out a pre-insert snapshot before showing newly observed topic assignments', async t => {
  const f = await fixture(t), originalQuery = f.db.query;
  let releaseRead, captureRead, captureInsert, holdRead = true;
  const readHeld = new Promise(resolve => { captureRead = resolve; });
  const readReleased = new Promise(resolve => { releaseRead = resolve; });
  const inserted = new Promise(resolve => { captureInsert = resolve; });
  f.db.query = async (sql, params) => {
    const result = await originalQuery(sql, params);
    if (holdRead && sql === 'SELECT topic,lane,enabled FROM office_topic_agent_assignments ORDER BY topic') {
      holdRead = false; captureRead(); await readReleased;
    }
    if (sql.startsWith('INSERT INTO office_topic_agent_assignments') && params[0].includes('Concurrent legacy topic')) captureInsert();
    return result;
  };
  const stale = f.service.snapshot();
  await readHeld;
  await insert(f, { id: 'concurrent-legacy', topic: 'Concurrent legacy topic' });
  const reportPending = createOfficeTopicTransfer({ db: f.db, topics, topicAgents: f.service }).report();
  await inserted;
  releaseRead();
  assert.equal((await stale).agents.some(agent => agent.topics.includes('Concurrent legacy topic')), false);
  const report = await reportPending;
  assert.equal(report.topics.find(row => row.topic === 'Concurrent legacy topic').agentId, agentFor('Concurrent legacy topic'));
});

test('immediate routing uses actual current persisted content, skips suppressed/absent rows, and resolves parent plus subtopic atomically', async t => {
  const f = await fixture(t), post = { id: 'fresh', title: 'A Django tutorial using Python', topic: null };
  await insert(f, post);
  const result = await classify(f, [post, { id: 'suppressed', title: 'Python tutorial' }]);
  assert.equal(result.checked, 1); assert.equal(result.assigned, 1); assert.equal(result.resolved, 1);
  const row = (await f.pg.query("SELECT * FROM office_feed_topic_assignments WHERE post_id='fresh'")).rows[0];
  assert.equal(row.topic, 'Python'); assert.equal(row.subtopic, 'Web frameworks'); assert.equal(row.rule_version, RULE_VERSION); assert.equal(row.agent_id, agentFor('Python'));
  assert.equal((await f.pg.query("SELECT topic FROM feed_posts_staging WHERE id='fresh'")).rows[0].topic, 'Python');
  assert.equal((await classify(f, [{ ...post, title: 'Stale different content' }])).processed, 0);
  const snapshot = await f.service.snapshot(); assert.equal(snapshot.agents.find(agent => agent.id === agentFor('Python')).assigned, 1);
  const report = await createOfficeTopicTransfer({ db: f.db, topics, topicAgents: f.service }).report();
  assert.equal(report.topics.find(row => row.topic === 'Python').agentId, agentFor('Python'));
  assert.equal(report.agents.length, 4);
  await f.pg.query("UPDATE feed_posts_staging SET topic=NULL WHERE id='fresh'");
  const repeatedUnknown = await classify(f, [post]);
  assert.equal(repeatedUnknown.resolved, 1);
  assert.deepEqual(repeatedUnknown.changes, [{ id: 'fresh', topic: 'Python', subtopic: 'Web frameworks' }], 'A source rewriting the parent to unknown still updates memory even when prior labels match');
});
test('changed content invalidates routing immediately; metadata-only refresh preserves label and timed retry', async t => {
  const f = await fixture(t), initial = { id: 'updated', title: 'A Django application', topic: 'Python' };
  await insert(f, initial); await classify(f, [initial]);
  const first = (await f.pg.query("SELECT * FROM office_feed_topic_assignments WHERE post_id='updated'")).rows[0];
  await f.pg.query("UPDATE feed_posts_staging SET fetched_at=NOW()+INTERVAL '1 second' WHERE id='updated'");
  const noRework = await classify(f, [initial]); assert.equal(noRework.processed, 1); assert.equal(noRework.checked, 0);
  assert.deepEqual(noRework.changes, []);
  const unchanged = (await f.pg.query("SELECT * FROM office_feed_topic_assignments WHERE post_id='updated'")).rows[0];
  assert.equal(String(unchanged.checked_at), String(first.checked_at)); assert.equal(String(unchanged.retry_at), String(first.retry_at));
  const updated = { ...initial, title: 'Python pandas data analysis' };
  await f.pg.query('UPDATE feed_posts_staging SET title=$2,fetched_at=NOW() WHERE id=$1', [updated.id, updated.title]);
  await classify(f, [updated]);
  assert.equal((await f.pg.query("SELECT subtopic FROM office_feed_topic_assignments WHERE post_id='updated'")).rows[0].subtopic, 'Data & automation');
  const ambiguous = { id: 'ambiguous', title: 'Python and JavaScript', topic: null }; await insert(f, ambiguous); await classify(f, [ambiguous]);
  const unresolved = (await f.pg.query("SELECT * FROM office_feed_topic_assignments WHERE post_id='ambiguous'")).rows[0];
  assert.equal(unresolved.subtopic, null); assert.equal(unresolved.topic, null); assert.equal(unresolved.outcome, 'unclassified');
  assert.ok(Date.parse(unresolved.retry_at) - Date.parse(unresolved.checked_at) >= 29 * 60000);
  const immediate = await f.service.runAgent(agentFor('Unknown')); assert.equal(immediate.checked, 0);
});
test('recovery reserves fresh and oldest capacity in both stages and counts committed work only', async t => {
  const f = await fixture(t);
  const perTable = PHASE_LIMIT * 5;
  for (const table of ['feed_posts_staging', 'feed_posts_cache']) await f.pg.query(`INSERT INTO ${table}(id,title,topic,fetched_at)
    SELECT $1 || n,'Python Django application','Python',NOW() - n * INTERVAL '1 minute' FROM generate_series(1,$2::integer) n`, [table,perTable]);
  const result = await f.service.runAgent(agentFor('Python'));
  assert.equal(result.ok, true); assert.equal(result.checked, PHASE_LIMIT * 4); assert.equal(result.assigned, PHASE_LIMIT * 4);
  const ids = new Set((await f.pg.query('SELECT post_id FROM office_feed_topic_assignments')).rows.map(row => row.post_id));
  assert.ok(ids.has('feed_posts_staging1')); assert.ok(ids.has(`feed_posts_staging${perTable}`)); assert.ok(ids.has('feed_posts_cache1')); assert.ok(ids.has(`feed_posts_cache${perTable}`));
  const snapshot = await f.service.snapshot(), agent = snapshot.agents.find(row => row.id === agentFor('Python'));
  assert.equal(agent.pending, perTable * 2 - PHASE_LIMIT * 4); assert.equal(agent.checked, PHASE_LIMIT * 4); assert.equal(agent.assigned, PHASE_LIMIT * 4); assert.equal(agent.batchLimit, PHASE_LIMIT * 4); assert.equal(agent.status, 'catching_up'); assert.ok(agent.oldestPendingAt); assert.ok(agent.nextRun);
  const state = (await f.pg.query('SELECT * FROM office_topic_agent_state WHERE lane=$1', [laneForTopic('Python')])).rows[0];
  assert.ok(Date.parse(state.lease_until) <= Date.now());
  assert.ok(Date.parse(state.next_run_at) % INTERVAL_MS === 0 || Date.parse(state.next_run_at) === Date.parse(state.last_completed_at), 'Work is due at the next database clock slot, or immediately if that slot passed during processing');
  assert.ok(Date.parse(state.next_run_at) - Date.parse(state.last_started_at) <= Math.max(INTERVAL_MS,Date.parse(state.last_completed_at)-Date.parse(state.last_started_at)), 'Completion never adds another 15-second cooldown');
  await f.pg.query("UPDATE office_topic_agent_state SET next_run_at=NOW()+INTERVAL '15 seconds' WHERE lane=$1", [laneForTopic('Python')]);
  assert.equal((await f.service.runAgent(agentFor('Python'))).skipped, 'not-due-or-leased');
  const manual = await f.service.runAgent(agentFor('Python'), { manual: true });
  assert.equal(manual.ok, true); assert.equal(manual.skipped, undefined, 'Manual work bypasses due time after the active lease is released');
});
test('shared leases prevent duplicate worker runs; expired owners recover; failures roll back labels and retry', async t => {
  const f = await fixture(t), other = createTopicRoutingAgents({ db: f.db, topics }); await other.initialize();
  await insert(f, { id: 'lease', title: 'Python Django application', topic: 'Python' });
  const attempts = await Promise.all([f.service.runAgent(agentFor('Python')), other.runAgent(agentFor('Python'))]);
  assert.equal(attempts.filter(result => result.skipped === 'not-due-or-leased').length, 1); assert.equal(attempts.reduce((sum, result) => sum + (result.checked || 0), 0), 1);
  await insert(f, { id: 'rollback', title: 'Python Django application', topic: 'Python' }); await ready(f, 'Python'); f.fail(true);
  const failed = await other.runAgent(agentFor('Python')); assert.equal(failed.ok, false);
  assert.equal((await f.pg.query("SELECT COUNT(*)::int AS count FROM office_feed_topic_assignments WHERE post_id='rollback'")).rows[0].count, 0);
  assert.equal((await other.snapshot()).agents.find(row => row.id === agentFor('Python')).status, 'degraded');
  f.fail(false); await ready(f, 'Python');
  const recovered = await other.runAgent(agentFor('Python')); assert.equal(recovered.checked, 1); assert.equal(recovered.ok, true);
});
test('staging content takes precedence over older live copies and routing writes roll back with failed persistence', async t => {
  const f = await fixture(t);
  const live = { id: 'shared', title: 'Python pandas data analysis', topic: 'Python' }, staging = { ...live, title: 'Python Django application' };
  await insert(f, live, 'feed_posts_cache'); await insert(f, staging); await classify(f, [staging]);
  assert.equal((await classify(f, [live], 'feed_posts_cache')).processed, 0);
  assert.equal((await f.pg.query("SELECT subtopic FROM office_feed_topic_assignments WHERE post_id='shared'")).rows[0].subtopic, 'Web frameworks');
  await assert.rejects(f.db.withClient(async queryRunner => {
    await queryRunner.query('BEGIN');
    try {
      await queryRunner.query("INSERT INTO feed_posts_staging(id,title,topic) VALUES('failed','Python Django application','Python')");
      await f.service.classifyPersisted([{ id: 'failed', title: 'Python Django application', topic: 'Python' }], { targetTable: 'feed_posts_staging', queryRunner });
      throw new Error('Persistence transaction failed');
    } catch (error) { await queryRunner.query('ROLLBACK'); throw error; }
  }));
  assert.equal((await f.pg.query("SELECT COUNT(*)::int AS count FROM office_feed_topic_assignments WHERE post_id='failed'")).rows[0].count, 0);
  assert.equal((await f.pg.query("SELECT COUNT(*)::int AS count FROM feed_posts_staging WHERE id='failed'")).rows[0].count, 0);
});
test('automatic recovery tick routes new stored posts and removes bounded orphan metadata without manual optimization', async t => {
  const f = await fixture(t);
  await insert(f, { id: 'automatic', title: 'A Python Django application', topic: 'Python' });
  await f.pg.query("INSERT INTO office_feed_topic_assignments(post_id,topic,subtopic) VALUES('orphan','Python','Web frameworks')");
  await f.service.tick();
  assert.equal((await f.pg.query("SELECT subtopic FROM office_feed_topic_assignments WHERE post_id='automatic'")).rows[0].subtopic, 'Web frameworks');
  assert.equal((await f.pg.query("SELECT COUNT(*)::int AS count FROM office_feed_topic_assignments WHERE post_id='orphan'")).rows[0].count, 0);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS count FROM office_topic_agent_state WHERE last_completed_at IS NOT NULL')).rows[0].count, 4);
});
test('manual optimization uses the shared routing metadata and notices changed content before the retry deadline', async t => {
  const f = await fixture(t);
  await insert(f, { id: 'manual', title: 'A Python Django application' });
  const callbacks = [], office = createOfficeTopicTransfer({ db: f.db, topics, topicAgents: f.service, onClassified: changes => callbacks.push(changes) });
  const first = await office.optimizeUnknown({ confirmed: true }); assert.equal(first.updated, 1); assert.equal(first.subtopicsAssigned, 1);
  let row = (await f.pg.query("SELECT * FROM office_feed_topic_assignments WHERE post_id='manual'")).rows[0];
  assert.equal(row.rule_version, RULE_VERSION); assert.equal(row.agent_id, agentFor('Python')); assert.equal(row.subtopic, 'Web frameworks'); assert.ok(row.source_fetched_at); assert.ok(row.content_hash);
  await f.pg.query("UPDATE feed_posts_staging SET title='Python pandas data analysis',fetched_at=NOW() WHERE id='manual'");
  const changed = await office.optimizeUnknown({ confirmed: true }); assert.equal(changed.checked, 1); assert.equal(changed.subtopicsAssigned, 1);
  row = (await f.pg.query("SELECT * FROM office_feed_topic_assignments WHERE post_id='manual'")).rows[0]; assert.equal(row.subtopic, 'Data & automation');
  assert.equal(callbacks.length, 2); assert.equal(callbacks[1][0].subtopic, 'Data & automation');
});
test('multi-chunk persistence updates shared counters once in deterministic lane order', async t => {
  const f = await fixture(t);
  await f.pg.exec(`INSERT INTO feed_posts_staging(id,title,topic)
    SELECT 'bulk-' || lpad(n::text,4,'0'),CASE WHEN n%2=0 THEN 'A Python Django application' ELSE 'Cybersecurity malware report' END,
      CASE WHEN n%2=0 THEN 'Python' ELSE 'Cybersecurity' END FROM generate_series(1,501) n`);
  const posts = (await f.pg.query('SELECT * FROM feed_posts_staging ORDER BY id DESC')).rows;
  const start = f.queries.length, result = await classify(f, posts);
  assert.equal(result.checked, 501); assert.equal(result.assigned, 501);
  const locks = f.queries.slice(start).filter(row => row.sql.startsWith('SELECT lane FROM office_topic_agent_state') && row.sql.includes('FOR UPDATE'));
  assert.equal(locks.length, 1, 'Chunk boundaries do not acquire shared lane locks in different orders');
  assert.deepEqual(locks[0].params[0], [...locks[0].params[0]].sort((a,b) => a-b));
  assert.equal((await f.pg.query('SELECT SUM(checked)::int AS checked,SUM(assigned)::int AS assigned FROM office_topic_agent_state')).rows[0].checked, 501);
});
test('manual staging and live routing defer shared counter locks until both post tables finish', async t => {
  const f = await fixture(t);
  await insert(f, { id: 'manual-staged', title: 'A Python Django application', topic: 'Python' });
  await insert(f, { id: 'manual-live', title: 'Cybersecurity malware report', topic: 'Cybersecurity' }, 'feed_posts_cache');
  const office = createOfficeTopicTransfer({ db: f.db, topics, topicAgents: f.service });
  const start = f.queries.length, result = await office.optimizeUnknown({ confirmed: true });
  assert.equal(result.checked, 2); assert.equal(result.subtopicsAssigned, 2);
  const queries = f.queries.slice(start);
  const locks = queries.map((row,index) => ({ ...row,index })).filter(row => row.sql.startsWith('SELECT lane FROM office_topic_agent_state') && row.sql.includes('FOR UPDATE'));
  assert.equal(locks.length, 1, 'One combined counter flush owns both table results');
  const postWrites = queries.map((row,index) => ({ ...row,index })).filter(row => /UPDATE feed_posts_(?:staging|cache) p SET topic/.test(row.sql));
  assert.equal(postWrites.length, 2);
  assert.ok(postWrites.every(row => row.index < locks[0].index), 'No new post-table locks are acquired after shared counters are locked');
  assert.equal((await f.pg.query('SELECT SUM(checked)::int AS checked,SUM(assigned)::int AS assigned FROM office_topic_agent_state')).rows[0].checked, 2);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS count FROM office_feed_topic_assignments')).rows[0].count, 2);
});
