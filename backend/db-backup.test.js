'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');

const moduleSource = fs.readFileSync(require.resolve('./db'), 'utf8');
const schema = `CREATE TABLE feed_posts_cache (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, group_id TEXT, title TEXT,
  content TEXT, author_name TEXT, source_url TEXT, media_url TEXT,
  media_type TEXT, media_poster TEXT, video_duration_seconds INTEGER,
  topic TEXT, likes_count INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0,
  post_created_at TIMESTAMPTZ, fetched_at TIMESTAMPTZ DEFAULT NOW(), location TEXT
); CREATE TABLE unrelated_private_data (id TEXT PRIMARY KEY);
INSERT INTO unrelated_private_data VALUES ('preserve');`;

// The production module runs unchanged. SQL, cursors, temporary tables,
// constraints, upserts, deletes, and rollback execute in real PostgreSQL
// engines. Only network pools, timers, host identity, size, and the external
// advisory lock owner are substituted for deterministic failure scenarios.
function harness(primary, backup, control = {}) {
  const trace = [];
  const timers = [];
  const pools = [];
  const logs = [];
  let borrowed = 0;
  let released = 0;
  class Pool {
    constructor(options) {
      this.kind = options.connectionString === 'backup' ? 'backup' : 'primary';
      this.ended = false;
      pools.push(this);
    }
    on() {}
    async end() { this.ended = true; }
    async connect() {
      if (this.kind === 'backup' && control.backupConnectFailures > 0) {
        control.backupConnectFailures--;
        throw Object.assign(new Error('postgres://secret-user:secret-password@private.invalid/db'), { code: 'ECONNREFUSED' });
      }
      borrowed++;
      return { query: (sql, params) => this.query(sql, params), release() { released++; } };
    }
    async query(sql, params) {
      trace.push({ kind: this.kind, sql, params });
      await control.beforeQuery?.(this.kind, sql, params);
      if (sql.includes('inet_server_addr')) {
        return { rows: [{ database: 'app', address: control.ambiguousIdentity ? null :
          (this.kind === 'primary' || control.sameDatabase ? '10.0.0.1' : '10.0.0.2'), port: 5432 }] };
      }
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: this.kind === 'primary'
        ? control.sourceLockAvailable !== false : control.lockAvailable !== false }] };
      if (sql.includes('pg_database_size')) return { rows: [{ bytes: control.capacityBytes ?? 1024 }] };
      const result = await (this.kind === 'backup' ? backup : primary).query(sql, params);
      return { ...result, rowCount: result.affectedRows || result.rowCount || 0 };
    }
  }
  const env = { DATABASE_URL: 'primary', DATABASE_URL_BACKUP: 'backup', ...(control.env || {}) };
  const context = {
    module: { exports: {} }, exports: {}, process: { env }, Date,
    console: { log(...values) { logs.push(values.join(' ')); }, warn(...values) { logs.push(values.join(' ')); } },
    require(name) {
      if (name === 'pg') return { Pool };
      if (name === './database-security') return { databaseConnectionOptions: connectionString => ({ connectionString }) };
      throw new Error(`Unexpected import ${name}`);
    },
    setTimeout(fn, delay) { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout() {},
  };
  vm.runInNewContext(moduleSource, context, { filename: 'backend/db.js' });
  const db = context.module.exports;
  return {
    db, timers, pools, trace, control, logs,
    get outstandingClients() { return borrowed - released; },
    async wait() {
      const deadline = Date.now() + 30_000;
      while (db.getBackupStatus().syncing) {
        if (Date.now() > deadline) throw new Error('Backup synchronization did not finish');
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    },
    async start() { await db.initDB(); db.startBackupSync(); await this.wait(); },
    async next() { assert.equal(timers.length, 1); await timers.shift().fn(); },
  };
}

async function seed(pg, id, title = 'original', ageDays = 0) {
  await pg.query(`INSERT INTO feed_posts_cache (id, source, title, topic, post_created_at, fetched_at)
    VALUES ($1, 'test', $2, 'initial', NOW() - ($3 * INTERVAL '1 day'), NOW())`, [id, title, ageDays]);
}

test('bounded backup snapshot reconciliation', { timeout: 60_000 }, async t => {
  const primary = new PGlite();
  const backup = new PGlite();
  t.after(async () => { await primary.close(); await backup.close(); });
  await primary.exec(schema);
  await backup.exec(schema);
  async function reset() {
    await primary.exec('TRUNCATE feed_posts_cache');
    await backup.exec('TRUNCATE feed_posts_cache');
  }

  await t.test('PostgreSQL allows the identity guard lock in a read-only repeatable-read transaction', async () => {
    await primary.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const result = await primary.query('SELECT pg_try_advisory_xact_lock(1969645923, 1650553707) AS locked');
      assert.equal(result.rows[0].locked, true);
    } finally { await primary.query('ROLLBACK'); }
  });

  await t.test('copies more than 20,000 tied timestamps and deterministically caps the newest 40,000 rows', async () => {
    await reset();
    await primary.exec(`INSERT INTO feed_posts_cache (id, source, title, post_created_at, fetched_at)
      SELECT LPAD(n::text, 5, '0'), 'test', 'tied', NOW(), NOW() FROM generate_series(0, 40001) AS n`);
    const h = harness(primary, backup); await h.start();
    const result = await backup.query('SELECT count(*)::int AS count, min(id) AS first, max(id) AS last FROM feed_posts_cache');
    assert.deepEqual(result.rows[0], { count: 40000, first: '00002', last: '40001' });
    assert.equal(h.db.getBackupStatus().rowCount, 40000);
    assert.equal(h.timers[0].delay, 30 * 60 * 1000);
    assert.equal(h.outstandingClients, 0);
    assert.ok(h.trace.filter(q => q.sql.startsWith('INSERT INTO ufi_backup_snapshot')).every(q => q.params.length <= 500 * 17));
    const lockAt = h.trace.findIndex(q => q.sql.includes('pg_try_advisory_xact_lock'));
    const readAt = h.trace.findIndex(q => q.sql.startsWith('BEGIN ISOLATION LEVEL'));
    assert.ok(lockAt >= 0 && readAt > lockAt);
  });

  await t.test('reconciles in-place updates, deletions, retention, and an empty primary snapshot', async () => {
    await reset(); await seed(primary, 'keep'); await seed(primary, 'remove');
    await seed(primary, 'expired', 'old', 20);
    const h = harness(primary, backup); await h.start();
    await primary.query("UPDATE feed_posts_cache SET title='corrected', topic='fixed' WHERE id='keep'");
    await primary.query("DELETE FROM feed_posts_cache WHERE id='remove'");
    await h.next();
    const rows = await backup.query('SELECT id, title, topic FROM feed_posts_cache');
    assert.deepEqual(rows.rows, [{ id: 'keep', title: 'corrected', topic: 'fixed' }]);
    assert.equal(h.db.getBackupStatus().lastPrunedRows, 1);
    await primary.exec('TRUNCATE feed_posts_cache'); await h.next();
    assert.equal(h.db.getBackupStatus().rowCount, 0);
    assert.equal((await backup.query('SELECT count(*)::int AS count FROM feed_posts_cache')).rows[0].count, 0);
    assert.deepEqual((await backup.query('SELECT * FROM unrelated_private_data')).rows, [{ id: 'preserve' }]);
  });

  await t.test('source read errors preserve the usable snapshot and backup connectivity', async () => {
    await reset(); await seed(primary, 'first'); await seed(backup, 'old');
    let fetches = 0;
    const h = harness(primary, backup, { beforeQuery(kind, sql) {
      if (kind === 'primary' && sql.startsWith('FETCH') && ++fetches === 2) {
        throw Object.assign(new Error('private source details'), { code: '08006' });
      }
    } });
    await h.start();
    assert.deepEqual((await backup.query('SELECT id FROM feed_posts_cache')).rows, [{ id: 'old' }]);
    assert.equal(h.db.isBackupConnected(), true);
    assert.equal(h.db.getBackupStatus().lastSyncAt, null);
    assert.match(h.db.getBackupStatus().lastError, /Primary snapshot read failed \(08006\)/);
    assert.equal(h.timers[0].delay, 60_000);
    assert.equal(h.outstandingClients, 0);
  });

  await t.test('backup write failure rolls back upserts and retains last successful status', async () => {
    await reset(); await seed(primary, 'keep');
    const h = harness(primary, backup); await h.start();
    const lastSyncAt = h.db.getBackupStatus().lastSyncAt;
    await primary.query("UPDATE feed_posts_cache SET title='changed' WHERE id='keep'");
    h.control.beforeQuery = (kind, sql) => {
      if (kind === 'backup' && sql.startsWith('DELETE FROM feed_posts_cache')) {
        throw Object.assign(new Error('postgres://user:password@private-host/db'), { code: '53100' });
      }
    };
    await h.next();
    assert.equal((await backup.query("SELECT title FROM feed_posts_cache WHERE id='keep'")).rows[0].title, 'original');
    assert.equal(h.db.getBackupStatus().lastSyncAt, lastSyncAt);
    assert.match(h.db.getBackupStatus().lastError, /Backup reconciliation failed \(53100\)/);
    assert.doesNotMatch(JSON.stringify(h.db.getBackupStatus()), /password|private-host|postgres:\/\//);
    h.control.beforeQuery = null; await h.next();
    assert.equal((await backup.query("SELECT title FROM feed_posts_cache WHERE id='keep'")).rows[0].title, 'changed');
    assert.equal(h.db.getBackupStatus().lastError, null);
    assert.equal(h.outstandingClients, 0);
  });

  await t.test('capacity pressure preserves and refreshes the snapshot instead of truncating it', async () => {
    await reset(); await seed(primary, 'keep');
    const h = harness(primary, backup, { capacityBytes: 5 * 1024 * 1024 * 1024 }); await h.start();
    assert.equal(h.db.getBackupStatus().capacityStatus, 'warning');
    assert.equal(h.db.getBackupStatus().rowCount, 1);
    assert.equal(h.db.getBackupStatus().lastResetAt, null);
    await primary.query("UPDATE feed_posts_cache SET title='changed' WHERE id='keep'"); await h.next();
    assert.equal((await backup.query('SELECT title FROM feed_posts_cache')).rows[0].title, 'changed');
    assert.equal(h.trace.some(q => q.sql.includes('TRUNCATE')), false);
  });

  await t.test('initial connection failure closes the pool and retries without restarting the service', async () => {
    await reset(); await seed(primary, 'keep');
    const h = harness(primary, backup, { backupConnectFailures: 1 }); await h.start();
    assert.equal(h.db.isBackupConnected(), false);
    assert.equal(h.pools.filter(p => p.kind === 'backup')[0].ended, true);
    assert.match(h.db.getBackupStatus().lastError, /ECONNREFUSED/);
    assert.doesNotMatch(JSON.stringify(h.db.getBackupStatus()), /secret-user|secret-password|private.invalid/);
    assert.equal(h.timers[0].delay, 60_000);
    await h.next();
    assert.equal(h.db.isBackupConnected(), true);
    assert.equal(h.db.getBackupStatus().rowCount, 1);
    assert.equal(h.timers[0].delay, 30 * 60 * 1000);
    assert.equal(h.outstandingClients, 0);
  });

  await t.test('failed schema initialization releases its client and closes the failed pool', async () => {
    await reset();
    const h = harness(primary, backup, { beforeQuery(kind, sql) {
      if (kind === 'backup' && sql.startsWith('ALTER TABLE')) throw Object.assign(new Error('denied'), { code: '42501' });
    } }); await h.start();
    assert.equal(h.outstandingClients, 0);
    assert.equal(h.pools.find(p => p.kind === 'backup').ended, true);
    assert.match(h.db.getBackupStatus().lastError, /42501/);
  });

  await t.test('backup transport failures mark it disconnected and reconnect on the next attempt', async () => {
    await reset(); await seed(primary, 'keep');
    const h = harness(primary, backup); await h.start();
    h.control.beforeQuery = (kind, sql) => {
      if (kind === 'backup' && sql.startsWith('INSERT INTO ufi_backup_snapshot')) {
        throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET' });
      }
    };
    await h.next();
    assert.equal(h.db.isBackupConnected(), false);
    assert.match(h.db.getBackupStatus().lastError, /ECONNRESET/);
    assert.equal((await backup.query('SELECT count(*)::int AS count FROM feed_posts_cache')).rows[0].count, 1);
    const previousError = h.db.getBackupStatus().lastError;
    h.control.beforeQuery = null; h.control.lockAvailable = false; await h.next();
    assert.equal(h.db.isBackupConnected(), true);
    assert.equal(h.pools.filter(p => p.kind === 'backup')[0].ended, true);
    assert.equal(h.db.getBackupStatus().lastError, previousError);
    h.control.lockAvailable = true; await h.next();
    assert.equal(h.db.getBackupStatus().lastError, null);
    assert.equal(h.outstandingClients, 0);
  });

  await t.test('backup connection acquisition failure retries a fresh pool', async () => {
    await reset(); await seed(primary, 'keep');
    const h = harness(primary, backup); await h.start();
    h.control.backupConnectFailures = 1; await h.next();
    assert.equal(h.db.isBackupConnected(), false);
    await h.next();
    assert.equal(h.db.isBackupConnected(), true);
    assert.equal(h.pools.filter(p => p.kind === 'backup')[0].ended, true);
    assert.equal(h.outstandingClients, 0);
  });

  await t.test('repeated starts never overlap an in-flight run or create a second timer', async () => {
    await reset(); await seed(primary, 'keep');
    let resume; const paused = new Promise(resolve => { resume = resolve; });
    let entered; const entry = new Promise(resolve => { entered = resolve; });
    const h = harness(primary, backup, { async beforeQuery(kind, sql) {
      if (kind === 'primary' && sql.startsWith('FETCH')) { entered(); await paused; }
    } });
    await h.db.initDB(); h.db.startBackupSync(); await entry;
    h.db.startBackupSync(); h.db.startBackupSync();
    assert.equal(h.timers.length, 0);
    assert.equal(h.db.getBackupStatus().syncing, true);
    assert.equal(h.trace.filter(q => q.sql.startsWith('DECLARE')).length, 1);
    resume(); await h.wait();
    assert.equal(h.timers.length, 1);
    assert.equal(h.outstandingClients, 0);
  });

  await t.test('another process owning the advisory lock skips the source read and preserves prior errors', async () => {
    await reset(); await seed(primary, 'new'); await seed(backup, 'old');
    const h = harness(primary, backup); await h.start();
    h.control.beforeQuery = (kind, sql) => { if (kind === 'primary' && sql.startsWith('FETCH')) throw Object.assign(new Error('timeout'), { code: '57014' }); };
    await h.next(); const previousError = h.db.getBackupStatus().lastError;
    h.control.lockAvailable = false;
    const sourceReads = h.trace.filter(q => q.sql.startsWith('DECLARE')).length;
    await h.next();
    assert.equal(h.trace.filter(q => q.sql.startsWith('DECLARE')).length, sourceReads);
    assert.equal(h.db.getBackupStatus().lastError, previousError);
    assert.equal(h.outstandingClients, 0);
  });

  for (const [name, controls] of [['same database under different URL aliases', { sameDatabase: true }], ['unverifiable database identity', { ambiguousIdentity: true }]]) {
    await t.test(`refuses snapshot writes for ${name}`, async () => {
      await reset(); await seed(primary, 'primary'); await seed(backup, 'backup');
      const h = harness(primary, backup, controls); await h.start();
      assert.equal(h.db.getBackupStatus().lastSyncAt, null);
      assert.ok(h.db.getBackupStatus().lastError);
      assert.equal(h.trace.some(q => q.sql.startsWith('CREATE TEMP TABLE') || q.sql.startsWith('DELETE FROM feed_posts_cache')), false);
      assert.deepEqual((await primary.query('SELECT id FROM feed_posts_cache')).rows, [{ id: 'primary' }]);
      assert.deepEqual((await backup.query('SELECT id FROM feed_posts_cache')).rows, [{ id: 'backup' }]);
      assert.equal(h.outstandingClients, 0);
    });
  }

  await t.test('source advisory lock prevents same-database writes even when interface addresses differ', async () => {
    await reset(); await seed(primary, 'primary'); await seed(backup, 'backup');
    const h = harness(primary, backup, { sourceLockAvailable: false }); await h.start();
    assert.match(h.db.getBackupStatus().lastError, /primary snapshot lock/);
    assert.equal(h.trace.some(q => q.sql.startsWith('CREATE TEMP TABLE') || q.sql.startsWith('DELETE FROM feed_posts_cache')), false);
    assert.deepEqual((await primary.query('SELECT id FROM feed_posts_cache')).rows, [{ id: 'primary' }]);
    assert.deepEqual((await backup.query('SELECT id FROM feed_posts_cache')).rows, [{ id: 'backup' }]);
    assert.equal(h.outstandingClients, 0);
  });

  await t.test('missing backup configuration does not create pools or retry timers', async () => {
    const h = harness(primary, backup, { env: { DATABASE_URL_BACKUP: '' } }); await h.start();
    assert.equal(h.db.getBackupStatus().enabled, false);
    assert.equal(h.timers.length, 0);
    assert.equal(h.pools.some(p => p.kind === 'backup'), false);
    h.db.startBackupSync();
    assert.equal(h.logs.filter(log => log.includes('synchronization is disabled')).length, 1);
  });
});
