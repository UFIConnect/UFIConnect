'use strict';
const { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const MAGIC = Buffer.from('UFI-OFFICE-RECOVERY-1\n');
const LIMIT = 256 * 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function keyFor(master, salt) {
  if (!Buffer.isBuffer(master) || master.length !== 32) throw Error('A 32-byte encryption key is required');
  return Buffer.from(hkdfSync('sha256', master, salt, 'ufi-office-production-recovery/v1', 32));
}
function sealSnapshot(value, master) {
  const plain = Buffer.from(JSON.stringify(value));
  if (plain.length > LIMIT) throw Error('Snapshot exceeds bounded capacity');
  const salt = randomBytes(16),
    iv = randomBytes(12),
    compressed = gzipSync(plain),
    meta = {
      version: 1,
      scope: 'office-tables-with-user-id-dependencies',
      createdAt: value.createdAt,
      plainBytes: plain.length,
      plainSha256: digest(plain),
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
    };
  const aad = Buffer.from(JSON.stringify(meta)),
    cipher = createCipheriv('aes-256-gcm', keyFor(master, salt), iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const header = Buffer.from(JSON.stringify({ ...meta, tag: cipher.getAuthTag().toString('base64') }));
  return Buffer.concat([MAGIC, Buffer.from(String(header.length) + '\n'), header, body]);
}
function readEnvelope(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMIT || !bytes.subarray(0, MAGIC.length).equals(MAGIC))
    throw Error('Invalid snapshot envelope');
  const nl = bytes.indexOf(10, MAGIC.length),
    length = Number(bytes.subarray(MAGIC.length, nl).toString());
  if (nl < 0 || !Number.isInteger(length) || length < 10 || length > 8192)
    throw Error('Invalid snapshot envelope');
  const start = nl + 1,
    header = JSON.parse(bytes.subarray(start, start + length).toString());
  const { tag, ...meta } = header;
  if (meta.version !== 1 || meta.plainBytes > LIMIT || meta.plainBytes < 1)
    throw Error('Invalid snapshot metadata');
  return { tag, meta, body: bytes.subarray(start + length) };
}
function decryptEnvelope({ tag, meta, body }, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('A 32-byte recovery key is required');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(meta.iv, 'base64'));
  decipher.setAAD(Buffer.from(JSON.stringify(meta)));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const compressed = Buffer.concat([decipher.update(body), decipher.final()]);
  const plain = gunzipSync(compressed, { maxOutputLength: LIMIT });
  if (plain.length !== meta.plainBytes || digest(plain) !== meta.plainSha256)
    throw Error('Snapshot integrity failed');
  return JSON.parse(plain.toString());
}
function openSnapshot(bytes, master) {
  const envelope = readEnvelope(bytes);
  return decryptEnvelope(envelope, keyFor(master, Buffer.from(envelope.meta.salt, 'base64')));
}
function deriveSnapshotRecoveryKey(bytes, master) {
  const envelope = readEnvelope(bytes);
  const key = keyFor(master, Buffer.from(envelope.meta.salt, 'base64'));
  const validated = decryptEnvelope(envelope, key);
  if (validated && typeof validated === 'object') validated.sql = '';
  return key;
}
function openSnapshotWithRecoveryKey(bytes, recoveryKey, expectedArchiveSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedArchiveSha256 || '') || digest(bytes) !== expectedArchiveSha256)
    throw Error('Recovery key does not match this encrypted archive identity');
  return decryptEnvelope(readEnvelope(bytes), recoveryKey);
}

// Native Windows plain pg_dump writes stdout in text mode. Undo that transport
// LF->CRLF mapping exactly once before sending SQL through a JS client. An
// original stored CRLF becomes CRCRLF in the stream and returns to CRLF here.
function decodePlainDump(sql, platform) {
  if (typeof sql !== 'string') throw Error('Expected plain SQL dump');
  return platform === 'win32' ? sql.replace(/\r\n/g, '\n') : sql;
}

function preparePlainDump(sql, platform) {
  const decoded = decodePlainDump(sql, platform);
  const lines = decoded.split('\n');
  const openingIndex = lines.findIndex((line) => line.trim() && !line.trimStart().startsWith('--'));
  const opening = openingIndex >= 0 && /^\\restrict\s+([A-Za-z0-9]+)\s*$/.exec(lines[openingIndex]);
  if (!opening) return decoded;
  let closingIndex = lines.length - 1;
  while (closingIndex > openingIndex && !lines[closingIndex].trim()) closingIndex--;
  if (lines[closingIndex].trim() !== '\\unrestrict ' + opening[1])
    throw Error('Snapshot SQL wrapper is incomplete or mismatched');
  // Only the native preamble/footer are metadata. Preserve wrapper-looking
  // text inside captured multiline values exactly as business data.
  return lines.filter((_, index) => index !== openingIndex && index !== closingIndex).join('\n');
}

module.exports = {
  sealSnapshot,
  openSnapshot,
  digest,
  decodePlainDump,
  preparePlainDump,
  deriveSnapshotRecoveryKey,
  openSnapshotWithRecoveryKey,
};
