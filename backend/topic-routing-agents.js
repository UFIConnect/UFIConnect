'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { classifyTopic, classifySubtopic, isUnknownTopic, UNKNOWN } = require('./office-topic-transfer');
const INTERVAL_MS = 15000;
const RULE_VERSION = 'topic-routing-v2';
const LANE_COUNT = 4;
const PHASE_LIMIT = 100;
const TABLES = ['feed_posts_staging', 'feed_posts_cache'];
const TOPIC_ROUTING_SCHEMA = [
  `ALTER TABLE office_feed_topic_assignments ADD COLUMN IF NOT EXISTS content_hash TEXT`,
  `ALTER TABLE office_feed_topic_assignments ADD COLUMN IF NOT EXISTS rule_version TEXT`,
  `ALTER TABLE office_feed_topic_assignments ADD COLUMN IF NOT EXISTS agent_id TEXT`,
  `ALTER TABLE office_feed_topic_assignments ADD COLUMN IF NOT EXISTS outcome TEXT`,
  `ALTER TABLE office_feed_topic_assignments ADD COLUMN IF NOT EXISTS retry_at TIMESTAMPTZ`,
  `ALTER TABLE office_feed_topic_assignments ADD COLUMN IF NOT EXISTS source_fetched_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS office_topic_assignment_retry ON office_feed_topic_assignments(retry_at)`,
  `CREATE TABLE IF NOT EXISTS office_topic_agent_assignments (
    topic TEXT PRIMARY KEY, lane SMALLINT NOT NULL CHECK(lane BETWEEN 0 AND 3), enabled BOOLEAN NOT NULL DEFAULT true,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS office_topic_agent_state (
    lane SMALLINT PRIMARY KEY CHECK(lane BETWEEN 0 AND 3), lease_owner TEXT, lease_until TIMESTAMPTZ,
    running BOOLEAN NOT NULL DEFAULT false, last_started_at TIMESTAMPTZ, last_completed_at TIMESTAMPTZ, last_ingest_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ, last_error TEXT, checked BIGINT NOT NULL DEFAULT 0, assigned BIGINT NOT NULL DEFAULT 0,
    resolved BIGINT NOT NULL DEFAULT 0, last_checked INTEGER NOT NULL DEFAULT 0, last_assigned INTEGER NOT NULL DEFAULT 0,
    last_resolved INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS office_topic_routing_scan (
    table_name TEXT PRIMARY KEY CHECK(table_name IN ('feed_posts_staging','feed_posts_cache')),
    cursor_id TEXT NOT NULL DEFAULT '', next_scan_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];
const agentId = lane => `topic_router_${lane + 1}`;
const canonicalTopic = topic => isUnknownTopic(topic) ? 'Unknown' : String(topic);
function laneForTopic(topic) {
  return createHash('sha256').update(canonicalTopic(topic)).digest().readUInt32BE(0) % LANE_COUNT;
}
function contentHash(post) {
  return createHash('md5').update([post.title || '', post.content || '', post.topic || ''].join('\x1f')).digest('hex');
}
const hashSql = alias => `md5(COALESCE(${alias}.title,'') || chr(31) || COALESCE(${alias}.content,'') || chr(31) || COALESCE(${alias}.topic,''))`;
const canonicalSql = alias => `CASE WHEN lower(btrim(COALESCE(${alias}.topic,'')))=ANY($1::text[]) THEN 'Unknown' ELSE ${alias}.topic END`;
const pendingSql = (post, assignment) => `(${assignment}.post_id IS NULL OR ${assignment}.topic IS DISTINCT FROM ${post}.topic
  OR ${assignment}.rule_version IS DISTINCT FROM $2::text OR ${assignment}.source_fetched_at IS DISTINCT FROM ${post}.fetched_at
  OR ${assignment}.retry_at <= NOW())`;
const failure = (status, message) => Object.assign(new Error(message), { status });

function createTopicRoutingAgents({ db, topics, onClassified = () => {}, now = Date.now, schedule = setInterval, cancel = clearInterval }) {
  const owner = randomUUID(), busy = new Set();
  let timer = null, ticking = false, initialized = false, snapshotCache = null, snapshotInFlight = null, lastDiscovery = 0;
  const definitions = () => Array.from({ length: LANE_COUNT }, (_, lane) => ({
    id: agentId(lane), name: `Topic routing ${lane + 1}`, emoji: '🏷️', category: 'Topic routing', serviceRole: 'api',
    description: 'Classifies new and retained posts into their assigned topic and an evidence-backed subtopic. Ambiguous matches stay Unclassified and retry later.', intervalMs: INTERVAL_MS, batchLimit: PHASE_LIMIT * TABLES.length * 2,
  }));
  const laneFromId = id => { const lane = definitions().findIndex(item => item.id === id); if (lane < 0) throw failure(400, 'Unknown topic routing agent.'); return lane; };
  async function seedTopics(values, queryRunner = db) {
    const names = [...new Set(values.map(canonicalTopic))];
    if (!names.length) return;
    await queryRunner.query(`INSERT INTO office_topic_agent_assignments(topic,lane)
      SELECT topic,lane FROM jsonb_to_recordset($1::jsonb) AS x(topic TEXT,lane SMALLINT)
      ON CONFLICT(topic) DO NOTHING`, [JSON.stringify(names.map(topic => ({ topic, lane: laneForTopic(topic) })))]);
  }
  async function initialize() {
    if (!db.isConnected()) throw failure(503, 'Topic routing storage is unavailable.');
    // Migrations are also safe to call directly in an isolated service fixture.
    for (const sql of TOPIC_ROUTING_SCHEMA) await db.query(sql);
    await seedTopics([...topics, 'Unknown']);
    await db.query(`INSERT INTO office_topic_agent_state(lane) SELECT generate_series(0,3) ON CONFLICT(lane) DO NOTHING`);
    await db.query("INSERT INTO office_topic_routing_scan(table_name) VALUES('feed_posts_staging'),('feed_posts_cache') ON CONFLICT(table_name) DO NOTHING");
    initialized = true; snapshotCache = null;
  }
  function decision(post) {
    const inferred = isUnknownTopic(post.topic) ? classifyTopic(post, topics) : null;
    const topic = inferred?.topic || post.topic || null;
    const subtopic = isUnknownTopic(topic) ? null : classifySubtopic(post, topic);
    return { id: String(post.id), original_topic: post.topic || null, original_hash: contentHash(post), topic, subtopic,
      content_hash: contentHash({ ...post, topic }), outcome: subtopic ? 'assigned' : 'unclassified', resolved: Boolean(inferred && inferred.topic !== post.topic), rechecked: true };
  }
  async function flushStats(values, { queryRunner } = {}) {
    if (!queryRunner?.query) throw new Error('Topic routing stats require the persistence transaction query runner.');
    const byLane = new Map();
    for (const value of values || []) {
      const row = byLane.get(value.lane) || { lane: value.lane, checked: 0, assigned: 0, resolved: 0 };
      row.checked += value.checked; row.assigned += value.assigned; row.resolved += value.resolved; byLane.set(value.lane, row);
    }
    if (!byLane.size) return;
    const stats = [...byLane.values()].sort((a,b) => a.lane - b.lane);
    // Flush only after all post tables in the caller's transaction are done.
    // All chunks/tables acquire shared counter locks once, in the same order.
    await queryRunner.query('SELECT lane FROM office_topic_agent_state WHERE lane=ANY($1::smallint[]) ORDER BY lane FOR UPDATE', [stats.map(row => row.lane)]);
    await queryRunner.query(`UPDATE office_topic_agent_state s SET checked=s.checked+x.checked,assigned=s.assigned+x.assigned,
      resolved=s.resolved+x.resolved,last_ingest_at=NOW()
      FROM jsonb_to_recordset($1::jsonb) AS x(lane SMALLINT,checked INTEGER,assigned INTEGER,resolved INTEGER) WHERE s.lane=x.lane`, [JSON.stringify(stats)]);
  }
  async function classifyPersisted(posts, { targetTable, queryRunner, trackStats = true } = {}) {
    if (!TABLES.includes(targetTable)) throw failure(400, 'Unsupported topic routing table.');
    if (!queryRunner?.query) throw new Error('Topic routing requires the persistence transaction query runner.');
    const candidates = [...new Map((posts || []).filter(post => post?.id).map(post => [String(post.id), post])).values()];
    const result = { processed: 0, checked: 0, assigned: 0, resolved: 0, changes: [] };
    const statsByLane = new Map();
    for (let offset = 0; offset < candidates.length; offset += 500) {
      const selected = candidates.slice(offset, offset + 500).sort((a,b) => String(a.id).localeCompare(String(b.id)));
      const prior = await queryRunner.query('SELECT * FROM office_feed_topic_assignments WHERE post_id=ANY($1::text[])', [selected.map(post => String(post.id))]);
      const priorById = new Map(prior.rows.map(row => [row.post_id, row]));
      const batch = selected.map(post => {
        const previous = priorById.get(String(post.id)), hash = contentHash(post);
        // A likes/count-only refresh changes fetched_at but not text. Refresh
        // the observed timestamp without reclassifying or postponing retry.
        if (previous?.content_hash === hash && previous.rule_version === RULE_VERSION && Date.parse(previous.retry_at) > now()) {
          return { id: String(post.id), original_topic: post.topic || null, original_hash: hash, topic: previous.topic,
            subtopic: previous.subtopic, content_hash: hash, outcome: previous.outcome, resolved: false,
            rechecked: false, checked_at: previous.checked_at, retry_at: previous.retry_at };
        }
        return decision(post);
      });
      await seedTopics(batch.map(row => row.topic), queryRunner);
      // Lock only matching current rows. An old collector response cannot
      // attach a stale label to a newer stored body. Staging is authoritative
      // while the same ID exists there; promotion will retain its assignment.
      const { rows } = await queryRunner.query(`WITH incoming AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id TEXT,original_topic TEXT,original_hash TEXT,topic TEXT,subtopic TEXT,content_hash TEXT,outcome TEXT,resolved BOOLEAN,rechecked BOOLEAN,checked_at TIMESTAMPTZ,retry_at TIMESTAMPTZ)
      ), current_rows AS MATERIALIZED (
        SELECT p.id FROM ${targetTable} p JOIN incoming i ON i.id=p.id
        JOIN office_topic_agent_assignments enabled_routing ON enabled_routing.topic=CASE WHEN lower(btrim(COALESCE(i.topic,'')))=ANY($3::text[]) THEN 'Unknown' ELSE i.topic END AND enabled_routing.enabled
        WHERE ${hashSql('p')}=i.original_hash
          ${targetTable === 'feed_posts_cache' ? "AND NOT EXISTS(SELECT 1 FROM feed_posts_staging staging WHERE staging.id=p.id AND (staging.topic IS DISTINCT FROM p.topic OR staging.title IS DISTINCT FROM p.title OR staging.content IS DISTINCT FROM p.content))" : ''}
        FOR UPDATE OF p
      ), updated AS (
        UPDATE ${targetTable} p SET topic=i.topic FROM incoming i,current_rows c
        WHERE p.id=c.id AND i.id=p.id RETURNING p.id,p.topic,p.fetched_at
      ), recorded AS (
        INSERT INTO office_feed_topic_assignments(post_id,topic,subtopic,content_hash,rule_version,agent_id,outcome,checked_at,retry_at,source_fetched_at)
        SELECT i.id,i.topic,i.subtopic,i.content_hash,$2,'topic_router_' || (routing.lane+1),i.outcome,
          CASE WHEN i.rechecked THEN NOW() ELSE i.checked_at END,
          CASE WHEN i.rechecked THEN NOW() + CASE WHEN i.subtopic IS NULL THEN INTERVAL '30 minutes' ELSE INTERVAL '1 day' END ELSE i.retry_at END,u.fetched_at
        FROM incoming i JOIN updated u ON u.id=i.id
        JOIN office_topic_agent_assignments routing ON routing.topic=CASE WHEN lower(btrim(COALESCE(i.topic,'')))=ANY($3::text[]) THEN 'Unknown' ELSE i.topic END
        WHERE routing.enabled
        ON CONFLICT(post_id) DO UPDATE SET topic=EXCLUDED.topic,subtopic=EXCLUDED.subtopic,content_hash=EXCLUDED.content_hash,
          rule_version=EXCLUDED.rule_version,agent_id=EXCLUDED.agent_id,outcome=EXCLUDED.outcome,checked_at=EXCLUDED.checked_at,retry_at=EXCLUDED.retry_at,source_fetched_at=EXCLUDED.source_fetched_at
        RETURNING post_id,topic,subtopic,agent_id
      ) SELECT r.post_id AS id,r.topic,r.subtopic,r.agent_id,i.resolved,i.rechecked FROM recorded r JOIN incoming i ON i.id=r.post_id`, [JSON.stringify(batch), RULE_VERSION, UNKNOWN]);
      result.processed += rows.length;
      result.checked += rows.filter(row => row.rechecked).length;
      result.assigned += rows.filter(row => row.rechecked && row.subtopic).length;
      result.resolved += rows.filter(row => row.resolved).length;
      result.changes.push(...rows.filter(row => {
        const previous = priorById.get(row.id);
        return row.resolved || previous?.topic !== row.topic && previous !== undefined
          || (previous?.subtopic || null) !== (row.subtopic || null);
      }).map(({ id, topic, subtopic }) => ({ id, topic, subtopic })));
      if (rows.some(row => row.rechecked)) {
        for (const row of rows.filter(row => row.rechecked)) {
          const lane = laneFromId(row.agent_id), counts = statsByLane.get(lane) || { lane, checked: 0, assigned: 0, resolved: 0 };
          counts.checked++; counts.assigned += row.subtopic ? 1 : 0; counts.resolved += row.resolved ? 1 : 0; statsByLane.set(lane, counts);
        }
      }
    }
    result.stats = [...statsByLane.values()];
    if (trackStats) await flushStats(result.stats, { queryRunner });
    return result;
  }
  async function discoverLegacyTopics() {
    // Keyset cursors bound the rows read while eventually reaching legacy
    // categories anywhere in storage. Due rows coordinate this across workers.
    await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        const scans = await client.query('SELECT table_name,cursor_id FROM office_topic_routing_scan WHERE next_scan_at<=NOW() ORDER BY table_name FOR UPDATE SKIP LOCKED');
        for (const scan of scans.rows) {
          if (!TABLES.includes(scan.table_name)) continue;
          const { rows } = await client.query(`SELECT id,topic FROM ${scan.table_name} WHERE id>$1 ORDER BY id LIMIT 1000`, [scan.cursor_id]);
          await seedTopics(rows.map(row => row.topic), client);
          await client.query("UPDATE office_topic_routing_scan SET cursor_id=$2,next_scan_at=NOW()+INTERVAL '1 minute' WHERE table_name=$1", [scan.table_name,rows.length === 1000 ? rows.at(-1).id : '']);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    });
  }
  async function runAgent(id, { manual = false } = {}) {
    const lane = laneFromId(id);
    if (!initialized || !db.isConnected()) return { ok: false, skipped: 'storage-unavailable', checked: 0, assigned: 0, resolved: 0 };
    if (busy.has(lane)) return { ok: true, skipped: 'running', checked: 0, assigned: 0, resolved: 0 };
    busy.add(lane);
    let claimed = false;
    try {
      const claim = await db.query(`UPDATE office_topic_agent_state SET lease_owner=$2,lease_until=NOW()+INTERVAL '45 seconds',running=true,last_started_at=NOW()
        WHERE lane=$1 AND (lease_until IS NULL OR lease_until <= NOW())
          AND ($3::boolean OR next_run_at IS NULL OR next_run_at <= NOW()) RETURNING lane`, [lane, owner, manual === true]);
      if (!claim.rows.length) return { ok: true, skipped: 'not-due-or-leased', checked: 0, assigned: 0, resolved: 0 };
      claimed = true;
      const totals = { checked: 0, assigned: 0, resolved: 0, changes: [] };
      const committed = await db.withClient(async client => {
        await client.query('BEGIN');
        try {
          const lock = await client.query('SELECT pg_try_advisory_xact_lock(721431,$1) AS locked', [lane]);
          if (!lock.rows[0]?.locked) { await client.query('ROLLBACK'); return false; }
          await client.query("SET LOCAL statement_timeout = '5000ms'");
          // Fresh and oldest work each receive reserved slots. An ongoing
          // stream of new posts cannot starve retained live backfill.
          for (const targetTable of TABLES) for (const order of ['DESC', 'ASC']) {
            const { rows } = await client.query(`SELECT p.id,p.title,p.content,p.topic FROM ${targetTable} p
              JOIN office_topic_agent_assignments routing ON routing.topic=${canonicalSql('p')} AND routing.lane=$3 AND routing.enabled
              LEFT JOIN office_feed_topic_assignments a ON a.post_id=p.id
              WHERE ${pendingSql('p', 'a')}
                ${targetTable === 'feed_posts_cache' ? 'AND NOT EXISTS(SELECT 1 FROM feed_posts_staging staging WHERE staging.id=p.id)' : ''}
              ORDER BY p.fetched_at ${order},p.id ${order} LIMIT $4 FOR UPDATE OF p SKIP LOCKED`, [UNKNOWN, RULE_VERSION, lane, PHASE_LIMIT]);
            const result = await classifyPersisted(rows, { targetTable, queryRunner: client, trackStats: false });
            totals.checked += result.checked; totals.assigned += result.assigned; totals.resolved += result.resolved; totals.changes.push(...result.changes);
          }
          const completion = await client.query(`UPDATE office_topic_agent_state SET running=false,lease_until=NOW(),
            next_run_at=GREATEST(to_timestamp((floor(extract(epoch FROM last_started_at)/15)+1)*15),NOW()),last_completed_at=NOW(),last_error=NULL,
            checked=checked+$3,assigned=assigned+$4,resolved=resolved+$5,last_checked=$3,last_assigned=$4,last_resolved=$5
            WHERE lane=$1 AND lease_owner=$2 RETURNING lane`, [lane, owner, totals.checked, totals.assigned, totals.resolved]);
          if (!completion.rows.length) throw new Error('Topic routing lease changed before commit.');
          await client.query('COMMIT'); return true;
        } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      });
      if (!committed) {
        await db.query("UPDATE office_topic_agent_state SET running=false,lease_until=NOW(),next_run_at=NOW()+INTERVAL '15 seconds' WHERE lane=$1 AND lease_owner=$2", [lane, owner]);
        return { ok: true, skipped: 'locked', checked: 0, assigned: 0, resolved: 0 };
      }
      snapshotCache = null;
      try { onClassified(totals.changes); } catch { /* Durable routing already committed; transient caches reload normally. */ }
      return { ok: true, ...totals };
    } catch (error) {
      if (claimed) await db.query(`UPDATE office_topic_agent_state SET running=false,lease_until=NOW(),
        next_run_at=NOW()+INTERVAL '15 seconds',last_error='Topic routing could not finish; retained work will retry.'
        WHERE lane=$1 AND lease_owner=$2`, [lane, owner]).catch(() => {});
      snapshotCache = null;
      return { ok: false, error: 'Topic routing could not finish; retained work will retry.', checked: 0, assigned: 0, resolved: 0 };
    } finally { busy.delete(lane); }
  }
  async function tick() {
    if (ticking || !initialized || !db.isConnected()) return;
    ticking = true;
    try {
      if (now() - lastDiscovery >= 60000) {
        try {
          await discoverLegacyTopics();
          await db.withClient(async client => {
            await client.query('BEGIN');
            try {
              await client.query("SET LOCAL statement_timeout = '5000ms'");
              await client.query(`DELETE FROM office_feed_topic_assignments WHERE post_id IN (
                SELECT a.post_id FROM office_feed_topic_assignments a WHERE NOT EXISTS(SELECT 1 FROM feed_posts_staging s WHERE s.id=a.post_id)
                AND NOT EXISTS(SELECT 1 FROM feed_posts_cache live WHERE live.id=a.post_id) LIMIT 200)`);
              await client.query('COMMIT');
            } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
          });
        } catch { /* Maintenance failures must not prevent known-topic routing. */ }
        finally { lastDiscovery = now(); }
      }
      // A single timer owns the four logical lanes. Database leases coordinate
      // API workers; pipeline processes call only the persistence hook.
      for (const definition of definitions()) await runAgent(definition.id);
    } finally { ticking = false; }
  }
  function start() {
    if (timer) return;
    timer = schedule(() => { void tick().catch(() => {}); }, INTERVAL_MS); timer?.unref?.();
    snapshotCache = null;
    void tick().catch(() => {});
  }
  function stop() { if (timer) cancel(timer); timer = null; snapshotCache = null; }
  async function snapshot() {
    if (!db.isConnected()) throw failure(503, 'Topic routing storage is unavailable.');
    if (snapshotCache && now() - snapshotCache.at < 5000) return snapshotCache.value;
    if (snapshotInFlight) return snapshotInFlight;
    snapshotInFlight = readSnapshot();
    try { return await snapshotInFlight; } finally { snapshotInFlight = null; }
  }
  function currentSnapshot() {
    return snapshotCache?.value || { enabled: initialized && Boolean(timer), intervalMs: INTERVAL_MS, ruleVersion: RULE_VERSION, observedAt: null,
      agents: definitions().map((definition,lane) => ({ ...definition, topics: [...topics,'Unknown'].filter(topic => laneForTopic(topic) === lane),
        status: 'waiting', lastRun: null, nextRun: null, checked: null, assigned: null, resolved: null, pending: null,
        oldestPendingAt: null, lagMs: null, error: null, running: false, enabled: initialized && Boolean(timer) })) };
  }
  async function readSnapshot() {
    const [states, assignments, work] = await Promise.all([
      db.query('SELECT * FROM office_topic_agent_state ORDER BY lane'),
      db.query('SELECT topic,lane,enabled FROM office_topic_agent_assignments ORDER BY topic'),
      db.query(`SELECT routing.lane,COUNT(*)::int AS pending,
        MIN(CASE WHEN a.post_id IS NOT NULL AND a.topic IS NOT DISTINCT FROM p.topic AND a.rule_version=$2
          AND a.source_fetched_at IS NOT DISTINCT FROM p.fetched_at THEN a.retry_at ELSE p.fetched_at END) AS oldest_pending_at
        FROM (SELECT id,topic,fetched_at FROM feed_posts_staging
          UNION ALL SELECT live.id,live.topic,live.fetched_at FROM feed_posts_cache live
          WHERE NOT EXISTS(SELECT 1 FROM feed_posts_staging staged WHERE staged.id=live.id)) p
        JOIN office_topic_agent_assignments routing ON routing.topic=${canonicalSql('p')} AND routing.enabled
        LEFT JOIN office_feed_topic_assignments a ON a.post_id=p.id WHERE ${pendingSql('p', 'a')} GROUP BY routing.lane`, [UNKNOWN, RULE_VERSION]),
    ]);
    const agents = definitions().map((definition, lane) => {
      const state = states.rows.find(row => Number(row.lane) === lane) || {}, backlog = work.rows.find(row => Number(row.lane) === lane);
      const pending = Number(backlog?.pending || 0), oldestPendingAt = backlog?.oldest_pending_at || null;
      const running = Boolean(state.running && Date.parse(state.lease_until) > now());
      const lagMs = oldestPendingAt ? Math.max(0, now() - Date.parse(oldestPendingAt)) : 0;
      return { ...definition, topics: assignments.rows.filter(row => Number(row.lane) === lane && row.enabled).map(row => row.topic),
        status: running ? 'running' : state.last_error ? 'degraded' : !state.last_completed_at && !state.last_ingest_at ? 'waiting' : pending && lagMs > INTERVAL_MS * 2 ? 'catching_up' : 'ready',
        lastRun: state.last_completed_at || null, nextRun: state.next_run_at || null,
        lastIngest: state.last_ingest_at || null,
        checked: Number(state.checked || 0), assigned: Number(state.assigned || 0), resolved: Number(state.resolved || 0),
        lastChecked: Number(state.last_checked || 0), lastAssigned: Number(state.last_assigned || 0),
        pending, oldestPendingAt, lagMs, error: state.last_error || null, running, enabled: initialized && Boolean(timer) };
    });
    const value = { enabled: initialized && Boolean(timer), intervalMs: INTERVAL_MS, ruleVersion: RULE_VERSION, observedAt: new Date(now()).toISOString(), agents,
      note: 'New writes are classified in their persistence transaction. Recovery runs every 15 seconds with a bounded workload; backlog age is observed, not a completion-time guarantee. Ambiguous matches retry after 30 minutes.' };
    snapshotCache = { at: now(), value }; return value;
  }
  return { initialize, definitions, snapshot, currentSnapshot, runAgent, start, stop, tick, classifyPersisted, flushStats, decision, ruleVersion: RULE_VERSION };
}
module.exports = { TOPIC_ROUTING_SCHEMA, INTERVAL_MS, RULE_VERSION, LANE_COUNT, PHASE_LIMIT, laneForTopic, contentHash, createTopicRoutingAgents };
