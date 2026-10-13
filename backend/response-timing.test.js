'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createResponseTiming } = require('./response-timing');
const { createAppHarness } = require('./test-support/app-harness');

async function serve(t, app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('response headers measure server elapsed time once, excluding a long SSE lifetime', async t => {
  let clock = 0n;
  const timing = createResponseTiming({ now: () => clock });
  const app = express();
  app.use(timing.middleware);
  app.get('/events/:memberId', (req, res) => {
    clock += 7_125_000n;
    res.set('Content-Type', 'text/event-stream');
    res.set('Server-Timing', 'db;dur=2.000');
    res.flushHeaders();
    clock += 900_000_000_000n;
    res.write('data: connected\n\n');
    res.end();
  });
  const base = await serve(t, app);
  const response = await fetch(`${base}/events/private-member-id?token=private-query`);
  assert.equal(await response.text(), 'data: connected\n\n');
  assert.equal(response.headers.get('server-timing'), 'db;dur=2.000, api;dur=7.125');
  const snapshot = timing.snapshot();
  assert.equal(snapshot.targetMs, 45);
  assert.deepEqual(snapshot.overall, { count: 1, sampleCount: 1, p50Ms: 7.125, p95Ms: 7.125, maxMs: 7.125, overTargetCount: 0 });
  assert.equal(snapshot.routes[0].route, '/events/:memberId');
  assert.equal(JSON.stringify(snapshot).includes('private-'), false);
});

test('explicit writeHead headers retain existing metrics, status, and non-timing headers', async t => {
  let clock = 0n;
  const timing = createResponseTiming({ now: () => clock });
  const app = express();
  app.use(timing.middleware);
  app.get('/object', (_req, res) => {
    clock += 46_500_000n;
    res.writeHead(202, 'Accepted', { 'server-timing': 'db;dur=3', 'X-Fixture': 'object' });
    res.end('object');
  });
  app.get('/array', (_req, res) => {
    clock += 2_250_000n;
    res.writeHead(201, ['Content-Type', 'text/plain', 'Server-Timing', 'cache;dur=1', 'X-Fixture', 'array']);
    res.end('array');
  });
  const base = await serve(t, app);
  for (const [route, status, metric] of [['object', 202, 'db;dur=3, api;dur=46.500'], ['array', 201, 'cache;dur=1, api;dur=2.250']]) {
    const response = await fetch(`${base}/${route}`);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('x-fixture'), route);
    assert.equal(response.headers.get('server-timing'), metric);
    assert.equal(await response.text(), route);
  }
  assert.equal(timing.snapshot().overall.overTargetCount, 1);
});

test('route and percentile windows stay bounded without retaining request IDs or query data', () => {
  let clock = 0n;
  const timing = createResponseTiming({ now: () => clock, maxRoutes: 3, samplesPerRoute: 4, aggregateSamples: 5 });
  const emit = (path, duration, method = 'GET') => {
    const headers = new Map();
    const response = {
      getHeader: name => headers.get(name.toLowerCase()),
      setHeader: (name, value) => headers.set(name.toLowerCase(), value),
      writeHead() { return this; },
    };
    timing.middleware({ method, route: path ? { path } : undefined,
      originalUrl: '/private-member-id?token=private-secret', baseUrl: '/private-member-id',
      params: { id: 'private-member-id' }, user: { id: 'private-member-id' } }, response, () => {
      clock += BigInt(Math.round(duration * 1e6));
      response.writeHead(200);
    });
  };
  for (const duration of [1, 2, 3, 4, 5, 50]) emit('/feed/:postId/comments', duration);
  let snapshot = timing.snapshot();
  assert.deepEqual(snapshot.overall, { count: 6, sampleCount: 5, p50Ms: 4, p95Ms: 50, maxMs: 50, overTargetCount: 1 });
  assert.deepEqual(snapshot.routes[0], { method: 'GET', route: '/feed/:postId/comments', count: 6, sampleCount: 4, p50Ms: 4, p95Ms: 50, maxMs: 50, overTargetCount: 1 });
  emit(null, 1);
  for (let i = 0; i < 10000; i += 1) emit('/registered-route-' + i, 1);
  snapshot = timing.snapshot();
  assert.equal(snapshot.routes.length, 3);
  assert.equal(snapshot.overall.count, 10007);
  assert.equal(snapshot.overall.sampleCount, 5);
  assert.ok(snapshot.routes.every(row => row.sampleCount <= 4));
  assert.equal(snapshot.routes.find(row => row.route === '[additional routes]').count, 10000);
  assert.equal(JSON.stringify(snapshot).includes('private-'), false);
  snapshot.routes[0].route = 'changed snapshot';
  assert.equal(timing.snapshot().routes[0].route, '/feed/:postId/comments');
});

test('the app exposes timing headers through CORS and protects detailed timing diagnostics', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'timing-fixture-only' } });
  t.after(() => app.close());
  const response = await app.request('/readyz', { headers: { origin: 'https://uficonnect.org' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('server-timing'), /^api;dur=\d+\.\d{3}$/);
  assert.equal(response.headers.get('access-control-expose-headers'), 'Server-Timing');
  assert.equal((await app.request('/health/details')).status, 401);
  const publicHealth = await app.request('/health');
  assert.equal(publicHealth.data.responseTiming, undefined);
  const details = await app.request('/health/details', { headers: { 'x-office-token': 'timing-fixture-only' } });
  assert.equal(details.status, 200);
  assert.equal(details.data.responseTiming.targetMs, 45);
  assert.ok(details.data.responseTiming.overall.count >= 3);
  assert.ok(details.data.responseTiming.routes.some(row => row.route === '/readyz'));
});
