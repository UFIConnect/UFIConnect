import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const ROLE_FILTERS = [
  'All', 'Engineer / Developer', 'Designer / Creative', 'Product Manager',
  'Founder / Entrepreneur', 'Marketer / Growth', 'Data / Analytics',
  'Content Creator', 'Student / Learner', 'Investor',
];

export default function Search() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [query,     setQuery]     = useState('');
  const [roleFilter,setRoleFilter]= useState('All');
  const [results,   setResults]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [followed,  setFollowed]  = useState({}); // id → followersCount

  const search = useCallback(async (q, role) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q)    params.set('q', q);
      if (role && role !== 'All') params.set('role', role);
      const { data } = await client.get(`/users/search?${params}`);
      setResults(data.users || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — show all users
  useEffect(() => { search('', 'All'); }, [search]);

  // Re-search on filter change
  useEffect(() => { search(query, roleFilter); }, [roleFilter]);

  function handleKeyDown(e) {
    if (e.key === 'Enter') search(query, roleFilter);
  }

  async function toggleFollow(user, e) {
    e.stopPropagation();
    const isNowFollowing = !user.isFollowing;
    try {
      let data;
      if (isNowFollowing) {
        ({ data } = await client.post(`/users/${user.id}/follow`));
      } else {
        ({ data } = await client.delete(`/users/${user.id}/follow`));
      }
      setResults(prev => prev.map(u =>
        u.id === user.id
          ? { ...u, isFollowing: isNowFollowing, followersCount: data.followersCount ?? u.followersCount }
          : u
      ));
    } catch {}
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Find People</h1>
        <p className="page-subtitle">Discover professionals, creators, and builders in the UFIConnect community.</p>
      </div>

      {/* Search bar */}
      <div style={{ maxWidth: 640, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            placeholder="Search by name, role, skill, or interest…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ flex: 1, borderRadius: 24, padding: '10px 18px' }}
          />
          <button
            className="btn btn-primary"
            onClick={() => search(query, roleFilter)}
            style={{ borderRadius: 24, minWidth: 80 }}
          >
            Search
          </button>
        </div>
      </div>

      {/* Role filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20, maxWidth: 640 }}>
        {ROLE_FILTERS.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => setRoleFilter(r)}
            style={{
              padding: '4px 14px', borderRadius: 16, fontSize: '.78rem', fontWeight: roleFilter === r ? 700 : 500,
              border: `1.5px solid ${roleFilter === r ? 'var(--primary)' : 'var(--border)'}`,
              background: roleFilter === r ? 'var(--primary)' : 'var(--surface)',
              color: roleFilter === r ? '#fff' : 'var(--text)', cursor: 'pointer',
            }}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Results */}
      <div style={{ maxWidth: 640 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Searching…</div>
        ) : results.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🔍</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>No people found</div>
            <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: 0 }}>
              Try a different name, skill, or role.
            </p>
          </div>
        ) : (
          results.map(user => (
            <div
              key={user.id}
              className="card"
              style={{ marginBottom: 10, cursor: 'pointer', transition: 'box-shadow .15s' }}
              onClick={() => navigate(`/u/${user.id}`)}
              onMouseOver={e => e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,.08)'}
              onMouseOut={e => e.currentTarget.style.boxShadow = ''}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div className="avatar avatar-md" style={{ flexShrink: 0 }}>
                  {initials(user.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{user.name}</div>
                      {user.title && (
                        <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
                          {user.title}{user.organization ? ` · ${user.organization}` : ''}
                        </div>
                      )}
                    </div>
                    <button
                      className={user.isFollowing ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
                      style={{ borderRadius: 20, flexShrink: 0, minWidth: 84 }}
                      onClick={e => toggleFollow(user, e)}
                    >
                      {user.isFollowing ? '✓ Following' : '+ Follow'}
                    </button>
                  </div>

                  {user.bio && (
                    <p style={{ margin: '6px 0 0', fontSize: '.85rem', color: 'var(--text)', lineHeight: 1.5,
                      overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {user.bio}
                    </p>
                  )}

                  {user.skills?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                      {user.skills.slice(0, 5).map(s => (
                        <span key={s} className="tag tag-primary" style={{ fontSize: '.72rem', padding: '2px 8px' }}>{s}</span>
                      ))}
                      {user.skills.length > 5 && (
                        <span className="tag" style={{ fontSize: '.72rem', padding: '2px 8px' }}>+{user.skills.length - 5}</span>
                      )}
                    </div>
                  )}

                  <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--muted)' }}>
                    {user.role && <span style={{ marginRight: 10 }}>💼 {user.role}</span>}
                    <span>{user.followersCount} follower{user.followersCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}
