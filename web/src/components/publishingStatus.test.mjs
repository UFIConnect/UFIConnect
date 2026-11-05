import test from 'node:test';
import assert from 'node:assert/strict';
import { crossPostRequestConfig, createPublishingStatusPolling, mergePublishingHistory, mergePublishingResults,
  pendingPublishingKey, publishingProcessingMessage, publishingReceiptLink } from './publishingStatus.mjs';

const pending = { platform: 'youtube', status: 'processing', publishId: 'video_123', providerId: 'video_123',
  postedUrl: 'https://www.youtube.com/watch?v=video_123' };
const post = (id, targets = [pending]) => ({ id, targets, createdAt: '2026-11-05T12:00:00Z' });
const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };

function events(extra = {}) {
  const listeners = new Map();
  return { ...extra,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name) { for (const fn of listeners.get(name) || []) fn(); },
  };
}
function clock() {
  let time = 0, sequence = 0;
  const tasks = new Map();
  return {
    now: () => time,
    schedule(fn, delay) { const id = ++sequence; tasks.set(id, { fn, at: time + delay }); return id; },
    unschedule(id) { tasks.delete(id); },
    delay: () => tasks.size ? Math.min(...[...tasks.values()].map(task => task.at - time)) : null,
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...tasks.entries()].sort((left, right) => left[1].at - right[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; tasks.delete(next[0]); next[1].fn(); await flush();
      }
      time = end; await flush();
    },
  };
}

test('only video publication receives the extended submit budget', () => {
  assert.deepEqual(crossPostRequestConfig('video'), { timeout: 360000 });
  for (const type of ['image', 'text', undefined]) assert.deepEqual(crossPostRequestConfig(type), {});
});

test('receipt refresh matches the exact batch, platform and provider ID and never regresses terminal results', () => {
  const results = [{ ...pending, error: 'Preparing delivery.' }, { platform: 'uficonnect', status: 'posted' }];
  const next = { ...pending, status: 'posted', statusCheckedAt: '2026-11-05T12:00:05Z' };
  assert.equal(mergePublishingResults(results, 'current', [post('another', [next])]), results);
  assert.equal(mergePublishingResults(results, null, [post('current', [next])]), results);
  assert.deepEqual(mergePublishingResults(results, 'current', [post('current', [{ ...next, publishId: 'different' }])]), results);
  const updated = mergePublishingResults(results, 'current', [post('current', [next])]);
  assert.equal(updated[0].status, 'posted'); assert.equal(updated[0].error, undefined);
  assert.equal(updated[1], results[1]);
  assert.deepEqual(mergePublishingResults(updated, 'current', [post('current')]), updated);
  const failed = [{ ...pending, status: 'failed', error: 'Provider rejected the video.' }];
  assert.deepEqual(mergePublishingResults(failed, 'current', [post('current', [next])]), failed);
  const measured = [{ ...pending, statusCheckedAt: '2026-11-05T12:00:10Z', processingProgress: 80 }];
  assert.deepEqual(mergePublishingResults(measured, 'current', [post('current', [{ ...pending, statusCheckedAt: '2026-11-05T12:00:05Z', processingProgress: 10 }])]), measured);
  assert.deepEqual(mergePublishingResults(measured, 'current', [post('current', [{ ...pending, processingProgress: 10 }])]), measured,
    'An unmeasured pending snapshot cannot overwrite measured progress');
  assert.equal(mergePublishingResults(measured, 'current', [post('current', [{ ...pending, status: 'posted' }])])[0].status, 'posted',
    'A terminal receipt from a compatible older server can complete the upload without a timestamp');
});

test('history refresh retains concurrent deliveries while protecting posted and failed receipts', () => {
  const current = [post('accepted', [{ ...pending, status: 'posted' }]), post('new-local')];
  const merged = mergePublishingHistory(current, [post('accepted'), post('older', [{ ...pending, status: 'failed' }])]);
  assert.equal(merged.find(row => row.id === 'accepted').targets[0].status, 'posted');
  assert.ok(merged.some(row => row.id === 'new-local'));
  assert.ok(merged.some(row => row.id === 'older'));
  assert.equal(mergePublishingHistory([], Array.from({ length: 80 }, (_, index) => post(`batch-${index}`))).length, 50);
  assert.equal(pendingPublishingKey([post('b'), post('a'), post('b')]), 'a|b');
  assert.equal(pendingPublishingKey([post('done', [{ ...pending, status: 'posted' }]), post('review', [{ platform: 'figma', status: 'handoff', publishId: 'comment' }])]), '');
});

test('partial status snapshots preserve concurrent provider receipts within their exact batch', () => {
  const youtube = { ...pending, statusCheckedAt: '2026-11-05T12:00:10Z', processingProgress: 80 };
  const linkedin = { platform: 'linkedin', status: 'posted', providerId: 'linkedin-1' };
  const tiktok = { platform: 'tiktok', status: 'processing', publishId: 'tiktok-1' };
  const current = [post('current', [youtube, linkedin, tiktok])];
  const merged = mergePublishingHistory(current, [post('current', [{ ...pending, processingProgress: 5 }])]);
  assert.deepEqual(merged[0].targets, [youtube, linkedin, tiktok]);
  const completed = mergePublishingHistory(merged, [post('current', [{ ...pending, status: 'posted' }])]);
  assert.equal(completed[0].targets[0].status, 'posted');
  assert.deepEqual(completed[0].targets.slice(1), [linkedin, tiktok]);
});

test('processing messages use only measured progress and links reject unsafe or mismatched YouTube hosts', () => {
  assert.match(publishingProcessingMessage(pending), /Uploaded to YouTube/);
  assert.match(publishingProcessingMessage({ ...pending, processingProgress: 42.8 }), /43%/);
  for (const progress of [null, undefined, '10', -1, 101]) assert.doesNotMatch(publishingProcessingMessage({ ...pending, processingProgress: progress }), /%/);
  assert.equal(publishingProcessingMessage({ platform: 'youtube', status: 'processing' }), 'Sending video to YouTube.');
  assert.equal(publishingReceiptLink(pending).label, 'View on YouTube');
  assert.equal(publishingReceiptLink({ ...pending, status: 'posted' }).label, 'View post');
  for (const postedUrl of ['javascript:alert(1)', 'https://youtube.com.evil.invalid/watch?v=video_123', 'https://user@youtube.com/watch?v=video_123', 'http://youtube.com/watch?v=video_123', 'https://youtube.com/watch?v=bad']) {
    assert.equal(publishingReceiptLink({ ...pending, postedUrl }), null);
  }
  assert.equal(publishingReceiptLink({ platform: 'uficonnect', status: 'posted', postedUrl: '/p/123' }).href, 'https://uficonnect.org/p/123');
});

test('status polling follows 3/5/10/30 second cadence and stops when receipts complete', async () => {
  const timer = clock(), page = events({ hidden: false }), host = events();
  let calls = 0, stillPending = true;
  const poller = createPublishingStatusPolling({ ...timer, document: page, window: host,
    request: async () => ({ posts: [post('current', [{ ...pending, status: ++calls === 4 ? 'posted' : 'processing' }])] }),
    onPosts: posts => { stillPending = Boolean(pendingPublishingKey(posts)); }, isPending: () => stillPending });
  assert.equal(timer.delay(), 3000);
  await timer.advance(2999); assert.equal(calls, 0);
  await timer.advance(1); assert.equal(calls, 1); assert.equal(timer.delay(), 5000);
  await timer.advance(5000); assert.equal(calls, 2); assert.equal(timer.delay(), 10000);
  await timer.advance(10000); assert.equal(calls, 3); assert.equal(timer.delay(), 30000);
  await timer.advance(30000); assert.equal(calls, 4); assert.equal(timer.delay(), null);
  poller.close();
});

test('polling pauses when hidden, coalesces manual/focus requests, and aborts old owners without applying responses', async () => {
  const timer = clock(), page = events({ hidden: true }), host = events();
  let calls = 0, applied = 0, resolve, signal, owner = 'first';
  const poller = createPublishingStatusPolling({ ...timer, document: page, window: host, isPending: () => true,
    isCurrent: () => owner === 'first', onPosts: () => applied++,
    request: currentSignal => { calls++; signal = currentSignal; return new Promise(done => { resolve = done; }); } });
  await timer.advance(60000); assert.equal(calls, 0);
  page.hidden = false; page.emit('visibilitychange'); host.emit('focus'); await timer.advance(0);
  assert.equal(calls, 1);
  const refresh = poller.refresh(); host.emit('focus'); assert.equal(calls, 1);
  resolve({ posts: [post('first')] }); await refresh; await flush(); assert.equal(applied, 1);
  page.hidden = true; page.emit('visibilitychange'); await timer.advance(60000); assert.equal(calls, 1);
  page.hidden = false; page.emit('visibilitychange'); await timer.advance(0); assert.equal(calls, 2);
  owner = 'second'; poller.close(); assert.equal(signal.aborted, true);
  resolve({ posts: [post('first', [{ ...pending, status: 'posted' }])] }); await flush();
  assert.equal(applied, 1); assert.equal(timer.delay(), null);
});

test('transient errors and provider warnings back off without changing receipt status or retrying publication', async () => {
  const timer = clock(), page = events({ hidden: false }), host = events(), states = [], receipts = [];
  let calls = 0;
  const poller = createPublishingStatusPolling({ ...timer, document: page, window: host, isPending: () => true,
    onState: value => states.push(value), onPosts: values => receipts.push(...values),
    request: async () => {
      calls++;
      if (calls === 1) throw { response: { status: 429, headers: { 'retry-after': '60' } } };
      return { posts: [post('current')], warnings: ['YouTube status is temporarily unavailable.'], retryAfterMs: 30000 };
    } });
  await timer.advance(3000); assert.equal(calls, 1); assert.equal(timer.delay(), 60000); assert.equal(receipts.length, 0);
  assert.ok(states.some(state => state.error?.includes('has not been resent')));
  host.emit('focus'); await timer.advance(30000); assert.equal(calls, 1);
  await poller.refresh(); assert.equal(calls, 2); assert.equal(receipts[0].targets[0].status, 'processing');
  assert.ok(states.some(state => state.error === 'YouTube status is temporarily unavailable.'));
  assert.equal(timer.delay(), 30000);
  poller.close();
});
