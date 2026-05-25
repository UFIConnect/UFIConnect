import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const NAV = [
  { to: '/',             icon: '📰', label: 'Feed'         },
  { to: '/groups',       icon: '🔍', label: 'Discover'     },
  { to: '/opportunities',icon: '💼', label: 'Opportunities' },
  { to: '/messages',     icon: '✉️', label: 'Messages'     },
  { to: '/profile',      icon: '👤', label: 'Profile'      },
];

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function Layout({ children, unreadCount = 0 }) {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">UF</div>
          <span className="sidebar-logo-text">UFIConnect</span>
        </div>

        {/* Nav links */}
        <nav className="sidebar-nav">
          {NAV.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{icon}</span>
              {label}
              {label === 'Messages' && unreadCount > 0 && (
                <span className="nav-badge">{unreadCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        {profile && (
          <div className="sidebar-user">
            <div className="avatar avatar-sm">
              {initials(profile.name)}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{profile.name}</div>
              <div className="sidebar-user-title">{profile.title || 'Member'}</div>
            </div>
            <button className="sidebar-logout" onClick={handleLogout} title="Log out">⎋</button>
          </div>
        )}
      </aside>

      <main className="main">
        {children}
      </main>
    </div>
  );
}
