export function canonicalCollectionSource(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return id === 'hn' ? 'hackernews' : id;
}

// Catalog rows describe configuration; sample rows describe available content.
// Merge them without counting a worker alias as a second source.
export function collectionSourceRows(data) {
  const rows = new Map();
  for (const row of [...(data?.sourceCatalog || []), ...(data?.sources || [])]) {
    const id = canonicalCollectionSource(row?.id);
    if (!id) continue;
    const previous = rows.get(id) || {};
    rows.set(id, { ...previous, ...row, id, workerId: row.workerId || previous.workerId || row.id });
  }
  return [...rows.values()];
}

export function collectionDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const seconds = milliseconds / 1000;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.round(seconds * 1000) / 1000}s`;
}

export function collectionTiming(row) {
  const limit = row?.pullLimit;
  const valid = Number.isInteger(limit?.maxPulls) && limit.maxPulls > 0
    && Number.isInteger(limit?.windowSeconds) && limit.windowSeconds > 0;
  const pullLimit = valid ? row.pullLimitLabel
    || `${limit.maxPulls} ${limit.maxPulls === 1 ? 'pull' : 'pulls'} / ${limit.windowSeconds}s` : null;
  return {
    pullLimit,
    minimumSpacing: valid ? collectionDuration(limit.minSpacingMs) : null,
    scheduledInterval: collectionDuration(row?.collectionIntervalMs),
  };
}

export function collectionStatus(row) {
  const state = row?.collection;
  if (state?.enabled === false) return { label: 'Collection disabled', tone: 'muted' };
  const reason = state?.pauseReason || state?.collectionReason;
  if (reason) return {
    label: ({ source_blocked: 'Source blocked', policy_unavailable: 'Policy unavailable',
      source_pull_limit: 'Waiting for next pull', source_flood: 'Waiting for intake capacity',
      intake_backlog: 'Waiting for queued posts', approval_cooldown: 'Collection cooldown',
      backoff: 'Provider cooldown', protected: 'Collection paused', source_in_flight: 'Collecting' })[reason] || 'Collection paused',
    tone: reason === 'source_in_flight' ? 'active' : 'waiting',
  };
  if (state?.inFlight) return { label: 'Collecting', tone: 'active' };
  if (state?.overdue) return { label: 'Collection overdue', tone: 'waiting' };
  if (state?.enabled === true) return { label: 'Scheduled', tone: 'available' };
  return Number(row?.postCount) > 0
    ? { label: 'Posts available', tone: 'available' }
    : { label: 'No posts yet', tone: 'muted' };
}
