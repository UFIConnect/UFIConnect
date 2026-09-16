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
const { databaseConnectionOptions } = require('./database-security');

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
  lastAttemptAt: null,
  nextSyncAt: null,
  syncing: false,
  capacityStatus: 'unknown',
};

// Do not return connection strings, hostnames, query text, or credentials in
// diagnostics. SQLSTATE/transport codes are enough to classify a failure.
function backupFailure(error, operation) {
  const code = /^[A-Z0-9_]{2,40}$/.test(String(error?.code || '')) ? ` (${error.code})` : '';
  return `${operation} failed${code}; inspect the database configuration and service logs.`;
}

let backupInitialization = null;

async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.log('ℹ️  DATABASE_URL not set — running with in-memory data.');
    return;
  }

  const connectionOptions = databaseConnectionOptions(process.env.DATABASE_URL);
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔗 Connecting to PostgreSQL (attempt ${attempt}/${maxRetries})...`);
      pool = new Pool({
        ...connectionOptions,
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
        ...connectionOptions,
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
    return false;
  }
  if (backupPool && _backupConnected) return true;
  if (backupInitialization) return backupInitialization;
  backupInitialization = initializeBackupPool();
  try { return await backupInitialization; }
  finally { backupInitialization = null; }
}

async function initializeBackupPool() {
  let backup;
  let client;
  try {
    if (backupPool) {
      const previous = backupPool;
      backupPool = null;
      await previous.end().catch(() => {});
    }
    backup = new Pool({
      ...databaseConnectionOptions(process.env.DATABASE_URL_BACKUP),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 20_000,
    });
    backup.on('error', (error) => {
      _backupConnected = false;
      backupState.lastError = backupFailure(error, 'Backup connection');
      console.warn('[db backup]', backupState.lastError);
    });
    client = await backup.connect();
    await client.query('SELECT 1');
    await client.query(`
      CREATE TABLE IF NOT EXISTS feed_posts_cache (
        id              TEXT PRIMARY KEY,
        source          TEXT NOT NULL,
        group_id        TEXT,
        title           TEXT,
        content         TEXT,
        author_name     TEXT,
        source_url      TEXT,
        media_url       TEXT,
        media_type      TEXT,
        media_poster    TEXT,
        video_duration_seconds INTEGER,
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
    await client.query(`ALTER TABLE feed_posts_cache ADD COLUMN IF NOT EXISTS video_duration_seconds INTEGER`);
    await client.query(`ALTER TABLE feed_posts_cache ADD COLUMN IF NOT EXISTS group_id TEXT`);
    // Same compound indexes migrateDB() gives the primary for this exact
    // query shape — without these the backup just reproduces the seq-scan-
    // and-external-sort cost failover exists to avoid, the moment any real
    // traffic actually lands on it.
    await client.query(`CREATE INDEX IF NOT EXISTS fpc_source_time_idx ON feed_posts_cache(source, post_created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS fpc_source_time_id_idx ON feed_posts_cache(source, post_created_at DESC, id DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS fpc_source_media_time_idx ON feed_posts_cache(source, media_type, post_created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS fpc_group_time_idx ON feed_posts_cache(group_id, post_created_at DESC) WHERE group_id IS NOT NULL`);
    backupPool = backup;
    _backupConnected = true;
    console.log('✅ Backup PostgreSQL (read failover) connected and indexed');
    return true;
  } catch (err) {
    backupPool = null;
    _backupConnected = false;
    backupState.lastError = backupFailure(err, 'Backup initialization');
    console.warn('[db backup]', backupState.lastError);
    return false;
  } finally {
    if (client) client.release();
    if (backup && backup !== backupPool) await backup.end().catch(() => {});
  }
}

const BACKUP_SYNC_COLUMNS = [
  'id', 'source', 'group_id', 'title', 'content', 'author_name', 'source_url', 'media_url',
  'media_type', 'media_poster', 'video_duration_seconds', 'topic', 'likes_count', 'comments_count', 'post_created_at', 'fetched_at', 'location',
];

// A snapshot is replaced only after its entire bounded source selection has
// been read successfully. Capacity problems must never erase the usable copy.
async function recordBackupCapacity(client) {
  const result = await client.query('SELECT pg_database_size(current_database()) AS bytes');
  backupState.sizeMb = Math.round((Number(result.rows[0]?.bytes) || 0) / (1024 * 1024));
  backupState.usedPct = Math.round((backupState.sizeMb / BACKUP_DB_LIMIT_MB) * 1000) / 10;
  backupState.capacityStatus = backupState.usedPct >= BACKUP_DB_RESET_PCT ? 'warning' : 'ok';
}

const BACKUP_IDENTITY_SQL = 'SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port';
function sameDatabase(primary, backup) {
  const valid = row => row && typeof row.database === 'string' && row.database.length > 0
    && typeof row.address === 'string' && row.address.length > 0
    && Number.isInteger(Number(row.port)) && Number(row.port) > 0;
  if (!valid(primary) || !valid(backup)) {
    const error = new Error('Database identity could not be verified.');
    error.code = 'UFI_DATABASE_IDENTITY';
    throw error;
  }
  return primary.database === backup.database && primary.address === backup.address
    && Number(primary.port) === Number(backup.port);
}

async function reconcileBackupSnapshot() {
  let sourceClient;
  let targetClient;
  let sourceTransaction = false;
  let targetTransaction = false;
  let targetConnectionError = null;
  let operation = 'Backup connection';
  try {
    targetClient = await backupPool.connect();
    await targetClient.query('BEGIN');
    targetTransaction = true;
    // All API workers and rolling deployments share this transaction lock.
    // Acquire it before opening the source snapshot so older copies cannot
    // overwrite a newer snapshot committed by another process.
    const lock = await targetClient.query('SELECT pg_try_advisory_xact_lock(1969645923, 1650553707) AS locked');
    if (lock.rows[0]?.locked !== true) return false;
    operation = 'Primary snapshot connection';
    sourceClient = await pool.connect();
    const primaryIdentity = await sourceClient.query(BACKUP_IDENTITY_SQL);
    operation = 'Backup identity check';
    const backupIdentity = await targetClient.query(BACKUP_IDENTITY_SQL);
    if (sameDatabase(primaryIdentity.rows[0], backupIdentity.rows[0])) {
      backupState.lastError = 'Backup synchronization refused: primary and backup are the same database.';
      return false;
    }
    operation = 'Primary snapshot read';
    await sourceClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    sourceTransaction = true;
    // Server addresses can differ when aliases reach different interfaces of
    // the same server. Database-scoped locks provide a second identity check:
    // this source transaction cannot acquire a lock already held by target
    // if both clients actually address the same database. No primary writes.
    const sourceLock = await sourceClient.query('SELECT pg_try_advisory_xact_lock(1969645923, 1650553707) AS locked');
    if (sourceLock.rows[0]?.locked !== true) {
      backupState.lastError = 'Backup synchronization refused: the primary snapshot lock is held or both connections address the same database.';
      return false;
    }
    const cutoff = new Date(Date.now() - BACKUP_FEED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const cols = BACKUP_SYNC_COLUMNS;
    await sourceClient.query(
      'DECLARE ufi_backup_source NO SCROLL CURSOR FOR SELECT ' + cols.join(', ') +
      ' FROM feed_posts_cache WHERE post_created_at >= $1' +
      ' ORDER BY fetched_at DESC NULLS LAST, post_created_at DESC, id DESC LIMIT $2',
      [cutoff, BACKUP_FEED_MAX_ROWS],
    );
    operation = 'Backup staging';
    await targetClient.query('CREATE TEMP TABLE ufi_backup_snapshot (LIKE feed_posts_cache INCLUDING DEFAULTS, PRIMARY KEY (id)) ON COMMIT DROP');
    let rowCount = 0;
    for (;;) {
      operation = 'Primary snapshot read';
      const { rows } = await sourceClient.query('FETCH FORWARD 500 FROM ufi_backup_source');
      if (!rows.length) break;
      rowCount += rows.length;
      const params = [];
      const tuples = rows.map(row => '(' + cols.map(column => {
        params.push(row[column]);
        return '$' + params.length;
      }).join(',') + ')').join(',');
      operation = 'Backup staging';
      await targetClient.query('INSERT INTO ufi_backup_snapshot (' + cols.join(', ') + ') VALUES ' + tuples, params);
    }
    operation = 'Primary snapshot completion';
    await sourceClient.query('COMMIT');
    sourceTransaction = false;
    operation = 'Backup reconciliation';
    const mutable = cols.filter(column => column !== 'id');
    const updateSet = mutable.map(column => column + '=EXCLUDED.' + column).join(', ');
    await targetClient.query('INSERT INTO feed_posts_cache AS existing (' + cols.join(', ') + ')' +
      ' SELECT ' + cols.join(', ') + ' FROM ufi_backup_snapshot WHERE true' +
      ' ON CONFLICT (id) DO UPDATE SET ' + updateSet +
      ' WHERE (' + mutable.map(column => 'existing.' + column).join(', ') + ')' +
      ' IS DISTINCT FROM (' + mutable.map(column => 'EXCLUDED.' + column).join(', ') + ')');
    const removed = await targetClient.query('DELETE FROM feed_posts_cache AS existing WHERE NOT EXISTS (SELECT 1 FROM ufi_backup_snapshot AS snapshot WHERE snapshot.id = existing.id)');
    await recordBackupCapacity(targetClient);
    await targetClient.query('COMMIT');
    targetTransaction = false;
    const completedAt = new Date().toISOString();
    backupState.lastSyncAt = completedAt;
    backupState.lastPrunedAt = completedAt;
    backupState.lastPrunedRows = removed.rowCount || 0;
    backupState.rowCount = rowCount;
    backupState.lastError = null;
    _backupConnected = true;
    console.log('[db backup sync] reconciled ' + rowCount + ' snapshot rows');
    if (backupState.capacityStatus === 'warning') {
      console.warn('[db backup] capacity warning: ' + backupState.usedPct + '% used; retained the valid snapshot');
    }
    return true;
  } catch (error) {
    const code = String(error?.code || '');
    if (operation.startsWith('Backup') && (operation === 'Backup connection'
      || /^(08[A-Z0-9]{3}|57P0[123]|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EPIPE|EHOSTUNREACH)$/.test(code))) {
      _backupConnected = false;
      targetConnectionError = error;
    }
    backupState.lastError = code === 'UFI_DATABASE_IDENTITY'
      ? 'Backup synchronization refused: database identity could not be verified; check both PostgreSQL endpoints.'
      : backupFailure(error, operation);
    console.warn('[db backup sync]', backupState.lastError);
    return false;
  } finally {
    if (sourceTransaction) await sourceClient.query('ROLLBACK').catch(() => {});
    if (targetTransaction) await targetClient.query('ROLLBACK').catch(() => {});
    if (sourceClient) sourceClient.release();
    if (targetClient) targetClient.release(targetConnectionError || undefined);
  }
}

let backupSyncStarted = false;
function startBackupSync(intervalMs = 30 * 60 * 1000) {
  if (backupSyncStarted) return;
  backupSyncStarted = true;
  if (!process.env.DATABASE_URL_BACKUP) {
    console.log('[db backup] DATABASE_URL_BACKUP is not configured; feed snapshot synchronization is disabled.');
    return;
  }
  const normalInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 30 * 60 * 1000;
  const retryInterval = Math.min(normalInterval, 60_000);
  const sync = async () => {
    backupState.syncing = true;
    backupState.lastAttemptAt = new Date().toISOString();
    backupState.nextSyncAt = null;
    let succeeded = false;
    try {
      if (!pool || !_connected) {
        backupState.lastError = 'Primary database unavailable; backup synchronization will retry.';
      } else if (await initBackupDB()) {
        succeeded = await reconcileBackupSnapshot();
      }
    } catch (error) {
      backupState.lastError = backupFailure(error, 'Backup synchronization');
      console.warn('[db backup sync]', backupState.lastError);
    } finally {
      backupState.syncing = false;
      const delay = succeeded ? normalInterval : retryInterval;
      backupState.nextSyncAt = new Date(Date.now() + delay).toISOString();
      // Schedule after completion, not at a fixed overlapping interval.
      const timer = setTimeout(sync, delay);
      timer.unref?.();
    }
  };
  void sync();
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
