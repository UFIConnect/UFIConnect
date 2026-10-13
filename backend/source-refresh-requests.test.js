'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSourceRefreshRequests } = require('./source-refresh-requests');

test('API refresh requests coalesce and pipeline claims only configured public source IDs', async () => {
  const pending = new Map(); let schemaCalls = 0;
  const db = { isConnected: () => true, query: async (sql, params) => {
    if (/CREATE TABLE/.test(sql)) { schemaCalls++; return {}; }
    if (/INSERT/.test(sql)) { for (const id of params[0]) pending.set(id, params[1]); return {}; }
    if (/DELETE/.test(sql)) { const rows = []; for (const id of params[0]) if (pending.has(id)) { rows.push({ source: id, requested_at: pending.get(id) }); pending.delete(id); } return { rows }; }
    throw Error('Unexpected query');
  } };
  const api = createSourceRefreshRequests({ db, sourceIds: ['youtube', 'reddit'], now: () => 0 });
  const pipeline = createSourceRefreshRequests({ db, sourceIds: ['youtube', 'reddit'] });
  const requests = await Promise.all([api.enqueue(['youtube', 'youtube', 'private-user-source']), api.enqueue(['youtube', 'reddit'])]);
  assert.equal(requests[0].queued, true);
  assert.deepEqual(requests[0].sourceIds, ['youtube']);
  assert.equal(schemaCalls, 1);
  assert.equal(pending.size, 2);
  const claimed = await pipeline.take();
  assert.deepEqual(claimed.sort(), ['reddit', 'youtube']);
  assert.deepEqual(await pipeline.take(), []);
  await api.enqueue(['youtube']); assert.deepEqual(await pipeline.take(), ['youtube']);
});

test('unavailable storage and failed writes never report a queued refresh', async () => {
  const unavailable = createSourceRefreshRequests({ db: { isConnected: () => false }, sourceIds: ['youtube'] });
  assert.deepEqual(await unavailable.enqueue(), { queued: false, sourceIds: [], requestedAt: null, reason: 'storage_unavailable' });
  const failed = createSourceRefreshRequests({ db: { isConnected: () => true, query: async sql => {
    if (/CREATE/.test(sql)) return {};
    throw Error('Database write failed');
  } }, sourceIds: ['youtube'] });
  await assert.rejects(failed.enqueue(), /Database write failed/);
  assert.equal((await failed.enqueue(['unknown'])).queued, false);
});
