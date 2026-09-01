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
const backupNumber = (name, fallback, min, max) => {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};
// This database is a bounded recovery snapshot, never a second production
// archive. Feed reads only need recent entries during a primary outage.
const BACKUP_FEED_RETENTION_DAYS = backupNumber('BACKUP_FEED_RETENTION_DAYS', 14, 1, 90);
const BACKUP_FEED_MAX_ROWS = backupNumber('BACKUP_FEED_MAX_ROWS', 40_000, 1_000, 500_000);
const BACKUP_DB_LIMIT_MB = backupNumber('BACKUP_DB_LIMIT_MB', 5_120, 128, 1_000_000);
const BACKUP_DB_RESET_PCT = backupNumber('BACKUP_DB_RESET_PCT', 85, 50, 99);
const backupState = {
  retentionDays: BACKUP_FEED_RETENTION_DAYS,
  maxRows: BACKUP_FEED_MAX_ROWS,
  sizeLimitMb: BACKUP_DB_LIMIT_MB,
  resetPct: BACKUP_DB_RESET_PCT,
  sizeMb: null,
  usedPct: null,
  lastSyncAt: null,
  lastPrunedAt: null,
  lastPrunedRows: 0,
  lastResetAt: null,
  rowCount: null,
  lastError: null,
};

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
        media_poster    TEXT,
        topic           TEXT,
        likes_count     INTEGER DEFAULT 0,
        comments_count  INTEGER DEFAULT 0,
        post_created_at TIMESTAMPTZ,
        fetched_at      TIMESTAMPTZ DEFAULT NOW(),
        location        TEXT
      )
    `);
    await client.query(`ALTER TABLE feed_posts_cache ADD COLUMN IF NOT EXISTS location TEXT`);
    await client.query(`ALTER TABLE feed_posts_cache ADD COLUMN IF NOT EXISTS media_poster TEXT`);
    // Same compound indexes migrateDB() gives the primary for this exact
    // query shape — without these the backup just reproduces the seq-scan-
    // and-external-sort cost failover exists to avoid, the moment any real
    // traffic actually lands on it.
    await client.query(`CREATE INDEX IF NOT EXISTS fpc_source_time_idx ON feed_posts_cache(source, post_created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS fpc_source_media_time_idx ON feed_posts_cache(source, media_type, post_created_at DESC)`);
    client.release();
    backupPool = backup;
    _backupConnected = true;
    await pruneBackupFeedCache();
    console.log('✅ Backup PostgreSQL (read failover) connected and indexed');
  } catch (err) {
    console.warn(`⚠️  Backup PostgreSQL unreachable: ${err.message}`);
    backupPool = null;
    _backupConnected = false;
  }
}

const BACKUP_SYNC_COLUMNS = [
  'id', 'source', 'title', 'content', 'author_name', 'source_url', 'media_url',
  'media_type', 'media_poster', 'topic', 'likes_count', 'comments_count', 'post_created_at', 'fetched_at', 'location',
];

async function pruneBackupFeedCache() {
  if (!backupPool || !_backupConnected) return;
  try {
    const sizeResult = await backupPool.query(`SELECT pg_database_size(current_database()) AS bytes`);
    const sizeMb = Math.round((Number(sizeResult.rows[0]?.bytes) || 0) / (1024 * 1024));
    const usedPct = Math.round((sizeMb / BACKUP_DB_LIMIT_MB) * 1000) / 10;
    backupState.sizeMb = sizeMb;
    backupState.usedPct = usedPct;
    if (usedPct >= BACKUP_DB_RESET_PCT) {
      const { rows: countRows } = await backupPool.query(`SELECT count(*)::int AS count FROM feed_posts_cache`);
      const cleared = Number(countRows[0]?.count) || 0;
      // This table is only the disposable recovery snapshot. TRUNCATE releases
      // its storage immediately, unlike DELETE which leaves pages allocated.
      await backupPool.query(`TRUNCATE TABLE feed_posts_cache`);
      backupState.lastPrunedAt = new Date().toISOString();
      backupState.lastPrunedRows = cleared;
      backupState.lastResetAt = backupState.lastPrunedAt;
      backupState.rowCount = 0;
      backupState.lastError = null;
      console.warn(`[db backup] reset ${cleared} snapshot rows at ${usedPct}% capacity; primary remains authoritative`);
      return;
    }
    const cutoff = new Date(Date.now() - BACKUP_FEED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const aged = await backupPool.query(
      `DELETE FROM feed_posts_cache WHERE post_created_at IS NULL OR post_created_at < $1`,
      [cutoff],
    );
    const { rows } = await backupPool.query(`SELECT count(*)::int AS count FROM feed_posts_cache`);
    const rowCount = Number(rows[0]?.count) || 0;
    let capped = 0;
    if (rowCount > BACKUP_FEED_MAX_ROWS) {
      const result = await backupPool.query(
        `DELETE FROM feed_posts_cache
         WHERE id IN (
           SELECT id FROM feed_posts_cache
           ORDER BY fetched_at ASC NULLS FIRST, post_created_at ASC NULLS FIRST, id ASC
           LIMIT $1
         )`,
        [rowCount - BACKUP_FEED_MAX_ROWS],
      );
      capped = result.rowCount || 0;
    }
    backupState.lastPrunedAt = new Date().toISOString();
    backupState.lastPrunedRows = (aged.rowCount || 0) + capped;
    backupState.rowCount = Math.max(0, rowCount - capped);
    backupState.lastError = null;
    if (backupState.lastPrunedRows) {
      console.log(`[db backup] pruned ${backupState.lastPrunedRows} rows; ${backupState.rowCount} retained`);
    }
  } catch (error) {
    backupState.lastError = error.message;
    console.warn('[db backup] prune failed:', error.message);
  }
}

// Keeps the backup's feed_posts_cache from just sitting frozen at whatever
// day failover was set up — incremental and watermark-based (fetched_at >
// last sync), not a full resync, since most of the primary table is older
// than readQuery()'s own time-bounded queries will ever ask for anyway.
// Runs on its own schedule, entirely independent of any user request.
let _lastSyncedAt = null;
function startBackupSync(intervalMs = 30 * 60 * 1000) {
  if (!backupPool) return;
  const cols = BACKUP_SYNC_COLUMNS;
  const sync = async () => {
    if (!pool || !_connected || !backupPool) return;
    try {
      const cutoff = new Date(Date.now() - BACKUP_FEED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const since = _lastSyncedAt && _lastSyncedAt > cutoff ? _lastSyncedAt : cutoff;
      const { rows } = await pool.query(
        `SELECT ${cols.join(', ')} FROM feed_posts_cache
         WHERE fetched_at > $1 AND post_created_at >= $2
         ORDER BY fetched_at ASC LIMIT 20000`,
        [since, cutoff]
      );
      if (!rows.length) {
        await pruneBackupFeedCache();
        return;
      }
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
        backupState.lastSyncAt = new Date().toISOString();
        console.log(`[db backup sync] synced ${rows.length} rows, watermark now ${new Date(_lastSyncedAt).toISOString()}`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      await pruneBackupFeedCache();
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

/** Borrow a primary DB client for a short transaction. */
async function withClient(fn) {
  if (!pool || !_connected) {
    throw new Error('DB not available');
  }
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
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

function getBackupStatus() {
  return {
    enabled: Boolean(process.env.DATABASE_URL_BACKUP),
    connected: _backupConnected,
    ...backupState,
  };
}

module.exports = { initDB, initBackupDB, startBackupSync, query, withClient, readQuery, isConnected, isBackupConnected, isReadFailoverActive, getBackupStatus };
