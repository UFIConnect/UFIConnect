/**
 * db.js — PostgreSQL connection with graceful in-memory fallback.
 *
 * If DATABASE_URL is set and reachable → useDB = true, all queries
 * run against PostgreSQL.  If the env var is missing or the first
 * connection attempt fails → useDB = false and the app continues
 * with the in-memory mock data already defined in index.js.
 *
 * Optional DATABASE_URL_BACKUP adds read failover for the specific
 * queries that call readQuery() instead of query() — see the comment
 * above readQuery() for exactly what that does and doesn't cover.
 */

const { Pool } = require('pg');

let pool = null;             // primary — general purpose, all writes + most reads
let primaryReadPool = null;  // primary, same DB — short statement_timeout, used only by readQuery()'s first attempt
let backupPool = null;       // secondary DB — read-only failover target for readQuery()
let _connected = false;
let _backupConnected = false;

// Circuit breaker for readQuery(), same shape as the outage breakers already
// used elsewhere in this app (see blueskyAnonOutageUntil/redditAnonOutageUntil
// in index.js): trips after consecutive primary read failures, skips the
// primary entirely for a cooldown window so a struggling primary isn't also
// stuck serving requests already destined to fail, then retries automatically.
let primaryReadOutageUntil = 0;
let primaryReadConsecutiveFailures = 0;
const READ_FAILURE_THRESHOLD = 3;
const READ_OUTAGE_COOLDOWN_MS = 60_000;
const READ_STATEMENT_TIMEOUT_MS = 8_000;
const BACKUP_STATEMENT_TIMEOUT_MS = 15_000;

async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.log('ℹ️  DATABASE_URL not set — running with in-memory data.');
    return;
  }

  const sslOpt = process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔗 Connecting to PostgreSQL (attempt ${attempt}/${maxRetries})...`);
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: sslOpt,
        // Confirmed live (2026-08-19) as a real bottleneck, not just headroom
        // math: getCursorFeedPage (the video feed, and /feed?sort=newest)
        // fires one query per source via Promise.all, and AGGREGATE_FEED_SOURCES
        // is 36 sources when no source filter is applied — a single such
        // request alone needs more connections than a max:20 pool provides,
        // so the rest queue for a free slot (up to connectionTimeoutMillis
        // each) before their own query even starts. 40 is still well inside
        // the ~97 connection headroom on the Standard plan, leaving room for
        // concurrent background-worker activity on the same pool. The real
        // fix is switching getCursorFeedPage to the single-query
        // ROW_NUMBER()-partition-by-source pattern getBalancedFeedPosts
        // already uses instead of N parallel per-source queries — this is
        // the immediate relief while that lands.
        max: 40,                             // was 20, briefly 10 before that
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 30_000,    // Was 15s — background jobs were queuing past that under load
        statement_timeout: 120_000,          // Increased to 2 minutes for slow queries
      });

      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      _connected = true;
      console.log('✅ PostgreSQL connected');
      // Separate, smaller pool against the SAME primary DB, dedicated to
      // readQuery()'s first attempt. A short statement_timeout here is what
      // lets a genuinely overloaded primary get detected and failed over to
      // backup in ~8s, instead of every readQuery() caller riding out the
      // main pool's full 120s statement_timeout first — that 120s wait with
      // an empty-feed result at the end of it is exactly what real users hit
      // on 2026-08-20 (see the getCursorFeedPage timeRange fix + this file).
      primaryReadPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: sslOpt,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        statement_timeout: READ_STATEMENT_TIMEOUT_MS,
      });
      return;
    } catch (err) {
      console.warn(
        `⚠️  PostgreSQL connection failed (attempt ${attempt}/${maxRetries}):\n  ` +
        `Error: ${err.message}\n  Code: ${err.code || 'unknown'}`,
      );
      pool = null;
      _connected = false;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
      }
    }
  }
  console.warn('⚠️  PostgreSQL unavailable after all retries — using in-memory data.');
}

// Optional read-failover target for the primary going down or overloaded.
// Only feed_posts_cache is kept in sync here (see startBackupSync below),
// and only the two hot, high-volume feed queries that actually caused a
// real production incident (getCursorFeedPage, getBalancedFeedPosts) read
// through readQuery() — every write and every other read in the app still
// goes exclusively through the primary pool via query(), unchanged. Two
// independent, unrelated Postgres instances with no replication between
// them can't safely share writes without a real risk of silently losing
// whichever side loses a later reconciliation, so this stays strictly
// read-only and strictly scoped to what actually needs it.
async function initBackupDB() {
  if (!process.env.DATABASE_URL_BACKUP) {
    console.log('ℹ️  DATABASE_URL_BACKUP not set — no read failover if the primary DB is overloaded.');
    return;
  }
  try {
    const backup = new Pool({
      connectionString: process.env.DATABASE_URL_BACKUP,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 20_000,
    });
    const client = await backup.connect();
    await client.query('SELECT 1');
    await client.query(`
      CREATE TABLE IF NOT EXISTS feed_posts_cache (
        id              TEXT PRIMARY KEY,
        source          TEXT NOT NULL,
        title           TEXT,
        content         TEXT,
        author_name     TEXT,
        source_url      TEXT,
        media_url       TEXT,
        media_type      TEXT,
        topic           TEXT,
        likes_count     INTEGER DEFAULT 0,
        comments_count  INTEGER DEFAULT 0,
        post_created_at TIMESTAMPTZ,
        fetched_at      TIMESTAMPTZ DEFAULT NOW(),
        location        TEXT
      )
    `);
    await client.query(`ALTER TABLE feed_posts_cache ADD COLUMN IF NOT EXISTS location TEXT`);
    // Same compound indexes migrateDB() gives the primary for this exact
    // query shape — without these the backup just reproduces the seq-scan-
    // and-external-sort cost failover exists to avoid, the moment any real
    // traffic actually lands on it.
    await client.query(`CREATE INDEX IF NOT EXISTS fpc_source_time_idx ON feed_posts_cache(source, post_created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS fpc_source_media_time_idx ON feed_posts_cache(source, media_type, post_created_at DESC)`);
    client.release();
    backupPool = backup;
    _backupConnected = true;
    console.log('✅ Backup PostgreSQL (read failover) connected and indexed');
  } catch (err) {
    console.warn(`⚠️  Backup PostgreSQL unreachable: ${err.message}`);
    backupPool = null;
    _backupConnected = false;
  }
}

const BACKUP_SYNC_COLUMNS = [
  'id', 'source', 'title', 'content', 'author_name', 'source_url', 'media_url',
  'media_type', 'topic', 'likes_count', 'comments_count', 'post_created_at', 'fetched_at', 'location',
];

// Keeps the backup's feed_posts_cache from just sitting frozen at whatever
// day failover was set up — incremental and watermark-based (fetched_at >
// last sync), not a full resync, since most of the primary table is older
// than readQuery()'s own time-bounded queries will ever ask for anyway.
// Runs on its own schedule, entirely independent of any user request.
let _lastSyncedAt = null;
function startBackupSync(intervalMs = 15 * 60 * 1000) {
  if (!backupPool) return;
  const cols = BACKUP_SYNC_COLUMNS;
  const sync = async () => {
    if (!pool || !_connected || !backupPool) return;
    try {
      const since = _lastSyncedAt || new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const { rows } = await pool.query(
        `SELECT ${cols.join(', ')} FROM feed_posts_cache WHERE fetched_at > $1 ORDER BY fetched_at ASC LIMIT 20000`,
        [since]
      );
      if (!rows.length) return;
      const client = await backupPool.connect();
      try {
        await client.query('BEGIN');
        const BATCH = 200;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const params = [];
          const tuples = batch.map(r => {
            const vals = cols.map(c => r[c]);
            const placeholders = vals.map(v => { params.push(v); return `$${params.length}`; });
            return `(${placeholders.join(',')})`;
          }).join(', ');
          const updateSet = cols.filter(c => c !== 'id').map(c => `${c}=EXCLUDED.${c}`).join(', ');
          await client.query(
            `INSERT INTO feed_posts_cache (${cols.join(', ')}) VALUES ${tuples}
             ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
            params
          );
        }
        await client.query('COMMIT');
        _lastSyncedAt = rows[rows.length - 1].fetched_at;
        console.log(`[db backup sync] synced ${rows.length} rows, watermark now ${new Date(_lastSyncedAt).toISOString()}`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      console.warn('[db backup sync] failed:', e.message);
    }
  };
  sync();
  setInterval(sync, intervalMs);
}

/** Run a parameterised query. Throws if DB is not available. Writes and everything not explicitly failover-eligible go through this, unchanged. */
async function query(text, params) {
  if (!pool || !_connected) {
    throw new Error('DB not available');
  }
  return pool.query(text, params);
}

// primaryReadPool's own statement_timeout option is a startup-packet
// parameter, honored only if the Postgres endpoint on the other end (or
// whatever pooler sits in front of it) actually applies it — confirmed
// live against the Neon endpoint used for local dev that it's silently
// ignored there (a `pg_sleep(10)` ran the full 10s despite an 8s
// statement_timeout). Racing the query against a plain JS timer doesn't
// depend on that and is what actually guarantees readQuery gives up and
// tries backup within READ_STATEMENT_TIMEOUT_MS regardless of which
// endpoint is on the primary/backup end. The abandoned query may still run
// to completion server-side — this only bounds how long the caller waits.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Read-only, failover-aware query for the specific hot paths that can
 * tolerate serving slightly-stale content from the backup during a primary
 * outage/overload (currently just getCursorFeedPage and getBalancedFeedPosts
 * in index.js). Never use this for writes or for anything that must reflect
 * the very latest state — see initBackupDB's comment for why.
 */
async function readQuery(text, params) {
  const breakerOpen = Date.now() < primaryReadOutageUntil;
  if (!breakerOpen && primaryReadPool) {
    try {
      const result = await withTimeout(primaryReadPool.query(text, params), READ_STATEMENT_TIMEOUT_MS, 'primary readQuery');
      primaryReadConsecutiveFailures = 0;
      return result;
    } catch (err) {
      primaryReadConsecutiveFailures++;
      console.warn(`[db readQuery] primary failed (${primaryReadConsecutiveFailures}/${READ_FAILURE_THRESHOLD}): ${err.message}`);
      if (primaryReadConsecutiveFailures >= READ_FAILURE_THRESHOLD) {
        primaryReadOutageUntil = Date.now() + READ_OUTAGE_COOLDOWN_MS;
        console.warn(`[db readQuery] primary read circuit OPEN for ${READ_OUTAGE_COOLDOWN_MS / 1000}s — routing to backup`);
      }
      if (backupPool && _backupConnected) {
        try {
          return await withTimeout(backupPool.query(text, params), BACKUP_STATEMENT_TIMEOUT_MS, 'backup readQuery');
        } catch (backupErr) {
          console.warn(`[db readQuery] backup also failed: ${backupErr.message}`);
        }
      }
      // No backup configured (or it also failed) — DATABASE_URL_BACKUP is
      // opt-in, so this is the common case until it's set. Falling through
      // to the slow, full-timeout primary pool instead of throwing here
      // means a legitimately slow-but-working query (the 20-49s the fixed
      // timeRange bound still took under real load, well past this
      // function's own 8s fast-path budget) still eventually succeeds
      // exactly like it did via plain query() before readQuery existed,
      // instead of readQuery's fast-fail turning "slow" into "empty."
      if (pool && _connected) return pool.query(text, params);
      throw err;
    }
  }
  // Breaker open, or no dedicated read pool yet (primary never connected) —
  // try backup first if one exists, but still fall back to the slow
  // primary pool rather than serving nothing if backup is unset or fails.
  if (backupPool && _backupConnected) {
    try {
      return await withTimeout(backupPool.query(text, params), BACKUP_STATEMENT_TIMEOUT_MS, 'backup readQuery');
    } catch (backupErr) {
      console.warn(`[db readQuery] backup failed while breaker open: ${backupErr.message}`);
    }
  }
  if (!pool || !_connected) throw new Error('DB not available');
  return pool.query(text, params);
}

/** Whether the primary database connection is live. */
function isConnected() {
  return _connected;
}

/** Whether the backup (read-failover) database connection is live. */
function isBackupConnected() {
  return _backupConnected;
}

/** True while readQuery() is routing around the primary due to repeated failures. */
function isReadFailoverActive() {
  return Date.now() < primaryReadOutageUntil;
}

module.exports = { initDB, initBackupDB, startBackupSync, query, readQuery, isConnected, isBackupConnected, isReadFailoverActive };
