import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisibleOfficePoller, officePollingPlan } from './office-polling.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('only views that display shared telemetry poll it; analytics and hidden pages do not request global status or agents', () => {
  for (const view of ['analytics', 'users', 'post-pipeline', 'feed-audit', 'topic-transfer', 'setup', 'reports', 'local-web', 'controls', 'office-ai']) {
    assert.deepEqual(officePollingPlan(view), { tasks: [], stream: false }, view);
  }
  assert.equal(officePollingPlan('overview').tasks.find(task => task.id === 'api').intervalMs, 8000);
  assert.equal(officePollingPlan('sources').tasks.find(task => task.id === 'pipeline').intervalMs, 8000);
  assert.equal(officePollingPlan('sources').tasks.find(task => task.id === 'api').intervalMs, 60000);
  assert.deepEqual(officePollingPlan('overview', false), { tasks: [], stream: false });
  assert.ok(officePollingPlan('versions').tasks.some(task => task.id === 'versions'));
});

test('polls serialize slow reads, cancel while hidden, resume once and release all timers on stop', async () => {
  const listeners = new Map(), timers = new Map(); let count = 0, resolve, signal, timerId = 0;
  const page = { hidden: false, visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const poller = createVisibleOfficePoller({ document: page, intervalMs: 8000,
    schedule: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, cancel: id => timers.delete(id),
    task: options => { count++; signal = options.signal; return new Promise(done => { resolve = done; }); } });
  await tick(); poller.refresh(); poller.refresh(); assert.equal(count, 1);
  page.hidden = true; page.visibilityState = 'hidden'; listeners.get('visibilitychange')();
  assert.equal(signal.aborted, true); assert.equal(timers.size, 0);
  resolve(); await tick(); assert.equal(count, 1);
  page.hidden = false; page.visibilityState = 'visible'; listeners.get('visibilitychange')(); await tick();
  assert.equal(count, 2); resolve(); await tick(); assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 8000);
  poller.stop(); assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
});

test('a page opened hidden waits until visible and request failures keep a bounded scheduled retry', async () => {
  let listener, requests = 0, next, errors = 0;
  const page = { hidden: true, visibilityState: 'hidden', addEventListener: (_name, fn) => { listener = fn; }, removeEventListener() {} };
  const poller = createVisibleOfficePoller({ document: page, intervalMs: 15000, schedule: (fn, ms) => { next = { fn, ms }; return 1; }, cancel() {}, onError: () => errors++,
    task: async () => { requests++; throw new Error('Unavailable'); } });
  await tick(); assert.equal(requests, 0);
  page.hidden = false; page.visibilityState = 'visible'; listener(); await tick();
  assert.equal(requests, 1); assert.equal(errors, 1); assert.equal(next.ms, 15000);
  poller.stop();
});
