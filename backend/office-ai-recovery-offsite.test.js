'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  { randomBytes } = require('node:crypto');
const { planArchiveParts, validatePartReceipt, verifyReassembled } = require('./office-ai-recovery-offsite');
const archive = Buffer.concat([Buffer.from('UFI-OFFICE-RECOVERY-1\n'), randomBytes(300)]);
test('encrypted parts have deterministic isolated names and reconstruct exactly in order', () => {
  const plan = planArchiveParts('office-2026-11-05T04-00-00-000Z-1234abcd.ufirec', archive, 128);
  assert.equal(plan.parts.length, 3);
  assert.equal(
    plan.parts.every((p) => p.bytes <= 128),
    true,
  );
  assert.equal(
    plan.parts.every((p) => p.publicId.startsWith(plan.prefix + '/part-')),
    true,
  );
  assert.deepEqual(
    verifyReassembled(
      plan,
      plan.parts.map((p) => archive.subarray(p.start, p.end)),
    ),
    archive,
  );
  assert.deepEqual(planArchiveParts(plan.filename, archive, 128), plan);
});
test('plaintext inputs, path traversal, oversized pieces and invalid resource receipts are rejected', () => {
  const name = 'office-2026-11-05T04-00-00-000Z-1234abcd.ufirec',
    part = planArchiveParts(name, archive, 128).parts[0];
  assert.throws(() => planArchiveParts('../../file.ufirec', archive));
  assert.throws(() => planArchiveParts(name, Buffer.from('plain SQL')));
  assert.throws(() => planArchiveParts(name, archive, 20 * 1024 * 1024));
  for (const overrides of [
    { type: 'upload' },
    { resource_type: 'image' },
    { bytes: 1 },
    { public_id: 'other-object' },
    { etag: 'a'.repeat(32) },
  ])
    assert.throws(() =>
      validatePartReceipt(part, {
        public_id: part.publicId,
        resource_type: 'raw',
        type: 'authenticated',
        bytes: part.bytes,
        ...overrides,
      }),
    );
  assert.equal(
    validatePartReceipt(part, {
      public_id: part.publicId,
      resource_type: 'raw',
      type: 'authenticated',
      bytes: part.bytes,
      etag: part.md5,
    }),
    true,
  );
});
test('missing, altered, truncated and reordered downloaded parts fail before restoration', () => {
  const plan = planArchiveParts('office-2026-11-05T04-00-00-000Z-1234abcd.ufirec', archive, 128),
    pieces = plan.parts.map((p) => Buffer.from(archive.subarray(p.start, p.end)));
  assert.throws(() => verifyReassembled(plan, pieces.slice(1)));
  assert.throws(() => verifyReassembled(plan, [...pieces].reverse()));
  const bad = pieces.map((p) => Buffer.from(p));
  bad[0][0] ^= 1;
  assert.throws(() => verifyReassembled(plan, bad));
  assert.throws(() => verifyReassembled(plan, [pieces[0].subarray(1), ...pieces.slice(1)]));
});
