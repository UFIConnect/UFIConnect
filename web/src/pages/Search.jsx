import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function initialSearchTab() {
  if (typeof window === 'undefined') return 'people';
  const requested = new URLSearchParams(window.location.search).get('tab');
  return ['people', 'communities', 'groups'].includes(requested) ? requested : 'people';
}

const ROLE_META = {
  'Engineer / Developer':    { icon: 'ED', color: '#2563EB', bg: '#EFF6FF' },
  'Designer / Creative':     { icon: 'DC', color: '#7C3AED', bg: '#F3EEFF' },
  'Product Manager':         { icon: 'PM', color: '#0284C7', bg: '#F0F9FF' },
  'Marketer / Growth':       { icon: 'MG', color: '#059669', bg: '#ECFDF5' },
  'Founder / Entrepreneur':  { icon: 'FE', color: '#D97706', bg: '#FFFBEB' },
  'Investor / VC':           { icon: 'VC', color: '#DB2777', bg: '#FDF2F8' },
  'Data / Analytics':        { icon: 'DA', color: '#EA580C', bg: '#FFF7ED' },
  'Student / Learner':       { icon: 'SL', color: '#7C3AED', bg: '#F3EEFF' },
  'Sales / Business Dev':    { icon: 'BD', color: '#2563EB', bg: '#EFF6FF' },
  'Operations / Finance':    { icon: 'OF', color: '#059669', bg: '#ECFDF5' },
  'Content Creator':         { icon: 'CC', color: '#D97706', bg: '#FFFBEB' },
  'Community Manager':       { icon: 'CM', color: '#0284C7', bg: '#F0F9FF' },
  'Researcher / Academic':   { icon: 'RA', color: '#7C3AED', bg: '#F3EEFF' },
  'HR / People Ops':         { icon: 'HR', color: '#DB2777', bg: '#FDF2F8' },
};

const ROLE_FILTERS = [
  'All', 'Engineer / Developer', 'Designer / Creative', 'Product Manager',
  'Founder / Entrepreneur', 'Marketer / Growth', 'Data / Analytics',
  'Content Creator', 'Student / Learner', 'Investor / VC',
  'Operations / Finance', 'Community Manager', 'Researcher / Academic',
];

const CATEGORY_ICONS = {
  'AI & Machine Learning': 'AI', 'Web Development': 'WD', 'Mobile Dev': 'MD',
  'DevOps & Cloud': 'DC', 'Cybersecurity': 'CY', 'Open Source': 'OS',
  'Data Science': 'DS', 'Product & Design': 'PD', 'Startup & Founders': 'SF',
  'Finance & Investing': 'FI', 'Marketing & Growth': 'MG', 'Career & Jobs': 'CJ',
  'Community': 'CM', 'Science & Research': 'SR', 'Gaming': 'GM',
  'Blockchain & Web3': 'W3', 'Healthcare': 'HC', 'Education': 'ED',
};

export default function Search() {
  const { profile } = useAuth();
  const navigate    = useNavigate();

  const [activeTab,   setActiveTab]   = useState(initialSearchTab);
  const [query,       setQuery]       = useState('');
  const [roleFilter,  setRoleFilter]  = useState('All');
  const [sortBy,      setSortBy]      = useState('relevance');
  const [results,     setResults]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [registeredCount, setRegisteredCount] = useState(null);
  const [countSource, setCountSource] = useState(null);

  // Groups state
  const [allGroups,     setAllGroups]     = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [joinedGroups,  setJoinedGroups]  = useState(new Set());
  const [joining,       setJoining]       = useState(null);

  const debounceRef = useRef(null);

  // ── People search ──────────────────────────────────────────────────────────
  const searchPeople = useCallback(async (q, role) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q)                      params.set('q', q);
      if (role && role !== 'All') params.set('role', role);
      const { data } = await client.get(`/users/search?${params}`);
      setResults(data.users || []);
      setRegisteredCount(data.registeredCount != null && Number.isFinite(Number(data.registeredCount)) ? Number(data.registeredCount) : null);
      setCountSource(data.countSource || null);
    } catch {
      setResults([]);
      setRegisteredCount(null);
      setCountSource(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { searchPeople('', 'All'); }, [searchPeople]);
  useEffect(() => { if (activeTab === 'people') searchPeople(query, roleFilter); }, [roleFilter]); // eslint-disable-line

  // ── Groups fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!['communities', 'groups'].includes(activeTab) || allGroups.length > 0) return;
    setGroupsLoading(true);
    Promise.all([
      client.get('/groups'),
      profile?.id ? client.get('/profile').catch(() => ({ data: {} })) : Promise.resolve({ data: {} }),
    ]).then(([gRes, pRes]) => {
      setAllGroups(gRes.data.groups || []);
      const joined = pRes.data.joinedGroups || [];
      setJoinedGroups(new Set(joined));
    }).catch(() => {}).finally(() => setGroupsLoading(false));
  }, [activeTab]); // eslint-disable-line

  function handleQueryChange(e) {
    const val = e.target.value;
    setQuery(val);
    if (activeTab === 'people') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => searchPeople(val, roleFilter), 280);
    }
  }

  function clearSearch() {
    setQuery('');
    if (activeTab === 'people') searchPeople('', roleFilter);
  }

  async function toggleFollow(user, e) {
    e.stopPropagation();
    const nowFollowing = !user.isFollowing;
    try {
      let data;
      if (nowFollowing) {
        ({ data } = await client.post(`/users/${user.id}/follow`));
      } else {
        ({ data } = await client.delete(`/users/${user.id}/follow`));
      }
      setResults(prev => prev.map(u =>
        u.id === user.id
          ? { ...u, isFollowing: nowFollowing, followersCount: data.followersCount ?? u.followersCount }
          : u
      ));
    } catch {}
  }

  async function toggleJoin(groupId, e) {
    e.stopPropagation();
    const group = allGroups.find(candidate => candidate.id === groupId);
    if (!group || group.isExternal || group.canJoin === false) return;
    setJoining(groupId);
    try {
      const isJoined = joinedGroups.has(groupId);
      if (!isJoined) {
        await client.post(`/groups/${groupId}/join`);
        setJoinedGroups(prev => new Set([...prev, groupId]));
      }
    } catch {}
    finally { setJoining(null); }
  }

  // Sort people
  const sortedResults = [...results].sort((a, b) => {
    if (sortBy === 'followers') return (b.followersCount || 0) - (a.followersCount || 0);
    return 0; // relevance = server order
  });

  // External communities and native UFIconnect groups are intentionally
  // separate discovery surfaces. They share one API response, but never one
  // result list, so the two tabs do not duplicate each other.
  const visibleGroups = allGroups.filter(group => activeTab === 'communities'
    ? group.isExternal === true
    : group.isExternal !== true);
  const filteredGroups = visibleGroups.filter(g => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return g.name?.toLowerCase().includes(q) ||
           g.description?.toLowerCase().includes(q) ||
           g.category?.toLowerCase().includes(q);
  });

  const hasQuery = query.trim().length > 0;

  return (
    <Layout>
      <Helmet>
        <title>Find People, Communities & Groups | UFIconnect</title>
        <meta name="description" content="Search professionals by role, skill, or organization. Discover 160+ communities across tech, design, startups, and more." />
        <link rel="canonical" href="https://uficonnect.org/search" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://uficonnect.org/search" />
        <meta property="og:title" content="Find People, Communities & Groups | UFIconnect" />
        <meta property="og:description" content="Search professionals by role, skill, or organization. Discover UFIconnect communities across tech, design, startups, and more." />
        <meta property="og:image" content="https://uficonnect.org/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>
      <div className="page-header">
        <h1 className="page-title">Search</h1>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {[
          { key: 'people', label: 'People' },
          { key: 'communities', label: 'Communities' },
          { key: 'groups', label: 'Groups' },
        ].map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 700 : 500,
              fontSize: '.875rem',
              color: activeTab === tab.key ? 'var(--primary)' : 'var(--muted)',
              borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div style={{ maxWidth: 640, marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
            fontSize: '1rem', pointerEvents: 'none', opacity: 0.5,
          }}>Q</span>
          <input
            className="form-input"
            placeholder={activeTab === 'people'
              ? 'Search by name, role, skill, or interest…'
              : activeTab === 'communities'
                ? 'Search communities by name or topic…'
                : 'Search UFIconnect groups by name or topic…'}
            value={query}
            onChange={handleQueryChange}
            autoFocus
            style={{ paddingLeft: 42, borderRadius: 24, padding: '11px 18px 11px 42px' }}
          />
          {(loading || groupsLoading) && (
            <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)' }}>
              <span className="spinner" style={{ width: 16, height: 16 }} />
            </span>
          )}
          {query && !(loading || groupsLoading) && (
            <button
              type="button"
              onClick={clearSearch}
              style={{
                position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '1rem', color: 'var(--muted)', lineHeight: 1,
              }}
            >×</button>
          )}
        </div>
      </div>

      {/* ── PEOPLE TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'people' && (
        <>
          {/* Role filters + sort */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap', maxWidth: 640 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
              {ROLE_FILTERS.map(r => {
                const rm = ROLE_META[r];
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRoleFilter(r)}
                    style={{
                      padding: '4px 12px', borderRadius: 'var(--radius-sm)', fontSize: '.77rem',
                      fontWeight: roleFilter === r ? 700 : 500,
                      border: `1.5px solid ${roleFilter === r ? (rm?.color || 'var(--primary)') : 'var(--border)'}`,
                      background: roleFilter === r ? (rm?.bg || 'var(--primary-light)') : 'var(--surface)',
                      color: roleFilter === r ? (rm?.color || 'var(--primary)') : 'var(--text)',
                      cursor: 'pointer', transition: 'all .15s',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    {rm && <span>{rm.icon}</span>}
                    {r}
                  </button>
                );
              })}
            </div>
            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{
                padding: '5px 10px', borderRadius: 8, border: '1.5px solid var(--border)',
                background: 'var(--surface)', color: 'var(--text)',
                fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
              }}
            >
              <option value="relevance">Relevance</option>
              <option value="followers">Most Followers</option>
            </select>
          </div>

          {/* Count */}
          {!loading && registeredCount !== null && (
            <div style={{ maxWidth: 640, marginBottom: 12, fontSize: '.78rem', color: 'var(--muted)', fontWeight: 500 }}>
              {registeredCount.toLocaleString()} registered member{registeredCount !== 1 ? 's' : ''}
              {hasQuery
                ? ` · ${sortedResults.length} result${sortedResults.length !== 1 ? 's' : ''}`
                : ` · ${sortedResults.length} available to connect${sortBy === 'followers' ? ', sorted by followers' : ''}`}
              {countSource === 'memory' && ' · count reconnecting'}
            </div>
          )}
          {!loading && registeredCount === null && countSource === 'unavailable' && (
            <div style={{ maxWidth: 640, marginBottom: 12, fontSize: '.78rem', color: 'var(--muted)', fontWeight: 500 }}>
              Registered-member count is temporarily unavailable.
            </div>
          )}

          {/* Suggested label */}
          {!loading && !hasQuery && sortedResults.length > 0 && (
            <div style={{ maxWidth: 640, marginBottom: 8 }}>
              <span style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                Suggested for you
              </span>
            </div>
          )}

          <div style={{ maxWidth: 640 }}>
            {!loading && sortedResults.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 12, fontWeight: 800 }}>Search</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>No people found</div>
                <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: 0 }}>
                  Try a different name, skill, or role.
                </p>
              </div>
            )}

            {sortedResults.map(user => {
              const rm = ROLE_META[user.role];
              return (
                <div
                  key={user.id}
                  className="card"
                  style={{ marginBottom: 10, cursor: 'pointer', transition: 'box-shadow .15s' }}
                  onClick={() => navigate(user.isSelf ? '/profile' : `/u/${user.id}`)}
                  onMouseOver={e => e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,.08)'}
                  onMouseOut={e => e.currentTarget.style.boxShadow = ''}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    {/* Avatar with role ring */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div
                        className="avatar avatar-md"
                        style={{ border: rm ? `2px solid ${rm.color}` : undefined }}
                      >
                        {initials(user.name)}
                      </div>
                      {rm && (
                        <span style={{
                          position: 'absolute', bottom: -4, right: -4,
                          width: 18, height: 18, borderRadius: '50%',
                          background: rm.bg, border: `1.5px solid ${rm.color}33`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '.6rem',
                        }}>{rm.icon}</span>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '.95rem', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {user.name}
                            {user.isSelf && (
                              <span style={{ fontSize: '.68rem', fontWeight: 700, background: 'var(--primary-light)', color: 'var(--primary)', padding: '1px 8px', borderRadius: 10, flexShrink: 0 }}>You</span>
                            )}
                          </div>
                          {user.title && (
                            <div style={{ fontSize: '.8rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {user.title}{user.organization ? ` · ${user.organization}` : ''}
                            </div>
                          )}
                        </div>

                        {user.isSelf ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ flexShrink: 0 }}
                            onClick={e => { e.stopPropagation(); navigate('/profile'); }}
                          >Edit profile</button>
                        ) : (
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                            <button
                              className={user.isFollowing ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
                              style={{ minWidth: 84 }}
                              onClick={e => toggleFollow(user, e)}
                            >
                              {user.isFollowing ? 'Following' : '+ Follow'}
                            </button>
                            <Link
                              to={`/messages/${user.id}`}
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                            >Message</Link>
                          </div>
                        )}
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

                      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        {user.role && rm && (
                          <span style={{ fontSize: '.72rem', fontWeight: 600, color: rm.color, background: rm.bg, padding: '2px 8px', borderRadius: 8 }}>
                            {rm.icon} {user.role}
                          </span>
                        )}
                        <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>
                          {user.followersCount} follower{user.followersCount !== 1 ? 's' : ''}
                        </span>
                        {!user.isSelf && user.sharedInterests?.length > 0 && (
                          <span style={{ fontSize: '.7rem', fontWeight: 600, color: '#059669', background: '#ECFDF5', padding: '1px 8px', borderRadius: 8 }}>
                            {user.sharedInterests.length === 1
                              ? `Both into ${user.sharedInterests[0]}`
                              : `${user.sharedInterests.length} shared interests`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── COMMUNITIES / GROUPS TABS ───────────────────────────────────────── */}
      {['communities', 'groups'].includes(activeTab) && (
        <>
          {groupsLoading && (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <span className="spinner spinner-primary" />
            </div>
          )}

          {!groupsLoading && (
            <>
              <div style={{ maxWidth: 640, marginBottom: 12, fontSize: '.78rem', color: 'var(--muted)', fontWeight: 500 }}>
                {hasQuery
                  ? `${filteredGroups.length} ${activeTab === 'communities' ? `communit${filteredGroups.length !== 1 ? 'ies' : 'y'}` : `group${filteredGroups.length !== 1 ? 's' : ''}`} matching "${query}"`
                  : `${filteredGroups.length} ${activeTab === 'communities' ? 'communities' : `UFIconnect group${filteredGroups.length !== 1 ? 's' : ''}`}`}
              </div>

              {filteredGroups.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: '32px 24px', maxWidth: 640 }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: 12, fontWeight: 800 }}>Groups</div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>No {activeTab === 'communities' ? 'communities' : 'groups'} found</div>
                  <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: 0 }}>
                    Try a different keyword or browse without a filter.
                  </p>
                </div>
              )}

              <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredGroups.map(group => {
                  const catIcon = CATEGORY_ICONS[group.category] || 'GR';
                  const canJoin = group.canJoin !== false && !group.isExternal;
                  const isJoined = canJoin && joinedGroups.has(group.id);
                  const isJoining = joining === group.id;
                  return (
                    <div
                      key={group.id}
                      className="card"
                      style={{ cursor: 'pointer', transition: 'box-shadow .15s' }}
                      onClick={() => group.isExternal
                        ? window.open(group.externalUrl, '_blank', 'noopener,noreferrer')
                        : navigate(`/groups/${group.id}`)}
                      onMouseOver={e => e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,.08)'}
                      onMouseOut={e => e.currentTarget.style.boxShadow = ''}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                          background: 'var(--bg-secondary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '1.4rem',
                        }}>{catIcon}</div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</div>
                          <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 1 }}>
                            {group.category && (
                              <span style={{ marginRight: 8 }}>{catIcon} {group.category}</span>
                            )}
                            {typeof group.members === 'number' && (
                              <span>{group.members.toLocaleString()} members</span>
                            )}
                          </div>
                          {group.description && (
                            <p style={{
                              margin: '4px 0 0', fontSize: '.82rem', color: 'var(--text)',
                              lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box',
                              WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            }}>{group.description}</p>
                          )}
                        </div>

                        <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          {!canJoin ? null : isJoined ? (
                            <span style={{ fontSize: '.72rem', fontWeight: 600, color: '#059669', background: '#ECFDF5', padding: '4px 10px', borderRadius: 6 }}>
                              Joined
                            </span>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={isJoining}
                              onClick={e => toggleJoin(group.id, e)}
                            >
                              {isJoining ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Join'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </Layout>
  );
}
