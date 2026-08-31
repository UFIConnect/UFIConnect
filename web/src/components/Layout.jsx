import { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import client from '../api/client';

function ShellIcon({ name, size = 20 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' };
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10.5V20h14v-9.5" /><path d="M9 20v-6h6v6" /></>,
    videos: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m10 9 5 3-5 3V9Z" /></>,
    posts: <><path d="M12 5v14" /><path d="M5 12h14" /><rect x="4" y="4" width="16" height="16" rx="3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
    groups: <><path d="M16 21v-2a4 4 0 0 0-8 0v2" /><circle cx="12" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M2 21v-2a4 4 0 0 1 3-3.87" /></>,
    opportunities: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.03.03a2 2 0 1 1-2.83 2.83l-.03-.03A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.06A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H3a2 2 0 1 1 0-4h.06A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.03-.03a2 2 0 1 1 2.83-2.83l.03.03A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.08V3a2 2 0 1 1 4 0v.06A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03A1.7 1.7 0 0 0 19.4 9c.23.36.6.6 1 .6h.6a2 2 0 1 1 0 4h-.06A1.7 1.7 0 0 0 19.4 15Z" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
    install: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  };
  return <svg {...common}>{paths[name] || paths.home}</svg>;
}

// shortLabel is used only in the mobile bottom-nav — 8 items sharing one
// row at .62rem leaves each column ~40-47px wide, and "Notifications" /
// "Opportunities" (13 characters each) wrap badly at that width. The
// desktop sidebar has room to spare, so it always uses the full label.
const NAV = [
  { to: '/',              icon: 'home',          label: 'Home'         },
  { to: '/videos',        icon: 'videos',        label: 'Videos'       },
  { to: '/profile?tab=posts', icon: 'posts',      label: 'Posts'        },
  { to: '/search',        icon: 'search',        label: 'Search'       },
  { to: '/notifications', icon: 'notifications', label: 'Notifications', shortLabel: 'Alerts' },
  { to: '/groups',        icon: 'groups',        label: 'Groups'       },
  { to: '/opportunities', icon: 'opportunities', label: 'Opportunities', shortLabel: 'Jobs' },
];

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// The Notifications bell had no unread/pending indicator anywhere — a
// member had no way to know a connection request or new follower was
// waiting without remembering to open the page themselves. GET /notifications
// already computed pendingConnections server-side; nothing on the client
// ever read it. Small enough to just be a number in a dot rather than a
// full component elsewhere.
function NavBadge({ count }) {
  if (!count) return null;
  return (
    <span style={{
      position: 'absolute', top: -2, right: -6,
      minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
      background: '#EF4444', color: '#fff', fontSize: '.62rem', fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      lineHeight: 1, boxShadow: '0 0 0 2px var(--card, #fff)',
    }}>
      {count > 9 ? '9+' : count}
    </span>
  );
}

export default function Layout({ children, wide = false }) {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { canInstall, installed, triggerInstall } = useInstallPrompt();
  // Pending connection requests + unread persisted notifications
  // (message/comment/like/follow) combined — one badge for "you have
  // something new to look at in Notifications," not two separate numbers
  // competing for the same small dot.
  const [notifBadge, setNotifBadge] = useState(0);

  // Polled from the shell itself, not the Notifications page — the whole
  // point of a nav badge is being visible from anywhere else in the app,
  // not just after already navigating to the page it's supposed to hint at.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    function load() {
      client.get('/notifications/badge-counts')
        .then(({ data }) => {
          if (cancelled) return;
          setNotifBadge((data.pendingConnections || 0) + (data.unreadNotifications || 0));
        })
        .catch(() => {});
    }
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [profile]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  // Clicking Feed while already on the feed page is a no-op for NavLink
  // (same route, no navigation fires) — this is the only nav item where
  // "go back to where this takes you" and "you're already there, scroll
  // up" are both things a user reasonably expects from one click.
  function handleNavClick(to) {
    if (to === '/' && location.pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return (
    <div className="shell">
      {/* ── Desktop sidebar ── */}
      <aside className="sidebar">
        <Link to="/" className="sidebar-logo" onClick={() => handleNavClick('/')} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="sidebar-logo-icon">UFI</div>
          <span className="sidebar-logo-text">UFIconnect</span>
        </Link>

        <nav className="sidebar-nav">
          {NAV.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => handleNavClick(to)}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon" style={{ position: 'relative' }}>
                <ShellIcon name={icon} size={19} />
                {to === '/notifications' && <NavBadge count={notifBadge} />}
              </span>
              {label}
            </NavLink>
          ))}
        </nav>

        {canInstall && (
          <button
            onClick={triggerInstall}
            style={{
              margin: '0 12px 12px',
              padding: '10px 16px',
              borderRadius: 12,
              border: '1.5px solid #6366F1',
              background: 'linear-gradient(135deg,#6366F1,#818CF8)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '.82rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              boxShadow: '0 2px 8px rgba(99,102,241,.25)',
              transition: 'transform .1s,box-shadow .1s',
            }}
            onMouseOver={e => e.currentTarget.style.transform = 'translateY(-1px)'}
            onMouseOut={e => e.currentTarget.style.transform = ''}
          >
            <ShellIcon name="install" size={16} />
            Get App
          </button>
        )}

        {profile && (
          <div className="sidebar-user">
            <div className="avatar avatar-sm">{initials(profile.name)}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{profile.name}</div>
              <div className="sidebar-user-title">
                {profile.preferences?.role || profile.title || 'Member'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <NavLink to="/settings" title="Settings">
                <button className="sidebar-logout" title="Settings" aria-label="Settings"><ShellIcon name="settings" size={16} /></button>
              </NavLink>
              <button className="sidebar-logout sidebar-logout--danger" onClick={handleLogout} aria-label="Log out" title="Log out"><ShellIcon name="logout" size={16} /></button>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <main className={`main${wide ? ' main-wide' : ''}`}>
        {children}
      </main>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="bottom-nav">
        {NAV.map(({ to, icon, label, shortLabel }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => handleNavClick(to)}
            className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon" style={{ position: 'relative' }}>
              <ShellIcon name={icon} size={19} />
              {to === '/notifications' && <NavBadge count={notifBadge} />}
            </span>
            {shortLabel || label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
