import { useState, useEffect } from 'react';
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

export default function Messages() {
  const navigate = useNavigate();
  const [convs,   setConvs]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/messages')
      .then(({ data }) => setConvs(data.conversations || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const totalUnread = convs.reduce((s, c) => s + (c.unreadCount || 0), 0);

  return (
    <Layout unreadCount={totalUnread}>
      <div className="page-header">
        <h1 className="page-title">Messages</h1>
        <p className="page-subtitle">
          {totalUnread > 0 ? `${totalUnread} unread message${totalUnread > 1 ? 's' : ''}` : 'All caught up ✓'}
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : convs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✉️</div>
          <div className="empty-title">No conversations yet</div>
          <div className="empty-desc">Connect with professionals to start a conversation.</div>
          <Link to="/search" className="btn btn-primary btn-sm" style={{ marginTop: 14, textDecoration: 'none' }}>
            Find people
          </Link>
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
