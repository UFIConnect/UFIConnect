import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';

const IS_LOCAL = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const NAV = [
  { to: '/',              icon: '📰', label: 'Feed'         },
  { to: '/groups',        icon: '🔍', label: 'Discover'     },
  { to: '/opportunities', icon: '💼', label: 'Opportunities' },
  { to: '/messages',      icon: '💬', label: 'Messages'     },
  // Agents tab — visible on localhost only
  ...(IS_LOCAL ? [{ to: '/agents', icon: '🤖', label: 'Agents' }] : []),
  { to: '/profile',       icon: '👤', label: 'Profile'      },
];

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function ComposeModal({ onClose }) {
  const [content, setContent] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useState(() => {
    client.get('/groups').then(({ data }) => setGroups(data.groups || [])).catch(() => {});
  }, []);

  async function handlePost() {
    if (!content.trim() || !groupId) return;
    setLoading(true);
    try {
      await client.post(`/groups/${groupId}/posts`, { content });
      setDone(true);
      setTimeout(onClose, 1200);
    } catch {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 520, padding: 24, borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,.22)' }}
        onClick={e => e.stopPropagation()}
      >
        {done ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>Post published!</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>✏️ Create Post</span>
              <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
            </div>
            <select
              className="form-input"
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              style={{ marginBottom: 12 }}
            >
              <option value="">Select a community…</option>
              {groups.filter(g => !g.isExternal).map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <textarea
              className="form-textarea"
              rows={5}
              placeholder="Share an idea, question, or update with your community…"
              value={content}
              onChange={e => setContent(e.target.value)}
              style={{ marginBottom: 14, resize: 'vertical' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handlePost}
                disabled={!content.trim() || !groupId || loading}
              >
                {loading ? <span className="spinner" /> : 'Publish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Layout({ children }) {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="shell">
      {composing && <ComposeModal onClose={() => setComposing(false)} />}

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
          {/* Compose button */}
          <button
            className="nav-link"
            style={{ border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', marginTop: 8,
              background: 'var(--primary)', color: '#fff', borderRadius: 10, fontWeight: 700 }}
            onClick={() => setComposing(true)}
          >
            <span className="nav-icon">✏️</span>
            Post
          </button>
        </nav>

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
        {NAV.slice(0, 2).map(({ to, icon, label }) => (
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
        {/* Center compose button */}
        <button
          className="bottom-nav-item"
          style={{ border: 'none', cursor: 'pointer' }}
          onClick={() => setComposing(true)}
        >
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 42, height: 42, borderRadius: '50%', background: 'var(--primary)',
              color: '#fff', fontSize: '1.3rem', marginBottom: 2,
            }}
          >✏️</span>
          <span style={{ fontSize: '.6rem', display: 'block' }}>Post</span>
        </button>
        {NAV.slice(2).map(({ to, icon, label }) => (
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
