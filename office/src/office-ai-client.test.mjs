import test from 'node:test';
import assert from 'node:assert/strict';
import { officeAIRequest } from './office-ai-client.js';

test('cancelling a polling subscriber aborts its request without replaying work', async () => {
  const parent = new AbortController(), controllers = new Set(); let calls = 0;
  const request = (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  };
  const pending = officeAIRequest(request, '/office/ai/tasks', { signal: parent.signal }, controllers);
  parent.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1); assert.equal(controllers.size, 0);
});

test('an aborted response body stays a cancellation rather than an unreadable-data error', async () => {
  const parent = new AbortController();
  await assert.rejects(officeAIRequest(async () => ({ ok: true, json: async () => { parent.abort(); throw Error('Stream ended'); } }),
    '/office/ai/terminal', { signal: parent.signal }), { name: 'AbortError' });
});

test('a cancelled subscriber cannot receive a late successful body from a request adapter', async () => {
  const parent = new AbortController();
  await assert.rejects(officeAIRequest(async () => ({ ok: true, json: async () => {
    parent.abort(); return { task: { id: 'stale-receipt' } };
  } }), '/office/ai/tasks', { signal: parent.signal }), { name: 'AbortError' });
});

test('completed reads release cancellation subscriptions and preserve mutation identity', async () => {
  const parent = new AbortController(), controllers = new Set(); let observed, calls = 0;
  const result = await officeAIRequest(async (_url, options) => {
    calls++; observed = options;
    return { ok: true, json: async () => ({ task: { id: 'synthetic-request' } }) };
  }, '/office/ai/tasks', { method: 'POST', signal: parent.signal, body: { clientRequestId: 'synthetic-request' } }, controllers);
  assert.equal(result.task.id, 'synthetic-request'); assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(observed.body), { clientRequestId: 'synthetic-request' });
  parent.abort(); assert.equal(observed.signal.aborted, false); assert.equal(controllers.size, 0);
});
