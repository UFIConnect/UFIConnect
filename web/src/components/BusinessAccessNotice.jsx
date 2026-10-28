import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isBusinessAccount } from '../businessAccount.mjs';

export default function BusinessAccessNotice({ title = 'Business recruiting workspace' }) {
  const { profile } = useAuth();
  const enrolled = isBusinessAccount(profile);
  return <section className="card" style={{ padding: 24, display: 'grid', gap: 12 }}>
    <h1 style={{ margin: 0 }}>{title}</h1>
    <p style={{ margin: 0 }}>{enrolled
      ? 'Your Business account is ready. Complete or restore its membership to use the recruiting workspace.'
      : 'Business accounts are created through the public Business registration before signing in. Your personal account cannot be converted into a Business account.'}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {enrolled && <Link className="btn btn-primary" to="/business/enrollment">Continue Business membership</Link>}
      <Link className="btn btn-outline" to="/opportunities">Browse jobs</Link>
      <Link className="btn btn-ghost" to="/settings">Account settings</Link>
    </div>
  </section>;
}
