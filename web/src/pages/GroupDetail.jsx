import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group,   setGroup]   = useState(null);
  const [members, setMembers] = useState([]);
  const [joined,  setJoined]  = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      client.get('/groups'),
      client.get(`/groups/${id}/members`),
      client.get('/profile'),
    ]).then(([gRes, mRes, pRes]) => {
      const found = (gRes.data.groups || []).find((g) => g.id === id);
      setGroup(found || null);
      setMembers(mRes.data.members || []);
      setJoined((pRes.data.joinedGroups || []).includes(id));
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  async function handleJoin() {
    try {
      if (joined) {
        await client.delete(`/groups/${id}/join`);
        setJoined(false);
        setGroup((g) => g ? { ...g, members: g.members - 1 } : g);
      } else {
        await client.post(`/groups/${id}/join`);
        setJoined(true);
        setGroup((g) => g ? { ...g, members: g.members + 1 } : g);
      }
    } catch (err) { console.error(err); }
  }

  if (loading) return <Layout><div style={{ textAlign:'center', padding:48 }}><span className="spinner spinner-primary" /></div></Layout>;
  if (!group)  return <Layout><div className="empty-state"><div className="empty-title">Group not found</div></div></Layout>;

  return (
    <Layout>
      {/* Back */}
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/groups')}>
        ← Back to Groups
      </button>

      {/* Group header */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ fontSize: '2.5rem' }}>📌</div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>{group.name}</h1>
            <p style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: 12 }}>{group.description}</p>
            <div style={{ display: 'flex', gap: 16, fontSize: '.82rem', color: 'var(--muted)' }}>
              <span>👥 {group.members?.toLocaleString()} members</span>
              <span>📂 {group.category}</span>
            </div>
          </div>
          <button className={`btn ${joined ? 'btn-ghost' : 'btn-primary'}`} onClick={handleJoin}>
            {joined ? 'Leave group' : 'Join group'}
          </button>
        </div>
      </div>

      {/* Members */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 16 }}>
          Members ({members.length})
        </h2>
        {members.length === 0 ? (
          <div className="empty-state">
            <div className="empty-desc">No members listed yet.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {members.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="avatar avatar-md">{initials(m.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{m.name}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{m.title}</div>
                </div>
                {m.organization && (
                  <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{m.organization}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
