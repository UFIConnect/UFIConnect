'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tls = require('node:tls');
const { PassThrough } = require('node:stream');
const { Client } = require('pg');
const { databaseConnectionOptions } = require('./database-security');

const env = {
  NODE_ENV: 'production', DATABASE_SSL_MODE: 'verify-full',
  DATABASE_PRIMARY_SSL_CA: 'primary-ca\\nnext-line',
  DATABASE_PRIMARY_SSL_SERVERNAME: 'instance.example.test',
  DATABASE_SSL_CA: 'existing-backup-ca',
};

test('destination CA and identity apply only to the primary; existing backup trust is preserved', () => {
  const primary = databaseConnectionOptions('postgres://member:fixture@192.0.2.1/app?sslmode=no-verify&ssl=false', env);
  assert.deepEqual(primary.ssl, { rejectUnauthorized: true, ca: 'primary-ca\nnext-line', servername: 'instance.example.test' });
  assert.equal(new URL(primary.connectionString).search, '');
  const backup = databaseConnectionOptions('postgres://member:fixture@backup.example.test/app', env, { role: 'backup' });
  assert.deepEqual(backup.ssl, { rejectUnauthorized: true, ca: 'existing-backup-ca' });
  assert.deepEqual(databaseConnectionOptions('postgres://backup.example.test/app', { ...env, DATABASE_SSL_CA: '' }, { role: 'backup' }).ssl,
    { rejectUnauthorized: true });
});

test('configured certificate identity rejects ambiguous hosts, URL overrides, and plaintext', () => {
  for (const servername of ['*.example.test', 'https://example.test', 'example.test:5432', 'user@example.test',
    'example.test/path', 'example.test\\path', 'example.test\n', '192.0.2.1', 'example..test', '-bad.example',
    'bad-.example', 'a'.repeat(64) + '.test', 'a'.repeat(250) + '.test']) {
    assert.throws(() => databaseConnectionOptions('postgres://192.0.2.1/app', { ...env, DATABASE_PRIMARY_SSL_SERVERNAME: servername }));
  }
  for (const url of ['postgres://other.example.test/app', 'postgres://192.0.2.1/app?host=other.example.test',
    'postgres://192.0.2.1/app?host=192.0.2.1&host=other.example.test']) {
    assert.throws(() => databaseConnectionOptions(url, env));
  }
  assert.throws(() => databaseConnectionOptions('postgres://192.0.2.1/app', {
    ...env, DATABASE_SSL_MODE: 'disable', DATABASE_ALLOW_PLAINTEXT_INTERNAL: 'true',
  }));
  assert.throws(() => databaseConnectionOptions('postgres://192.0.2.1/app', { ...env, NODE_ENV: 'development', DATABASE_SSL_MODE: '' }));
  assert.equal(databaseConnectionOptions('postgres://instance.example.test/app', env).ssl.servername, env.DATABASE_PRIMARY_SSL_SERVERNAME);
});

test('installed pg keeps verified CA and SNI through URL parsing and both TLS negotiation modes', t => {
  const pgStream = require(path.join(path.dirname(require.resolve('pg')), 'stream.js'));
  let observed;
  t.mock.method(pgStream, 'getSecureStream', options => {
    observed = options;
    const stream = new PassThrough();
    t.after(() => stream.destroy());
    return stream;
  });
  for (const mode of ['postgres', 'direct']) {
    const options = databaseConnectionOptions('postgres://fixture:fixture@192.0.2.1/app?sslnegotiation=' + mode +
      '&sslmode=no-verify&sslrootcert=ignored&ssl=false', env);
    const client = new Client(options);
    assert.equal(client.connectionParameters.sslnegotiation, mode);
    assert.deepEqual(client.ssl, options.ssl);
    client.connection.upgradeToSSL(client.host, () => {});
    assert.equal(observed.rejectUnauthorized, true);
    assert.equal(observed.servername, env.DATABASE_PRIMARY_SSL_SERVERNAME);
    assert.equal(observed.ca, 'primary-ca\nnext-line');
    assert.equal(observed.checkServerIdentity, undefined);
    assert.equal(tls.checkServerIdentity(observed.servername, { subjectaltname: 'DNS:instance.example.test' }), undefined);
    assert.equal(tls.checkServerIdentity(observed.servername, { subjectaltname: 'DNS:other.example.test' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  }
  assert.throws(() => databaseConnectionOptions('postgres://192.0.2.1/app?sslnegotiation=invalid', env));
});

test('database pool initialization sends primary trust to both primary pools and backup trust only to backup', async () => {
  const pools = [];
  class Pool {
    constructor(options) { pools.push(options); }
    on() {}
    async connect() { return { async query() { return { rows: [] }; }, release() {} }; }
  }
  const runtimeEnv = { ...env, DATABASE_URL: 'postgres://192.0.2.1/app', DATABASE_URL_BACKUP: 'postgres://backup.example.test/app' };
  const context = {
    module: { exports: {} }, exports: {}, process: { env: runtimeEnv }, console: { log() {}, warn() {} },
    require(name) {
      if (name === 'pg') return { Pool };
      if (name === './database-security') return { databaseConnectionOptions: (url, _env, options) => databaseConnectionOptions(url, runtimeEnv, options) };
      throw new Error('Unexpected dependency');
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./db'), 'utf8'), context);
  await context.module.exports.initDB();
  assert.equal(await context.module.exports.initBackupDB(), true);
  assert.equal(pools.length, 3);
  for (const pool of pools.slice(0, 2)) assert.deepEqual(pool.ssl, { rejectUnauthorized: true, ca: 'primary-ca\nnext-line', servername: 'instance.example.test' });
  assert.deepEqual(pools[2].ssl, { rejectUnauthorized: true, ca: 'existing-backup-ca' });
});

test('legacy verified TLS and explicit local plaintext configuration remain supported', () => {
  assert.deepEqual(databaseConnectionOptions('postgres://db.example.test/app', { NODE_ENV: 'production' }).ssl, { rejectUnauthorized: true });
  assert.throws(() => databaseConnectionOptions('postgres://db.example.test/app', { NODE_ENV: 'production', DATABASE_SSL_MODE: 'disable' }));
  assert.equal(databaseConnectionOptions('postgres://localhost/app', { NODE_ENV: 'production', DATABASE_SSL_MODE: 'disable', DATABASE_ALLOW_PLAINTEXT_INTERNAL: 'true' }).ssl, false);
  assert.throws(() => databaseConnectionOptions('postgres://db.example.test/app', {}, { role: 'typo' }));
});
