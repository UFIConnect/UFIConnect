'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfficeAIMemoryRoutes } = require('./office-ai-memory-routes');
const { createAppHarness } = require('./test-support/app-harness');

async function invoke(handler, extras = {}) {
  const response = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ query: {}, params: {}, body: {}, ...extras }, response);
  return response;
}

test('memory routes expose bounded recall and pagination with cache disabled', async () => {
  const calls = [], memory = {
    list: async options => { calls.push(['list', options]); return { entries: [], nextCursor: 'cursor' }; },
    search: async (query, options) => { calls.push(['search', query, options]); return { entries: [{ id: 'remembered' }] }; },
  };
  const handlers = createOfficeAIMemoryRoutes(memory);
  const recent = await invoke(handlers.list, { query: { limit: '12', before: 'cursor' } });
  assert.equal(recent.statusCode, 200); assert.equal(recent.headers['Cache-Control'], 'no-store');
  assert.equal(recent.body.persistent, true); assert.equal(recent.body.shared, true);
  assert.deepEqual(calls[0], ['list', { limit: 12, before: 'cursor' }]);
  const searched = await invoke(handlers.list, { query: { query: '  previous deployment  ', limit: '8' } });
  assert.equal(searched.body.entries[0].id, 'remembered');
  assert.deepEqual(calls[1], ['search', 'previous deployment', { limit: 8 }]);
  assert.equal((await invoke(handlers.list, { query: { scope: 'some-other-account' } })).statusCode, 400);
  assert.equal((await invoke(handlers.list, { query: { query: ['bad'] } })).statusCode, 400);
  assert.equal((await invoke(handlers.list, { query: { query: 'x'.repeat(501) } })).statusCode, 400);
  assert.equal(calls.length, 2);
});

test('memory mutations delegate only canonical IDs, explicit clear confirmation and bounded legacy import fields', async () => {
  const calls = [], memory = {
    remove: async id => { calls.push(['remove', id]); return { deleted: true }; },
    clear: async options => { calls.push(['clear', options]); return { cleared: true }; },
    importSavedConversations: async options => { calls.push(['import', options]); return { imported: 2, nextCursor: null }; },
  };
  const handlers = createOfficeAIMemoryRoutes(memory);
  await invoke(handlers.remove, { params: { id: 'memory-id' } });
  await invoke(handlers.clear, { body: { confirmed: 'true' } });
  await invoke(handlers.clear, { body: { confirmed: true } });
  await invoke(handlers.importHistory, { body: { limit: 3, before: 'cursor', scope: 'other' } });
  assert.deepEqual(calls, [['remove', 'memory-id'], ['clear', { confirmed: false }], ['clear', { confirmed: true }], ['import', { limit: 3, before: 'cursor' }]]);
  const failed = createOfficeAIMemoryRoutes({ list: async () => { throw new Error('private-provider-credential'); } });
  const result = await invoke(failed.list);
  assert.equal(result.statusCode, 503); assert.ok(!JSON.stringify(result.body).includes('private-provider-credential'));
});

test('every real memory route requires Office authentication before any database or memory access', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'memory-routes-test' } });
  t.after(() => app.close());
  for (const [url, method, body] of [
    ['/office/ai/memory', 'GET'],
    ['/office/ai/memory/00000000-0000-4000-8000-000000000001', 'DELETE'],
    ['/office/ai/memory/clear', 'POST', { confirmed: true }],
    ['/office/ai/memory/import', 'POST', { limit: 5 }],
    ['/office/ai/workspace/00000000-0000-4000-8000-000000000001', 'GET'],
    ['/office/ai/workspace/00000000-0000-4000-8000-000000000001/file?path=index.html', 'GET'],
    ['/office/ai/activity', 'GET'],
  ]) {
    const result = await app.request(url, { method, body });
    assert.equal(result.status, 401, url);
  }
  assert.equal(app.queries.length, 0);
});
