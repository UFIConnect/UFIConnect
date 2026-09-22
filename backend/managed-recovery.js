const PROVIDER_ORIGIN = 'https://api.render.com/v1';
const DATABASE_STATES = new Set(['available', 'suspended', 'creating', 'updating', 'unavailable', 'recovery_in_progress']);
const DATABASE_ID = /^dpg-[a-z0-9-]{8,80}$/;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

// Read-only provider evidence. Never return provider objects, connection URLs,
// export download links, credential values, or raw provider errors to Office.
function createManagedRecovery({ env = {}, fetcher = globalThis.fetch, now = Date.now, ttlMs = 60000, timeoutMs = 5000 } = {}) {
  const key = String(env.RENDER_API_KEY || '').trim();
  const databaseId = String(env.RENDER_DATABASE_ID || '').trim();
  const backupId = String(env.RENDER_BACKUP_DATABASE_ID || '').trim();
  const configured = Boolean(key && DATABASE_ID.test(databaseId));
  let cached = null;
  let lastAttempt = null;
  let inFlight = null;
  const initial = () => ({ configured, status: configured ? 'unknown' : 'not_configured', checkedAt: null,
    primary: null, feedReplica: { configured: Boolean(backupId), state: 'unknown' }, issues: [], refreshing: false });
  const fresh = () => lastAttempt !== null && now() - lastAttempt < ttlMs;
  function snapshot() {
    const result = cached || initial();
    return { ...result, status: cached && !fresh() ? 'stale' : result.status, refreshing: Boolean(inFlight) };
  }
  async function request(path) {
    try {
      const response = await fetcher(`${PROVIDER_ORIGIN}${path}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
      });
      if (!response.ok) return { error: [401, 403].includes(response.status) ? 'access_denied' : 'provider_unavailable' };
      return { value: await response.json() };
    } catch {
      return { error: 'provider_unavailable' };
    }
  }
  async function refresh() {
    if (!configured) return snapshot();
    if (inFlight) return inFlight;
    if (fresh()) return snapshot();
    inFlight = (async () => {
      const [database, recovery, exports, replica] = await Promise.all([
        request(`/postgres/${databaseId}`), request(`/postgres/${databaseId}/recovery`), request(`/postgres/${databaseId}/export`),
        backupId ? DATABASE_ID.test(backupId) ? request(`/postgres/${backupId}`) : { error: 'invalid_configuration' } : { value: null },
      ]);
      const issues = [];
      const issue = (component, result) => { if (result.error) issues.push({ component, code: result.error }); };
      for (const [component, result] of Object.entries({ database, recovery, exports, feedReplica: replica })) issue(component, result);
      const databaseState = value => DATABASE_STATES.has(value?.status) ? value.status : 'unknown';
      const primaryState = databaseState(database.value);
      if (!database.error && primaryState === 'unknown') issues.push({ component: 'database', code: 'invalid_response' });
      const recoveryValue = recovery.value;
      const startsAt = timestamp(recoveryValue?.startsAt);
      const recoveryStatus = recoveryValue?.recoveryStatus === 'AVAILABLE' && startsAt ? 'available'
        : ['UNAVAILABLE', 'BACKUP_NOT_READY', 'UNSUPPORTED_PLAN', 'NOT_AVAILABLE'].includes(recoveryValue?.recoveryStatus) ? 'unavailable' : 'unknown';
      if (!recovery.error && recoveryStatus === 'unknown') issues.push({ component: 'recovery', code: 'invalid_response' });
      if (!exports.error && !Array.isArray(exports.value)) issues.push({ component: 'exports', code: 'invalid_response' });
      const exportEvidence = (Array.isArray(exports.value) ? exports.value : []).flatMap(item => {
        const createdAt = timestamp(item?.createdAt);
        if (!createdAt) return [];
        return [{ createdAt, available: typeof item.url === 'string' && /^https:\/\//i.test(item.url) }];
      }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const replicaState = databaseState(replica.value);
      if (backupId && !replica.error && replicaState === 'unknown') issues.push({ component: 'feedReplica', code: 'invalid_response' });
      lastAttempt = now();
      cached = {
        configured, status: issues.some(issue => ['database', 'recovery'].includes(issue.component)) ? 'unknown'
          : primaryState === 'available' && recoveryStatus === 'available' ? 'available' : 'unavailable',
        checkedAt: new Date(lastAttempt).toISOString(),
        primary: { state: primaryState, recovery: { status: recoveryStatus, startsAt },
          exportsChecked: !exports.error && Array.isArray(exports.value), latestExport: exportEvidence[0] || null },
        feedReplica: { configured: Boolean(backupId), state: replicaState }, issues,
      };
      return snapshot();
    })();
    try { await inFlight; } finally { inFlight = null; }
    return snapshot();
  }
  return {
    // Office's frequently polled status remains synchronous while a single
    // background read refreshes provider evidence, independent of feed work.
    peek() { void refresh(); return snapshot(); },
    read: refresh,
  };
}

module.exports = { createManagedRecovery };
