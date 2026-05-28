import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const ROLE_FILTERS = [
  'All', 'Engineer / Developer', 'Designer / Creative', 'Product Manager',
  'Founder / Entrepreneur', 'Marketer / Growth', 'Data / Analytics',
  'Content Creator', 'Student / Learner', 'Investor / VC',
  'Operations / Finance', 'Community Manager', 'Healthcare Professional',
];

export default function Search() {
  const { profile } = useAuth();
  const navigate    = useNavigate();

  const [query,      setQuery]      = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [results,    setResults]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback(async (q, role) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q)                    params.set('q', q);
      if (role && role !== 'All') params.set('role', role);
      const { data } = await client.get(`/users/search?${params}`);
      setResults(data.users || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { search('', 'All'); }, [search]);

  // Re-search on role filter change
  useEffect(() => { search(query, roleFilter); }, [roleFilter]); // eslint-disable-line

  function handleQueryChange(e) {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val, roleFilter), 280);
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

  const hasQuery = query.trim().length > 0;

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Find People</h1>
        <p className="page-subtitle">
          {hasQuery
            ? `Showing results for "${query}"`
            : 'Suggested professionals based on your interests and role.'}
        </p>
      </div>

      {/* Search bar — live as you type */}
      <div style={{ maxWidth: 640, marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
            fontSize: '1rem', pointerEvents: 'none', opacity: 0.5,
          }}>🔍</span>
          <input
            className="form-input"
            placeholder="Search by name, role, skill, or interest…"
            value={query}
            onChange={handleQueryChange}
            autoFocus
            style={{ paddingLeft: 42, borderRadius: 24, padding: '11px 18px 11px 42px' }}
          />
          {loading && (
            <span style={{
              position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
            }}>
              <span className="spinner" style={{ width: 16, height: 16 }} />
            </span>
          )}
          {query && !loading && (
            <button
              type="button"
              onClick={() => { setQuery(''); search('', roleFilter); }}
              style={{
                position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem',
                color: 'var(--muted)', lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
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
              padding: '4px 13px', borderRadius: 16, fontSize: '.77rem', fontWeight: roleFilter === r ? 700 : 500,
              border: `1.5px solid ${roleFilter === r ? 'var(--primary)' : 'var(--border)'}`,
              background: roleFilter === r ? 'var(--primary)' : 'var(--surface)',
              color: roleFilter === r ? '#fff' : 'var(--text)', cursor: 'pointer',
              transition: 'all .15s',
            }}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Section header */}
      {!loading && results.length > 0 && (
        <div style={{ maxWidth: 640, marginBottom: 12, fontSize: '.78rem', color: 'var(--muted)', fontWeight: 500 }}>
          {hasQuery
            ? `${results.length} result${results.length !== 1 ? 's' : ''}`
            : `${results.length} professional${results.length !== 1 ? 's' : ''} — sorted by relevance to you`}
        </div>
      )}

      {/* Results */}
      <div style={{ maxWidth: 640 }}>
        {!loading && results.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🔍</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>No people found</div>
            <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: 0 }}>
              Try a different name, skill, or role.
            </p>
          </div>
        )}

        {results.map(user => (
          <div
            key={user.id}
            className="card"
            style={{ marginBottom: 10, cursor: 'pointer', transition: 'box-shadow .15s' }}
            onClick={() => navigate(user.isSelf ? '/profile' : `/u/${user.id}`)}
            onMouseOver={e => e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,.08)'}
            onMouseOut={e => e.currentTarget.style.boxShadow = ''}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div className="avatar avatar-md" style={{ flexShrink: 0 }}>
                {initials(user.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Name + action */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '.95rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {user.name}
                      {user.isSelf && (
                        <span style={{ fontSize: '.68rem', fontWeight: 700, background: 'var(--primary-light)', color: 'var(--primary)', padding: '1px 8px', borderRadius: 10 }}>
                          You
                        </span>
                      )}
                    </div>
                    {user.title && (
                      <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
                        {user.title}{user.organization ? ` · ${user.organization}` : ''}
                      </div>
                    )}
                  </div>
                  {user.isSelf ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ borderRadius: 20, flexShrink: 0 }}
                      onClick={e => { e.stopPropagation(); navigate('/profile'); }}
                    >
                      Edit profile
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button
                        className={user.isFollowing ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
                        style={{ borderRadius: 20, minWidth: 84 }}
                        onClick={e => toggleFollow(user, e)}
                      >
                        {user.isFollowing ? '✓ Following' : '+ Follow'}
                      </button>
                      <Link
                        to={`/messages/${user.id}`}
                        className="btn btn-ghost btn-sm"
                        style={{ borderRadius: 20, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                      >
                        💬
                      </Link>
                    </div>
                  )}
                </div>

                {/* Bio */}
                {user.bio && (
                  <p style={{ margin: '6px 0 0', fontSize: '.85rem', color: 'var(--text)', lineHeight: 1.5,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {user.bio}
                  </p>
                )}

                {/* Skills */}
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

                {/* Footer: role + followers + shared interests */}
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  {user.role && (
                    <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>💼 {user.role}</span>
                  )}
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>
                    {user.followersCount} follower{user.followersCount !== 1 ? 's' : ''}
                  </span>
                  {!user.isSelf && user.sharedInterests?.length > 0 && (
                    <span style={{ fontSize: '.7rem', fontWeight: 600, color: '#059669', background: '#ECFDF5', padding: '1px 8px', borderRadius: 8 }}>
                      ✦ {user.sharedInterests.length === 1
                        ? `Both into ${user.sharedInterests[0]}`
                        : `${user.sharedInterests.length} shared interests`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
