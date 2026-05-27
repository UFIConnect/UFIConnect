import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function PublicProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile: myProfile } = useAuth();

  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [toggling,setToggling]= useState(false);

  useEffect(() => {
    setLoading(true);
    client.get(`/users/${id}`)
      .then(({ data }) => { setUser(data); setError(''); })
      .catch(() => setError('User not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  async function toggleFollow() {
    if (!user) return;
    setToggling(true);
    try {
      let data;
      if (user.isFollowing) {
        ({ data } = await client.delete(`/users/${user.id}/follow`));
      } else {
        ({ data } = await client.post(`/users/${user.id}/follow`));
      }
      setUser(u => ({
        ...u,
        isFollowing: !u.isFollowing,
        followersCount: data.followersCount ?? u.followersCount,
      }));
    } catch {}
    finally { setToggling(false); }
  }

  if (loading) return (
    <Layout>
      <div className="empty-state"><span className="spinner spinner-primary" /></div>
    </Layout>
  );

  if (error || !user) return (
    <Layout>
      <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>👤</div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>User not found</div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/search')}>← Back to Search</button>
      </div>
    </Layout>
  );

  const isOwn = myProfile?.id === user.id;

  return (
    <Layout>
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 16 }}
        onClick={() => navigate(-1)}
      >
        ← Back
      </button>

      {/* Cover */}
      <div className="profile-cover" />

      {/* Header */}
      <div className="profile-header">
        <div className="profile-avatar-wrap">
          <div className="avatar avatar-xl">{initials(user.name)}</div>
        </div>
        <div className="profile-name">{user.name}</div>
        {user.title && <div className="profile-title">{user.title}</div>}
        {user.organization && <div className="profile-org">🏢 {user.organization}</div>}

        {/* Follower counts */}
        <div style={{ display: 'flex', gap: 20, marginTop: 12, justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{user.followersCount}</div>
            <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>Followers</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{user.followingCount}</div>
            <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>Following</div>
          </div>
        </div>

        {!isOwn && (
          <div className="profile-actions" style={{ marginTop: 14 }}>
            <button
              className={user.isFollowing ? 'btn btn-ghost' : 'btn btn-primary'}
              onClick={toggleFollow}
              disabled={toggling}
              style={{ minWidth: 110 }}
            >
              {toggling
                ? <span className="spinner" />
                : user.isFollowing ? '✓ Following' : '+ Follow'
              }
            </button>
          </div>
        )}

        {isOwn && (
          <div className="profile-actions" style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/profile')}>Edit profile</button>
          </div>
        )}
      </div>

      {/* About */}
      {user.bio && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>About</h3>
          <p style={{ fontSize: '.9rem', lineHeight: 1.7 }}>{user.bio}</p>
        </div>
      )}

      {/* Skills */}
      {user.skills?.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Skills</h3>
          <div className="tags">
            {user.skills.map(s => <span key={s} className="tag tag-primary">{s}</span>)}
          </div>
        </div>
      )}

      {/* Role & preferences */}
      {(user.role || user.experience || user.interests?.length > 0 || user.goals?.length > 0) && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Background</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {user.role && (
              <div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: 3 }}>Role</div>
                <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{user.role}</div>
              </div>
            )}
            {user.experience && (
              <div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: 3 }}>Experience</div>
                <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{user.experience}</div>
              </div>
            )}
            {user.interests?.length > 0 && (
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: 6 }}>Interests</div>
                <div className="tags">
                  {user.interests.map(i => <span key={i} className="tag tag-secondary">{i}</span>)}
                </div>
              </div>
            )}
            {user.goals?.length > 0 && (
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: 6 }}>Goals</div>
                <div className="tags">
                  {user.goals.map(g => <span key={g} className="tag">{g}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Links */}
      {user.links && Object.values(user.links).some(Boolean) && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Links</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(user.links).filter(([, v]) => v).map(([key, url]) => (
              <a
                key={key}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  border: '1.5px solid var(--border)', borderRadius: 8, textDecoration: 'none',
                  color: 'var(--text)', fontSize: '.875rem', fontWeight: 600 }}
              >
                <span style={{ fontSize: '1rem', textTransform: 'capitalize' }}>{key}</span>
                <span style={{ flex: 1, fontSize: '.78rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
                <span style={{ color: 'var(--primary)' }}>→</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}
