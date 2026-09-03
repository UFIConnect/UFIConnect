import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import client from '../api/client';
import HomeFeedTools from './HomeFeedTools';
import { HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS } from './sourceMeta';

function ShellIcon({ name, size = 20 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' };
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10.5V20h14v-9.5" /><path d="M9 20v-6h6v6" /></>,
    videos: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m10 9 5 3-5 3V9Z" /></>,
    posts: <><path d="M12 5v14" /><path d="M5 12h14" /><rect x="4" y="4" width="16" height="16" rx="3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
    groups: <><path d="M16 21v-2a4 4 0 0 0-8 0v2" /><circle cx="12" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M2 21v-2a4 4 0 0 1 3-3.87" /></>,
    messages: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />,
    opportunities: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.03.03a2 2 0 1 1-2.83 2.83l-.03-.03A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.06A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H3a2 2 0 1 1 0-4h.06A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.03-.03a2 2 0 1 1 2.83-2.83l.03.03A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.08V3a2 2 0 1 1 4 0v.06A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03A1.7 1.7 0 0 0 19.4 9c.23.36.6.6 1 .6h.6a2 2 0 1 1 0 4h-.06A1.7 1.7 0 0 0 19.4 15Z" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
    install: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    command: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 17h6" /><path d="M17 14v6" /></>,
    following: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="m17 10 2 2 3-3" /></>,
    countries: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></>,
    restaurants: <><path d="M7 3v8" /><path d="M4 3v5a3 3 0 0 0 6 0V3" /><path d="M7 11v10" /><path d="M17 3v18" /><path d="M17 3c3 1.5 3 7.5 0 9" /></>,
    sources: <><path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" /><path d="m3 12 9 4.5 9-4.5" /><path d="m3 16.5 9 4.5 9-4.5" /></>,
    skills: <><path d="M12 3 14.5 8l5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9L9.5 8 12 3Z" /></>,
    files: <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h6" /></>,
  };
  return <svg {...common}>{paths[name] || paths.home}</svg>;
}

// shortLabel is used only in the mobile bottom-nav so longer destination
// names stay readable. The desktop sidebar always uses the full label.
const HOME_FEED_PATH = '/?feed=feed&all=1';
const MOBILE_FEED_OPTIONS = new Set(['ufi', 'feed', 'following', 'groups', 'countries', 'restaurants']);

const NAV = [
  { to: HOME_FEED_PATH,  icon: 'home',           label: 'Home'         },
  { to: '/videos',        icon: 'videos',        label: 'Videos'       },
  { to: '/search',        icon: 'search',        label: 'Search'       },
  { to: '/notifications', icon: 'notifications', label: 'Notifications', shortLabel: 'Alerts' },
  { to: '/opportunities', icon: 'opportunities', label: 'Opportunities', shortLabel: 'Jobs' },
  { to: '/profile',       icon: 'profile',       label: 'Profile'      },
];
const MOBILE_BOTTOM_NAV = NAV.filter(({ icon }) => icon !== 'search');

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
  const { profile, logout, updateProfileLocally } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { canInstall, installed, triggerInstall } = useInstallPrompt();
  // Pending connection requests + unread persisted notifications
  // (message/comment/like/follow) combined — one badge for "you have
  // something new to look at in Notifications," not two separate numbers
  // competing for the same small dot.
  const [notifBadge, setNotifBadge] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const desktopHomeClickTimer = useRef(null);
  const mobileHomeTapTimer = useRef(null);

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

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => () => {
    if (desktopHomeClickTimer.current) window.clearTimeout(desktopHomeClickTimer.current);
    if (mobileHomeTapTimer.current) window.clearTimeout(mobileHomeTapTimer.current);
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function navigateToDesktopHome({ showAll = false } = {}) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (showAll) {
      navigate(HOME_FEED_PATH, { replace: location.pathname === '/', state: { refreshHomeAt: Date.now() } });
      return;
    }
    if (location.pathname !== '/') navigate('/');
  }

  // A desktop Home click returns to the top without replacing the member's
  // selected feed. A quick second click deliberately opens the complete mix.
  function handleDesktopHomeClick(event) {
    event.preventDefault();
    if (desktopHomeClickTimer.current) {
      window.clearTimeout(desktopHomeClickTimer.current);
      desktopHomeClickTimer.current = null;
      navigateToDesktopHome({ showAll: true });
      return;
    }
    desktopHomeClickTimer.current = window.setTimeout(() => {
      desktopHomeClickTimer.current = null;
      navigateToDesktopHome();
    }, 250);
  }

  function navigateToMobileFeed(feed) {
    const next = MOBILE_FEED_OPTIONS.has(feed) ? feed : 'feed';
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    navigate(next === 'feed' ? HOME_FEED_PATH : `/?feed=${encodeURIComponent(next)}`, {
      state: { refreshHomeAt: Date.now() },
    });
  }

  function saveMobileFeed(feed) {
    const next = MOBILE_FEED_OPTIONS.has(feed) ? feed : 'feed';
    const previous = profile?.roleSettings || {};
    const roleSettings = { ...previous, mobileSelectedFeed: next };
    updateProfileLocally({ roleSettings });
    client.patch('/profile', { roleSettings }).catch(() => {
      updateProfileLocally({ roleSettings: previous });
    });
  }

  // A single mobile Home tap restores the member's saved feed; a quick second
  // tap deliberately resets to the complete Home/All feed.
  function handleMobileHomeClick(event) {
    event.preventDefault();
    if (mobileHomeTapTimer.current) {
      window.clearTimeout(mobileHomeTapTimer.current);
      mobileHomeTapTimer.current = null;
      navigateToMobileFeed('feed');
      return;
    }
    mobileHomeTapTimer.current = window.setTimeout(() => {
      mobileHomeTapTimer.current = null;
      navigateToMobileFeed(selectedMobileFeed);
    }, 250);
  }

  function selectMobileFeed(feed) {
    const current = mobileFeedMode || 'feed';
    const next = current === feed ? 'feed' : feed;
    saveMobileFeed(next);
    navigateToMobileFeed(next);
  }

  const requestedFeed = new URLSearchParams(location.search).get('feed');
  const mobileFeedMode = requestedFeed === 'local' ? 'countries' : (requestedFeed || 'feed');
  const selectedMobileFeed = MOBILE_FEED_OPTIONS.has(profile?.roleSettings?.mobileSelectedFeed)
    ? profile.roleSettings.mobileSelectedFeed
    : 'feed';
  const isHomeFeedRoute = location.pathname === '/';
  const mobileSourceIds = mobileFeedMode === 'following'
    ? FOLLOWING_FEED_SOURCE_IDS
    : HOME_FEED_SOURCE_IDS;

  return (
    <div className="shell">
      {/* ── Desktop sidebar ── */}
      <aside className="sidebar">
        <Link to={HOME_FEED_PATH} className="sidebar-logo" onClick={handleDesktopHomeClick} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="sidebar-logo-icon">UFI</div>
          <span className="sidebar-logo-text">UFIconnect</span>
        </Link>

        <nav className="sidebar-nav">
          {NAV.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={icon === 'home'}
              aria-label={label}
              title={label}
              onClick={icon === 'home' ? handleDesktopHomeClick : undefined}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon" style={{ position: 'relative' }}>
                <ShellIcon name={icon} size={19} />
                {to === '/notifications' && <NavBadge count={notifBadge} />}
              </span>
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        {canInstall && (
          <button
            onClick={triggerInstall}
            className="sidebar-install"
            aria-label="Get app"
            title="Get app"
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
            <span className="sidebar-install-label">Get App</span>
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

      {profile && (
        <header className="mobile-app-header">
          <Link
            to={HOME_FEED_PATH}
            className="mobile-app-header-brand"
            onClick={event => {
              setMobileMenuOpen(false);
              handleMobileHomeClick(event);
            }}
          >
            <span className="mobile-app-header-mark" aria-hidden="true">UFI</span>
            <span>UFIconnect</span>
          </Link>

          <div className="mobile-command-menu">
            <NavLink
              to="/search"
              className={({ isActive }) => `mobile-app-header-search${isActive ? ' active' : ''}`}
              aria-label="Search"
              title="Search"
              onClick={() => setMobileMenuOpen(false)}
            >
              <ShellIcon name="search" size={19} />
            </NavLink>
            <button
              type="button"
              className="mobile-command-menu-trigger"
              aria-label={mobileMenuOpen ? 'Close app menu' : 'Open app menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-command-menu-panel"
              title="App menu"
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              <ShellIcon name="menu" size={19} />
            </button>
          </div>
        </header>
      )}

      {/* Keep the sheet outside the backdrop-filtered header. Fixed descendants
          of that header are positioned against it on mobile browsers and can
          collapse instead of filling the available viewport. */}
      {profile && mobileMenuOpen && (
        <div id="mobile-command-menu-panel" className="mobile-command-menu-panel" role="dialog" aria-label="App menu">
          <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'ufi' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'ufi'} onClick={() => selectMobileFeed('ufi')}>
            <ShellIcon name="posts" size={18} />
            UFI
          </button>
          <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'feed' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'feed'} onClick={() => selectMobileFeed('feed')}>
            <ShellIcon name="home" size={18} />
            All feed
          </button>
          <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'following' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'following'} onClick={() => selectMobileFeed('following')}>
            <ShellIcon name="following" size={18} />
            Following
          </button>
          <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'groups' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'groups'} onClick={() => selectMobileFeed('groups')}>
            <ShellIcon name="groups" size={18} />
            Groups
          </button>
          <NavLink to="/messages" className="mobile-command-menu-item" onClick={() => setMobileMenuOpen(false)}>
            <ShellIcon name="messages" size={18} />
            Messages
          </NavLink>
          <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'countries' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'countries'} onClick={() => selectMobileFeed('countries')}>
            <ShellIcon name="countries" size={18} />
            Travel
          </button>
          <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'restaurants' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'restaurants'} onClick={() => selectMobileFeed('restaurants')}>
            <ShellIcon name="restaurants" size={18} />
            Restaurants
          </button>
          <HomeFeedTools
            showSources
            sourceIds={mobileSourceIds}
          />
          <NavLink to="/command-center" className="mobile-command-menu-item mobile-command-menu-item--command" onClick={() => setMobileMenuOpen(false)}>
            <ShellIcon name="command" size={18} />
            Command Center
          </NavLink>
        </div>
      )}

      {/* ── Main content ── */}
      <main className={`main${wide ? ' main-wide' : ''}`}>
        {children}
      </main>

      {profile && mobileMenuOpen && (
        <button
          type="button"
          className="mobile-command-menu-scrim"
          aria-label="Close app menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      {/* ── Mobile bottom tab bar ── */}
      <nav className="bottom-nav">
        {MOBILE_BOTTOM_NAV.map(({ to, icon, label, shortLabel }) => (
          <NavLink
            key={to}
            to={to}
            end={icon === 'home'}
            onClick={icon === 'home' ? handleMobileHomeClick : undefined}
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
