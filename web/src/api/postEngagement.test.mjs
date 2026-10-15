import test from 'node:test';
import assert from 'node:assert/strict';
import { publishPostEngagement, mergeConfirmedComments, clearConfirmedEngagement, engagementLedger } from './postEngagement.mjs';
test('confirmed comments appear during provider lag, deduplicate, then expire', () => {
  clearConfirmedEngagement();
  const target = new EventTarget();
  const comment = { id: 'reply', author: { name: 'Member' }, content: 'Hello', createdAt: new Date().toISOString() };
  publishPostEngagement({ id: 'post', source: 'mastodon' }, { action: 'comment', comment }, target);
  assert.equal(mergeConfirmedComments('post', []).length, 1);
  assert.equal(mergeConfirmedComments('post', [], Date.now(), true)[0].author, 'Member');
  assert.equal(mergeConfirmedComments('other', []).length, 0);
  assert.equal(mergeConfirmedComments('post', [comment]).length, 1);
  assert.equal(mergeConfirmedComments('post', []).length, 0);
  publishPostEngagement({ id: 'post' }, { action: 'comment', comment }, target);
  assert.equal(mergeConfirmedComments('post', [], Date.now() + 61_000).length, 0);
});
test('confirmed writes win over reads already in flight and clear with session', () => {
  clearConfirmedEngagement();
  const revision = engagementLedger.revision();
  publishPostEngagement({ id: 'post' }, { action: 'like', likesCount: 4, likedByMe: true }, new EventTarget());
  assert.equal(engagementLedger.apply({ id: 'post', likesCount: 3 }, revision).likesCount, 4);
  assert.equal(engagementLedger.apply({ id: 'post', likesCount: 8 }, engagementLedger.revision()).likesCount, 8);
  clearConfirmedEngagement();
  assert.equal(engagementLedger.apply({ id: 'post', likesCount: 3 }, revision).likesCount, 3);
});
