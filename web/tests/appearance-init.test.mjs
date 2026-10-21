import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/appearance-init.js', import.meta.url), 'utf8');

function fixture({ at = '2026-10-18T12:00:00Z', offsetMinutes = 0, preference, hidden = false, blockedStorage = false } = {}) {
  const clock = { now: Date.parse(at), offsetMinutes };
  const listeners = () => {
    const handlers = new Map();
    return {
      addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
      removeEventListener(name, fn) { handlers.get(name)?.delete(fn); },
      dispatchEvent(event) { for (const fn of [...(handlers.get(event.type) || [])]) fn(event); return true; },
    };
  };
  const stored = new Map(preference === undefined ? [] : [['ufi:appearance', preference]]);
  const storageWrites = [], timers = new Map(), changes = [];
  let timerId = 0;
  const meta = { content: '' };
  const document = { ...listeners(), hidden, documentElement: { dataset: {} }, querySelector: selector => selector === 'meta[name="theme-color"]' ? meta : null };
  const window = {
    ...listeners(),
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Storage denied'); return stored.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage denied'); storageWrites.push([key, value]); stored.set(key, value); },
    },
    setTimeout(callback, delay) { assert(Number.isFinite(delay) && delay > 0 && delay <= 60_000, 'Automatic appearance must recheck within one minute'); const id = ++timerId; timers.set(id, { callback, due: clock.now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    matchMedia() { assert.fail('Automatic appearance must not depend on device color preference'); },
  };
  const forbidden = () => { assert.fail('Appearance must not request location or network access'); };
  Object.defineProperty(window, 'navigator', { get: forbidden });
  window.fetch = forbidden;
  class LocalDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
    getHours() { return new Date(this.getTime() + clock.offsetMinutes * 60_000).getUTCHours(); }
    getMinutes() { return new Date(this.getTime() + clock.offsetMinutes * 60_000).getUTCMinutes(); }
    getSeconds() { return new Date(this.getTime() + clock.offsetMinutes * 60_000).getUTCSeconds(); }
    getMilliseconds() { return new Date(this.getTime()).getUTCMilliseconds(); }
    getTimezoneOffset() { return -clock.offsetMinutes; }
  }
  const emit = (target, type, detail = {}) => target.dispatchEvent({ type, ...detail });
  window.addEventListener('ufi:appearance', () => changes.push({ ...document.documentElement.dataset }));
  const context = { window, document, Date: LocalDate, Event: class { constructor(type) { this.type = type; } },
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, fetch: forbidden };
  Object.defineProperty(context, 'navigator', { get: forbidden });
  vm.runInNewContext(script, context, { filename: 'appearance-init.js' });
  return {
    window, document, clock, timers, changes, meta, stored, storageWrites,
    mode: () => document.documentElement.dataset.theme,
    emitWindow: (type, detail) => emit(window, type, detail),
    emitDocument: type => emit(document, type),
    setClock(at, offset = clock.offsetMinutes) { clock.now = Date.parse(at); clock.offsetMinutes = offset; },
    runNextTimer() {
      assert(timers.size > 0, 'Expected automatic appearance timer');
      const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      timers.delete(id); clock.now = timer.due; timer.callback();
    },
  };
}

test('Auto changes at local 06:00 and 20:00 without a reload', () => {
  const morning = fixture({ at: '2026-10-18T05:59:59.999Z' });
  assert.equal(morning.mode(), 'dark');
  morning.runNextTimer();
  assert.equal(morning.mode(), 'light');
  assert.equal(morning.document.documentElement.dataset.appearance, 'system');
  assert.equal(morning.window.__ufiAppearance.preference, 'system');
  assert.equal(morning.timers.size, 1);
  const evening = fixture({ at: '2026-10-18T19:59:59.999Z' });
  assert.equal(evening.mode(), 'light');
  evening.runNextTimer();
  assert.equal(evening.mode(), 'dark');
  assert.notEqual(evening.meta.content, morning.meta.content, 'Browser chrome follows the resolved mode');
});

test('manual Light and Dark survive clock changes and switching back to Auto uses current time', () => {
  const f = fixture({ at: '2026-10-18T23:00:00Z', preference: 'light' });
  assert.equal(f.mode(), 'light'); assert.equal(f.timers.size, 0);
  f.window.__ufiAppearance.setPreference('dark');
  f.setClock('2026-10-19T12:00:00Z'); f.emitWindow('focus'); f.emitWindow('pageshow');
  assert.equal(f.mode(), 'dark'); assert.equal(f.timers.size, 0);
  assert.equal(f.stored.get('ufi:appearance'), 'dark');
  f.window.__ufiAppearance.setPreference('system');
  assert.equal(f.mode(), 'light'); assert.equal(f.timers.size, 1);
  f.window.__ufiAppearance.setPreference('light');
  assert.equal(f.mode(), 'light'); assert.equal(f.timers.size, 0);
  f.setClock('2026-10-19T22:00:00Z'); f.emitWindow('focus');
  assert.equal(f.mode(), 'light');
});

test('Auto reads the current local timezone on focus and page restoration', () => {
  const f = fixture({ at: '2026-10-18T12:00:00Z', offsetMinutes: -480 });
  assert.equal(f.mode(), 'dark', '04:00 local');
  f.setClock('2026-10-18T12:00:00Z', 180); f.emitWindow('focus');
  assert.equal(f.mode(), 'light', '15:00 after timezone change');
  f.setClock('2026-10-18T12:00:00Z', 600); f.emitWindow('pageshow');
  assert.equal(f.mode(), 'dark', '22:00 after page restoration in another timezone');
  assert.equal(f.timers.size, 1, 'Repeated foreground events do not accumulate timers');
});

test('a hidden page stops scheduling and resolves the current clock when visible again', () => {
  const f = fixture({ at: '2026-10-18T19:30:00Z' });
  assert.equal(f.mode(), 'light');
  f.document.hidden = true; f.emitDocument('visibilitychange');
  assert.equal(f.timers.size, 0);
  f.setClock('2026-10-19T02:00:00Z');
  f.document.hidden = false; f.emitDocument('visibilitychange');
  assert.equal(f.mode(), 'dark'); assert.equal(f.timers.size, 1);
  const initiallyHidden = fixture({ hidden: true });
  assert.equal(initiallyHidden.timers.size, 0);
});

test('clock jumps are corrected on the next timer and repeated unchanged checks do not emit changes', () => {
  const f = fixture({ at: '2026-10-18T12:00:00Z' });
  const initialChanges = f.changes.length;
  f.runNextTimer(); f.emitWindow('focus'); f.emitWindow('pageshow');
  assert.equal(f.changes.length, initialChanges);
  const timer = [...f.timers.values()][0];
  f.timers.clear(); f.setClock('2026-10-18T23:00:00Z'); timer.callback();
  assert.equal(f.mode(), 'dark'); assert.equal(f.changes.length, initialChanges + 1);
  assert.equal(f.timers.size, 1);
});

test('storage changes synchronize manual choice, reset and invalid values across tabs', () => {
  const f = fixture({ at: '2026-10-18T23:00:00Z', preference: 'dark' });
  f.emitWindow('storage', { key: 'ufi:appearance', newValue: 'light' });
  assert.equal(f.mode(), 'light'); assert.equal(f.window.__ufiAppearance.preference, 'light');
  f.emitWindow('storage', { key: 'unrelated', newValue: 'dark' });
  assert.equal(f.mode(), 'light');
  f.emitWindow('storage', { key: null, newValue: null });
  assert.equal(f.mode(), 'dark'); assert.equal(f.window.__ufiAppearance.preference, 'system');
  f.setClock('2026-10-19T12:00:00Z');
  f.emitWindow('storage', { key: 'ufi:appearance', newValue: 'unsupported-theme' });
  assert.equal(f.mode(), 'light'); assert.equal(f.window.__ufiAppearance.preference, 'system');
  assert.equal(f.storageWrites.length, 0, 'Receiving a storage event does not write back to storage');
});

test('blocked storage and unavailable location do not prevent Auto or a manual choice', () => {
  const f = fixture({ blockedStorage: true, at: '2026-10-18T23:00:00Z' });
  assert.equal(f.mode(), 'dark');
  f.window.__ufiAppearance.setPreference('light');
  assert.equal(f.mode(), 'light'); assert.equal(f.window.__ufiAppearance.preference, 'light');
  f.window.__ufiAppearance.setPreference('system');
  assert.equal(f.mode(), 'dark'); assert.equal(f.timers.size, 1);
});

test('an old stored system preference remains Auto and fractional timezone offsets use local hours', () => {
  const f = fixture({ preference: 'system', at: '2026-10-18T00:29:59.999Z', offsetMinutes: 330 });
  assert.equal(f.mode(), 'dark', '05:59:59 local');
  f.runNextTimer();
  assert.equal(f.mode(), 'light', '06:00 local');
  assert.equal(f.stored.get('ufi:appearance'), 'system');
  assert.equal(f.storageWrites.length, 0, 'Reading an existing preference does not rewrite it');
});
