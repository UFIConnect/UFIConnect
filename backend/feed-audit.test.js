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
  assert.equal(f.audit.admit(makePost(2, { author: { id: 'alice' } })).reason, 'author_flood');
  assert.equal(f.audit.admit(makePost(3, { author: { id: 'bob' } })).allowed, true);
  assert.equal(f.audit.admit(makePost(4)).reason, 'source_flood');
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
  assert.equal(f.audit.admit(makePost(6)).reason, 'approval_cooldown');
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
