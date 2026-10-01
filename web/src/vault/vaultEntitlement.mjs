// Reading/exporting/removing existing local content never depends on billing.
// Only additions or changes to content require an active subscription.
export function changesVaultContent(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next)) return true;
  const existing = new Map(previous.map(entry => [entry.id, entry]));
  if (new Set(next.map(entry => entry.id)).size !== next.length) return true;
  return next.some(entry => {
    const old = existing.get(entry.id);
    if (!old) return true;
    const keys = new Set([...Object.keys(old), ...Object.keys(entry)]);
    return [...keys].filter(key => !['favorite', 'launchCount'].includes(key))
      .some(key => JSON.stringify(old[key]) !== JSON.stringify(entry[key]));
  });
}
