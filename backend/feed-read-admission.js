// Bound expensive feed reads per API process. This is an overload guard,
// not a request-rate limit or a cache of personalized responses.
function createFeedReadAdmission({ maxActive = 16, maxQueued = 64, queueTimeoutMs = 2000 } = {}) {
  let active = 0;
  const queue = [];
  const counters = { admitted: 0, rejected: 0, disconnected: 0, peakActive: 0, peakQueued: 0 };

  function reject(res) {
    counters.rejected++;
    if (!res.destroyed && !res.writableEnded) {
      res.set('Retry-After', '2');
      res.status(503).json({ code: 'FEED_BUSY', error: 'The feed is busy. Please try again shortly.', retryAfterSeconds: 2, hasMore: true });
    }
  }

  function permit() {
    active++;
    counters.admitted++;
    counters.peakActive = Math.max(counters.peakActive, active);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      drain();
    };
  }

  function drain() {
    while (active < maxActive && queue.length) {
      const entry = queue.shift();
      entry.cleanup();
      if (entry.res.destroyed || entry.res.writableEnded) {
        counters.disconnected++;
        entry.resolve(null);
      } else entry.resolve(permit());
    }
  }

  function acquire(res) {
    if (res.destroyed || res.writableEnded) return Promise.resolve(null);
    if (active < maxActive) return Promise.resolve(permit());
    if (queue.length >= maxQueued) {
      reject(res);
      return Promise.resolve(null);
    }
    return new Promise(resolve => {
      const entry = { res, resolve, cleanup: null };
      const remove = () => {
        const index = queue.indexOf(entry);
        if (index < 0) return false;
        queue.splice(index, 1);
        entry.cleanup();
        return true;
      };
      const closed = () => {
        if (!remove()) return;
        counters.disconnected++;
        resolve(null);
      };
      const timer = setTimeout(() => {
        if (!remove()) return;
        reject(res);
        resolve(null);
      }, queueTimeoutMs);
      timer.unref?.();
      entry.cleanup = () => { clearTimeout(timer); res.removeListener('close', closed); };
      res.once('close', closed);
      queue.push(entry);
      counters.peakQueued = Math.max(counters.peakQueued, queue.length);
    });
  }

  return {
    wrap: handler => async (req, res, next) => {
      const release = await acquire(res);
      if (!release) return;
      // A disconnected active request keeps its permit until its work ends;
      // releasing on socket close would allow abandoned SQL to bypass the cap.
      try { return await handler(req, res, next); }
      finally { release(); }
    },
    snapshot: () => ({ active, queued: queue.length, maxActive, maxQueued, queueTimeoutMs, ...counters }),
  };
}

module.exports = { createFeedReadAdmission };
