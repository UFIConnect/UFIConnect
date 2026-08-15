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
const FLUSH_INTERVAL_MS = 3000;
const MAX_BATCH = 50;

const reported = new Set(); // ids already sent this session — never re-queued even if re-viewed
const queue = new Set();
let flushTimer = null;

function flush() {
  flushTimer = null;
  if (!queue.size) return;
  const postIds = [...queue].slice(0, MAX_BATCH);
  postIds.forEach(id => { queue.delete(id); reported.add(id); });
  client.post('/posts/engaged', { postIds }).catch(() => {});
  if (queue.size) scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

export function reportEngaged(postId) {
  if (!postId || reported.has(postId) || queue.has(postId)) return;
  queue.add(postId);
  scheduleFlush();
}

// Best-effort immediate flush — e.g. before the tab backgrounds/closes, so
// the last few seconds of engagement aren't silently dropped waiting on
// the timer.
export function flushEngaged() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flush();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEngaged();
  });
}
