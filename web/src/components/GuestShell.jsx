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
    <div className="guest-shell">
      <header className="guest-header">
        <Link to="/" className="guest-brand">
          {/* Same branded mark as the authenticated sidebar's logo (see
              Layout.jsx's sidebar-logo-icon) instead of a generic globe
              emoji placeholder, so a guest sees the same identity a member
              does. */}
          <span className="guest-brand-mark">UFI</span>
          <span className="guest-brand-name">UFIconnect</span>
        </Link>
        <div className="guest-actions">
          <Link to="/login" className="btn btn-ghost btn-sm guest-action">Sign in</Link>
          <Link to="/register" className="btn btn-primary btn-sm guest-action">
            <span className="guest-join-full">Join UFIconnect</span>
            <span className="guest-join-short">Join free</span>
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
