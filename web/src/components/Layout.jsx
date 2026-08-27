import { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import client from '../api/client';

// shortLabel is used only in the mobile bottom-nav — 8 items sharing one
// row at .62rem leaves each column ~40-47px wide, and "Notifications" /
// "Opportunities" (13 characters each) wrap badly at that width. The
// desktop sidebar has room to spare, so it always uses the full label.
const NAV = [
  { to: '/',              icon: '📰', label: 'Feed'         },
  { to: '/videos',        icon: '▶️', label: 'Videos'       },
  { to: '/post',          icon: '✏️', label: 'Posts'        },
  { to: '/search',        icon: '🔍', label: 'Search'       },
  { to: '/notifications', icon: '🔔', label: 'Notifications', shortLabel: 'Alerts' },
  { to: '/groups',        icon: '🌐', label: 'Groups'       },
  { to: '/opportunities', icon: '💼', label: 'Opportunities', shortLabel: 'Jobs' },
  { to: '/profile',       icon: '👤', label: 'Profile'      },
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

export default function Layout({ children }) {
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
                {icon}
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
            <span style={{ fontSize: '1rem' }}>⬇</span>
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
                <button className="sidebar-logout" title="Settings" style={{ fontSize: '1rem' }}>⚙️</button>
              </NavLink>
              <button className="sidebar-logout sidebar-logout--danger" onClick={handleLogout} aria-label="Log out" title="Log out">⎋</button>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <main className="main">
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
              {icon}
              {to === '/notifications' && <NavBadge count={notifBadge} />}
            </span>
            {shortLabel || label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
