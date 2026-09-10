import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import client from '../api/client';
import HomeFeedTools from './HomeFeedTools';
import JobsSidebarControls from './JobsSidebarControls';
import NotificationInbox from './NotificationInbox';
import './social-surfaces.css';
import { HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS } from './sourceMeta';
import { PanelLeft, ShoppingBag, BriefcaseBusiness, Bookmark, Music } from 'lucide-react';

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
    command: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 17h6" /><path d="M17 14v6" /></>,
    following: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="m17 10 2 2 3-3" /></>,
    countries: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></>,
    restaurants: <><path d="M7 3v8" /><path d="M4 3v5a3 3 0 0 0 6 0V3" /><path d="M7 11v10" /><path d="M17 3v18" /><path d="M17 3c3 1.5 3 7.5 0 9" /></>,
    sources: <><path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" /><path d="m3 12 9 4.5 9-4.5" /><path d="m3 16.5 9 4.5 9-4.5" /></>,
    menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
    skills: <><path d="M12 3 14.5 8l5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9L9.5 8 12 3Z" /></>,
    files: <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h6" /></>,
    saved: <path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4V4Z" />,
    close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.4-2.5L20 9" /><path d="m4 15 2.5 2.5A7 7 0 0 0 17.9 15" /></>,
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
  { to: '/opportunities', icon: 'opportunities', label: 'Jobs'          },
  { to: '/profile',       icon: 'profile',       label: 'Profile'      },
];
const MOBILE_BOTTOM_NAV = NAV
  .filter(({ icon }) => icon !== 'search')
  .map((item) => item.icon === 'notifications'
    ? { to: '/?feed=groups', feed: 'groups', icon: 'groups', label: 'Groups', shortLabel: 'Groups' }
    : item);

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
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState(null);
  const [mobileHeaderPopup, setMobileHeaderPopup] = useState(null);
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [mobileSearchTarget, setMobileSearchTarget] = useState('posts');
  const menuSwipeStartRef = useRef(null);

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
    window.addEventListener('ufi-notifications-updated', load);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('ufi-notifications-updated', load); };
  }, [profile]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setMobileAccountOpen(false);
    setMobileHeaderPopup(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key !== 'Escape') return;
      setMobileMenuOpen(false);
      setMobileAccountOpen(false);
      setMobileHeaderPopup(null);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    if (!mobileAccountOpen) return undefined;
    const mobile = window.matchMedia('(max-width: 768px)');
    if (!mobile.matches) { setMobileAccountOpen(false); return undefined; }
    const drawer = document.getElementById('mobile-account-drawer');
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => drawer?.querySelector('button')?.focus({ preventScroll: true }));
    function trapFocus(event) {
      if (event.key !== 'Tab' || !drawer) return;
      const items = [...drawer.querySelectorAll('a[href], button:not(:disabled)')];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    }
    const closeOnDesktop = event => { if (!event.matches) setMobileAccountOpen(false); };
    document.addEventListener('keydown', trapFocus);
    mobile.addEventListener('change', closeOnDesktop);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trapFocus);
      mobile.removeEventListener('change', closeOnDesktop);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [mobileAccountOpen]);

  // Edge-only swipes keep source rails and media gestures separate from drawers.
  useEffect(() => {
    function handleTouchStart(event) {
      menuSwipeStartRef.current = null;
      if (!profile || mobileHeaderPopup || window.innerWidth > 768 || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const target = event.target;
      if (mobileAccountOpen) {
        if (!(target instanceof Element) || !target.closest('#mobile-account-drawer')) return;
        menuSwipeStartRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now(), action: 'close-account' };
        return;
      }
      if (mobileMenuOpen) {
        if (!(target instanceof Element) || !target.closest('#mobile-feed-drawer')) return;
        menuSwipeStartRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now(), action: 'close' };
        return;
      }
      const action = touch.clientX <= 72 ? 'open-account' : touch.clientX >= window.innerWidth - 72 ? 'open' : null;
      if (!action) return;
      if (target instanceof Element && target.closest('input, textarea, select, button, a, iframe, video, [role="dialog"]')) return;
      menuSwipeStartRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now(), action };
    }

    function handleTouchEnd(event) {
      const start = menuSwipeStartRef.current;
      menuSwipeStartRef.current = null;
      if (!start || event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      const verticalDistance = Math.abs(start.y - touch.clientY);
      if (verticalDistance > 60 || Date.now() - start.at > 700) return;
      if (start.action === 'open' && start.x - touch.clientX >= 56) {
        setMobileHeaderPopup(null);
        setMobileAccountOpen(false);
        setMobileMenuOpen(true);
      } else if (start.action === 'close' && touch.clientX - start.x >= 56) {
        setMobileMenuOpen(false);
      } else if (start.action === 'open-account' && touch.clientX - start.x >= 56) {
        setMobileMenuOpen(false);
        setMobileAccountOpen(true);
      } else if (start.action === 'close-account' && start.x - touch.clientX >= 56) {
        setMobileAccountOpen(false);
      }
    }

    function cancelSwipe() {
      menuSwipeStartRef.current = null;
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', cancelSwipe, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', cancelSwipe);
    };
  }, [mobileHeaderPopup, mobileMenuOpen, mobileAccountOpen, profile]);

  function closeMobileOverlays() {
    setMobileMenuOpen(false);
    setMobileAccountOpen(false);
    setMobileHeaderPopup(null);
  }

  function toggleMobileHeaderPopup(name) {
    const opening = mobileHeaderPopup !== name;
    setMobileMenuOpen(false);
    setMobileAccountOpen(false);
    setMobileHeaderPopup(opening ? name : null);
  }

  function submitMobileSearch(event) {
    event.preventDefault();
    const query = mobileSearchQuery.trim();
    closeMobileOverlays();
    const params = new URLSearchParams({ tab: mobileSearchTarget });
    if (query) params.set('q', query);
    navigate(`/search?${params.toString()}`);
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function handleAllFeedHomeClick(event) {
    event.preventDefault();
    closeMobileOverlays();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    navigate(HOME_FEED_PATH, {
      replace: location.pathname === '/',
      state: { refreshHomeAt: Date.now() },
    });
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

  function selectMobileFeed(feed) {
    saveMobileFeed(feed);
    const next = MOBILE_FEED_OPTIONS.has(feed) ? feed : 'feed';
    if (isHomeFeedRoute && mobileFeedMode === next && (next !== 'groups' || mobileGroupScope === 'joined')) {
      setMobileMenuOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      window.dispatchEvent(new Event('ufi:refresh-selected-feed'));
      return;
    }
    navigateToMobileFeed(feed);
  }

  const mobileFeedParams = new URLSearchParams(location.search);
  const requestedFeed = mobileFeedParams.get('feed');
  const mobileGroupScope = mobileFeedParams.get('groupScope') === 'public' ? 'public' : 'joined';
  const mobileFeedMode = requestedFeed === 'local' ? 'countries' : (requestedFeed || 'feed');
  const isHomeFeedRoute = location.pathname === '/';
  const isJobsRoute = location.pathname === '/opportunities' || location.pathname.startsWith('/opportunities/');
  const mobileSourceIds = mobileFeedMode === 'following'
    ? FOLLOWING_FEED_SOURCE_IDS
    : HOME_FEED_SOURCE_IDS;

  return (
    <div className={`shell${wide ? ' shell-wide' : ''}`}>
      {/* ── Desktop sidebar ── */}
      <aside className="sidebar">
        <Link to={HOME_FEED_PATH} className="sidebar-logo" onClick={handleAllFeedHomeClick} style={{ textDecoration: 'none', color: 'inherit' }}>
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
              onClick={icon === 'home' ? handleAllFeedHomeClick : undefined}
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
          <div className="mobile-app-header-start">
            <Link
              to={HOME_FEED_PATH}
              className="mobile-app-header-brand"
              aria-label="Home"
              onClick={handleAllFeedHomeClick}
            >
              <span className="mobile-app-header-mark" aria-hidden="true">UFI</span>
            </Link>
            <button
              type="button"
              className={`mobile-app-header-action${mobileAccountOpen ? ' active' : ''}`}
              aria-label="Open account menu"
              aria-expanded={mobileAccountOpen}
              aria-controls="mobile-account-drawer"
              title="Account menu"
              onClick={() => {
                setMobileMenuOpen(false);
                setMobileHeaderPopup(null);
                setMobileAccountOpen(open => !open);
              }}
            >
              <PanelLeft size={21} aria-hidden="true" />
            </button>
          </div>

          <div className="mobile-command-menu">
            <button
              type="button"
              className={`mobile-app-header-action${mobileHeaderPopup === 'notifications' ? ' active' : ''}`}
              aria-label="Alerts"
              aria-expanded={mobileHeaderPopup === 'notifications'}
              aria-controls="mobile-alerts-popup"
              title="Alerts"
              onClick={() => toggleMobileHeaderPopup('notifications')}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <ShellIcon name="notifications" size={19} />
                <NavBadge count={notifBadge} />
              </span>
            </button>
            <button
              type="button"
              className={`mobile-app-header-action${mobileHeaderPopup === 'search' ? ' active' : ''}`}
              aria-label="Search"
              aria-expanded={mobileHeaderPopup === 'search'}
              aria-controls="mobile-search-popup"
              title="Search"
              onClick={() => toggleMobileHeaderPopup('search')}
            >
              <ShellIcon name="search" size={19} />
            </button>
            <button
              type="button"
              className={`mobile-app-header-action${mobileMenuOpen ? ' active' : ''}`}
              aria-label="Open menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-feed-drawer"
              title="Menu"
              onClick={() => {
                setMobileHeaderPopup(null);
                setMobileAccountOpen(false);
                setMobileMenuOpen(open => !open);
              }}
            >
              <ShellIcon name="menu" size={21} />
            </button>
          </div>
        </header>
      )}

      {profile && mobileHeaderPopup === 'search' && (
        <section id="mobile-search-popup" className="mobile-header-popup" role="dialog" aria-label="Search">
          <div className="mobile-header-popup-heading">
            <strong>Search</strong>
            <button type="button" className="mobile-header-popup-close" aria-label="Close search" onClick={() => setMobileHeaderPopup(null)}><ShellIcon name="close" size={18} /></button>
          </div>
          <form className="mobile-quick-search" onSubmit={submitMobileSearch}>
            <div className="mobile-quick-search-tabs" role="tablist" aria-label="Search in">
              {[
                { key: 'posts', label: 'Posts' },
                { key: 'people', label: 'People' },
                { key: 'groups', label: 'Groups' },
                { key: 'jobs', label: 'Jobs' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mobileSearchTarget === key}
                  className={`mobile-quick-search-tab${mobileSearchTarget === key ? ' active' : ''}`}
                  onClick={() => setMobileSearchTarget(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mobile-quick-search-field">
              <ShellIcon name="search" size={18} />
              <input
                type="search"
                value={mobileSearchQuery}
                aria-label={`Search ${mobileSearchTarget}`}
                placeholder={`Search ${mobileSearchTarget}`}
                autoFocus
                onChange={event => setMobileSearchQuery(event.target.value)}
              />
              {mobileSearchQuery && (
                <button type="button" aria-label="Clear search" onClick={() => setMobileSearchQuery('')}><ShellIcon name="close" size={16} /></button>
              )}
            </div>
            <button type="submit" className="btn btn-primary mobile-quick-search-submit">Search</button>
          </form>
        </section>
      )}

      {profile && mobileHeaderPopup === 'notifications' && (
        <section id="mobile-alerts-popup" className="mobile-header-popup mobile-alerts-popup" role="dialog" aria-label="Alerts">
          <div className="mobile-header-popup-heading">
            <strong>Notifications</strong>
            <button type="button" className="mobile-header-popup-close" aria-label="Close alerts" onClick={() => setMobileHeaderPopup(null)}><ShellIcon name="close" size={18} /></button>
          </div>
          <NotificationInbox compact onNavigate={closeMobileOverlays} />
          <div className="mobile-header-popup-footer">
            <Link to="/notifications" className="btn btn-primary btn-sm" onClick={closeMobileOverlays}>View all</Link>
          </div>
        </section>
      )}

      {/* Keep the drawer outside the backdrop-filtered header so mobile browsers
          position it against the viewport rather than the sticky header. */}
      {profile && (
        <aside
          id="mobile-account-drawer"
          className={`mobile-feed-drawer mobile-account-drawer${mobileAccountOpen ? ' open' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="Account and shop"
          aria-hidden={!mobileAccountOpen}
        >
          <div className="mobile-feed-drawer-header">
            <button type="button" className="mobile-feed-drawer-close" aria-label="Close account sidebar" onClick={() => setMobileAccountOpen(false)}>
              <ShellIcon name="close" size={19} />
            </button>
          </div>
          <div className="mobile-feed-drawer-content">
            <Link
              to="/?feed=ufi&channel=shop"
              className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'ufi' && mobileFeedParams.get('channel') === 'shop' ? ' active' : ''}`}
              onClick={closeMobileOverlays}
            >
              <ShoppingBag size={20} aria-hidden="true" />
              Shop
            </Link>
            <div className="mobile-account-saved" role="group" aria-label="Saved">
              <div className="mobile-account-saved-heading">Saved</div>
              <Link to="/profile?tab=saved&section=jobs" className="mobile-command-menu-item" onClick={closeMobileOverlays}>
                <BriefcaseBusiness size={20} aria-hidden="true" />
                Roles
              </Link>
              <Link to="/profile?tab=saved&section=posts" className="mobile-command-menu-item" onClick={closeMobileOverlays}>
                <Bookmark size={20} aria-hidden="true" />
                Posts
              </Link>
            </div>
            <div className="mobile-feed-drawer-bottom mobile-account-drawer-bottom">
              <NavLink to="/profile" className="mobile-command-menu-item mobile-account-profile" aria-label="Profile" onClick={closeMobileOverlays}>
                <span className="mobile-account-avatar" aria-hidden="true">
                  {profile.avatarUrl && failedAvatarUrl !== profile.avatarUrl
                    ? <img src={profile.avatarUrl} alt="" onError={() => setFailedAvatarUrl(profile.avatarUrl)} />
                    : initials(profile.name)}
                </span>
                <span className="mobile-account-profile-copy">
                  <strong>{profile.name}</strong>
                  <span>Profile</span>
                </span>
              </NavLink>
              <div className="mobile-account-actions">
                <NavLink to="/settings" className="mobile-command-menu-item" onClick={closeMobileOverlays}>
                  <ShellIcon name="settings" size={18} />
                  Settings
                </NavLink>
                <button type="button" className="mobile-command-menu-item mobile-command-menu-item--logout" onClick={handleLogout}>
                  <ShellIcon name="logout" size={18} />
                  Log out
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}
      {profile && (
        <aside
          id="mobile-feed-drawer"
          className={`mobile-feed-drawer${mobileMenuOpen ? ' open' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={isJobsRoute ? 'Jobs tools' : 'Feeds and account tools'}
          aria-hidden={!mobileMenuOpen}
        >
          <div className="mobile-feed-drawer-header">
            <button type="button" className="mobile-feed-drawer-close" aria-label="Close feed sidebar" onClick={() => setMobileMenuOpen(false)}>
              <ShellIcon name="close" size={19} />
            </button>
          </div>
          <div className={`mobile-feed-drawer-content${isJobsRoute ? ' mobile-feed-drawer-content--jobs' : ''}`}>
            {isJobsRoute ? (
              <>
                <JobsSidebarControls onNavigate={() => setMobileMenuOpen(false)} />
                <div className="mobile-jobs-role-links">
                  <NavLink to="/settings?tab=preferences" className="mobile-command-menu-item" onClick={() => setMobileMenuOpen(false)}>
                    <ShellIcon name="profile" size={18} />
                    Roles
                  </NavLink>
                </div>
                <div className="mobile-feed-drawer-bottom mobile-jobs-drawer-bottom">
                  <NavLink to="/groups" className="mobile-command-menu-item" onClick={() => setMobileMenuOpen(false)}>
                    <ShellIcon name="groups" size={18} />
                    Discover groups
                  </NavLink>
                  <NavLink to="/messages" className="mobile-command-menu-item" style={{ fontWeight: 400 }} onClick={() => setMobileMenuOpen(false)}>
                    <ShellIcon name="messages" size={18} />
                    Messages
                  </NavLink>
                  <HomeFeedTools showSources={false} />
                  <NavLink to="/resume-builder" className="mobile-command-menu-item mobile-command-menu-item--command" onClick={() => setMobileMenuOpen(false)}>
                    <ShellIcon name="files" size={18} />
                    Resume Builder
                  </NavLink>
                </div>
              </>
            ) : (
              <>
                <div className="mobile-feed-drawer-feeds">
              <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'ufi' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'ufi'} onClick={() => selectMobileFeed('ufi')}>
                <ShellIcon name="posts" size={18} />
                UFI
              </button>
              <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'following' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'following'} onClick={() => selectMobileFeed('following')}>
                <ShellIcon name="following" size={18} />
                Following
              </button>
              <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'groups' && mobileGroupScope === 'joined' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'groups' && mobileGroupScope === 'joined'} onClick={() => selectMobileFeed('groups')}>
                <ShellIcon name="groups" size={18} />
                Your groups
              </button>
              <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'countries' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'countries'} onClick={() => selectMobileFeed('countries')}>
                <ShellIcon name="countries" size={18} />
                Travel
              </button>
              <button type="button" className={`mobile-command-menu-item${isHomeFeedRoute && mobileFeedMode === 'restaurants' ? ' active' : ''}`} aria-pressed={isHomeFeedRoute && mobileFeedMode === 'restaurants'} onClick={() => selectMobileFeed('restaurants')}>
                <ShellIcon name="restaurants" size={18} />
                Restaurants
              </button>
              <NavLink to="/music" className="mobile-command-menu-item" onClick={() => setMobileMenuOpen(false)}>
                <Music size={18} aria-hidden="true" />Music
              </NavLink>
                </div>
                <div className="mobile-feed-drawer-bottom">
              <NavLink to="/groups" className="mobile-command-menu-item" onClick={() => setMobileMenuOpen(false)}>
                <ShellIcon name="search" size={18} />
                Discover groups
              </NavLink>
              <NavLink to="/messages" className="mobile-command-menu-item" style={{ fontWeight: 400 }} onClick={() => setMobileMenuOpen(false)}>
                <ShellIcon name="messages" size={18} />
                Messages
              </NavLink>
              <HomeFeedTools
                showSources
                sourceIds={mobileSourceIds}
              />
              <NavLink to="/command-center" className="mobile-command-menu-item mobile-command-menu-item--command" onClick={() => setMobileMenuOpen(false)}>
                <ShellIcon name="command" size={18} />
                Command Center
              </NavLink>
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      {/* ── Main content ── */}
      <main className={`main${wide ? ' main-wide' : ''}`}>
        {children}
      </main>

      {profile && (mobileMenuOpen || mobileAccountOpen || mobileHeaderPopup) && (
        <button
          type="button"
          className="mobile-command-menu-scrim"
          aria-label="Close open menu"
          onClick={closeMobileOverlays}
        />
      )}
      {/* ── Mobile bottom tab bar ── */}
      <nav className="bottom-nav">
        {MOBILE_BOTTOM_NAV.map(({ to, feed, icon, label, shortLabel }) => (
          <NavLink
            key={to}
            to={to}
            end={icon === 'home'}
            onClick={icon === 'home'
              ? handleAllFeedHomeClick
              : feed
                ? (event) => { event.preventDefault(); selectMobileFeed(feed); }
                : undefined}
            className={({ isActive }) => {
              const active = icon === 'home'
                ? isHomeFeedRoute && mobileFeedMode === 'feed'
                : feed
                  ? isHomeFeedRoute && mobileFeedMode === feed
                  : isActive;
              return `bottom-nav-item${active ? ' active' : ''}`;
            }}
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
