const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createFeedReadAdmission } = require('./feed-read-admission');

function response() {
  return Object.assign(new EventEmitter(), {
    headers: {}, statusCode: 200, destroyed: false, writableEnded: false,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
  });
}

test('a 10,000-intent synthetic burst bounds active work and its queue', async () => {
  const gate = createFeedReadAdmission({ maxActive: 4, maxQueued: 8, queueTimeoutMs: 2000 });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let handlers = 0;
  const handler = gate.wrap(async (_req, res) => { handlers++; await held; res.json({ ok: true }); });
  const responses = Array.from({ length: 10000 }, response);
  const requests = responses.map(res => handler({}, res));
  await Promise.resolve();
  assert.equal(handlers, 4);
  assert.equal(gate.snapshot().active, 4);
  assert.equal(gate.snapshot().queued, 8);
  assert.equal(gate.snapshot().rejected, 9988);
  assert.ok(responses.slice(12).every(res => res.statusCode === 503 && res.headers['Retry-After'] === '2' && res.body.hasMore));
  release();
  await Promise.all(requests);
  assert.equal(handlers, 12);
  assert.equal(gate.snapshot().active, 0);
  assert.equal(gate.snapshot().queued, 0);
  assert.equal(gate.snapshot().peakActive, 4);
});

test('queued disconnects are removed, while active disconnects retain their permit until work stops', async () => {
  const gate = createFeedReadAdmission({ maxActive: 1, maxQueued: 1 });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let handlers = 0;
  const handler = gate.wrap(async () => { handlers++; await held; });
  const active = response(), queued = response();
  const first = handler({}, active), second = handler({}, queued);
  await Promise.resolve();
  active.destroyed = true; active.emit('close');
  assert.equal(gate.snapshot().active, 1);
  queued.destroyed = true; queued.emit('close');
  await second;
  assert.equal(gate.snapshot().queued, 0);
  assert.equal(queued.listenerCount('close'), 0);
  const third = handler({}, response());
  assert.equal(handlers, 1);
  release(); await Promise.all([first, third]);
  assert.equal(handlers, 2);
  assert.equal(gate.snapshot().active, 0);
});

test('queue deadlines return a retryable response and rejected handlers release permits', async () => {
  const gate = createFeedReadAdmission({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 15 });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const handler = gate.wrap(async () => { await held; throw new Error('Fixture read failed'); });
  const first = assert.rejects(handler({}, response()), /Fixture read failed/);
  const queued = response(), second = handler({}, queued);
  await delay(25); await second;
  assert.equal(queued.statusCode, 503);
  assert.equal(queued.body.code, 'FEED_BUSY');
  assert.equal(queued.listenerCount('close'), 0);
  release(); await first;
  assert.equal(gate.snapshot().active, 0);
});
