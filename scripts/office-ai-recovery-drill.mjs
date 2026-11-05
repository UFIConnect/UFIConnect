import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url),
  projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.resolve(
    process.env.OFFICE_RECOVERY_DIRECTORY || path.join(projectRoot, '.cache/office-recovery'),
  ),
  privateDir = path.join(base, 'private');
const {
  sealSnapshot,
  openSnapshot,
  openSnapshotWithRecoveryKey,
  digest,
  preparePlainDump,
} = require('../backend/office-ai-production-recovery');
const { Client } = require('../backend/node_modules/pg');
const { databaseConnectionOptions } = require('../backend/database-security');
export async function ensurePrivateDirectory() {
  await fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    await fs.chmod(privateDir, 0o700);
    return;
  }
  const script = `$ErrorActionPreference='Stop';$p=[IO.Path]::GetFullPath($env:UFI_RECOVERY_PRIVATE_DIR);$a=[Security.AccessControl.DirectorySecurity]::new();$a.SetAccessRuleProtection($true,$false);foreach($s in @([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))){$r=[Security.AccessControl.FileSystemAccessRule]::new($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow');[void]$a.AddAccessRule($r)};[IO.DirectoryInfo]::new($p).SetAccessControl($a)`;
  await new Promise((resolve, reject) => {
    const child = spawn(
      path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: 'ignore', env: { ...process.env, UFI_RECOVERY_PRIVATE_DIR: privateDir } },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('Private backup directory protection timed out'));
    }, 10000);
    child.on('error', () => {
      clearTimeout(timer);
      reject(Error('Private backup directory protection failed'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error('Private backup directory protection failed'));
    });
  });
}
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const fingerprint = (table) =>
  `WITH hashed AS MATERIALIZED(SELECT md5(to_jsonb(t)::text) AS h FROM public.${quote(table)} t) SELECT count(*)::text AS rows,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS checksum FROM hashed`;
async function dump(env, snapshot) {
  const url = new URL(env.DATABASE_URL),
    host = decodeURIComponent(url.hostname),
    servername = env.DATABASE_PRIMARY_SSL_SERVERNAME;
  const ca = path.join(privateDir, 'trusted-ca.pem');
  await fs.writeFile(
    ca,
    [
      ...(env.DATABASE_PRIMARY_SSL_CA || env.DATABASE_SSL_CA
        ? [String(env.DATABASE_PRIMARY_SSL_CA || env.DATABASE_SSL_CA).replace(/\\n/g, '\n')]
        : []),
      ...rootCertificates,
    ].join('\n'),
  );
  const pgEnv = {
    ...process.env,
    PGHOST: servername || host,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: ca,
    PGAPPNAME: 'ufi_office_encrypted_backup_readonly',
    PGCONNECT_TIMEOUT: '15',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=180000 -c lock_timeout=5000',
    ...(servername && isIP(host) ? { PGHOSTADDR: host } : {}),
    ...(url.searchParams.get('sslnegotiation')
      ? { PGSSLNEGOTIATION: url.searchParams.get('sslnegotiation') }
      : {}),
  };
  const binary =
    process.env.OFFICE_PG_DUMP_PATH ||
    (process.platform === 'win32'
      ? path.join(projectRoot, '.cache/tools/postgresql-18.6/pgsql/bin/pg_dump.exe')
      : 'pg_dump');
  const args = [
    '--format=plain',
    '--no-owner',
    '--no-acl',
    '--no-comments',
    '--no-security-labels',
    '--no-publications',
    '--no-subscriptions',
    '--quote-all-identifiers',
    '--inserts',
    '--rows-per-insert=100',
    '--table=public.office_*',
    '--snapshot=' + snapshot,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: pgEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks = [];
    let size = 0,
      stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('Office backup exceeded3-minute bound'));
    }, 180000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024 * 1024) {
        child.kill();
        reject(Error('Office snapshot exceeded256MiB bound'));
      } else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(Error('Local PostgreSQL backup client unavailable'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        let safe = stderr;
        for (const [key, value] of Object.entries(env))
          if (
            /TOKEN|SECRET|PASSWORD|DATABASE_URL|ENCRYPTION_KEY/.test(key) &&
            typeof value === 'string' &&
            value.length > 6
          )
            safe = safe.split(value).join('[redacted]');
        reject(Error('Read-only PostgreSQL dump failed(' + code + '): ' + safe.slice(0, 500)));
      } else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}
export async function captureOfficeSnapshot(env) {
  await ensurePrivateDirectory();
  const start = performance.now(),
    client = new Client({
      ...databaseConnectionOptions(env.DATABASE_URL, { ...env, NODE_ENV: 'production' }),
      connectionTimeoutMillis: 15000,
      statement_timeout: 180000,
      application_name: 'ufi_office_recovery_snapshot_readonly',
    });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL lock_timeout='5s'");
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const tables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'office_%' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    if (!tables.length || tables.some((t) => !/^office_[a-z0-9_]+$/.test(t)))
      throw Error('Office snapshot table scope invalid');
    const parentIds = (await client.query('SELECT id FROM public.users ORDER BY id')).rows.map(
      (row) => row.id,
    );
    const sql = await dump(env, snapshot);
    const fingerprints = {};
    for (const table of tables) fingerprints[table] = (await client.query(fingerprint(table))).rows[0];
    const constraints = (
      await client.query(
        "SELECT t.relname table_name,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid JOIN pg_namespace n ON t.relnamespace=n.oid WHERE n.nspname='public' AND t.relname LIKE 'office_%' ORDER BY t.relname,c.conname",
      )
    ).rows;
    const value = {
      version: 1,
      createdAt: new Date().toISOString(),
      capturePlatform: process.platform,
      scope:
        'Office public.office_* tables only; users represented by id-only dependency placeholders for isolated validation, not restored accounts',
      tables,
      parentIds,
      sql,
      fingerprints,
      constraints,
      sourceServer: (await client.query('SHOW server_version')).rows[0].server_version,
    };
    const master = Buffer.from(env.OAUTH_TOKEN_ENCRYPTION_KEY || '', 'base64');
    const bytes = sealSnapshot(value, master);
    const filename =
      'office-' + value.createdAt.replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8) + '.ufirec';
    await fs.writeFile(path.join(privateDir, filename), bytes, { mode: 0o600 });
    await client.query('ROLLBACK');
    const candidates = (await fs.readdir(privateDir))
      .filter((name) => /^office-[0-9TZ-]+-[a-f0-9]{8}\.ufirec$/.test(name))
      .sort()
      .reverse();
    return {
      filename,
      createdAt: value.createdAt,
      encryptedBytes: bytes.length,
      encryptedSha256: digest(bytes),
      captureMs: Math.round(performance.now() - start),
      tables: tables.length,
      sqlBytes: Buffer.byteLength(sql),
      retentionCapacity: 'unlimited',
      actualRetainedSnapshots: candidates.length,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}
export async function verifyOfficeSnapshot(env, filename, { recoveryKey, expectedArchiveSha256 } = {}) {
  const { PGlite } = require('../backend/node_modules/@electric-sql/pglite');
  if (path.basename(filename) !== filename || !filename.endsWith('.ufirec'))
    throw Error('Choose a saved encrypted snapshot filename');
  const file = path.resolve(privateDir, filename);
  if (path.dirname(file) !== privateDir) throw Error('Snapshot path outside private recovery directory');
  const start = performance.now(),
    bytes = await fs.readFile(file),
    master = recoveryKey ? null : Buffer.from(env.OAUTH_TOKEN_ENCRYPTION_KEY || '', 'base64'),
    open = (data, key = recoveryKey || master) =>
      recoveryKey ? openSnapshotWithRecoveryKey(data, key, expectedArchiveSha256) : openSnapshot(data, key),
    snapshot = open(bytes),
    db = new PGlite();
  try {
    await db.waitReady;
    const localVersion = (await db.query('SHOW server_version')).rows[0].server_version;
    await db.exec("SET TIME ZONE 'UTC';CREATE TABLE public.users(id uuid PRIMARY KEY)");
    if (snapshot.parentIds.length)
      await db.query('INSERT INTO public.users(id) SELECT unnest($1::uuid[])', [snapshot.parentIds]);
    const sql = preparePlainDump(snapshot.sql, snapshot.capturePlatform || 'win32');
    await db.exec(sql);
    await db.exec('SET search_path=public');
    const results = [];
    for (const table of snapshot.tables) {
      const actual = (await db.query(fingerprint(table))).rows[0],
        expected = snapshot.fingerprints[table];
      results.push({
        table,
        rows: Number(actual.rows),
        expectedRows: Number(expected.rows),
        checksumMatches: actual.rows === expected.rows && actual.checksum === expected.checksum,
        expectedChecksum: expected.checksum,
        actualChecksum: actual.checksum,
      });
    }
    if (results.some((r) => !r.checksumMatches)) {
      await fs.writeFile(
        path.join(base, 'restore-mismatch-diagnostic.json'),
        JSON.stringify(
          {
            sourceServer: snapshot.sourceServer,
            isolatedServer: localVersion,
            results,
            sqlSettings: snapshot.sql
              .split('\n')
              .filter((l) => /^SET /.test(l))
              .slice(0, 20),
          },
          null,
          2,
        ),
      );
      throw Error(
        'Restored Office table failed row/checksum verification: ' +
          results
            .filter((r) => !r.checksumMatches)
            .map((r) => r.table)
            .join(','),
      );
    }
    const constraints = (
      await db.query(
        "SELECT t.relname table_name,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid JOIN pg_namespace n ON t.relnamespace=n.oid WHERE n.nspname='public' AND t.relname LIKE 'office_%' ORDER BY t.relname,c.conname",
      )
    ).rows;
    if (JSON.stringify(constraints) !== JSON.stringify(snapshot.constraints)) {
      await fs.writeFile(
        path.join(base, 'restore-constraint-diagnostic.json'),
        JSON.stringify({ expected: snapshot.constraints, actual: constraints }, null, 2),
      );
      throw Error('Restored Office constraints differ from snapshot');
    }
    const damaged = Buffer.from(bytes);
    damaged[damaged.length - 1] ^= 1;
    let tamperRejected = false,
      wrongKeyRejected = false;
    try {
      open(damaged);
    } catch {
      tamperRejected = true;
    }
    try {
      open(bytes, randomBytes(32));
    } catch {
      wrongKeyRejected = true;
    }
    if (!tamperRejected || !wrongKeyRejected) throw Error('Snapshot authentication guard failed');
    return {
      verifiedAt: new Date().toISOString(),
      filename,
      sourceServer: snapshot.sourceServer,
      isolatedServer: localVersion,
      restoreMs: Math.round(performance.now() - start),
      restoredTables: results.length,
      restoredRows: results.reduce((sum, t) => sum + t.rows, 0),
      tables: results,
      constraintsVerified: constraints.length,
      userIdDependencyPlaceholders: snapshot.parentIds.length,
      tamperRejected,
      wrongKeyRejected,
      productionWrites: 0,
      inMemoryRestore: true,
      scope: snapshot.scope,
    };
  } catch (error) {
    throw Error(
      'Isolated restore failed(' +
        String(error.code || error.name) +
        '); no production restore was attempted. ' +
        (/^Restored|^Snapshot/.test(error.message) ? error.message : ''),
    );
  } finally {
    await db.close().catch(() => {});
    snapshot.sql = '';
  }
}
async function main() {
  const mode = process.argv[2];
  if (!['capture', 'verify'].includes(mode))
    throw Error('Usage: office-ai-recovery-drill.mjs capture | verify <encrypted-filename>');
  const env = process.env;
  if (!env.OAUTH_TOKEN_ENCRYPTION_KEY || (mode === 'capture' && !env.DATABASE_URL))
    throw Error('Load the protected database and encryption settings into the operator environment.');
  await fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(privateDir, 0o700);
  const result =
    mode === 'capture' ? await captureOfficeSnapshot(env) : await verifyOfficeSnapshot(env, process.argv[3]);
  await fs.writeFile(
    path.join(base, mode === 'capture' ? 'snapshot-capture.json' : 'restore-drill.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      ...result,
      tables:
        typeof result.tables === 'number'
          ? result.tables
          : result.tables?.map(({ table, rows, checksumMatches }) => ({ table, rows, checksumMatches })),
    }),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
