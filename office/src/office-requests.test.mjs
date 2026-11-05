import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeRequestCoordinator } from './office-requests.mjs';
import { createOfficeClient, createOfficeEventSource } from './office-runtime.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(JSON.stringify(body)).length) } });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('concurrent reviewed reads share one network request and independent response bodies, then honor expiry and reload', async () => {
  let clock = 0, calls = 0;
  const client = createOfficeRequestCoordinator({ clock: () => clock,
    fetcher: async () => { calls++; await tick(); return json({ measured: calls }); } });
  const responses = await Promise.all(Array.from({ length: 12 }, () => client.request('/office/status')));
  assert.deepEqual(await Promise.all(responses.map(response => response.json())), Array.from({ length: 12 }, () => ({ measured: 1 })));
  assert.equal(calls, 1);
  assert.equal((await (await client.request('/office/status')).json()).measured, 1);
  assert.equal(calls, 1);
  clock += 2001;
  assert.equal((await (await client.request('/office/status')).json()).measured, 2);
  await client.request('/office/status', { cache: 'reload' }); assert.equal(calls, 3);
  const row = client.getDiagnostics().rows[0];
  assert.equal(row.networkRequests, 3); assert.equal(row.coalesced, 11); assert.equal(row.cacheHits, 1);
  assert.equal(row.measuredResponses, 3); assert.ok(row.knownResponseBytes > 0);
});

test('one cancelled reader cannot cancel another, and cancelling every reader permits an immediate new read', async () => {
  let release, captured, calls = 0;
  const client = createOfficeRequestCoordinator({ fetcher: async (_url, options) => {
    calls++; captured = options.signal;
    return new Promise(resolve => { release = resolve; });
  } });
  const first = new AbortController(), second = new AbortController();
  const cancelled = client.request('/office/status', { signal: first.signal });
  const surviving = client.request('/office/status', { signal: second.signal });
  first.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(captured.aborted, false);
  release(json({ live: true })); assert.deepEqual(await (await surviving).json(), { live: true });
  const third = new AbortController();
  const abandoned = client.request('/office/agents', { signal: third.signal });
  third.abort(); await assert.rejects(abandoned, { name: 'AbortError' }); assert.equal(captured.aborted, true);
  const oldRelease = release;
  const replacement = client.request('/office/agents');
  assert.equal(calls, 3, 'a resumed view does not join the cancelled request');
  release(json({ current: true })); await replacement;
  oldRelease(json({ stale: true })); await tick();
});

test('authentication changes abort old reads, clear private cache and discard old session measurements', async () => {
  let scope = 1, release;
  const client = createOfficeRequestCoordinator({ getScope: () => scope,
    fetcher: () => new Promise(resolve => { release = resolve; }) });
  const old = client.request('/office/status');
  scope++; client.clear({ auth: true });
  release(json({ private: 'old account' }));
  await assert.rejects(old, { name: 'AbortError' });
  assert.deepEqual(client.getDiagnostics().rows, []);
});

test('writes invalidate completed reads and an older read finishing later cannot restore stale cached data', async () => {
  let release, statusCalls = 0;
  const client = createOfficeRequestCoordinator({ fetcher: async (url, options) => {
    if (options.method === 'POST') return json({ ok: true });
    statusCalls++;
    if (statusCalls === 1) return new Promise(resolve => { release = resolve; });
    return json({ version: 'after write' });
  } });
  const before = client.request('/office/status');
  await client.request('/office/controls/example/execute', { method: 'POST', body: '{}' });
  assert.deepEqual(await (await client.request('/office/status')).json(), { version: 'after write' });
  release(json({ version: 'before write' })); await before;
  assert.deepEqual(await (await client.request('/office/status')).json(), { version: 'after write' });
  assert.equal(statusCalls, 2);
});

test('private user and unknown query reads bypass caching, while memory entries and oversized responses remain bounded', async () => {
  let calls = 0;
  const client = createOfficeRequestCoordinator({ maxEntries: 2, maxBytes: 64,
    fetcher: async () => { calls++; return json({ value: calls }); } });
  await client.request('/office/users?search=private-name'); await client.request('/office/users?search=private-name');
  await client.request('/office/status?unexpected=private-value'); await client.request('/office/status?unexpected=private-value');
  assert.equal(calls, 4);
  for (const category of ['one', 'two', 'three', 'one']) await client.request(`/office/analytics/pageviews?category=${category}`);
  assert.equal(calls, 8, 'the third cached response evicts the oldest of two entries');
  let largeCalls = 0;
  const large = createOfficeRequestCoordinator({ fetcher: async () => { largeCalls++; return json({ value: 'x'.repeat(600000) }); } });
  assert.equal((await (await large.request('/office/status')).json()).value.length, 600000);
  await large.request('/office/status'); assert.equal(largeCalls, 2);
});

test('request diagnostics contain fixed dimensions only and observing diagnostics creates no request', async () => {
  const client = createOfficeRequestCoordinator({ pageUrl: 'https://office.example.invalid/', serviceBases: [
    { service: 'api', url: 'https://api.example.invalid' }, { service: 'pipeline', url: 'https://pipeline.example.invalid' }],
    fetcher: async () => json({ sensitive: 'private-response-body' }) });
  await client.request('https://api.example.invalid/office/users/private-user-id?search=private-search', { headers: { 'x-office-token': 'private-token' } });
  await client.request('https://pipeline.example.invalid/office/agents');
  const before = client.getDiagnostics();
  for (let index = 0; index < 20; index++) assert.equal(client.getDiagnostics(), before);
  assert.equal(before.rows[0].family, 'Members'); assert.equal(before.rows[1].service, 'Pipeline');
  assert.doesNotMatch(JSON.stringify(before), /private-|example\.invalid|\/office\/|search=/);
});

test('a 401 write authenticates future requests but is never automatically replayed', async () => {
  let prompts = 0, writes = 0;
  const client = createOfficeClient({ prompt: async () => `token-${++prompts}`, fetcher: async (_url, options) => {
    if (options.method === 'POST') { writes++; return json({ error: 'Access changed' }, 401); }
    return options.headers['x-office-token'] ? json({ ok: true }) : json({}, 401);
  } });
  await client.request('/office/status'); assert.equal(prompts, 1);
  const write = await client.request('/office/controls/example/execute', { method: 'POST', body: '{}' });
  assert.equal(write.status, 401); assert.equal(writes, 1); assert.equal(prompts, 2);
});

test('a write without existing access establishes authentication before its one network attempt and never retries failures', async () => {
  let calls = 0, prompts = 0;
  const client = createOfficeClient({ prompt: async () => { prompts++; return 'operator-token'; },
    fetcher: async (_url, options) => { calls++; assert.equal(options.headers['x-office-token'], 'operator-token'); throw new TypeError('Connection lost'); } });
  await assert.rejects(client.request('/office/deploy/api', { method: 'POST' }), { name: 'TypeError' });
  assert.equal(calls, 1); assert.equal(prompts, 1);
});

test('Request objects cannot bypass explicit write methods or be replayed as GET reads', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return json({}, 401); };
  const coordinator = createOfficeRequestCoordinator({ fetcher });
  const client = createOfficeClient({ fetcher, prompt: async () => 'operator-token' });
  const write = new Request('https://api.example.invalid/office/status', { method: 'POST', body: 'private write' });
  await assert.rejects(coordinator.request(write), /URL string or URL object/);
  await assert.rejects(client.request(write), /URL string or URL object/);
  assert.equal(calls, 0);
});

test('repeated manual refresh replaces the existing cache allocation instead of accumulating ghost bytes', async () => {
  let calls = 0;
  const client = createOfficeRequestCoordinator({ maxBytes: 1024,
    fetcher: async () => { calls++; return json({ sample: 'x'.repeat(200), version: calls }); } });
  await client.request('/office/status');
  for (let index = 0; index < 15; index++) await client.request('/office/status', { cache: 'reload' });
  assert.equal((await (await client.request('/office/status')).json()).version, 16);
  assert.equal(calls, 16, 'the final ordinary read still uses the one bounded cached response');
});

test('Office streams record header arrival without caching or buffering the event body and remain cancellable', async () => {
  let streamCalls = 0, capturedSignal, prompts = 0, cancelled = 0;
  const client = createOfficeClient({ prompt: async () => { prompts++; return 'stream-operator-token'; },
    fetcher: async (url, options) => {
      if (url.endsWith('/office/status')) return options.headers['x-office-token'] ? json({ ok: true }) : json({}, 401);
      streamCalls++; capturedSignal = options.signal;
      assert.equal(options.headers['x-office-token'], 'stream-operator-token');
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"backlog":[]}\n\n'));
      }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    } });
  await client.request('/office/status');
  const OfficeStream = createOfficeEventSource({ fetcher: client.transportRequest, getToken: client.getToken });
  const stream = new OfficeStream('/office/agents/stream');
  await new Promise(resolve => { stream.onmessage = () => { stream.close(); resolve(); }; });
  assert.equal(capturedSignal.aborted, true);
  const row = client.getDiagnostics().rows.find(item => item.family === 'Agents');
  assert.equal(row.networkRequests, 1); assert.equal(row.completed, 1); assert.equal(row.lastStatus, 200);
  assert.equal(row.cacheHits, 0); assert.equal(row.coalesced, 0); assert.equal(row.measuredResponses, 0);
  const next = new OfficeStream('/office/agents/stream');
  await new Promise(resolve => { next.onmessage = () => { next.close(); resolve(); }; });
  assert.equal(streamCalls, 2, 'each live stream is its own uncached connection');
  assert.equal(prompts, 1, 'stream transport never starts an authentication prompt');
  assert.doesNotMatch(JSON.stringify(client.getDiagnostics()), /stream-operator-token|backlog|\/office\//);
  assert.equal(cancelled, 0, 'event transport remains owned by the stream consumer');
});

test('stream transport fixes credentials to the current Office scope and cannot transmit writes', async () => {
  let streamCalls = 0;
  const client = createOfficeClient({ prompt: async () => 'current-operator', fetcher: async (url, options) => {
    if (url.endsWith('/office/status')) return options.headers['x-office-token'] ? json({ ok: true }) : json({}, 401);
    streamCalls++;
    assert.equal(options.headers['x-office-token'], 'current-operator');
    assert.equal(options.headers.accept, 'text/event-stream');
    return new Response('data: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  await client.request('/office/status');
  const response = await client.transportRequest('/office/agents/stream', { headers: { 'x-office-token': 'another-operator', Accept: 'application/json' } });
  assert.equal(await response.text(), 'data: {}\n\n');
  await assert.rejects(client.transportRequest('/office/agents/stream', { method: 'POST', body: '{}' }), /GET requests without a body/);
  assert.equal(streamCalls, 1);
});
