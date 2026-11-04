const positiveNumber = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const seconds = milliseconds => `${(milliseconds / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })}s`;

// Read the current policy label from telemetry. Never turn a legacy shard count
// into a rate or use the policy ceiling as a measured collection interval.
export function sourceRateMetrics(row = {}, { source = false } = {}) {
  const limit = row.pullLimit;
  const label = typeof row.pullLimitLabel === 'string' && row.pullLimitLabel.trim()
    ? row.pullLimitLabel.trim()
    : positiveNumber(limit?.windowSeconds) && positiveNumber(limit?.maxPulls)
      ? `${limit.maxPulls} ${limit.maxPulls === 1 ? 'pull' : 'pulls'} / ${limit.windowSeconds}s` : null;
  if (!source && !limit && !label) return [{ label: 'Schedule', value: row.interval || null, text: true }];
  return [
    { label: 'Pull limit', value: label, text: true },
    { label: 'Collection interval', value: positiveNumber(row.collectionIntervalMs) ? seconds(row.collectionIntervalMs) : null, text: true },
  ];
}

export function sourceRateSummary(row, options) {
  return sourceRateMetrics(row, options).map(({ label, value }) => `${label}: ${value || 'Not reported'}`).join(' · ');
}
