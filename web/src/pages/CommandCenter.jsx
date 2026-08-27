import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import PricingModal from '../components/PricingModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import client from '../api/client';
import { SOURCE_META, CONNECTED_SOCIAL_PLATFORMS } from '../components/sourceMeta';

// Platforms with a real, working "my own posts" fetcher server-side (see
// OWN_CONTENT_FETCHERS in backend/index.js) — the rest of
// CONNECTED_SOCIAL_PLATFORMS render as "Coming soon" in Your Feed instead,
// same honesty convention the rest of this app already uses for platforms
// pending API/app-review access.
const OWN_CONTENT_PLATFORMS = ['github', 'gitlab', 'youtube', 'reddit', 'twitch', 'bluesky'];
// Platforms with a real, working publish-on-your-behalf API (see
// REAL_PUBLISH_PLATFORMS server-side) — every other connected platform can
// still be selected in Cross-Post, it just gets queued instead of posted.
const REAL_PUBLISH_PLATFORMS = ['bluesky', 'reddit'];

const SECTIONS = [
  { key: 'feed',      label: 'Connected Feed', icon: '📡' },
  { key: 'content',   label: 'AI Content Hub', icon: '✨' },
  { key: 'yourfeed',  label: 'Your Feed',      icon: '🗂️' },
  { key: 'jobs',      label: 'Job Tracker',    icon: '💼' },
  { key: 'crosspost', label: 'Cross-Post',     icon: '📤' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function StatChip({ label, value }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 16px', minWidth: 96 }}>
      <div style={{ fontSize: '1.3rem', fontWeight: 800, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '.68rem', color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
    </div>
  );
}

function LockedState({ onUpgrade }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '52px 24px' }}>
      <div style={{ fontSize: '2.4rem', marginBottom: 12 }}>🧭</div>
      <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 8px' }}>Unlock the Command Center</h2>
      <p style={{ color: 'var(--muted)', fontSize: '.88rem', maxWidth: 440, margin: '0 auto 22px', lineHeight: 1.6 }}>
        See everything from your connected accounts in one place, draft social
        content with AI, and track your job search — all with a Pro or
        Business plan.
      </p>
      <button className="btn btn-primary" type="button" onClick={onUpgrade}>Upgrade to unlock →</button>
    </div>
  );
}

function PostRow({ post, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="card"
      type="button"
      style={{
        display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left', width: '100%',
        cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--card)', padding: 14,
      }}
    >
      {post.mediaUrl && post.mediaType === 'image' ? (
        <img src={post.mediaUrl} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 52, height: 52, borderRadius: 8, flexShrink: 0, background: 'var(--bg-secondary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem',
        }}>
          {post.mediaType === 'video' ? '🎬' : '📝'}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 700, fontSize: '.85rem', overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {post.title || post.content?.slice(0, 80) || 'Untitled post'}
        </div>
        <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 4 }}>
          {post.author?.name || post.sourceLabel} · {timeAgo(post.createdAt)}
        </div>
      </div>
    </button>
  );
}

function PostDetailModal({ post, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: '.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px' }}>
            {post.sourceLabel || post.source}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ all: 'unset', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--muted)' }}>✕</button>
        </div>
        {post.mediaUrl && post.mediaType === 'image' && (
          <img src={post.mediaUrl} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 12, maxHeight: 280, objectFit: 'cover' }} />
        )}
        <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', lineHeight: 1.4 }}>{post.title}</h3>
        {post.content && post.content !== post.title && (
          <p style={{ fontSize: '.85rem', lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{post.content}</p>
        )}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '.78rem', color: 'var(--muted)', margin: '12px 0' }}>
          {post.author?.name && <span>👤 {post.author.name}</span>}
          <span>🕒 {timeAgo(post.createdAt)}</span>
          {post.likesCount > 0 && <span>❤️ {post.likesCount}</span>}
          {post.commentsCount > 0 && <span>💬 {post.commentsCount}</span>}
        </div>
        {post.sourceUrl && (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>
            View original post ↗
          </a>
        )}
      </div>
    </div>
  );
}

// Reuses /office/feed?mode=following directly (the same Following pool the
// Feed page's own Following tab reads) rather than a new endpoint — the
// only thing this section adds is grouping the response by source and a
// detail view, no new server-side data shape needed.
function ConnectedFeedSection() {
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(false);
  const [activePost, setActivePost] = useState(null);
  const [sourceFilter, setSourceFilter] = useState(null);

  useEffect(() => {
    let cancelled = false;
    client.get('/office/feed', { params: { mode: 'following', limit: 60, sort: 'newest', seed: 'command-center' } })
      .then(({ data }) => { if (!cancelled) setPosts((data.posts || []).filter(p => p?.id)); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  if (posts === null && !error) return <div className="empty-state"><span className="spinner spinner-primary" /></div>;
  if (error) return <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>Couldn't load your connected feed.</div>;
  if (!posts.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>👥</div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Nothing here yet</div>
        <div style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Follow people or connect an account to see their posts here.</div>
      </div>
    );
  }

  const bySource = new Map();
  for (const p of posts) {
    const src = p.source || 'uficonnect';
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(p);
  }
  const sources = [...bySource.keys()].sort((a, b) => bySource.get(b).length - bySource.get(a).length);
  const visibleSources = sourceFilter ? [sourceFilter] : sources;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <StatChip label="Posts" value={posts.length} />
        <StatChip label="Sources" value={sources.length} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button
          type="button" onClick={() => setSourceFilter(null)}
          className="btn btn-sm"
          style={{ background: !sourceFilter ? 'var(--primary)' : 'var(--bg-secondary)', color: !sourceFilter ? '#fff' : 'var(--text)', border: 'none' }}
        >
          All
        </button>
        {sources.map(src => {
          const meta = SOURCE_META[src] || SOURCE_META.uficonnect;
          const active = sourceFilter === src;
          return (
            <button
              key={src} type="button" onClick={() => setSourceFilter(active ? null : src)}
              className="btn btn-sm"
              style={{ background: active ? 'var(--primary)' : 'var(--bg-secondary)', color: active ? '#fff' : 'var(--text)', border: 'none' }}
            >
              {meta.icon} {meta.label} · {bySource.get(src).length}
            </button>
          );
        })}
      </div>

      {visibleSources.map(src => {
        const meta = SOURCE_META[src] || SOURCE_META.uficonnect;
        return (
          <div key={src} style={{ marginBottom: 26 }}>
            <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
              {meta.icon} {meta.label} <span style={{ fontWeight: 500 }}>· {bySource.get(src).length}</span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {bySource.get(src).map((p, i) => (
                <PostRow key={`${p.id}-${i}`} post={p} onOpen={() => setActivePost(p)} />
              ))}
            </div>
          </div>
        );
      })}

      {activePost && <PostDetailModal post={activePost} onClose={() => setActivePost(null)} />}
    </div>
  );
}

const DRAFT_PLATFORMS = [
  { value: 'tiktok',    label: 'TikTok',      icon: '🎵' },
  { value: 'instagram', label: 'Instagram',   icon: '📸' },
  { value: 'linkedin',  label: 'LinkedIn',    icon: '💼' },
  { value: 'twitter',   label: 'X / Twitter', icon: '𝕏' },
  { value: 'threads',   label: 'Threads',     icon: '🧵' },
  { value: 'general',   label: 'General',     icon: '🌐' },
];

// AI drafting only — the member still posts it themselves on the platform's
// own app. There's no real publish-on-their-behalf API this app can reach
// for TikTok or Instagram (business/creator app review neither has been
// through), so this deliberately doesn't pretend to auto-post.
function ContentHubSection() {
  const { showToast } = useToast();
  const [platform, setPlatform] = useState('tiktok');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState(null);
  const [notConfigured, setNotConfigured] = useState(false);

  async function handleDraft(e) {
    e.preventDefault();
    if (!topic.trim() || drafting) return;
    setDrafting(true);
    setDrafts(null);
    setNotConfigured(false);
    try {
      const { data } = await client.post('/command-center/content-draft', { platform, topic, tone });
      setDrafts(data.drafts || []);
    } catch (err) {
      if (err?.response?.status === 503) setNotConfigured(true);
      else showToast(err?.response?.data?.message || 'Could not generate drafts. Please try again.', 'error');
    } finally {
      setDrafting(false);
    }
  }

  function copyDraft(text) {
    navigator.clipboard?.writeText(text)
      .then(() => showToast('Copied to clipboard', 'success'))
      .catch(() => showToast('Could not copy — select and copy manually.', 'error'));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="card">
        <h3 style={{ margin: '0 0 4px', fontSize: '.95rem' }}>✨ Draft new content</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: 0 }}>
          AI-drafted captions for the platform you post to — copy, tweak, and post it yourself.
        </p>
        <form onSubmit={handleDraft} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <div>
            <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>Platform</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DRAFT_PLATFORMS.map(p => (
                <button
                  key={p.value} type="button" onClick={() => setPlatform(p.value)}
                  className="btn btn-sm"
                  style={{ background: platform === p.value ? 'var(--primary)' : 'var(--bg-secondary)', color: platform === p.value ? '#fff' : 'var(--text)', border: 'none' }}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>What's the post about?</label>
            <textarea
              value={topic} onChange={e => setTopic(e.target.value)} rows={3}
              placeholder="e.g. Launching my new side project, a productivity app for freelancers"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Tone (optional)</label>
            <input
              value={tone} onChange={e => setTone(e.target.value)}
              placeholder="e.g. playful, professional, bold"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem' }}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={drafting || !topic.trim()} style={{ alignSelf: 'flex-start' }}>
            {drafting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Draft with AI ✨'}
          </button>
        </form>
      </div>

      {notConfigured && (
        <div className="card" style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: '.85rem' }}>
          AI content drafting isn't configured yet — check back soon.
        </div>
      )}

      {drafts && drafts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {drafts.map((d, i) => (
            <div key={i} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '.86rem', lineHeight: 1.6, flex: 1 }}>{d}</p>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => copyDraft(d)} style={{ flexShrink: 0 }}>📋 Copy</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Content review/download, sectioned by platform — distinct from Connected
// Feed above (which shows the Following pool, i.e. OTHER people's posts).
// This is the member's OWN posts on each connected platform, for reviewing
// or pulling a copy of their own content. Only ever lists platforms the
// member has actually connected (see ConnectedAccounts.jsx for that flow).
function YourFeedSection() {
  const { showToast } = useToast();
  const [connected, setConnected] = useState(null);
  const [activePlatform, setActivePlatform] = useState(null);
  const [posts, setPosts] = useState(null);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postsError, setPostsError] = useState(false);

  useEffect(() => {
    client.get('/social/platforms').then(({ data }) => setConnected(data.connected || {})).catch(() => setConnected({}));
  }, []);

  function openPlatform(platform) {
    setActivePlatform(platform);
    setPosts(null);
    setPostsError(false);
    setLoadingPosts(true);
    client.get('/command-center/your-content', { params: { platform } })
      .then(({ data }) => setPosts(data.posts || []))
      .catch(() => setPostsError(true))
      .finally(() => setLoadingPosts(false));
  }

  async function downloadText(post) {
    const blob = new Blob([JSON.stringify({ title: post.title, content: post.content, sourceUrl: post.sourceUrl, createdAt: post.createdAt }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${post.id || 'post'}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadImage(post) {
    try {
      const { data } = await client.get('/command-center/your-content/download', {
        params: { url: post.mediaUrl, platform: activePlatform }, responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url; a.download = `${post.id || 'image'}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Could not download that file.', 'error');
    }
  }

  if (connected === null) return <div className="empty-state"><span className="spinner spinner-primary" /></div>;

  const connectedPlatforms = CONNECTED_SOCIAL_PLATFORMS.filter(p => connected[p]);

  if (!connectedPlatforms.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>🔗</div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>No connected accounts yet</div>
        <div style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: 16 }}>Connect a platform to review and download your own posts from it here.</div>
        <Link to="/connected-accounts" className="btn btn-primary btn-sm">Connect an account →</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {connectedPlatforms.map(p => {
          const meta = SOURCE_META[p] || SOURCE_META.uficonnect;
          const supported = OWN_CONTENT_PLATFORMS.includes(p);
          const active = activePlatform === p;
          return (
            <button
              key={p} type="button" disabled={!supported}
              onClick={() => openPlatform(p)}
              className="btn btn-sm"
              style={{
                background: active ? 'var(--primary)' : 'var(--bg-secondary)',
                color: active ? '#fff' : (supported ? 'var(--text)' : 'var(--muted)'),
                border: 'none', opacity: supported ? 1 : 0.6,
              }}
              title={supported ? undefined : 'Coming soon — pending platform API approval'}
            >
              {meta.icon} {meta.label}{!supported && ' · Coming soon'}
            </button>
          );
        })}
      </div>

      {!activePlatform && (
        <div className="card" style={{ textAlign: 'center', padding: 28, color: 'var(--muted)', fontSize: '.85rem' }}>
          Pick a platform above to see your own posts there.
        </div>
      )}

      {activePlatform && loadingPosts && <div className="empty-state"><span className="spinner spinner-primary" /></div>}
      {activePlatform && !loadingPosts && postsError && (
        <div className="card" style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Couldn't load your {activePlatform} content.</div>
      )}
      {activePlatform && !loadingPosts && !postsError && posts && !posts.length && (
        <div className="card" style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Nothing found yet.</div>
      )}
      {activePlatform && !loadingPosts && posts && posts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {posts.map(post => (
            <div key={post.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {post.mediaType === 'image' && post.mediaUrl && (
                <img src={post.mediaUrl} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.title}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 4 }}>{timeAgo(post.createdAt)}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText(post)}>📋 Text</button>
                {post.mediaType === 'image' && post.mediaUrl && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadImage(post)}>🖼 Image</button>
                )}
                {post.mediaType === 'video_thumbnail_only' && post.sourceUrl && (
                  <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">▶ View original ↗</a>
                )}
                {!post.mediaType && post.sourceUrl && (
                  <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">View ↗</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const JOB_STATUSES = ['saved', 'applied', 'viewed'];

// Tracking only — the member sets their own status, nothing here submits an
// application automatically. matchScore/matchReasons come straight from
// /opportunities' own existing resume-match scoring, not recomputed here.
function JobTrackerSection() {
  const { showToast } = useToast();
  const [opportunities, setOpportunities] = useState(null);
  const [tracked, setTracked] = useState({});
  const [error, setError] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // bust=1 mirrors Opportunities.jsx's own manual-refresh param — without
  // it this would just re-read the server-side listings cache and never
  // actually show anything new.
  const loadAll = useCallback((bust = false) => {
    setError(false);
    Promise.all([client.get('/opportunities', { params: bust ? { bust: 1 } : {} }), client.get('/jobs/tracking')])
      .then(([oppRes, trackRes]) => {
        setOpportunities((oppRes.data.opportunities || []).filter(o => o?.id));
        const map = {};
        for (const j of (trackRes.data.jobs || [])) map[j.id] = j;
        setTracked(map);
      })
      .catch(() => setError(true))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  function handleRefresh() {
    setRefreshing(true);
    loadAll(true);
  }

  async function setStatus(job, status) {
    setSavingId(job.id);
    try {
      await client.post('/jobs/tracking', {
        jobId: job.id, status, title: job.title, org: job.org,
        source: job.source, sourceUrl: job.sourceUrl, matchScore: job.matchScore,
      });
      setTracked(prev => ({ ...prev, [job.id]: { ...prev[job.id], id: job.id, status } }));
    } catch {
      showToast('Could not update.', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function untrack(jobId) {
    setSavingId(jobId);
    try {
      await client.delete(`/jobs/tracking/${encodeURIComponent(jobId)}`);
      setTracked(prev => { const next = { ...prev }; delete next[jobId]; return next; });
    } catch {
      showToast('Could not remove.', 'error');
    } finally {
      setSavingId(null);
    }
  }

  if (opportunities === null && !error) return <div className="empty-state"><span className="spinner spinner-primary" /></div>;
  if (error) return <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>Couldn't load listings.</div>;

  const sorted = [...opportunities].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  const trackedValues = Object.values(tracked);
  const savedCount = trackedValues.filter(t => t.status === 'saved').length;
  const appliedCount = trackedValues.filter(t => t.status === 'applied').length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <StatChip label="Listings" value={sorted.length} />
        <StatChip label="Saved" value={savedCount} />
        <StatChip label="Applied" value={appliedCount} />
        <button
          type="button" onClick={handleRefresh} disabled={refreshing}
          className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
        >
          {refreshing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '🔄 Refresh'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sorted.map(job => {
          const t = tracked[job.id];
          const strong = Number.isFinite(job.matchScore) && job.matchScore >= 15;
          return (
            <div key={job.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: '.88rem' }}>{job.title}</div>
                <div style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: 2 }}>
                  {job.org}{job.location ? ` · ${job.location}` : ''}
                </div>
              </div>
              {Number.isFinite(job.matchScore) && (
                <span style={{
                  fontSize: '.68rem', fontWeight: 800, whiteSpace: 'nowrap',
                  color: strong ? '#059669' : 'var(--muted)',
                  background: strong ? '#ECFDF5' : 'var(--bg-secondary)',
                  padding: '3px 9px', borderRadius: 10,
                }}>
                  {strong ? '✓ Strong match' : `Match ${job.matchScore}`}
                </span>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {JOB_STATUSES.map(s => (
                  <button
                    key={s} type="button" disabled={savingId === job.id}
                    onClick={() => (t?.status === s ? untrack(job.id) : setStatus(job, s))}
                    className="btn btn-sm"
                    style={{
                      background: t?.status === s ? 'var(--primary)' : 'var(--bg-secondary)',
                      color: t?.status === s ? '#fff' : 'var(--text)',
                      border: 'none', textTransform: 'capitalize',
                    }}
                  >
                    {t?.status === s ? '✓ ' : ''}{s}
                  </button>
                ))}
              </div>
              {job.sourceUrl && (
                <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">View →</a>
              )}
            </div>
          );
        })}
        {!sorted.length && (
          <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
            No listings available right now — check back soon.
          </div>
        )}
      </div>
    </div>
  );
}

const PLATFORM_RESULT_META = {
  posted: { icon: '✅', label: 'Posted' },
  queued: { icon: '🕒', label: 'Queued — pending platform approval' },
  failed: { icon: '❌', label: 'Failed' },
};

// Real publishing only for Bluesky/Reddit (see REAL_PUBLISH_PLATFORMS both
// here and server-side) — every other selected platform comes back
// 'queued', never silently marked as posted. connectedPlatforms comes from
// the same /social/platforms the other sections already call.
function CrossPostSection() {
  const { showToast } = useToast();
  const [connected, setConnected] = useState(null);
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [posting, setPosting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    client.get('/social/platforms').then(({ data }) => setConnected(data.connected || {})).catch(() => setConnected({}));
    client.get('/command-center/cross-post/history').then(({ data }) => setHistory(data.posts || [])).catch(() => setHistory([]));
  }, []);

  function toggle(platform) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform); else next.add(platform);
      return next;
    });
  }

  async function handlePost(e) {
    e.preventDefault();
    if (!content.trim() || !selected.size || posting) return;
    setPosting(true);
    setLastResult(null);
    try {
      const { data } = await client.post('/command-center/cross-post', { content: content.trim(), platforms: [...selected] });
      setLastResult(data.targets || []);
      setHistory(prev => [{ id: data.id, content: content.trim(), targets: data.targets, createdAt: new Date().toISOString() }, ...(prev || [])]);
      setContent('');
      setSelected(new Set());
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not send your post. Please try again.', 'error');
    } finally {
      setPosting(false);
    }
  }

  if (connected === null) return <div className="empty-state"><span className="spinner spinner-primary" /></div>;
  const connectedPlatforms = CONNECTED_SOCIAL_PLATFORMS.filter(p => connected[p]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="card">
        <h3 style={{ margin: '0 0 4px', fontSize: '.95rem' }}>📤 Post to multiple platforms</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: 0 }}>
          Bluesky and Reddit post for real. Every other platform saves your post as queued until its publishing API is available.
        </p>
        {!connectedPlatforms.length ? (
          <div style={{ marginTop: 16 }}>
            <Link to="/connected-accounts" className="btn btn-primary btn-sm">Connect an account →</Link>
          </div>
        ) : (
          <form onSubmit={handlePost} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
            <textarea
              value={content} onChange={e => setContent(e.target.value)} rows={4}
              placeholder="What do you want to share?"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', resize: 'vertical' }}
            />
            <div>
              <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>Send to</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {connectedPlatforms.map(p => {
                  const meta = SOURCE_META[p] || SOURCE_META.uficonnect;
                  const active = selected.has(p);
                  const real = REAL_PUBLISH_PLATFORMS.includes(p);
                  return (
                    <button
                      key={p} type="button" onClick={() => toggle(p)}
                      className="btn btn-sm"
                      style={{ background: active ? 'var(--primary)' : 'var(--bg-secondary)', color: active ? '#fff' : 'var(--text)', border: 'none' }}
                    >
                      {meta.icon} {meta.label}{!real && ' · queued'}
                    </button>
                  );
                })}
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={posting || !content.trim() || !selected.size} style={{ alignSelf: 'flex-start' }}>
              {posting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Send'}
            </button>
          </form>
        )}
      </div>

      {lastResult && (
        <div className="card">
          <h3 style={{ margin: '0 0 10px', fontSize: '.85rem' }}>Result</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lastResult.map(t => {
              const meta = SOURCE_META[t.platform] || SOURCE_META.uficonnect;
              const resultMeta = PLATFORM_RESULT_META[t.status] || PLATFORM_RESULT_META.failed;
              return (
                <div key={t.platform} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.85rem' }}>
                  <span>{resultMeta.icon}</span>
                  <span style={{ fontWeight: 600 }}>{meta.icon} {meta.label}</span>
                  <span style={{ color: 'var(--muted)' }}>
                    {t.status === 'posted' && t.postedUrl ? <a href={t.postedUrl} target="_blank" rel="noopener noreferrer">View post ↗</a> : (t.error || resultMeta.label)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {history && history.length > 0 && (
        <div>
          <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>History</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map(h => (
              <div key={h.id} className="card">
                <p style={{ margin: '0 0 8px', fontSize: '.85rem', whiteSpace: 'pre-wrap' }}>{h.content}</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '.72rem', color: 'var(--muted)' }}>
                  {(h.targets || []).map(t => (
                    <span key={t.platform}>{(PLATFORM_RESULT_META[t.status] || {}).icon} {(SOURCE_META[t.platform] || {}).label || t.platform}</span>
                  ))}
                  <span>· {timeAgo(h.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommandCenter() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [section, setSection] = useState('feed');
  const [pricingOpen, setPricingOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(null);

  async function handleUpgrade(tier) {
    setUpgrading(tier);
    try {
      const { data } = await client.post('/billing/create-checkout-session', { tier });
      window.location.href = data.url;
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not start checkout. Please try again.', 'error');
      setUpgrading(null);
    }
  }

  if (!profile) {
    return <Layout><div className="empty-state"><span className="spinner spinner-primary" /></div></Layout>;
  }

  const locked = profile.plan === 'free';

  return (
    <Layout>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          🧭 Command Center
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem', margin: '4px 0 0' }}>
          Every connected account, organized. AI drafts. Job tracking.
        </p>
      </div>

      {locked ? (
        <LockedState onUpgrade={() => setPricingOpen(true)} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 22, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
            {SECTIONS.map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                style={{
                  padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  fontWeight: section === s.key ? 700 : 500,
                  color: section === s.key ? 'var(--primary)' : 'var(--muted)',
                  borderBottom: section === s.key ? '2px solid var(--primary)' : '2px solid transparent',
                  fontSize: '.875rem', marginBottom: '-1px', transition: 'all .15s',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {s.icon} {s.label}
              </button>
            ))}
          </div>

          {section === 'feed' && <ConnectedFeedSection />}
          {section === 'content' && <ContentHubSection />}
          {section === 'yourfeed' && <YourFeedSection />}
          {section === 'jobs' && <JobTrackerSection />}
          {section === 'crosspost' && <CrossPostSection />}
        </>
      )}

      {pricingOpen && (
        <PricingModal
          loadingTier={upgrading}
          onClose={() => setPricingOpen(false)}
          onSelectTier={handleUpgrade}
        />
      )}
    </Layout>
  );
}
