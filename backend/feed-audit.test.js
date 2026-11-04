'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createFeedAudit, normalizePolicy } = require('./feed-audit');
const makePost = (id, extra = {}) => ({ id: String(id), source: 'reddit', title: `Engineering report ${id}`, content: `A useful engineering article containing distinct content number ${id}.`, sourceUrl: `https://example.org/posts/${id}`, ...extra });
const fixture = async () => {
  const pg = new PGlite(); let time = Date.now();
  const db = { query: (...args) => pg.query(...args), isConnected: () => true };
  const options = { now: () => time, schedule: () => null, requirePolicy: true };
  const audit = createFeedAudit(db, options); await audit.initialize();
  return { pg, db, audit, options, advance: ms => { time += ms; } };
};
test('source blocks persist across instances and aliases and remain active with flood guard disabled', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  await f.audit.block('hn', 'Compromised source');
  await f.audit.configure({ enabled: false });
  const another = createFeedAudit(f.db, f.options); await another.reload();
  assert.deepEqual(another.access(makePost(1, { source: 'hackernews' })), { allowed: false, reason: 'source_blocked' });
  assert.equal(another.admit(makePost(2, { source: 'hn' })).allowed, false);
  assert.equal(another.access(makePost(3, { source: 'hn', isExternal: false })).allowed, false);
  await another.unblock('hn'); assert.equal(another.access(makePost(1, { source: 'hackernews' })).allowed, true);
});
test('source and author rate guards separate held intake from approval and reset windows', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  await f.audit.configure({ maxPerSourcePerMinute: 2, maxPerAuthorPerMinute: 1 });
  assert.equal(f.audit.admit(makePost(1, { author: { id: 'alice' } })).allowed, true);
  const authorHold = f.audit.admit(makePost(2, { author: { id: 'alice' } }));
  assert.equal(authorHold.reason, 'author_flood');
  assert.equal(authorHold.retryAt, f.options.now() + 60000);
  assert.equal(f.audit.admit(makePost(3, { author: { id: 'bob' } })).allowed, true);
  const sourceHold = f.audit.admit(makePost(4));
  assert.equal(sourceHold.reason, 'source_flood'); assert.equal(sourceHold.retryAt, authorHold.retryAt);
  assert.equal(f.audit.summary().held, 2); assert.equal(f.audit.summary().approvalPct, null);
  f.advance(61000); await f.audit.reload(); assert.equal(f.audit.admit(makePost(4)).allowed, true);
});
test('content duplicates use a rolling source window and one admission is not charged twice', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  await f.audit.configure({ maxPerSourcePerMinute: 2, duplicateWindowSeconds: 10 });
  const first = makePost(1); assert.equal(f.audit.admit(first).allowed, true);
  assert.equal(f.audit.admit({ ...first, content: first.content + ' ' }).allowed, true);
  assert.equal(f.audit.admit({ ...first, id: '2' }).reason, 'duplicate_content');
  f.advance(11000); assert.equal(f.audit.admit({ ...first, id: '2' }).allowed, true);
  assert.equal(f.audit.admit(makePost(3)).reason, 'source_flood');
});
test('poor approval activates cooldown without counting held posts as successful approvals', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  await f.audit.configure({ minimumSample: 5, cooldownSeconds: 10 });
  for (let n = 0; n < 5; n++) f.audit.record(makePost(n), { allowed: false, reason: 'link_spam' });
  const hold = f.audit.admit(makePost(6));
  assert.equal(hold.reason, 'approval_cooldown'); assert.equal(hold.retryAt, f.options.now() + 10000);
  assert.equal(f.audit.summary().approvalPct, 0); assert.equal(f.audit.summary().checked, 5);
  f.advance(11000); assert.equal(f.audit.admit(makePost(6)).allowed, true);
});
test('history deduplicates identical outcomes across processes and supports paginated inspection', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  const bad = makePost(1, { title: 'A suspicious offer', content: 'Buy accounts from this link', sourceUrl: 'https://example.org/path?token=private&topic=tech' });
  f.audit.record(bad, { allowed: false, reason: 'spam_or_solicitation' });
  f.audit.record({ ...bad }, { allowed: false, reason: 'spam_or_solicitation' });
  f.audit.record(makePost(2), { allowed: true }); await f.audit.flush();
  const another = createFeedAudit(f.db, f.options); await another.initialize();
  another.record(bad, { allowed: false, reason: 'spam_or_solicitation' }); await another.flush();
  const result = await another.list({ status: 'rejected', q: 'suspicious', limit: 1 });
  assert.equal(result.items.length, 1); assert.equal(result.summary.checked, 2); assert.equal(result.summary.approvalPct, 50);
  assert.equal(result.items[0].sourceUrl.includes('private'), false);
  assert.match(result.items[0].explanation, /scam pattern/);
  assert.equal((await another.detail(result.items[0].id)).content, bad.content);
  assert.equal((await another.list({ limit: 1 })).hasMore, true);
});
test('policy validation rejects bypasses and independently written configuration keys survive', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  assert.throws(() => normalizePolicy({ enabled: 'false' }));
  assert.throws(() => normalizePolicy({ maxPerSourcePerMinute: 0 }));
  assert.throws(() => normalizePolicy({ blockedSources: [] }));
  const another = createFeedAudit(f.db, f.options); await another.initialize();
  await f.audit.configure({ maxPerSourcePerMinute: 80 }); await another.configure({ maxPerAuthorPerMinute: 7 });
  await f.audit.reload(); assert.equal(f.audit.policy().maxPerSourcePerMinute, 80); assert.equal(f.audit.policy().maxPerAuthorPerMinute, 7);
});
test('production intake fails closed before policy initialization', () => {
  const audit = createFeedAudit({ isConnected: () => false }, { requirePolicy: true, schedule: () => null });
  assert.equal(audit.access(makePost(1)).reason, 'policy_unavailable');
  assert.equal(audit.admit(makePost(1)).allowed, false);
  assert.equal(audit.summary().held, 1); assert.equal(audit.access(makePost(2, { source: 'uficonnect' })).allowed, true);
});
test('stale policy fails closed and recovers only after a database refresh', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  f.advance(31000); assert.equal(f.audit.access(makePost(1)).reason, 'policy_unavailable');
  await f.audit.reload(); assert.equal(f.audit.access(makePost(1)).allowed, true);
});
test('normalization and approved screening metadata do not inflate audit counts', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  const raw = makePost(1, { content: 'Normal   readable article content.' });
  const normalized = { ...raw, content: 'Normal readable article content.', screeningStatus: 'approved' };
  f.audit.record(raw, { allowed: true, post: normalized });
  f.audit.record(normalized, { allowed: true, post: normalized });
  assert.equal(f.audit.summary().checked, 1);
});
test('canonical source block commands resolve only to registered worker aliases', () => {
  const { findOfficeControl } = require('./office-controls');
  assert.equal(findOfficeControl('source.block.hackernews', ['hn']).sourceId, 'hn');
  assert.equal(findOfficeControl('source.unblock.hackernews', ['hn']).sourceId, 'hn');
  assert.equal(findOfficeControl('source.block.hackernews', ['reddit']), null);
});

test('old stored policies gain pull defaults and nested policy snapshots cannot mutate enforcement', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  await f.db.query("UPDATE office_feed_policy SET settings=settings - 'sourcePullLimits' WHERE id=1");
  await f.audit.reload();
  assert.deepEqual(f.audit.policy().sourcePullLimits.bluesky, { windowSeconds: 30, maxPulls: 12 });
  const snapshot = f.audit.policy(); snapshot.sourcePullLimits.bluesky.maxPulls = 9999;
  assert.equal(f.audit.collectionState('bluesky').minSpacingMs, 2500);
  const first = normalizePolicy({}), second = normalizePolicy({});
  first.sourcePullLimits.bluesky.windowSeconds = 9999;
  assert.equal(second.sourcePullLimits.bluesky.windowSeconds, 30);
  await f.audit.block('bluesky', 'Review source');
  const blocked = f.audit.policy(); blocked.blockedSources[0].reason = 'Changed externally';
  assert.equal(f.audit.policy().blockedSources[0].reason, 'Review source');
});

test('concurrent partial source pull settings preserve independently updated entries', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  const another = createFeedAudit(f.db, f.options); await another.initialize();
  await Promise.all([
    f.audit.configure({ sourcePullLimits: { bluesky: { windowSeconds: 60, maxPulls: 6 } } }),
    another.configure({ sourcePullLimits: { medium: { windowSeconds: 90, maxPulls: 3 } }, maxPerSourcePerMinute: 80 }),
  ]);
  await f.audit.reload();
  assert.deepEqual(f.audit.policy().sourcePullLimits.bluesky, { windowSeconds: 60, maxPulls: 6 });
  assert.deepEqual(f.audit.policy().sourcePullLimits.medium, { windowSeconds: 90, maxPulls: 3 });
  assert.equal(f.audit.policy().sourcePullLimits.reddit.maxPulls, 8);
  assert.equal(f.audit.policy().maxPerSourcePerMinute, 80);
  await f.audit.configure({ sourcePullLimits: { hn: { windowSeconds: 40, maxPulls: 2 } } });
  assert.equal(f.audit.collectionState('hn').minSpacingMs, 20000);
  assert.equal(f.audit.collectionState('hackernews').minSpacingMs, 20000);
  await assert.rejects(f.audit.configure({ sourcePullLimits: { bluesky: { maxPulls: 100 } } }));
  assert.equal(f.audit.collectionState('bluesky').minSpacingMs, 10000);
});

test('collection budget checks never spend capacity or create synthetic audit outcomes', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  await f.audit.configure({ maxPerSourcePerMinute: 2 });
  const before = f.audit.summary();
  for (let n = 0; n < 10; n++) assert.equal(f.audit.collectionState('reddit').remaining, 2);
  assert.deepEqual(f.audit.summary(), before);
  const first = makePost(1); assert.equal(f.audit.admit(first).allowed, true);
  assert.equal(f.audit.collectionState('reddit').remaining, 1);
  assert.equal(f.audit.admit(first).allowed, true);
  assert.equal(f.audit.collectionState('reddit').remaining, 1, 'A repeated admission is charged once');
  assert.equal(f.audit.admit(makePost(2)).allowed, true);
  const exhausted = f.audit.collectionState('reddit');
  assert.equal(exhausted.allowed, false); assert.equal(exhausted.reason, 'source_flood');
  assert.equal(exhausted.remaining, 0); assert.ok(Number.isFinite(exhausted.retryAt));
  assert.equal(f.audit.summary().held, 0);
  f.advance(60000); await f.audit.reload();
  assert.equal(f.audit.collectionState('reddit').allowed, true);
  assert.equal(f.audit.collectionState('reddit').remaining, 2);
});

test('configuration waits out a pre-write policy snapshot and immediately enforces the saved ceilings', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  const query = f.db.query;
  let hold = true, releaseRead, markRead, markWrite;
  const readCaptured = new Promise(resolve => { markRead = resolve; });
  const writeCompleted = new Promise(resolve => { markWrite = resolve; });
  f.db.query = async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (hold && sql.startsWith('SELECT settings')) {
      hold = false;
      const pendingRead = new Promise(resolve => { releaseRead = resolve; });
      markRead(); await pendingRead;
    }
    if (sql.startsWith('UPDATE office_feed_policy')) markWrite();
    return result;
  };
  const staleReload = f.audit.reload(); await readCaptured;
  const configured = f.audit.configure({ sourcePullLimits: { bluesky: { windowSeconds: 60, maxPulls: 3 } } });
  await writeCompleted; releaseRead(); await staleReload;
  const returned = await configured;
  assert.deepEqual(returned.sourcePullLimits.bluesky, { windowSeconds: 60, maxPulls: 3 });
  assert.equal(f.audit.collectionState('bluesky').minSpacingMs, 20000);
});

test('collection checks pause blocked and stale sources even when admission limits are disabled', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  await f.audit.configure({ enabled: false });
  const ready = f.audit.collectionState('bluesky');
  assert.equal(ready.allowed, true); assert.equal(ready.remaining, null); assert.equal(ready.minSpacingMs, 2500);
  await f.audit.block('bluesky', 'Review intake');
  assert.equal(f.audit.collectionState('bluesky').reason, 'source_blocked');
  assert.equal(f.audit.summary().rejected, 0);
  f.advance(31000);
  assert.equal(f.audit.collectionState('medium').reason, 'policy_unavailable');
  assert.equal(f.audit.summary().held, 0);
  await f.audit.reload();
  assert.equal(f.audit.collectionState('medium').allowed, true);
  const unavailable = createFeedAudit({ isConnected: () => false }, { requirePolicy: true, schedule: () => null });
  assert.equal(unavailable.collectionState('bluesky').reason, 'policy_unavailable');
});

test('collection checks start a stable quality cooldown before pulling and recover at its deadline', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  await f.audit.configure({ minimumSample: 5, cooldownSeconds: 10 });
  for (let n = 0; n < 5; n++) f.audit.record(makePost(n), { allowed: false, reason: 'link_spam' });
  const paused = f.audit.collectionState('reddit');
  assert.equal(paused.reason, 'approval_cooldown'); assert.equal(paused.allowed, false);
  f.advance(5000);
  assert.equal(f.audit.collectionState('reddit').retryAt, paused.retryAt, 'Polling does not extend cooldown');
  assert.equal(f.audit.summary().held, 0);
  f.advance(5000);
  assert.equal(f.audit.collectionState('reddit').allowed, true);
  assert.equal(f.audit.collectionState('reddit').remaining, 300);
});

test('a failed policy refresh retains its bounded grace period and collection recovers after reload', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  f.advance(20000); f.db.isConnected = () => false;
  await assert.rejects(f.audit.reload(), /unavailable/);
  assert.equal(f.audit.collectionState('bluesky').allowed, true);
  f.advance(10001);
  assert.equal(f.audit.collectionState('bluesky').reason, 'policy_unavailable');
  f.db.isConnected = () => true; await f.audit.reload();
  assert.equal(f.audit.collectionState('bluesky').allowed, true);
  assert.equal(f.audit.status().policyError, null);
  assert.equal(f.audit.summary().held, 0);
});

test('RSS author placeholders cannot combine distinct authors or unknown authors into a fake identity', async t => {
  const f = await fixture(); t.after(() => f.pg.close());
  await f.audit.configure({ maxPerSourcePerMinute: 5, maxPerAuthorPerMinute: 1 });
  const rss = (id, name, isUnknown) => makePost(id, { source: 'medium', sourceLabel: 'Medium', author: { id: 'medium_author', name, title: 'Medium', isUnknown } });
  assert.equal(f.audit.admit(rss(1, 'Alice')).allowed, true);
  assert.equal(f.audit.admit(rss(2, 'Bob')).allowed, true);
  assert.equal(f.audit.admit(rss(3, 'Alice')).reason, 'author_flood');
  assert.equal(f.audit.admit(rss(4, 'Medium')).allowed, true);
  assert.equal(f.audit.admit(rss(5, 'Medium')).allowed, true);
  assert.equal(f.audit.admit(rss(6, 'Publisher fallback', true)).allowed, true);
  assert.equal(f.audit.admit(rss(7, 'Publisher fallback', true)).reason, 'source_flood', 'Unknown authors still share the source cap');
});
