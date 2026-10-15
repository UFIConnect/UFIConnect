const snapshots = new Map();
const MAX_AGE = 120_000;
export const liveSnaps = (items, now = Date.now()) => (items || []).filter(item => new Date(item.expiresAt).getTime() > now);
export function readSnapSnapshot(identity, now = Date.now()) {
  const entry = snapshots.get(identity);
  if (!entry || now - entry.savedAt > MAX_AGE) { snapshots.delete(identity); return null; }
  return { ...entry.snapshot, snaps: liveSnaps(entry.snapshot.snaps, now), loading: false, refreshingSources: [] };
}
export function saveSnapSnapshot(snapshot, now = Date.now()) {
  if (!snapshot.identity || snapshot.loading) return;
  snapshots.delete(snapshot.identity);
  snapshots.set(snapshot.identity, { snapshot: { ...snapshot, snaps: liveSnaps(snapshot.snaps, now) }, savedAt: now });
  while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value);
}
export function clearSnapSnapshots() { snapshots.clear(); }
export function mergeSnapRefresh(existing, incoming, errors, source, now = Date.now()) {
  const failed = name => Boolean(errors[name] || errors.sources)
    && !/disconnect|reconnect|unauthori|forbidden|permission|sign in|401|403/i.test(String(errors[name] || errors.sources));
  const fresh = liveSnaps(incoming, now).filter(item => !source || item.source === source);
  const ids = new Set(fresh.map(item => `${item.source}:${item.id}`));
  const retained = liveSnaps(existing, now).filter(item =>
    (source && item.source !== source || failed(item.source)) && !ids.has(`${item.source}:${item.id}`));
  return [...retained, ...fresh];
}
