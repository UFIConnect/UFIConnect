import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PostList from '../components/PostList';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [group,   setGroup]   = useState(null);
  const [members, setMembers] = useState([]);
  const [joined,  setJoined]  = useState(false);
  const [loading, setLoading] = useState(true);

  const [groupPosts,    setGroupPosts]    = useState([]);
  const [postsLoading,  setPostsLoading]  = useState(true);
  const [composing,     setComposing]     = useState(false);
  const [content,       setContent]       = useState('');
  const [posting,       setPosting]       = useState(false);
  const [postError,     setPostError]     = useState('');
  const textareaRef = useRef(null);

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

  function loadGroupPosts(opts = {}) {
    if (!opts.silent) setPostsLoading(true);
    client.get(`/groups/${id}/posts`)
      .then(({ data }) => setGroupPosts(data.posts || []))
      .catch(() => setGroupPosts([]))
      .finally(() => setPostsLoading(false));
  }

  useEffect(() => { loadGroupPosts(); }, [id]); // eslint-disable-line

  // Scrolling back up to the top acts as pull-to-refresh, same as every
  // other list page on the site.
  useScrollToRefresh(() => loadGroupPosts({ silent: true }), { enabled: !postsLoading });

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

  function openCompose() {
    setComposing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function handlePost(e) {
    e.preventDefault();
    if (!content.trim()) { setPostError('Write something before posting.'); return; }
    setPostError('');
    setPosting(true);
    try {
      const { data } = await client.post(`/groups/${id}/posts`, { content: content.trim() });
      setGroupPosts((prev) => [data.post, ...prev]);
      setContent('');
      setComposing(false);
    } catch (err) {
      setPostError(err.response?.data?.message || 'Failed to publish. Please try again.');
    } finally {
      setPosting(false);
    }
  }

  if (loading) return <Layout><div style={{ textAlign:'center', padding:48 }}><span className="spinner spinner-primary" /></div></Layout>;
  if (!group)  return <Layout><div className="empty-state"><div className="empty-title">Group not found</div></div></Layout>;

  return (
    <Layout>
      {/* Back */}
      <button className="btn-back" style={{ marginBottom: 16 }} onClick={() => navigate('/groups')}>
        <span className="btn-back-icon">‹</span> Back to Groups
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

      {/* Post composer — only for joined members */}
      {joined && (
        <div className="card" style={{ marginBottom: 16 }}>
          {!composing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'text' }} onClick={openCompose}>
              <div className="avatar avatar-md" style={{ flexShrink: 0 }}>{initials(profile?.name)}</div>
              <div style={{
                flex: 1, padding: '10px 16px', borderRadius: 22,
                border: '1.5px solid var(--border)', background: 'var(--surface)',
                color: 'var(--muted)', fontSize: '.9rem',
              }}>
                Share something with {group.name}…
              </div>
              <button className="btn btn-primary btn-sm" style={{ minWidth: 80 }}>
                ✏️ Post
              </button>
            </div>
          ) : (
            <form onSubmit={handlePost}>
              <textarea
                ref={textareaRef}
                className="form-textarea"
                rows={4}
                placeholder={`Share something with ${group.name}…`}
                value={content}
                onChange={(e) => { setContent(e.target.value); setPostError(''); }}
                style={{ resize: 'vertical', fontSize: '.93rem', lineHeight: 1.6, marginBottom: 10 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '.72rem', color: content.length > 1800 ? '#DC2626' : 'var(--muted)' }}>
                  {content.length} / 2000
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setComposing(false); setContent(''); setPostError(''); }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={posting || !content.trim()} style={{ minWidth: 90 }}>
                    {posting ? <span className="spinner" /> : '✏️ Publish'}
                  </button>
                </div>
              </div>
              {postError && <div className="auth-error" style={{ marginTop: 8 }}>{postError}</div>}
            </form>
          )}
        </div>
      )}

      {/* Group posts */}
      <div style={{ marginBottom: 16 }}>
        <PostList
          posts={groupPosts}
          loading={postsLoading}
          emptyTitle="No posts yet"
          emptyDesc={joined ? 'Be the first to post in this group.' : 'Join the group to start the conversation.'}
          emptyAction={joined ? <button className="btn btn-primary btn-sm" onClick={openCompose}>Write a post</button> : null}
          currentUserId={profile?.id}
          onPostDeleted={(id) => setGroupPosts((prev) => prev.filter((p) => p.id !== id))}
        />
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
              <div
                key={m.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                onClick={() => navigate(m.id === profile?.id ? '/profile' : `/u/${m.id}`)}
              >
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
