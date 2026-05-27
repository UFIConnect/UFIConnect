import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const PROMPTS = [
  "What are you working on this week?",
  "Share a lesson you learned recently.",
  "What's a tool or resource you'd recommend?",
  "What insight or win would you like to share?",
  "Ask the community something you've been wondering about.",
  "What's one thing you wish someone had told you earlier?",
];

const COMMUNITY_ICONS = {
  'ufi-general':  '🌐',
  'ufi-tech':     '💻',
  'ufi-business': '🚀',
  'ufi-creative': '🎨',
  'ufi-career':   '💼',
  'ufi-wellness': '🌿',
};

export default function Post() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const textareaRef = useRef(null);

  const [groups,   setGroups]   = useState([]);
  const [groupId,  setGroupId]  = useState('ufi-general');
  const [content,  setContent]  = useState('');
  const [composing, setComposing] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [posted,   setPosted]   = useState(false);
  const [error,    setError]    = useState('');
  const [feed,     setFeed]     = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);

  const placeholder = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  useEffect(() => {
    // Load internal communities
    client.get('/groups')
      .then(({ data }) => {
        const internal = (data.groups || []).filter(g => !g.isExternal);
        setGroups(internal);
        if (internal.length > 0) {
          const gen = internal.find(g => g.id === 'ufi-general');
          setGroupId(gen ? gen.id : internal[0].id);
        }
      })
      .catch(() => {});

    // Load recent community posts from the main feed (internal only)
    setFeedLoading(true);
    client.get('/feed')
      .then(({ data }) => {
        const internalPosts = (data.posts || []).filter(p => p.source === 'uficonnect');
        setFeed(internalPosts.slice(0, 20));
      })
      .catch(() => {})
      .finally(() => setFeedLoading(false));
  }, [posted]);

  function openCompose() {
    setComposing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!content.trim()) { setError('Write something before posting.'); return; }
    if (!groupId)         { setError('Select a community to post in.'); return; }
    setError('');
    setLoading(true);
    try {
      await client.post(`/groups/${groupId}/posts`, { content: content.trim() });
      setContent('');
      setComposing(false);
      setPosted(p => !p); // trigger feed reload
    } catch {
      setError('Failed to publish. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const selectedGroup = groups.find(g => g.id === groupId);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Community</h1>
        <p className="page-subtitle">See what the UFIConnect community is sharing — and add your voice.</p>
      </div>

      {/* ── Compose card ── */}
      <div className="card" style={{ maxWidth: 640, marginBottom: 16 }}>
        {!composing ? (
          /* Collapsed — click to open */
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'text' }}
            onClick={openCompose}
          >
            <div className="avatar avatar-md" style={{ flexShrink: 0 }}>
              {initials(profile?.name)}
            </div>
            <div
              style={{
                flex: 1, padding: '10px 16px', borderRadius: 22,
                border: '1.5px solid var(--border)', background: 'var(--surface)',
                color: 'var(--muted)', fontSize: '.9rem',
              }}
            >
              {placeholder}
            </div>
            <button className="btn btn-primary btn-sm" style={{ borderRadius: 20, minWidth: 80 }}>
              ✏️ Post
            </button>
          </div>
        ) : (
          /* Expanded compose form */
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div className="avatar avatar-md" style={{ flexShrink: 0, marginTop: 4 }}>
                {initials(profile?.name)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '.85rem', marginBottom: 2 }}>{profile?.name || 'You'}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
                  {profile?.preferences?.role || profile?.title || 'UFIConnect Member'}
                </div>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              className="form-textarea"
              rows={4}
              placeholder={placeholder}
              value={content}
              onChange={e => { setContent(e.target.value); setError(''); }}
              style={{ resize: 'vertical', fontSize: '.93rem', lineHeight: 1.6, marginBottom: 10 }}
            />

            {/* Community pills */}
            {groups.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: '.73rem', color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>Post to:</span>
                {groups.map(g => {
                  const sel = groupId === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGroupId(g.id)}
                      style={{
                        padding: '4px 12px', borderRadius: 16, fontSize: '.78rem', fontWeight: sel ? 700 : 500,
                        border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                        background: sel ? 'var(--primary)' : 'var(--surface)',
                        color: sel ? '#fff' : 'var(--text)', cursor: 'pointer',
                      }}
                    >
                      {COMMUNITY_ICONS[g.id] || '💬'} {g.name}
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '.72rem', color: content.length > 1800 ? '#DC2626' : 'var(--muted)' }}>
                {content.length} / 2000
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setComposing(false); setContent(''); setError(''); }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={loading || !content.trim() || !groupId}
                  style={{ minWidth: 90 }}
                >
                  {loading ? <span className="spinner" /> : '✏️ Publish'}
                </button>
              </div>
            </div>
            {error && <div className="auth-error" style={{ marginTop: 8 }}>{error}</div>}
          </form>
        )}
      </div>

      {/* ── Community feed ── */}
      <div style={{ maxWidth: 640 }}>
        {feedLoading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading posts…</div>
        ) : feed.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✍️</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Nothing here yet</div>
            <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: '0 0 16px' }}>
              Be the first to post to the UFIConnect community.
            </p>
            <button className="btn btn-primary btn-sm" onClick={openCompose}>Write a post →</button>
          </div>
        ) : (
          feed.map(post => (
            <div key={post.id} className="card post-card" style={{ marginBottom: 12 }}>
              {/* Author row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div className="avatar avatar-sm">{initials(post.author?.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '.85rem' }}>{post.author?.name || 'Member'}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>
                    {post.author?.title || ''}{post.group ? ` · ${post.group.name}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: '.7rem', color: 'var(--muted)' }}>{timeAgo(post.createdAt)}</span>
              </div>

              {/* Content */}
              <p style={{ margin: '0 0 10px', fontSize: '.9rem', lineHeight: 1.6, color: 'var(--text)' }}>
                {post.content}
              </p>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
                  🤍 {post.likesCount || 0}
                </span>
                <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
                  💬 {post.commentsCount || 0}
                </span>
                {post.group && (
                  <span style={{
                    fontSize: '.72rem', fontWeight: 600, marginLeft: 'auto',
                    color: 'var(--primary)', background: 'var(--primary-light)',
                    padding: '2px 8px', borderRadius: 10,
                  }}>
                    {COMMUNITY_ICONS[post.group.id] || '💬'} {post.group.name}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}
