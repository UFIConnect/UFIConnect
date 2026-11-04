'use strict';

const { sourcePullLimit } = require('./source-pull-limits');

const pullLimitLabel = limit => `${limit.maxPulls} ${limit.maxPulls === 1 ? 'pull' : 'pulls'} / ${limit.windowSeconds}s`;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;

// Configured collection ceilings and observed scheduler cadence are different
// measurements. Missing local scheduler evidence remains unknown on the API.
function sourceRateMetadata(source, policy = {}, collection = null) {
  const pullLimit = sourcePullLimit(source, policy.sourcePullLimits);
  return {
    pullLimit,
    pullLimitLabel: pullLimitLabel(pullLimit),
    collectionIntervalMs: positive(collection?.intervalMs) ? collection.intervalMs : null,
    cycleMinutes: positive(collection?.expectedCycleMs) ? Math.round(collection.expectedCycleMs / 6000) / 10 : null,
  };
}

function sanitizeSourceRateMetadata(input) {
  const limit = input?.pullLimit;
  if (!limit || !Number.isInteger(limit.windowSeconds) || limit.windowSeconds < 1 || limit.windowSeconds > 86400
    || !Number.isInteger(limit.maxPulls) || limit.maxPulls < 1 || limit.maxPulls > 10000
    || limit.minSpacingMs !== Math.ceil(limit.windowSeconds * 1000 / limit.maxPulls)) return {};
  const pullLimit = { windowSeconds: limit.windowSeconds, maxPulls: limit.maxPulls, minSpacingMs: limit.minSpacingMs };
  return { pullLimit, pullLimitLabel: pullLimitLabel(pullLimit),
    collectionIntervalMs: positive(input.collectionIntervalMs) ? input.collectionIntervalMs : null,
    cycleMinutes: positive(input.cycleMinutes) ? input.cycleMinutes : null };
}

module.exports = { sourceRateMetadata, sanitizeSourceRateMetadata, pullLimitLabel };
