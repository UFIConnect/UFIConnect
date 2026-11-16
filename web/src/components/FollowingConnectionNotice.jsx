import { Link } from 'react-router-dom';
import { SOURCE_META } from './sourceMeta';
import { syncFailureReason } from './sourceSyncFailureReason.mjs';

function syncSourceLabel(source) {
  return source === 'snaps' ? 'Snaps' : SOURCE_META[source]?.label || source;
}

export default function FollowingConnectionNotice({ errors = {}, onRetry }) {
  const failures = Object.entries(errors);
  if (!failures.length) return null;
  return (
    <div role="status" style={{ padding: 12, border: '1px solid currentColor', borderRadius: 10, margin: '12px 0', overflowWrap: 'anywhere', fontSize: '.9rem' }}>
      <strong>Some connected feeds could not sync</strong>
      <p style={{ margin: '6px 0' }}>{failures.map(([source]) => syncSourceLabel(source)).join(', ')}</p>
      <details>
        <summary>Sync details</summary>
        <ul style={{ paddingInlineStart: 20, margin: '4px 0' }}>
          {failures.map(([source, message]) => <li key={source}>
            <strong>{syncSourceLabel(source)}</strong> · {source === 'snaps' ? 'Snaps are temporarily unavailable.' : syncFailureReason(message)}
          </li>)}
        </ul>
      </details>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
        {failures.some(([source]) => source !== 'snaps' && source !== 'uficonnect') && (
          <Link to="/connected-accounts" style={{ color: 'inherit', textDecoration: 'underline' }}>Manage connected accounts</Link>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Retry sync</button>
      </div>
    </div>
  );
}
