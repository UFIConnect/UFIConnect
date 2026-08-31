import client from './client';

// Genuine engagement ("seen"), distinct from the view/impression tracking
// the backend already does automatically for every post a feed/video
// response returns (see markPostsSeen server-side) — that fires the moment
// content is *delivered*, with no signal about whether it was actually
// looked at. This is the "did they actually watch/read it" signal: call
// reportEngaged() once a caller has independently decided a real
// engagement threshold was crossed (see VideoFeedView.jsx — watched past
// ~3s/50% — and PostList.jsx — visible on screen ~2s+).
//
// Batches ids client-side and flushes on a short timer/size cap instead of
// firing one request per post — a fast scroll session engaging a dozen
// posts in a few seconds would otherwise be a dozen separate requests for
// a signal that isn't on any critical path and doesn't need to land
// instantly.
const FLUSH_INTERVAL_MS = 500;
const MAX_BATCH = 50;

const reported = new Set(); // post ids already sent this session - never re-queued even if re-viewed
const queues = new Map(); // context -> Set<postId>
const inFlight = new Set();
let flushTimer = null;
let flushing = false;

async function flush() {
  flushTimer = null;
  if (flushing) return;
  flushing = true;
  let hasMore = false;
  try {
    for (const [context, queue] of queues.entries()) {
      if (!queue.size) continue;
      const postIds = [...queue].slice(0, MAX_BATCH);
      postIds.forEach(id => { queue.delete(id); inFlight.add(id); });
      try {
        await client.post('/posts/engaged', { postIds, context });
        postIds.forEach(id => reported.add(id));
      } catch {
        // Keep the item queued so a transient connection failure cannot make
        // a consumed card eligible to come back in this browser session.
        postIds.forEach(id => { if (!reported.has(id)) queue.add(id); });
      }
      postIds.forEach(id => inFlight.delete(id));
      if (queue.size) hasMore = true;
    }
  } finally {
    flushing = false;
  }
  if (hasMore || [...queues.values()].some(queue => queue.size)) scheduleFlush();
}

function scheduleFlush(delay = FLUSH_INTERVAL_MS) {
  if (flushTimer) {
    if (delay > 0) return;
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => { void flush(); }, delay);
}

function isQueued(postId) {
  if (inFlight.has(postId)) return true;
  for (const queue of queues.values()) {
    if (queue.has(postId)) return true;
  }
  return false;
}

export function reportEngaged(postId, context = 'feed') {
  if (!postId || reported.has(postId) || isQueued(postId)) return;
  const key = context === 'videos' ? 'videos' : 'feed';
  let queue = queues.get(key);
  if (!queue) {
    queue = new Set();
    queues.set(key, queue);
  }
  if (queue.has(postId)) return;
  queue.add(postId);
  scheduleFlush();
}

// A card becomes consumed when it has actually moved above the viewport.
// Send that batch immediately rather than waiting for a dwell timer, so the
// next feed request cannot race it and return the same card again.
export function reportConsumed(postId, context = 'feed') {
  if (!postId || reported.has(postId) || isQueued(postId)) return;
  const key = context === 'videos' ? 'videos' : 'feed';
  let queue = queues.get(key);
  if (!queue) {
    queue = new Set();
    queues.set(key, queue);
  }
  queue.add(postId);
  scheduleFlush(0);
}

// Best-effort immediate flush — e.g. before the tab backgrounds/closes, so
// the last few seconds of engagement aren't silently dropped waiting on
// the timer.
export function flushEngaged() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  void flush();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEngaged();
  });
}

// The magnitude behind reportEngaged's yes/no signal — how long a video was
// actually watched, how long a post's comments were actually left open, or
// whether an external source link was clicked. Feeds the feed's own ranking
// (see personalizeOrder/recordEngagementSignal server-side), not anything
// this tab needs a response for, so this is genuinely fire-and-forget: no
// batching, no retry, a dropped ping just doesn't nudge that one signal.
export function reportEngagementSignal({ postId, source, topic, watchMs, commentsViewMs, linkClick }) {
  if (!postId || (!watchMs && !commentsViewMs && !linkClick)) return;
  client.post('/posts/engagement-signal', { source, topic, watchMs, commentsViewMs, linkClick }).catch(() => {});
}
