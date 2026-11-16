import { Link } from 'react-router-dom';
import { SOURCE_META } from './sourceMeta';

export default function FollowingConnectionNotice({ errors = {} }) {
  const sources = Object.keys(errors);
  if (!sources.length) return null;
  const names = sources.filter(source => source !== 'sources').map(source => SOURCE_META[source]?.label || source);
  const canReconnect = sources.some(source => source !== 'sources' && source !== 'uficonnect');
  return (
    <div role="status" style={{ padding: 12, border: '1px solid currentColor', borderRadius: 10, margin: '12px 0', overflowWrap: 'anywhere', fontSize: '.9rem' }}>
      <strong>Some connected feeds could not sync</strong>
      <p style={{ margin: '6px 0' }}>
        {names.length > 0 && `${names.join(', ')}. `}Try refreshing.
        {canReconnect && ' If the problem continues, reconnect these accounts.'}
      </p>
      {canReconnect && <Link to="/connected-accounts" style={{ color: 'inherit', textDecoration: 'underline' }}>Manage connected accounts</Link>}
    </div>
  );
}
