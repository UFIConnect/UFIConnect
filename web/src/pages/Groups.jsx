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
      </Helmet>
      {GroupsContent()}
    </>
  );
}

function GroupsContent() {
  const navigate = useNavigate();
  const [groups,     setGroups]     = useState([]);
  const [joined,     setJoined]     = useState(new Set());
  const [categories, setCategories] = useState([]);
  const [filter,     setFilter]     = useState('all');
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    Promise.all([
      client.get('/groups'),
      client.get('/groups/categories'),
      client.get('/profile'),
    ]).then(([gRes, cRes, pRes]) => {
      setGroups(gRes.data.groups || []);
      setCategories(cRes.data.categories || []);
      setJoined(new Set(pRes.data.joinedGroups || []));
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

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

  const displayed = filter === 'all' ? groups : groups.filter((g) => g.category === filter);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Discover Groups</h1>
        <p className="page-subtitle">
          Real public communities from Reddit, Discord, LinkedIn, News, and more — follow any to personalise your feed with business, creative, and industry conversations.
        </p>
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
