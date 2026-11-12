import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserScreenAwake, watchScreenAwake } from './useScreenAwake.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  let now = 0, sequence = 0;
  const timers = new Map(), changes = [];
  const win = new EventTarget(), doc = new EventTarget();
  doc.hidden = false;
  win.performance = { now: () => now };
  win.setTimeout = (callback, delay) => {
    timers.set(++sequence, { callback, at: now + delay });
    return sequence;
  };
  win.clearTimeout = id => timers.delete(id);
  const policy = watchScreenAwake({ win, doc, setAwake: awake => changes.push(awake) });
  return {
    policy, changes, timers,
    input: event => win.dispatchEvent(new Event(event)),
    visibility(hidden) { doc.hidden = hidden; doc.dispatchEvent(new Event('visibilitychange')); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort(([, first], [, second]) => first.at - second.at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
      await settle();
    },
  };
}

test('Videos has no idle deadline and entering Home allows sleep after 15 seconds', async () => {
  const f = fixture();
  f.policy.setHome(false);
  await f.advance(90 * 60 * 1000);
  assert.deepEqual(f.changes, [true]);
  assert.equal(f.timers.size, 0);
  f.policy.setHome(true);
  await f.advance(14_999);
  assert.equal(f.changes.at(-1), true);
  await f.advance(1);
  assert.equal(f.changes.at(-1), false);
  f.policy.setHome(false);
  await f.advance(30_000);
  assert.equal(f.changes.at(-1), true);
  assert.equal(f.timers.size, 0);
});

test('Home input extends the deadline and reacquires the wake lock after an idle release', async () => {
  const f = fixture();
  f.policy.setHome(true);
  await f.advance(10_000);
  f.input('touchmove');
  await f.advance(10_000);
  f.input('wheel');
  await f.advance(14_999);
  assert.equal(f.changes.at(-1), true);
  await f.advance(1);
  assert.equal(f.changes.at(-1), false);
  f.input('pointerdown');
  await f.advance(0);
  assert.equal(f.changes.at(-1), true);
  f.policy.setHome(false);
  await f.advance(60_000);
  assert.equal(f.changes.at(-1), true);
  assert.equal(f.timers.size, 0);
});

test('backgrounding and cleanup release the lock and foreground Home gets a new wait', async () => {
  const f = fixture();
  f.policy.setHome(true);
  await f.advance(10_000);
  f.visibility(true);
  f.input('keydown');
  await f.advance(60_000);
  assert.deepEqual(f.changes, [true, false]);
  f.visibility(false);
  await f.advance(14_999);
  assert.equal(f.changes.at(-1), true);
  await f.advance(1);
  assert.equal(f.changes.at(-1), false);
  f.policy.setHome(false);
  await f.advance(0);
  f.input('pagehide');
  await f.advance(0);
  assert.equal(f.changes.at(-1), false);
  f.input('pageshow');
  await f.advance(0);
  assert.equal(f.changes.at(-1), true);
  f.policy.stop();
  f.input('pointerdown');
  await f.advance(60_000);
  assert.equal(f.changes.at(-1), false);
  assert.equal(f.timers.size, 0);
});

const sentinel = () => ({ released: false, async release() { this.released = true; } });

test('a late browser wake-lock grant is released and revoked locks can be reacquired', async () => {
  const pending = Promise.withResolvers();
  const first = sentinel(), second = sentinel(), third = sentinel();
  const locks = [pending.promise, second, third];
  let requests = 0;
  const setAwake = createBrowserScreenAwake({ request(type) {
    assert.equal(type, 'screen');
    return locks[requests++];
  } });
  const acquiring = setAwake(true);
  await setAwake(true);
  await setAwake(false);
  pending.resolve(first);
  await acquiring;
  assert.equal(first.released, true);
  assert.equal(requests, 1);
  await setAwake(true);
  assert.equal(second.released, false);
  second.released = true;
  await setAwake(true);
  assert.equal(requests, 3);
  await setAwake(false);
  assert.equal(third.released, true);
});
