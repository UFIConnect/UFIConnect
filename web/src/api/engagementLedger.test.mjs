import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngagementLedger } from './engagementLedger.mjs';

test('an overlapping feed read cannot undo a confirmed like or comment', () => {
  const ledger = createEngagementLedger();
  const before = ledger.revision();
  ledger.record('p', { likedByMe: true, likesCount: 4 });
  ledger.record('p', { commentsCount: 3 });
  assert.deepEqual(ledger.apply({ id: 'p', content: 'fresh', likesCount: 2, commentsCount: 1 }, before),
    { id: 'p', content: 'fresh', likedByMe: true, likesCount: 4, commentsCount: 3 });
  assert.equal(ledger.apply({ id: 'p', likesCount: 7 }, ledger.revision()).likesCount, 7);
});

test('account changes clear confirmed state and storage remains bounded', () => {
  const ledger = createEngagementLedger(2);
  const before = ledger.revision();
  for (const id of ['a', 'b', 'c']) ledger.record(id, { likesCount: 8 });
  assert.equal(ledger.apply({ id: 'a', likesCount: 0 }, before).likesCount, 0);
  assert.equal(ledger.apply({ id: 'c', likesCount: 0 }, before).likesCount, 8);
  ledger.clear();
  assert.equal(ledger.apply({ id: 'c', likesCount: 0 }, before).likesCount, 0);
});
