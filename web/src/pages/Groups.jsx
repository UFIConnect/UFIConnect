import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import client from '../api/client';

const CATEGORY_META = {
  'AI & ML':     { icon: '🤖', bg: '#F3EEFF', text: '#7C3AED' },
  'Engineering': { icon: '💻', bg: '#EFF6FF', text: '#2563EB' },
  'Startups':    { icon: '🚀', bg: '#FFFBEB', text: '#D97706' },
  'Design':      { icon: '🎨', bg: '#FDF2F8', text: '#DB2777' },
  'Marketing':   { icon: '📈', bg: '#ECFDF5', text: '#059669' },
  'Finance':     { icon: '💰', bg: '#F0F9FF', text: '#0284C7' },
  'Remote Work': { icon: '🌍', bg: '#EEF2FF', text: '#4338CA' },
  'Education':   { icon: '🎓', bg: '#FFF7ED', text: '#EA580C' },
  'Social':      { icon: '🔗', bg: '#F9FAFB', text: '#6B7280' },
  'Health':      { icon: '🏃', bg: '#F0FDF4', text: '#16A34A' },
  'Climate':     { icon: '🌱', bg: '#ECFDF5', text: '#065F46' },
  'Food':        { icon: '🍳', bg: '#FFF7ED', text: '#C2410C' },
  'Travel':      { icon: '✈️', bg: '#F0F9FF', text: '#0369A1' },
  'Gaming':      { icon: '🎮', bg: '#F5F3FF', text: '#6D28D9' },
  'Music':       { icon: '🎵', bg: '#FDF4FF', text: '#A21CAF' },
  'Fashion':     { icon: '👗', bg: '#FFF1F2', text: '#BE123C' },
  'Lifestyle':   { icon: '🌟', bg: '#FFFFF0', text: '#92400E' },
  'Sports':      { icon: '⚽', bg: '#ECFDF5', text: '#047857' },
  'Space':       { icon: '🚀', bg: '#EEF2FF', text: '#3730A3' },
};

const PLATFORM_META = {
  reddit:      { icon: '🟠', label: 'Reddit',         color: '#FF4500' },
  discord:     { icon: '💬', label: 'Discord',        color: '#5865F2' },
  linkedin:    { icon: '💼', label: 'LinkedIn',       color: '#0A66C2' },
  hackernews:  { icon: '🔶', label: 'News',           color: '#FF6600' },
  devto:       { icon: '👩‍💻', label: 'DEV Community',  color: '#3B49DF' },
  github:      { icon: '🐙', label: 'GitHub',         color: '#24292F' },
  uficonnect:  { icon: '🌐', label: 'UFIConnect',    color: '#6366F1' },
};

export default function Groups() {
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>Professional Communities & Groups | UFIConnect</title>
        <meta name="description" content="Discover 50+ professional communities on UFIConnect. Join business, creative, education, and industry groups from Reddit, Discord, LinkedIn, and more — all curated by your role and interests." />
        <link rel="canonical" href="https://uficonnect.org/groups" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://uficonnect.org/groups" />
        <meta property="og:title" content="Professional Communities & Groups | UFIConnect" />
        <meta property="og:description" content="Discover professional communities on UFIConnect across business, creative, education, tech, and industry paths." />
        <meta property="og:image" content="https://uficonnect.org/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>
      {GroupsContent()}
    </>
  );
}

function GroupsContent() {
  const navigate = useNavigate();
  const [groups,      setGroups]      = useState([]);
  const [joined,      setJoined]      = useState(new Set());
  const [categories,  setCategories]  = useState([]);
  const [filter,      setFilter]      = useState('all');
  const [search,      setSearch]      = useState('');
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  function loadGroups(bust = false) {
    if (bust) setRefreshing(true); else setLoading(true);
    const groupUrl = bust ? '/groups?bust=1' : '/groups';
    Promise.all([
      client.get(groupUrl),
      client.get('/groups/categories'),
      client.get('/profile'),
    ]).then(([gRes, cRes, pRes]) => {
      setGroups(gRes.data.groups || []);
      setCategories(cRes.data.categories || []);
      setJoined(new Set(pRes.data.joinedGroups || []));
      setLastRefresh(new Date());
    }).catch(console.error).finally(() => { setLoading(false); setRefreshing(false); });
  }

  useEffect(() => { loadGroups(); }, []);

  async function handleJoin(e, groupId) {
    e.stopPropagation();
    const isJoined = joined.has(groupId);
    try {
      if (isJoined) {
        await client.delete(`/groups/${groupId}/join`);
        setJoined((prev) => { const s = new Set(prev); s.delete(groupId); return s; });
        setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, members: g.members - 1 } : g));
      } else {
        await client.post(`/groups/${groupId}/join`);
        setJoined((prev) => new Set([...prev, groupId]));
        setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, members: g.members + 1 } : g));
      }
    } catch (err) { console.error(err); }
  }

  const q = search.trim().toLowerCase();
  const byFilter = filter === 'all' ? groups : groups.filter((g) => g.category === filter);
  const displayed = q
    ? byFilter.filter(g =>
        (g.name || '').toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q) ||
        (g.category || '').toLowerCase().includes(q)
      )
    : byFilter;

  return (
    <Layout>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Discover Groups</h1>
          <p className="page-subtitle">
            Real public communities from Reddit, Discord, LinkedIn, News, and more — follow any to personalise your feed with business, creative, and industry conversations.
            {lastRefresh && (
              <span style={{ marginLeft: 8, fontSize: '.72rem', color: 'var(--muted)' }}>
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => loadGroups(true)}
          disabled={refreshing}
          style={{ marginTop: 4, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>↻</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: 14, position: 'relative', maxWidth: 480 }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: '.9rem', opacity: 0.45, pointerEvents: 'none' }}>🔍</span>
        <input
          className="form-input"
          placeholder="Search groups by name, category, or keyword…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ paddingLeft: 38, borderRadius: 22, padding: '9px 16px 9px 38px', fontSize: '.875rem' }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}
          >×</button>
        )}
      </div>

      {/* Category filter */}
      <div className="filter-bar" style={{ flexWrap: 'wrap' }}>
        <button className={`filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`filter-btn${filter === cat ? ' active' : ''}`}
            onClick={() => setFilter(cat)}
          >
            {CATEGORY_META[cat]?.icon} {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : (
        <>
          <p style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: 12 }}>
            {displayed.length} public communit{displayed.length !== 1 ? 'ies' : 'y'}
          </p>
          <div className="groups-grid">
            {displayed.map((group) => {
              const meta    = CATEGORY_META[group.category] || { icon: '📌', bg: '#F1F5F9', text: '#64748B' };
              const isJoin  = joined.has(group.id);
              const platMeta = group.platform ? PLATFORM_META[group.platform] : null;

              return (
                <div
                  key={group.id}
                  className="card group-card"
                  onClick={() => group.isExternal
                    ? window.open(group.externalUrl, '_blank', 'noopener,noreferrer')
                    : navigate(`/groups/${group.id}`)
                  }
                  style={{ cursor: 'pointer', position: 'relative' }}
                >
                  {/* Origin badge — always shown */}
                  {(() => {
                    const origin = group.isExternal
                      ? (platMeta || PLATFORM_META.uficonnect)
                      : PLATFORM_META.uficonnect;
                    return (
                      <div style={{
                        position: 'absolute', top: 10, right: 10,
                        fontSize: '.65rem', fontWeight: 700,
                        color: origin.color, background: `${origin.color}18`,
                        padding: '2px 7px', borderRadius: 4,
                        display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        {origin.icon} {origin.label}
                      </div>
                    );
                  })()}

                  <div className="group-card-header">
                    <span className="group-icon">{meta.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="group-name" style={{ paddingRight: group.isExternal ? 80 : 0 }}>
                        {group.name}
                      </div>
                      <span
                        className="group-category-badge"
                        style={{ background: meta.bg, color: meta.text }}
                      >
                        {group.category}
                      </span>
                    </div>
                  </div>

                  <p className="group-desc">{group.description}</p>

                  <div className="group-footer">
                    <span className="group-members">
                      👥 {group.members?.toLocaleString()} members
                    </span>
                    {group.isExternal ? (
                      <a
                        href={group.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="btn btn-sm btn-outline"
                        style={{ borderColor: platMeta?.color || 'var(--primary)', color: platMeta?.color || 'var(--primary)' }}
                      >
                        Visit →
                      </a>
                    ) : (
                      <button
                        className={`btn btn-sm${isJoin ? ' btn-ghost' : ' btn-primary'}`}
                        onClick={(e) => handleJoin(e, group.id)}
                      >
                        {isJoin ? 'Joined ✓' : 'Join'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Layout>
  );
}
