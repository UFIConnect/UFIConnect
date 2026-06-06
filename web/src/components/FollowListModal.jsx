import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function FollowListModal({ userId, type, title, onClose }) {
  const navigate = useNavigate();
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client.get(`/users/${userId}/${type}`)
      .then(({ data }) => setUsers(data.users || []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [userId, type]);

  async function toggleFollow(user, e) {
    e.stopPropagation();
    try {
      let data;
      if (user.isFollowing) {
        ({ data } = await client.delete(`/users/${user.id}/follow`));
      } else {
        ({ data } = await client.post(`/users/${user.id}/follow`));
      }
      setUsers(prev => prev.map(u =>
        u.id === user.id
          ? { ...u, isFollowing: !user.isFollowing, followersCount: data.followersCount ?? u.followersCount }
          : u
      ));
    } catch {}
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.45)', display: 'flex',
        alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--card)', borderRadius: '20px 20px 0 0',
        width: '100%', maxWidth: 540, maxHeight: '75vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -4px 32px rgba(0,0,0,.15)',
      }}>
        {/* Handle + header */}
        <div style={{ padding: '12px 20px 0', textAlign: 'center' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>{title}</h2>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--muted)', lineHeight: 1 }}
            >×</button>
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', padding: '0 16px 24px', flex: 1 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
          {!loading && users.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: '.9rem' }}>
              Nobody here yet.
            </div>
          )}
          {users.map(user => (
            <div
              key={user.id}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => { onClose(); navigate(user.isSelf ? '/profile' : `/u/${user.id}`); }}
            >
              <div className="avatar avatar-sm" style={{ flexShrink: 0 }}>{initials(user.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{user.name}</div>
                {(user.title || user.role) && (
                  <div style={{ fontSize: '.75rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.title || user.role}
                    {user.organization ? ` · ${user.organization}` : ''}
                  </div>
                )}
              </div>
              {!user.isSelf && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button
                    className={user.isFollowing ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
                    style={{ borderRadius: 20, minWidth: 76, fontSize: '.75rem' }}
                    onClick={e => toggleFollow(user, e)}
                  >
                    {user.isFollowing ? '✓ Following' : '+ Follow'}
                  </button>
                  <Link
                    to={`/messages/${user.id}`}
                    className="btn btn-ghost btn-sm"
                    style={{ borderRadius: 20, padding: '0 10px', display: 'flex', alignItems: 'center', fontSize: '.85rem', textDecoration: 'none' }}
                    onClick={onClose}
                  >
                    💬
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
