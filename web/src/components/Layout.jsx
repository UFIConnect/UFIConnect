import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

const NAV = [
  { to: '/',              icon: '📰', label: 'Feed'         },
  { to: '/search',        icon: '🔍', label: 'Search'       },
  { to: '/messages',      icon: '💬', label: 'Messages'     },
  { to: '/groups',        icon: '🌐', label: 'Groups'       },
  { to: '/opportunities', icon: '💼', label: 'Opportunities' },
  { to: '/profile',       icon: '👤', label: 'Profile'      },
];

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function Layout({ children }) {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const { canInstall, installed, triggerInstall } = useInstallPrompt();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="shell">
      {/* ── Desktop sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">UF</div>
          <span className="sidebar-logo-text">UFIConnect</span>
        </div>

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
              <button className="sidebar-logout" onClick={handleLogout} title="Log out">⎋</button>
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
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
