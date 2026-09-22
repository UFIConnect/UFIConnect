import { managedRecoveryState, feedRecoverySummary, feedProviderSummary } from './recovery-status.mjs';

const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'not reported';
const paragraph = { fontSize: 12, margin: '0 0 8px', overflowWrap: 'anywhere' };

export default function RecoveryOverview({ server }) {
  const recovery = server?.managedRecovery;
  const backup = server?.dbBackupStatus;
  const state = managedRecoveryState(recovery);
  const available = state === 'available';
  const feedReady = backup?.connected && backup?.lastSyncAt && !backup?.lastError
    && (!recovery?.feedReplica?.configured || recovery.feedReplica.state === 'available')
    && !recovery?.issues?.some(issue => issue.component === 'feedReplica');
  return <section aria-labelledby="office-recovery-title" data-testid="office-recovery" style={{ padding: '16px 18px', marginBottom: 24, borderRadius: 12, border: '1px solid #1e293b', background: '#0d1524' }}>
    <h2 id="office-recovery-title" style={{ fontSize: 14, margin: '0 0 12px', color: '#e2e8f0' }}>Data recovery</h2>
    <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Primary database recovery</h3>
    <p data-recovery-state={state} style={{ ...paragraph, color: available ? '#4ade80' : '#fbbf24' }}>
      {available ? 'Available: Render reports point-in-time recovery for the primary database.'
        : state === 'not_configured' ? 'Provider verification is not configured. Set RENDER_API_KEY and RENDER_DATABASE_ID on the API service.'
          : state === 'stale' ? 'Provider evidence is stale. Waiting for a fresh recovery check.'
            : state === 'unavailable' ? 'Render does not currently report an available primary recovery window.'
              : 'Provider recovery status is unknown. Waiting for a successful Render check.'}
    </p>
    <p style={{ ...paragraph, color: '#94a3b8' }}>Recovery window begins: {date(recovery?.primary?.recovery?.startsAt)}.<br />
      Latest export: {recovery?.primary?.latestExport ? `${date(recovery.primary.latestExport.createdAt)} (${recovery.primary.latestExport.available ? 'available at last check' : 'download not ready'})` : recovery?.primary?.exportsChecked ? 'none reported' : 'unverified'}.<br />
      Provider checked: {date(recovery?.checkedAt)}{recovery?.refreshing ? ' · refreshing' : ''}.
    </p>
    <p style={{ ...paragraph, color: '#94a3b8' }}>Covers the primary PostgreSQL database, including accounts, messages, and settings. Restore drills and files stored with other providers need separate verification.</p>
    <a href="https://dashboard.render.com/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#93c5fd' }}>Open Render to review recovery</a>
    <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>Optional recent-feed snapshot</h3>
    <p data-feed-recovery-state={feedReady ? 'ready' : 'attention'} style={{ ...paragraph, color: feedReady ? '#4ade80' : '#fbbf24' }}>{feedRecoverySummary(backup, recovery)}</p>
    <p style={{ ...paragraph, color: '#94a3b8' }}>{feedProviderSummary(recovery)}</p>
    <p style={{ ...paragraph, color: '#94a3b8' }}>Last successful feed sync: {date(backup?.lastSyncAt)}.
      {backup?.rowCount != null ? ` ${Number(backup.rowCount).toLocaleString()} feed posts copied.` : ''}
      {backup?.lastAttemptAt ? ` Last attempt: ${date(backup.lastAttemptAt)}.` : ''}
    </p>
    <p style={{ fontSize: 11, margin: 0, color: '#94a3b8' }}>This bounded feed copy excludes accounts, messages, and settings. Its connection status does not describe the primary recovery window. No restore or database resume is performed by this panel.</p>
  </section>;
}
