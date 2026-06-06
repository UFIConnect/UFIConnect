import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NewMessageModal({ onClose, onSelect }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await client.get(`/users/search?q=${encodeURIComponent(query.trim())}&limit=8`);
        setResults(data.users || data.results || []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 80,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 16,
          width: 'min(480px, 92vw)',
          boxShadow: '0 16px 48px rgba(0,0,0,.18)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: '.95rem' }}>New Message</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--muted)', lineHeight: 1 }}>×</button>
        </div>

        {/* Search input */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, fontSize: '.85rem', pointerEvents: 'none' }}>🔍</span>
            <input
              ref={inputRef}
              className="form-input"
              placeholder="Search by name, role or skills…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ paddingLeft: 34, width: '100%', borderRadius: 10 }}
            />
          </div>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div style={{ padding: '20px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: '.85rem' }}>
              No users found for "{query}"
            </div>
          )}
          {!loading && !query.trim() && (
            <div style={{ padding: '20px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: '.85rem' }}>
              Type a name to search
            </div>
          )}
          {results.map(user => (
            <button
              key={user.id}
              onClick={() => onSelect(user)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '12px 20px', background: 'none',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                borderBottom: '1px solid var(--border)',
              }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseOut={e => e.currentTarget.style.background = 'none'}
            >
              <div className="avatar avatar-md" style={{ flexShrink: 0 }}>
                {initials(user.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '.88rem' }}>{user.name}</div>
                {(user.title || user.preferences?.role) && (
                  <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.title || user.preferences?.role}
                    {user.organization ? ` · ${user.organization}` : ''}
                  </div>
                )}
              </div>
              <span style={{ fontSize: '.72rem', color: 'var(--primary)', fontWeight: 600, flexShrink: 0 }}>Message →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Messages() {
  const navigate = useNavigate();
  const [convs,      setConvs]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showModal,  setShowModal]  = useState(false);

  useEffect(() => {
    client.get('/messages')
      .then(({ data }) => setConvs(data.conversations || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Close modal on Escape
  useEffect(() => {
    if (!showModal) return;
    const h = e => { if (e.key === 'Escape') setShowModal(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [showModal]);

  function handleSelectUser(user) {
    setShowModal(false);
    navigate(`/messages/${user.id}`);
  }

  const totalUnread = convs.reduce((s, c) => s + (c.unreadCount || 0), 0);

  return (
    <Layout unreadCount={totalUnread}>
      {showModal && (
        <NewMessageModal
          onClose={() => setShowModal(false)}
          onSelect={handleSelectUser}
        />
      )}

      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-subtitle">
            {totalUnread > 0 ? `${totalUnread} unread message${totalUnread > 1 ? 's' : ''}` : 'All caught up ✓'}
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          ✏️ New Message
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : convs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✉️</div>
          <div className="empty-title">No conversations yet</div>
          <div className="empty-desc">Start a conversation with someone in your network.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
              New Message
            </button>
            <Link to="/search" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
              Find people
            </Link>
          </div>
        </div>
      ) : (
        <div className="conv-list">
          {convs.map((conv) => (
            <div
              key={conv.id}
              className={`conv-item${conv.unreadCount > 0 ? ' unread' : ''}`}
              onClick={() => navigate(`/messages/${conv.participant?.id}`)}
            >
              <div className="avatar avatar-md">
                {initials(conv.participant?.name)}
              </div>
              <div className="conv-info">
                <div className="conv-name">{conv.participant?.name || 'Unknown'}</div>
                <div className="conv-last">
                  {conv.lastMessage?.isMe && '↑ '}
                  {conv.lastMessage?.content || 'No messages yet'}
                </div>
              </div>
              <div className="conv-right">
                <div className="conv-time">{timeAgo(conv.lastMessage?.createdAt)}</div>
                {conv.unreadCount > 0 && (
                  <div className="conv-unread-badge">{conv.unreadCount}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
