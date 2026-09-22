export function managedRecoveryState(recovery, now = Date.now()) {
  if (!recovery) return 'unknown';
  if (recovery.status === 'not_configured') return 'not_configured';
  const checkedAt = Date.parse(recovery.checkedAt);
  if (recovery.status === 'stale' || Number.isFinite(checkedAt) && (now - checkedAt > 90_000 || checkedAt - now > 5_000)) return 'stale';
  if (!Number.isFinite(checkedAt)) return 'unknown';
  if (recovery.issues?.some(issue => ['database', 'recovery'].includes(issue.component))) return 'unknown';
  if (recovery.status === 'available' && recovery.primary?.state === 'available' && recovery.primary?.recovery?.status === 'available') return 'available';
  return recovery.status === 'unavailable' ? 'unavailable' : 'unknown';
}

export function feedRecoverySummary(backup, managed) {
  if (managed?.feedReplica?.state === 'suspended') return 'Suspended in Render. The optional feed copy cannot connect until its database is resumed.';
  if (!backup) return 'Feed snapshot status has not been reported.';
  if (!backup.enabled) return 'Optional feed snapshot is not configured.';
  if (!backup.connected) return 'Feed snapshot is disconnected; the primary database recovery is reported separately above.';
  if (backup.lastError) return 'Connected; the latest feed snapshot update failed.';
  return backup.lastSyncAt ? 'Connected; the latest feed snapshot update succeeded.' : 'Connected; waiting for the first feed snapshot update.';
}

export function feedProviderSummary(managed) {
  if (!managed?.feedReplica?.configured) return 'Provider state is not configured for the optional feed database.';
  if (managed.issues?.some(issue => issue.component === 'feedReplica') || managed.feedReplica.state === 'unknown') return 'Feed provider state is unverified; the Render check did not succeed.';
  return `Feed provider state at last check: ${managed.feedReplica.state}.`;
}
