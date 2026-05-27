import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const PROMPTS = [
  "What are you working on this week?",
  "Share a lesson you learned recently.",
  "What's a tool or resource you'd recommend?",
  "What challenge are you trying to solve?",
  "What insight or win would you like to share?",
  "Ask the community something you've been wondering about.",
  "What's one thing you wish someone had told you earlier?",
  "Share a project you're proud of.",
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
  const [groups,  setGroups]  = useState([]);
  const [groupId, setGroupId] = useState('ufi-general'); // default: General Discussion
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState('');

  const placeholder = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  useEffect(() => {
    client.get('/groups')
      .then(({ data }) => {
        // Show all internal UFIConnect communities (no join required to post)
        const internal = (data.groups || []).filter(g => !g.isExternal);
        setGroups(internal);
        // Auto-select General Discussion if available, else first group
        if (internal.length > 0) {
          const general = internal.find(g => g.id === 'ufi-general');
          setGroupId(general ? general.id : internal[0].id);
        }
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!content.trim()) { setError('Write something before posting.'); return; }
    if (!groupId)         { setError('Select a community to post in.'); return; }
    setError('');
    setLoading(true);
    try {
      await client.post(`/groups/${groupId}/posts`, { content: content.trim() });
      setDone(true);
      setTimeout(() => navigate('/'), 1800);
    } catch {
      setError('Failed to publish. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Layout>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 16 }}>
          <div style={{ fontSize: '3.5rem' }}>✅</div>
          <h2 style={{ margin: 0, fontWeight: 700 }}>Post published!</h2>
          <p style={{ color: 'var(--muted)', margin: 0 }}>Taking you back to your feed…</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Create a Post</h1>
        <p className="page-subtitle">Share an update, question, or idea with your community.</p>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        {/* Author row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="avatar avatar-md" style={{ flexShrink: 0 }}>
            {initials(profile?.name)}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{profile?.name || 'You'}</div>
            <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
              {profile?.preferences?.role || profile?.title || 'UFIConnect Member'}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Community selector — pill buttons */}
          <div className="form-group">
            <label className="form-label">Post to</label>
            {groups.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {groups.map(g => {
                  const sel = groupId === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGroupId(g.id)}
                      style={{
                        padding: '7px 14px', borderRadius: 22, fontSize: '.82rem', fontWeight: sel ? 700 : 500,
                        border: `2px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                        background: sel ? 'var(--primary)' : 'var(--surface)',
                        color: sel ? '#fff' : 'var(--text)',
                        cursor: 'pointer', transition: 'all .18s',
                      }}
                    >
                      {COMMUNITY_ICONS[g.id] || '💬'} {g.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '.82rem', color: 'var(--muted)', padding: '8px 0' }}>
                Loading communities…
              </div>
            )}
          </div>

          {/* Content area */}
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Your post</label>
            <textarea
              className="form-textarea"
              rows={6}
              placeholder={placeholder}
              value={content}
              onChange={e => { setContent(e.target.value); setError(''); }}
              style={{ resize: 'vertical', fontSize: '.93rem', lineHeight: 1.6 }}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <span style={{ fontSize: '.72rem', color: content.length > 1800 ? '#DC2626' : 'var(--muted)' }}>
                {content.length} / 2000
              </span>
            </div>
          </div>

          {error && (
            <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigate(-1)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !content.trim() || !groupId}
              style={{ minWidth: 120 }}
            >
              {loading ? <span className="spinner" /> : '✏️ Publish'}
            </button>
          </div>
        </form>
      </div>

      {/* Prompt inspiration */}
      <div className="card" style={{ maxWidth: 640, marginTop: 14, padding: '14px 18px' }}>
        <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.4px' }}>
          💡 Need inspiration?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PROMPTS.map((p, i) => (
            <button
              key={i}
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ textAlign: 'left', justifyContent: 'flex-start', fontWeight: 400, fontSize: '.82rem' }}
              onClick={() => setContent(prev => prev ? prev : p)}
            >
              → {p}
            </button>
          ))}
        </div>
      </div>
    </Layout>
  );
}
