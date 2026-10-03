import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// fetchUrl lets a caller override the default /users/:id/:type lookup with
// any other endpoint that returns the same { users: [...] } shape (e.g.
// PostDetail's "who liked this" list via /posts/:postId/likes) — every row
// action below (follow toggle, message) already works generically against
// any user list, not just a follow relationship, so only the fetch itself
// needed to become swappable.
export default function FollowListModal({ userId, type, title, onClose, fetchUrl, emptyLabel, note }) {
  const navigate = useNavigate();
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const closeRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    client.get(fetchUrl || `/users/${userId}/${type}`)
      .then(({ data }) => { if (!cancelled) { setUsers(data.users || []); setRestricted(!!data.restricted); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, type, fetchUrl, attempt]);

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

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

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), a[href]')];
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
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
            <h2 id={titleId} style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>{title}</h2>
            <button
              ref={closeRef} type="button" aria-label="Close"
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--muted)', lineHeight: 1 }}
            >×</button>
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', padding: '0 16px 24px', flex: 1 }}>
          {note && <p style={{ margin: '0 4px 8px', fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.5 }}>{note}</p>}
          {loading && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
          {!loading && restricted && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: '.9rem' }}>
              This list is private.
            </div>
          )}
          {!loading && error && <p role="alert">Could not load this list. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt(value => value + 1)}>Try again</button></p>}
          {!loading && !error && !restricted && users.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: '.9rem' }}>
              {emptyLabel || 'Nobody here yet.'}
            </div>
          )}
          {users.map(user => (
            <div
              key={user.id}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => { onClose(); navigate(user.isSelf ? '/profile' : `/u/${user.id}`); }}
            >
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="avatar-sm" style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div className="avatar avatar-sm" style={{ flexShrink: 0 }}>{initials(user.name)}</div>
              )}
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
                    style={{ minWidth: 76, fontSize: '.75rem' }}
                    onClick={e => toggleFollow(user, e)}
                  >
                    {user.isFollowing ? 'Following' : '+ Follow'}
                  </button>
                  <Link
                    to={`/messages/${user.id}`}
                    className="btn btn-ghost btn-sm"
                    style={{ borderRadius: 20, padding: '0 10px', display: 'flex', alignItems: 'center', fontSize: '.85rem', textDecoration: 'none' }}
                    onClick={onClose}
                  >
                    Message
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>, document.body
  );
}
