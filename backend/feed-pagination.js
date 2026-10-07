const DEFAULT_MAX_PER_LANE = 2;

function defaultPostKey(post) {
  if (post?.id) return String(post.id);
  return [post?.source, post?.sourceUrl, post?.title, post?.createdAt]
    .map(value => String(value || ''))
    .join('|');
}

function uniquePosts(posts, keyForPost) {
  const seen = new Set();
  return (Array.isArray(posts) ? posts : []).filter((post) => {
    if (!post) return false;
    const key = keyForPost(post);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Cursor pagination for feeds assembled from live/in-memory pools. Each
// lane advances independently, so a two-per-source page never discards the
// rest of that source. Page numbers remain supported for older clients by
// walking the exact same cursor state forward internally.
function paginateEqualizedPool(posts, {
  mode,
  scope = null,
  cursorMap = {},
  page = 1,
  limit = 20,
  seenIds = null,
  laneForPost = post => post?.source || 'unknown',
  keyForPost = defaultPostKey,
  maxPerLane = DEFAULT_MAX_PER_LANE,
  encodeCursor = value => value,
} = {}) {
  const list = uniquePosts(posts, keyForPost);
  const lanes = new Map();
  for (const post of list) {
    const lane = String(laneForPost(post) || 'unknown');
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(post);
  }

  const hasCursor = cursorMap?.__poolMode === mode
    && (scope === null || cursorMap?.__poolScope === scope)
    && cursorMap?.__laneCursors
    && typeof cursorMap.__laneCursors === 'object';
  let state = hasCursor
    ? {
      __poolMode: mode, ...(scope === null ? {} : { __poolScope: scope }),
      __poolPage: Math.max(0, Number(cursorMap.__poolPage) || 0),
      __laneCursors: { ...cursorMap.__laneCursors },
    }
    : { __poolMode: mode, ...(scope === null ? {} : { __poolScope: scope }), __poolPage: 0, __laneCursors: {} };
  const changedScope = scope !== null && cursorMap?.__poolMode === mode && cursorMap.__poolScope !== scope;
  const iterations = hasCursor || changedScope ? 1 : Math.max(1, Math.min(Number(page) || 1, 1000));
  const laneCap = Number.isFinite(maxPerLane) ? Math.max(1, Math.floor(maxPerLane)) : Infinity;
  let pageRows = [];
  let hasMore = false;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const starts = new Map();
    for (const [lane, queue] of lanes) {
      const lastKey = String(state.__laneCursors[lane] || '');
      const found = lastKey ? queue.findIndex(post => keyForPost(post) === lastKey) : -1;
      starts.set(lane, found >= 0 ? found + 1 : 0);
    }

    const visitedByLane = new Map();
    const selectedByLane = new Map();
    const selectedKeys = new Set();
    pageRows = [];
    for (const post of list) {
      const lane = String(laneForPost(post) || 'unknown');
      const visited = visitedByLane.get(lane) || 0;
      visitedByLane.set(lane, visited + 1);
      if (visited < (starts.get(lane) || 0)) continue;
      const key = keyForPost(post);
      if (post?.id && seenIds?.has(post.id)) continue;
      const laneCount = selectedByLane.get(lane) || 0;
      if (pageRows.length >= limit || laneCount >= laneCap) continue;
      selectedByLane.set(lane, laneCount + 1);
      selectedKeys.add(key);
      pageRows.push(post);
    }

    const nextLaneCursors = { ...state.__laneCursors };
    hasMore = false;
    for (const [lane, queue] of lanes) {
      let index = starts.get(lane) || 0;
      let lastHandled = null;
      while (index < queue.length) {
        const candidate = queue[index];
        const handled = selectedKeys.has(keyForPost(candidate))
          || (candidate?.id && seenIds?.has(candidate.id));
        if (!handled) break;
        lastHandled = candidate;
        index += 1;
      }
      if (lastHandled) nextLaneCursors[lane] = keyForPost(lastHandled);
      if (queue.slice(index).some(post => !post?.id || !seenIds?.has(post.id))) hasMore = true;
    }
    state = {
      __poolMode: mode, ...(scope === null ? {} : { __poolScope: scope }),
      __poolPage: state.__poolPage + 1,
      __laneCursors: nextLaneCursors,
    };
    if (!hasMore && iteration + 1 < iterations) pageRows = [];
  }

  return {
    posts: pageRows,
    cursorMap: state,
    nextCursor: encodeCursor(state),
    hasMore,
    totalAvailable: list.filter(post => !post?.id || !seenIds?.has(post.id)).length,
  };
}

module.exports = { paginateEqualizedPool };
