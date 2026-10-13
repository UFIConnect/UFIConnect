'use strict';

// Keys contain only the UFI member and provider IDs. Tokens never become queue
// identifiers or status fields. All readers and warmers share these four slots.
function createFollowingRefreshQueue({ concurrency = 4, maxPending = 128 } = {}) {
  const entries = new Map(), pending = [];
  let active = 0;
  function pump() {
    while (active < concurrency && pending.length) {
      const foreground = pending.findIndex(entry => entry.priority);
      const entry = pending.splice(foreground < 0 ? 0 : foreground, 1)[0];
      active++;
      Promise.resolve().then(entry.work).then(entry.resolve, entry.reject).finally(() => {
        entries.delete(entry.key);
        active--;
        pump();
      });
    }
  }
  function run(key, work, { priority = false } = {}) {
    if (entries.has(key)) return entries.get(key).promise;
    if (pending.length >= maxPending) return Promise.reject(Object.assign(new Error('Following refresh is busy. Try again shortly.'), { status: 503 }));
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const entry = { key, work, promise, resolve, reject, priority };
    entries.set(key, entry);
    pending.push(entry);
    pump();
    return promise;
  }
  return { run, status: () => ({ active, pending: pending.length, maxConcurrency: concurrency, maxPending }) };
}

module.exports = { createFollowingRefreshQueue };
