import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import client from '../api/client';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { useToast } from '../contexts/ToastContext';

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

export default function Notifications() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(false);
  const [accepting,  setAccepting]  = useState(null);
  const [accepted,   setAccepted]   = useState(new Set());
  const [declining,  setDeclining]  = useState(null);
  const [declined,   setDeclined]   = useState(new Set());

  function load(opts = {}) {
    setError(false);
    if (!opts.silent) setLoading(true);
    client.get('/notifications')
      .then(({ data }) => setItems(data.notifications || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // Same "viewing the list clears the badge" convention as everywhere
    // else — fire-and-forget, doesn't block rendering the (already-unread)
    // items on this same load.
    client.post('/notifications/mark-read').catch(() => {});
  }, []);

  // Scrolling back up to the top acts as pull-to-refresh, same as every
  // other list page on the site.
  useScrollToRefresh(() => load({ silent: true }), { enabled: !loading });

  async function handleAccept(notification) {
    setAccepting(notification.id);
    try {
      await client.post(`/users/${notification.user.id}/connect`);
      setAccepted(prev => new Set(prev).add(notification.id));
      showToast('Connection accepted', 'success');
    } catch {
      // leave as pending — user can retry
      showToast('Failed to accept — please try again.', 'error');
    } finally {
      setAccepting(null);
    }
  }

  // Same DELETE the profile page's cancel/decline button uses — previously
  // this list only ever offered Accept, so a request from someone you don't
  // want to connect with had no way to go away except being ignored forever.
  async function handleDecline(notification) {
    setDeclining(notification.id);
    try {
      await client.delete(`/users/${notification.user.id}/connect`);
      setDeclined(prev => new Set(prev).add(notification.id));
    } catch {
      // leave as pending — user can retry
      showToast('Failed to decline — please try again.', 'error');
    } finally {
      setDeclining(null);
    }
  }

  return (
    <Layout>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">
            {items.length > 0 ? `${items.length} update${items.length > 1 ? 's' : ''}` : 'All caught up'}
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => navigate('/messages')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          Messages
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-icon">!</div>
          <div className="empty-title">Couldn't load notifications</div>
          <div className="empty-desc">Check your connection and try again.</div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={load}>Try again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">NTF</div>
          <div className="empty-title">No notifications yet</div>
          <div className="empty-desc">Likes, comments, follows, and connection requests will show up here.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
            <Link to="/search" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
              Find people
            </Link>
          </div>
        </div>
      ) : (
        <div className="conv-list">
          {items.map((n) => {
            const isRequest = n.type === 'connection_request';
            const isAccepted = accepted.has(n.id);
            const isDeclined = declined.has(n.id);
            // comment/like link to the post they're about; connection_request/
            // new_follower link to the person's profile, same as before.
            const targetLink = (n.type === 'comment' || n.type === 'like') && n.targetId
              ? `/p/${n.targetId}`
              : `/u/${n.user.id}`;
            const actionText = {
              connection_request: 'wants to connect with you',
              new_follower:       'started following you',
              comment:            'commented on your post',
              like:               'liked your post',
            }[n.type] || '';
            return (
              <div key={n.id} className="conv-item" style={{ cursor: 'default', opacity: n.read === false ? 1 : 0.85 }}>
                <Link to={targetLink} style={{ flexShrink: 0 }}>
                  <div className="avatar avatar-md">{initials(n.user.name)}</div>
                </Link>
                <div className="conv-info">
                  <div className="conv-name">
                    <Link to={targetLink} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {n.user.name}
                    </Link>
                  </div>
                  <div className="conv-last">
                    {actionText}
                    {n.type === 'connection_request' || n.type === 'new_follower'
                      ? (n.user.title ? ` · ${n.user.title}` : '')
                      : (n.preview ? `: "${n.preview}"` : '')}
                  </div>
                </div>
                <div className="conv-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="conv-time">{timeAgo(n.createdAt)}</div>
                  {(n.type === 'comment' || n.type === 'like') && (
                    <Link to={targetLink} className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>View</Link>
                  )}
                  {isRequest && (
                    isAccepted ? (
                      <span style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--primary)' }}>Connected</span>
                    ) : isDeclined ? (
                      <span style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)' }}>Declined</span>
                    ) : (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={accepting === n.id || declining === n.id}
                          onClick={() => handleAccept(n)}
                        >
                          {accepting === n.id ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Accept'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={accepting === n.id || declining === n.id}
                          onClick={() => handleDecline(n)}
                        >
                          {declining === n.id ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Decline'}
                        </button>
                      </>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
