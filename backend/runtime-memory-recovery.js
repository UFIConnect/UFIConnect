'use strict';

const MB = 1024 * 1024;
const snapshotOf = read => {
  const memory = read();
  return Object.fromEntries(['rss', 'heapUsed', 'heapTotal', 'external'].map(key => [
    `${key}MB`, Math.round((Number(memory[key]) || 0) / MB),
  ]));
};

// Cache trimming releases references, but V8 can retain the previous heap high
// water mark. On a small container that can keep an otherwise idle process in
// the RSS guard indefinitely. Collect only after pressure has triggered a trim;
// ordinary request handling never asks for a collection.
function createRuntimeMemoryRecovery({
  collect = typeof globalThis.gc === 'function' ? () => globalThis.gc({ execution: 'async' }) : null,
  readMemory = () => process.memoryUsage(), now = Date.now, cooldownMs = 5 * 60 * 1000,
} = {}) {
  const cooldown = Math.max(30 * 1000, Math.min(30 * 60 * 1000, Number(cooldownMs) || 5 * 60 * 1000));
  const state = { available: typeof collect === 'function', running: false, attempts: 0, completed: 0,
    failures: 0, lastAttemptAt: null, lastCompletedAt: null, lastMode: null, before: null, after: null };
  let pending = null;

  function recover(mode) {
    if (!['pressure', 'critical'].includes(mode)) return Promise.resolve({ recovered: false, reason: 'normal' });
    if (!state.available) return Promise.resolve({ recovered: false, reason: 'unavailable' });
    if (pending) return pending;
    const started = now();
    if (state.lastAttemptAt !== null && started - state.lastAttemptAt < cooldown)
      return Promise.resolve({ recovered: false, reason: 'cooldown' });
    state.running = true; state.attempts++; state.lastAttemptAt = started; state.lastMode = mode;
    pending = Promise.resolve().then(async () => {
      state.before = snapshotOf(readMemory);
      await collect();
      state.after = snapshotOf(readMemory);
      state.completed++; state.lastCompletedAt = now();
      return { recovered: true, before: { ...state.before }, after: { ...state.after } };
    }).catch(() => {
      state.failures++;
      return { recovered: false, reason: 'collection-failed' };
    }).finally(() => { state.running = false; pending = null; });
    return pending;
  }
  return { recover, status: () => ({ ...state, before: state.before && { ...state.before },
    after: state.after && { ...state.after }, cooldownMs: cooldown }) };
}

module.exports = { createRuntimeMemoryRecovery };
