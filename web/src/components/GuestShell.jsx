import { Link } from 'react-router-dom';

// Minimal top bar for a visitor with no session — the full app Layout
// (sidebar, nav, profile menu) assumes an authenticated member everywhere
// else in this app and has never been exercised without one. Used by
// PostDetail (a shared post link clicked by someone with no account) and
// GuestFeed (browsing before signing up) — anywhere a logged-out visitor
// needs to land on something real instead of either crashing or being
// redirected straight to login.
export default function GuestShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F8FAFC)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--card)',
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'var(--text)', fontWeight: 800, fontSize: '1.05rem' }}>
          🌐 UFIconnect
        </Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/login"><button className="btn btn-ghost btn-sm" type="button">Sign in</button></Link>
          <Link to="/register"><button className="btn btn-primary btn-sm" type="button">Join UFIconnect</button></Link>
        </div>
      </div>
      {children}
    </div>
  );
}
