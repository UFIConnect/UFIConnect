import { Link } from 'react-router-dom';
import { SOURCE_META } from './sourceMeta';

export default function FollowingConnectionNotice({ errors = {} }) {
  const sources = Object.keys(errors);
  if (!sources.length) return null;
  return (
    <div role="status" style={{ padding: 12, border: '1px solid currentColor', borderRadius: 10, margin: '12px 0', overflowWrap: 'anywhere', fontSize: '.9rem' }}>
      <strong>Some connected feeds could not sync</strong>
      <p style={{ margin: '6px 0' }}>{sources.map(source => SOURCE_META[source]?.label || source).join(', ')}. Try refreshing. If the problem continues, reconnect these accounts.</p>
      <Link to="/connected-accounts" style={{ color: 'inherit', textDecoration: 'underline' }}>Manage connected accounts</Link>
    </div>
  );
}
