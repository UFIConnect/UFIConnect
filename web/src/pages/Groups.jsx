import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
};

export default function Groups() {
  const navigate = useNavigate();
  const [groups,    setGroups]    = useState([]);
  const [joined,    setJoined]    = useState(new Set());
  const [categories, setCategories] = useState([]);
  const [filter,    setFilter]    = useState('all');
  const [loading,   setLoading]   = useState(true);

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

  const displayed = filter === 'all'
    ? groups
    : groups.filter((g) => g.category === filter);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Discover Groups</h1>
        <p className="page-subtitle">Find communities that match your interests and goals.</p>
      </div>

      {/* Category filter */}
      <div className="filter-bar">
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
        <div className="groups-grid">
          {displayed.map((group) => {
            const meta   = CATEGORY_META[group.category] || { icon: '📌', bg: '#F1F5F9', text: '#64748B' };
            const isJoin = joined.has(group.id);
            return (
              <div
                key={group.id}
                className="card group-card"
                onClick={() => navigate(`/groups/${group.id}`)}
              >
                <div className="group-card-header">
                  <span className="group-icon">{meta.icon}</span>
                  <div>
                    <div className="group-name">{group.name}</div>
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
                  <span className="group-members">👥 {group.members?.toLocaleString()} members</span>
                  <button
                    className={`btn btn-sm${isJoin ? ' btn-ghost' : ' btn-primary'}`}
                    onClick={(e) => handleJoin(e, group.id)}
                  >
                    {isJoin ? 'Joined ✓' : 'Join'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
