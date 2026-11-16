import { Link } from 'react-router-dom';
import { SOURCE_META } from './sourceMeta';

function syncFailureReason(message) {
  // Provider errors can contain request URLs or other diagnostic data.
  const detail = typeof message === 'string' ? message : '';
  if (/quota|rate[ -]?limit|\b429\b/i.test(detail)) return 'The provider request limit was reached.';
  if (/reconnect|revoked|expired|invalid[ _-]token|unauthori[sz]ed|\b401\b/i.test(detail)) return 'Reconnect this account to resume syncing.';
  if (/permission|scope|forbidden|\b403\b/i.test(detail)) return 'The provider denied access to this feed.';
  if (/timed out|timeout/i.test(detail)) return 'The provider took too long to respond.';
  return 'The provider is temporarily unavailable.';
}

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
