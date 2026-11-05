'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  { randomBytes } = require('node:crypto'),
  {
    sealSnapshot,
    openSnapshot,
    decodePlainDump,
    preparePlainDump,
    deriveSnapshotRecoveryKey,
    openSnapshotWithRecoveryKey,
    digest,
  } = require('./office-ai-production-recovery');
test('encrypted snapshots survive roundtrip while plaintext and credential-like data remain absent', () => {
  const key = randomBytes(32),
    value = {
      createdAt: new Date().toISOString(),
      sql: "INSERT INTO x VALUES ('private-member@example.invalid','secret-value-123');",
      rows: 3,
    };
  const sealed = sealSnapshot(value, key);
  assert.ok(!sealed.includes(Buffer.from('private-member')));
  assert.ok(!sealed.includes(Buffer.from('secret-value')));
  assert.deepEqual(openSnapshot(sealed, key), value);
  assert.notDeepEqual(sealSnapshot(value, key), sealed);
});
test('altered ciphertext, altered authenticated metadata and wrong key reject restoration', () => {
  const key = randomBytes(32),
    sealed = sealSnapshot({ createdAt: '2026-11-05T04:00:00Z', sql: 'select 1' }, key);
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 2] ^= 1;
  assert.throws(() => openSnapshot(tampered, key));
  assert.throws(() => openSnapshot(sealed, randomBytes(32)));
  const meta = Buffer.from(sealed),
    at = meta.indexOf(Buffer.from('office-tables'));
  meta[at] ^= 1;
  assert.throws(() => openSnapshot(meta, key));
});
test('invalid envelopes and undersized master keys fail before parsing or decryption', () => {
  assert.throws(() => openSnapshot(Buffer.from('invalid'), randomBytes(32)));
  assert.throws(() => sealSnapshot({ sql: 'x' }, randomBytes(16)));
  assert.throws(() => openSnapshot(Buffer.from('UFI-OFFICE-RECOVERY-1\n999999\n'), randomBytes(32)));
});
test('Windows plain-dump transport decoding preserves original LF,CRLF and bareCR inside values', () => {
  const original = "INSERT INTO t VALUES('one\ntwo','one\r\ntwo','one\rtwo');\n";
  const transported = original.replace(/\n/g, '\r\n');
  assert.equal(decodePlainDump(transported, 'win32'), original);
  assert.equal(decodePlainDump(original, 'linux'), original);
});
test('only native dump preamble/footer wrappers are removed while matching lines inside values survive', () => {
  const body = "INSERT INTO t VALUES('begin\n\\restrict inside\n\\unrestrict inside\nend');\n";
  const wrapped = '-- PostgreSQL dump\n\\restrict outer123\n' + body + '\\unrestrict outer123\n';
  const prepared = preparePlainDump(wrapped.replace(/\n/g, '\r\n'), 'win32');
  assert.equal(prepared, '-- PostgreSQL dump\n' + body);
});
test('older plain SQL without native preamble preserves every wrapper-looking data line', () => {
  const body = "INSERT INTO t VALUES('begin\n\\restrict inside\n\\unrestrict inside\nend');\n";
  assert.equal(preparePlainDump(body, 'linux'), body);
});
test('incomplete or mismatched native wrappers reject the SQL before restoration', () => {
  assert.throws(() => preparePlainDump('-- dump\n\\restrict abc\nSELECT 1;\n', 'linux'), /incomplete/);
  assert.throws(
    () => preparePlainDump('-- dump\n\\restrict abc\nSELECT 1;\n\\unrestrict xyz', 'linux'),
    /mismatched/,
  );
});
test('archive-specific derived recovery keys restore the exact archive without its master key', () => {
  const master = randomBytes(32),
    value = { createdAt: '2026-11-05T04:00:00Z', sql: 'private Office state' },
    archive = sealSnapshot(value, master);
  const key = deriveSnapshotRecoveryKey(archive, master);
  assert.equal(key.length, 32);
  assert.notDeepEqual(key, master);
  assert.deepEqual(openSnapshotWithRecoveryKey(archive, key, digest(archive)), value);
});
test('derived recovery keys reject another archive, wrong identity and wrong key', () => {
  const master = randomBytes(32),
    first = sealSnapshot({ sql: 'same state' }, master),
    second = sealSnapshot({ sql: 'same state' }, master),
    key = deriveSnapshotRecoveryKey(first, master);
  assert.throws(() => openSnapshotWithRecoveryKey(second, key, digest(second)));
  assert.throws(() => openSnapshotWithRecoveryKey(first, key, 'a'.repeat(64)));
  assert.throws(() => openSnapshotWithRecoveryKey(first, randomBytes(32), digest(first)));
});
