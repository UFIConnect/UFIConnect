'use strict';
const { createHash } = require('node:crypto');
const MAGIC = Buffer.from('UFI-OFFICE-RECOVERY-1\n');
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
function planArchiveParts(filename, bytes, maximumPartBytes = 8 * 1024 * 1024) {
  if (
    !/^office-[0-9TZ-]+-[a-f0-9]{8}\.ufirec$/.test(filename) ||
    !Buffer.isBuffer(bytes) ||
    !bytes.subarray(0, MAGIC.length).equals(MAGIC) ||
    bytes.length > 256 * 1024 * 1024 ||
    !Number.isInteger(maximumPartBytes) ||
    maximumPartBytes < 64 ||
    maximumPartBytes > 8 * 1024 * 1024
  )
    throw Error('Choose a bounded encrypted Office recovery archive');
  const archiveSha256 = hash(bytes),
    count = Math.ceil(bytes.length / maximumPartBytes);
  const prefix = 'office-recovery/' + filename.slice(0, -7) + '/' + archiveSha256.slice(0, 16);
  const parts = Array.from({ length: count }, (_, index) => {
    const start = index * maximumPartBytes,
      end = Math.min(start + maximumPartBytes, bytes.length),
      piece = bytes.subarray(start, end);
    return {
      index: index + 1,
      count,
      start,
      end,
      bytes: piece.length,
      sha256: hash(piece),
      md5: hash(piece, 'md5'),
      publicId:
        prefix +
        '/part-' +
        String(index + 1).padStart(2, '0') +
        '-of-' +
        String(count).padStart(2, '0') +
        '.ufirec',
    };
  });
  return { filename, archiveSha256, encryptedBytes: bytes.length, prefix, parts };
}
function validatePartReceipt(part, receipt) {
  if (
    !receipt ||
    receipt.public_id !== part.publicId ||
    receipt.resource_type !== 'raw' ||
    receipt.type !== 'authenticated' ||
    receipt.bytes !== part.bytes
  )
    throw Error('Offsite part was not confirmed as the exact authenticated raw object');
  if (/^[a-f0-9]{32}$/i.test(receipt.etag || '') && receipt.etag.toLowerCase() !== part.md5)
    throw Error('Existing offsite object differs from the encrypted archive part');
  return true;
}
function verifyReassembled(plan, pieces) {
  if (
    !Array.isArray(pieces) ||
    pieces.length !== plan.parts.length ||
    pieces.some(
      (piece, index) =>
        !Buffer.isBuffer(piece) ||
        piece.length !== plan.parts[index].bytes ||
        hash(piece) !== plan.parts[index].sha256,
    )
  )
    throw Error('Offsite downloaded part failed integrity verification');
  const bytes = Buffer.concat(pieces);
  if (bytes.length !== plan.encryptedBytes || hash(bytes) !== plan.archiveSha256)
    throw Error('Reassembled encrypted archive differs from the source snapshot');
  return bytes;
}
module.exports = { planArchiveParts, validatePartReceipt, verifyReassembled };
