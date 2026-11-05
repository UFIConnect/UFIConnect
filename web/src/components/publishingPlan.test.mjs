import test from 'node:test';
import assert from 'node:assert/strict';
import { publishingPlan, retainedPublishingTargets, publishingDraftFingerprint, readPublishingHold, savePublishingHold, recoverPublishingRun } from './publishingPlan.mjs';
const post = { configured: true, crossPost: { supported: true } };
const accounts = { linkedin: post, youtube: { configured: true, crossPost: { supported: true, requiresVideo: true, allowedMedia: ['video'] } }, twitter: post };
const context = { accounts, connected: { linkedin: true, youtube: true, twitter: true }, plan: 'pro', content: 'Draft' };

test('incomplete media or provider options never block another selected ready destination', () => {
  const result = publishingPlan(['linkedin', 'youtube'], { ...context, optionReasons: { youtube: 'Choose YouTube channel.' } });
  assert.deepEqual(result.ready, ['linkedin']);
  assert.deepEqual(result.pending, [{ platform: 'youtube', reason: 'Add a video to publish to this account.' }]);
  assert.equal(result.label, 'Publish to 1 ready destination');
  assert.deepEqual(publishingPlan(['linkedin', 'youtube'], { ...context, media: { type: 'video' }, optionReasons: { youtube: 'Choose YouTube channel.' } }).pending,
    [{ platform: 'linkedin', reason: 'This account does not support this video attachment.' }, { platform: 'youtube', reason: 'Choose YouTube channel.' }]);
});
test('loading, account consent, membership and explicit audience consent remain per-target requirements', () => {
  assert.deepEqual(publishingPlan(['uficonnect', 'linkedin'], { ...context, loading: true }).ready, ['uficonnect']);
  assert.equal(publishingPlan(['linkedin'], { ...context, connected: {} }).ready.length, 0);
  assert.equal(publishingPlan(['linkedin'], { ...context, plan: 'free' }).ready.length, 0);
  assert.equal(publishingPlan(['linkedin'], { ...context, extraReasons: { linkedin: 'Approve this audience.' } }).pending[0].reason, 'Approve this audience.');
  assert.deepEqual(publishingPlan(['local', 'linkedin'], { ...context, localReason: 'Choose a group.' }).ready, ['linkedin']);
});
test('short-format text and missing receipts cannot silently discard other chosen targets', () => {
  const result = publishingPlan(['twitter', 'linkedin'], { ...context, content: 'x'.repeat(500) });
  assert.deepEqual(result.ready, ['linkedin']);
  assert.match(result.pending[0].reason, /280/);
  assert.deepEqual(retainedPublishingTargets(['linkedin', 'youtube', 'twitter'], [{ platform: 'linkedin', status: 'posted' }, { platform: 'twitter', status: 'failed' }]), ['youtube', 'twitter']);
  assert.deepEqual(retainedPublishingTargets(['youtube', 'linkedin'], [{ platform: 'youtube', status: 'processing' }, { platform: 'linkedin', status: 'handoff' }]), []);
});

test('unconfirmed receipts survive remount and orphan markers recover without blocking new destinations', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const fingerprint = publishingDraftFingerprint('Draft', null);
  savePublishingHold(storage, 'member-a', fingerprint, { youtube: 'Review this receipt.' });
  assert.deepEqual(readPublishingHold(storage, 'member-a', fingerprint), { youtube: 'Review this receipt.' });
  assert.deepEqual(readPublishingHold(storage, 'member-b', fingerprint), {});
  storage.setItem('draft', JSON.stringify({ content: 'Draft', selected: ['uficonnect', 'youtube'] }));
  storage.setItem('sending', '1');
  assert.equal(recoverPublishingRun(storage, 'draft', 'sending').recovered, true);
  assert.equal(storage.getItem('sending'), null);
  const reasons = readPublishingHold(storage, 'draft:delivery-holds', fingerprint);
  assert.deepEqual(publishingPlan(['uficonnect', 'youtube', 'linkedin'], { ...context, extraReasons: reasons }).ready, ['linkedin']);
  storage.setItem('sending', '1');
  assert.equal(recoverPublishingRun(storage, 'draft', 'sending', true).recovered, false);
  assert.equal(storage.getItem('sending'), '1', 'An active same-document operation retains its marker');
});

test('review hold memory is bounded and rejects unsafe metadata', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  for (let index = 0; index < 25; index++) savePublishingHold(storage, 'holds', `draft-${index}`, { youtube: 'Review delivery.' });
  const ledger = JSON.parse(storage.getItem('holds'));
  assert.equal(Object.keys(ledger).length, 20);
  assert.equal(ledger['draft-0'], undefined);
  assert.deepEqual(readPublishingHold(storage, 'holds', 'draft-24'), { youtube: 'Review delivery.' });
  savePublishingHold(storage, 'holds', 'safe', { youtube: 'Review.', 'not a source': 'Invalid', github: 'x'.repeat(501) });
  assert.deepEqual(readPublishingHold(storage, 'holds', 'safe'), { youtube: 'Review.' });
  savePublishingHold(storage, 'holds', 'x'.repeat(20001), { youtube: 'Oversized fingerprint.' });
  assert.equal(Object.keys(JSON.parse(storage.getItem('holds'))).length, 20);
});
