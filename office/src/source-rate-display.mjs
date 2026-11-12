const positiveNumber = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const seconds = milliseconds => `${(milliseconds / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })}s`;

export function sourceRateMetrics(row = {}, { source = false, showShardLimit = false } = {}) {
  const { maxPulls, windowSeconds } = row.pullLimit ?? {};
  const hasLimit = Number.isSafeInteger(maxPulls) && maxPulls > 0
    && Number.isSafeInteger(windowSeconds) && windowSeconds > 0;
  const label = hasLimit ? `${maxPulls} ${maxPulls === 1 ? 'pull' : 'pulls'} / ${windowSeconds}s`
    : typeof row.pullLimitLabel === 'string' ? row.pullLimitLabel.trim() || null : null;
  const interval = positiveNumber(row.collectionIntervalMs) ? seconds(row.collectionIntervalMs) : null;
  const sourceWorker = row.diagnosticCapability === 'source-worker' || /\bshards?\b/i.test(row.interval || '');
  if (!source && !sourceWorker && !row.pullLimit && !label && !interval) {
    return [{ label: 'Schedule', value: row.interval || null, text: true }];
  }
  if (showShardLimit) return [
    { label: 'Pull interval', value: interval, text: true },
    { label: 'Shards', value: hasLimit ? String(maxPulls) : null, text: true },
    { label: 'Limit window', value: hasLimit ? `${windowSeconds}s` : null, text: true },
  ];
  return [
    { label: 'Pull limit', value: label, text: true },
    { label: 'Collection interval', value: interval, text: true },
  ];
}

export function sourceRateSummary(row, options) {
  return sourceRateMetrics(row, options).map(({ label, value }) => `${label}: ${value || 'Not reported'}`).join(' · ');
}
