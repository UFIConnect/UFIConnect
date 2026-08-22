import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import FollowListModal from '../components/FollowListModal';
import PostList from '../components/PostList';
import client from '../api/client';
import { useToast } from '../contexts/ToastContext';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const ROLE_META = {
  'Engineer / Developer':    { icon: '💻', color: '#2563EB', bg: '#EFF6FF' },
  'Designer / Creative':     { icon: '🎨', color: '#7C3AED', bg: '#F3EEFF' },
  'Product Manager':         { icon: '📋', color: '#0284C7', bg: '#F0F9FF' },
  'Marketer / Growth':       { icon: '📈', color: '#059669', bg: '#ECFDF5' },
  'Founder / Entrepreneur':  { icon: '🚀', color: '#D97706', bg: '#FFFBEB' },
  'Investor / VC':           { icon: '💰', color: '#DB2777', bg: '#FDF2F8' },
  'Data / Analytics':        { icon: '📊', color: '#EA580C', bg: '#FFF7ED' },
  'Student / Learner':       { icon: '🎓', color: '#7C3AED', bg: '#F3EEFF' },
  'Sales / Business Dev':    { icon: '🤝', color: '#2563EB', bg: '#EFF6FF' },
  'Operations / Finance':    { icon: '⚙️', color: '#059669', bg: '#ECFDF5' },
  'Content Creator':         { icon: '🎬', color: '#D97706', bg: '#FFFBEB' },
  'Community Manager':       { icon: '🌐', color: '#0284C7', bg: '#F0F9FF' },
  'Researcher / Academic':   { icon: '🔬', color: '#7C3AED', bg: '#F3EEFF' },
  'HR / People Ops':         { icon: '👥', color: '#DB2777', bg: '#FDF2F8' },
};

const LINK_ICONS = {
  linkedin:  { icon: '🔷', label: 'LinkedIn' },
  github:    { icon: '🐙', label: 'GitHub' },
  gitlab:    { icon: 'GL', label: 'GitLab' },
  portfolio: { icon: '🌐', label: 'Portfolio' },
  resume:    { icon: '📄', label: 'Resume' },
  twitter:   { icon: '🐦', label: 'X / Twitter' },
  other:     { icon: '🔗', label: 'Link' },
};

// Role-specific fields to display on public profile
const ROLE_PUBLIC_FIELDS = {
  'Engineer / Developer':   ['primaryStack', 'preferredRole', 'yearsExp'],
  'Designer / Creative':    ['designTools', 'specialization', 'portfolioUrl'],
  'Product Manager':        ['domain', 'methodology', 'teamSize'],
  'Marketer / Growth':      ['channels', 'tools', 'industryFocus'],
  'Founder / Entrepreneur': ['companyName', 'stage', 'industryFocus', 'lookingFor'],
  'Investor / VC':          ['checkSize', 'stagePreference', 'sectors'],
  'Data / Analytics':       ['tools', 'domain'],
  'Student / Learner':      ['school', 'targetRole', 'currentlyLearning'],
  'Sales / Business Dev':   ['dealType', 'industryFocus', 'tools'],
  'Operations / Finance':   ['specialization', 'industryFocus'],
  'Content Creator':        ['platforms', 'niche', 'audienceSize'],
  'Community Manager':      ['platforms', 'communitySize', 'industryFocus'],
  'Researcher / Academic':  ['institution', 'field', 'output'],
  'HR / People Ops':        ['specialization', 'companySize', 'industryFocus'],
};

const ROLE_FIELD_LABELS = {
  primaryStack: 'Tech stack', preferredRole: 'Focus', yearsExp: 'Experience',
  designTools: 'Tools', specialization: 'Specialization', portfolioUrl: 'Portfolio',
  domain: 'Domain', methodology: 'Methodology', teamSize: 'Team size',
  channels: 'Channels', tools: 'Tools', industryFocus: 'Industry',
  companyName: 'Company', stage: 'Stage', lookingFor: 'Looking for',
  checkSize: 'Check size', stagePreference: 'Stage pref.', sectors: 'Sectors',
  school: 'School', targetRole: 'Target role', currentlyLearning: 'Learning',
  dealType: 'Deal type', platforms: 'Platforms', niche: 'Niche',
  audienceSize: 'Audience', communitySize: 'Community', institution: 'Institution',
  field: 'Research field', output: 'Output', companySize: 'Company size',
};

export default function PublicProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile: myProfile } = useAuth();
  const { showToast } = useToast();

  const [user,     setUser]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [toggling, setToggling] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [modal,    setModal]    = useState(null);
  const [posts,    setPosts]    = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [postsLoadingMore, setPostsLoadingMore] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef  = useRef(null);
  const moreMenuRef = useRef(null);

  // Close the "more options" menu on an outside click — same pattern Feed's
  // filter panel uses (ref-containment check on both the trigger and the
  // panel, so a click on the trigger itself toggles rather than immediately
  // re-closing).
  useEffect(() => {
    function handleClick(e) {
      if (
        moreOpen &&
        moreMenuRef.current && !moreMenuRef.current.contains(e.target) &&
        moreBtnRef.current && !moreBtnRef.current.contains(e.target)
      ) setMoreOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);

  useEffect(() => {
    setLoading(true);
    client.get(`/users/${id}`)
      .then(({ data }) => { setUser(data); setError(''); })
      // A hidden profile 403s with { hidden: true } — distinguished from a
      // genuine 404 so the empty state below can say the accurate thing
      // ("this profile is private") instead of the misleading "not found."
      .catch((err) => setError(err?.response?.data?.hidden ? 'hidden' : 'notfound'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setPostsLoading(true);
    client.get(`/users/${id}/posts`, { params: { limit: 50 } })
      .then(({ data }) => { setPosts(data.posts || []); setPostsHasMore(!!data.hasMore); })
      .catch(() => { setPosts([]); setPostsHasMore(false); })
      .finally(() => setPostsLoading(false));
  }, [id]);

  // See PostList's onNearEnd / ImageLightbox's "max view" — same reasoning
  // as Profile.jsx's own loadMorePosts.
  async function loadMorePosts() {
    if (postsLoadingMore || !postsHasMore) return;
    setPostsLoadingMore(true);
    try {
      const { data } = await client.get(`/users/${id}/posts`, { params: { limit: 50, offset: posts.length } });
      const incoming = data.posts || [];
      setPosts(prev => {
        const knownIds = new Set(prev.map(p => p.id));
        return [...prev, ...incoming.filter(p => !knownIds.has(p.id))];
      });
      setPostsHasMore(!!data.hasMore);
    } catch {}
    finally { setPostsLoadingMore(false); }
  }

  async function toggleFollow() {
    if (!user) return;
    setToggling(true);
    try {
      let data;
      if (user.isFollowing) {
        ({ data } = await client.delete(`/users/${user.id}/follow`));
      } else {
        ({ data } = await client.post(`/users/${user.id}/follow`));
      }
      setUser(u => ({
        ...u,
        isFollowing: !u.isFollowing,
        followersCount: data.followersCount ?? u.followersCount,
      }));
    } catch {
      showToast('Something went wrong — please try again.', 'error');
    }
    finally { setToggling(false); }
  }

  // connectionStatus: 'none' | 'pending_sent' | 'pending_received' | 'connected'.
  // Same POST endpoint sends a fresh request *or* accepts one already
  // pointed at you (see POST /users/:id/connect server-side) — which one
  // happens is implicit in the current status, not something this button
  // needs to know about itself.
  async function toggleConnect() {
    if (!user) return;
    setConnecting(true);
    try {
      const isActive = user.connectionStatus === 'pending_sent' || user.connectionStatus === 'connected';
      const { data } = isActive
        ? await client.delete(`/users/${user.id}/connect`)
        : await client.post(`/users/${user.id}/connect`);
      setUser(u => ({ ...u, connectionStatus: data.connectionStatus }));
      if (data.connectionStatus === 'pending_sent') showToast('Connection request sent', 'success');
      else if (data.connectionStatus === 'connected') showToast('You are now connected', 'success');
    } catch {
      showToast('Something went wrong — please try again.', 'error');
    }
    finally { setConnecting(false); }
  }

  // Declining a request someone sent you is the same DELETE the "cancel"
  // path above uses (see the backend's DELETE /users/:id/connect comment —
  // it treats "cancel one you sent" and "decline one you received" as the
  // same "this pending relationship shouldn't exist" action), but it needed
  // its own button: pending_received's single toggleConnect button already
  // means Accept, so there was previously no way to decline a request from
  // this page at all — only accept it or leave it pending forever.
  async function declineConnect() {
    if (!user) return;
    setConnecting(true);
    try {
      const { data } = await client.delete(`/users/${user.id}/connect`);
      setUser(u => ({ ...u, connectionStatus: data.connectionStatus }));
    } catch {
      showToast('Something went wrong — please try again.', 'error');
    }
    finally { setConnecting(false); }
  }

  // Blocking severs the follow/connection on the backend and makes this
  // profile 403 for both people going forward — navigate away immediately
  // rather than trying to keep showing a page that's about to become
  // inaccessible. Unblocking only happens from Settings > Privacy, not from
  // here, since this page won't be reachable again once blocked.
  async function handleBlock() {
    if (!user) return;
    setMoreOpen(false);
    if (!window.confirm(`Block ${user.name}? They won't be able to follow, message, or connect with you, and neither of you will be able to view each other's profile. You can unblock from Settings > Privacy at any time.`)) return;
    setBlocking(true);
    try {
      await client.post(`/users/${user.id}/block`);
      showToast(`Blocked ${user.name}`, 'success');
      navigate('/');
    } catch {
      showToast('Failed to block — please try again.', 'error');
      setBlocking(false);
    }
  }

  if (loading) return (
    <Layout>
      <div className="empty-state"><span className="spinner spinner-primary" /></div>
    </Layout>
  );

  if (error || !user) return (
    <Layout>
      <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>{error === 'hidden' ? '🔒' : '👤'}</div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          {error === 'hidden' ? 'This profile is private' : 'User not found'}
        </div>
        {error === 'hidden' && (
          <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: '0 0 12px' }}>
            This member has limited who can see their profile.
          </p>
        )}
        <button className="btn-back" onClick={() => navigate('/search')}><span className="btn-back-icon">‹</span> Back to Search</button>
      </div>
    </Layout>
  );

  const isOwn  = myProfile?.id === user.id;
  const meta   = ROLE_META[user.role] || { icon: '👤', color: 'var(--primary)', bg: 'var(--primary-light)' };
  const roleFields = ROLE_PUBLIC_FIELDS[user.role] || [];
  const hasLinks = user.links && Object.values(user.links).some(Boolean);

  return (
    <Layout>
      <button className="btn-back" style={{ marginBottom: 16 }} onClick={() => navigate(-1)}>
        <span className="btn-back-icon">‹</span> Back
      </button>

      {/* Cover — the user's own photo if they've set one, else a role-colored gradient */}
      <div style={{
        height: 100, borderRadius: '12px 12px 0 0', marginBottom: 0,
        ...(user.coverUrl
          ? { backgroundImage: `url(${user.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: `linear-gradient(135deg, ${meta.color}22 0%, ${meta.color}44 100%)` }),
        border: `1px solid ${meta.color}22`,
      }} />

      {/* Header card */}
      <div className="profile-header" style={{ borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
        <div className="profile-avatar-wrap" style={{ marginTop: -40 }}>
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="avatar-xl" style={{ borderRadius: '50%', objectFit: 'cover', display: 'block', border: `3px solid ${meta.color}` }} />
          ) : (
            <div className="avatar avatar-xl" style={{ border: `3px solid ${meta.color}`, background: meta.color }}>
              {initials(user.name)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 }}>
          <div className="profile-name" style={{ margin: 0 }}>{user.name}</div>
          {user.followsYouBack && !isOwn && (
            <span style={{
              fontSize: '.65rem', fontWeight: 700, color: '#6B7280',
              background: '#F3F4F6', padding: '2px 7px', borderRadius: 8, border: '1px solid #E5E7EB',
            }}>Follows you</span>
          )}
        </div>

        {user.title && <div className="profile-title">{user.title}</div>}
        {user.organization && <div className="profile-org">🏢 {user.organization}</div>}

        {/* Role badge */}
        {user.role && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8,
            background: meta.bg, color: meta.color,
            padding: '4px 12px', borderRadius: 20,
            fontSize: '.78rem', fontWeight: 700,
            border: `1px solid ${meta.color}33`,
          }}>
            {meta.icon} {user.role}
          </div>
        )}

        {/* Follow counts */}
        <div style={{ display: 'flex', gap: 20, marginTop: 14, justifyContent: 'center' }}>
          {[
            { type: 'followers', count: user.followersCount, label: 'Followers' },
            { type: 'following', count: user.followingCount, label: 'Following' },
          ].map(({ type, count, label }) => (
            <button
              key={type}
              onClick={() => setModal(type)}
              style={{ textAlign: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 8 }}
            >
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{count}</div>
              <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{label}</div>
            </button>
          ))}
        </div>

        {/* Actions */}
        {!isOwn && (
          <div className="profile-actions" style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className={user.isFollowing ? 'btn btn-ghost' : 'btn btn-primary'}
              onClick={toggleFollow}
              disabled={toggling}
              style={{ minWidth: 110 }}
            >
              {toggling ? <span className="spinner" /> : user.isFollowing ? '✓ Following' : '+ Follow'}
            </button>
            {user.connectionStatus === 'pending_received' ? (
              <>
                <button
                  className="btn btn-primary"
                  onClick={toggleConnect}
                  disabled={connecting}
                  style={{ minWidth: 110 }}
                >
                  {connecting ? <span className="spinner" /> : 'Accept request'}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={declineConnect}
                  disabled={connecting}
                  style={{ minWidth: 90 }}
                >
                  Decline
                </button>
              </>
            ) : (
              <button
                className={user.connectionStatus === 'none' ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={toggleConnect}
                disabled={connecting}
                style={{ minWidth: 110 }}
              >
                {connecting ? <span className="spinner" /> : {
                  none: '🤝 Connect',
                  pending_sent: 'Pending ✕',
                  connected: '✓ Connected',
                }[user.connectionStatus || 'none']}
              </button>
            )}
            <Link to={`/messages/${user.id}`} className="btn btn-ghost" style={{ minWidth: 110, textAlign: 'center' }}>
              💬 Message
            </Link>

            {/* Rare/high-consequence actions (just Block for now) live behind
                a "more options" menu rather than sitting in the row as a
                full-weight button next to Follow/Connect/Message — same
                placement every major social platform uses, so it isn't
                competing for attention with the actions people actually take
                most of the time, and can't be tapped by accident. */}
            <div style={{ position: 'relative' }}>
              <button
                ref={moreBtnRef}
                onClick={() => setMoreOpen(o => !o)}
                aria-label="More options"
                aria-expanded={moreOpen}
                className="btn btn-ghost"
                style={{ width: 40, padding: 0, fontSize: '1.1rem', fontWeight: 700, letterSpacing: '1px' }}
              >
                •••
              </button>
              {moreOpen && (
                <div
                  ref={moreMenuRef}
                  role="menu"
                  style={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20,
                    minWidth: 180, background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden',
                    textAlign: 'left',
                  }}
                >
                  <button
                    role="menuitem"
                    onClick={handleBlock}
                    disabled={blocking}
                    style={{
                      all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '10px 14px', fontSize: '.85rem', fontWeight: 600,
                      color: 'var(--danger)', cursor: blocking ? 'default' : 'pointer', opacity: blocking ? 0.6 : 1,
                    }}
                    onMouseOver={e => e.currentTarget.style.background = '#FEE2E2'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {blocking ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '🚫'} Block {user.name}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {isOwn && (
          <div className="profile-actions" style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/profile')}>Edit profile</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>

        {/* Bio */}
        {user.bio && (
          <div className="card">
            <h3 style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>About</h3>
            <p style={{ fontSize: '.9rem', lineHeight: 1.7, margin: 0 }}>{user.bio}</p>
          </div>
        )}

        {/* Posts */}
        <div>
          <div style={{ maxWidth: 640, marginBottom: 8 }}>
            <h3 style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 4px' }}>Posts</h3>
          </div>
          <PostList
            posts={posts}
            loading={postsLoading}
            showAuthor={false}
            emptyTitle="No posts yet"
            emptyDesc={`${user.name} has not posted to the community yet.`}
            onNearEnd={loadMorePosts}
          />
        </div>

        {/* Skills */}
        {user.skills?.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Skills</h3>
            <div className="tags">
              {user.skills.map(s => <span key={s} className="tag tag-primary">{s}</span>)}
            </div>
          </div>
        )}

        {/* Role-specific details */}
        {roleFields.length > 0 && roleFields.some(f => user.roleSettings?.[f]) && (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, background: meta.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
              }}>{meta.icon}</div>
              <h3 style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', margin: 0 }}>
                {user.role}
              </h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {roleFields.filter(f => user.roleSettings[f]).map(f => (
                <div key={f}>
                  <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                    {ROLE_FIELD_LABELS[f] || f}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{user.roleSettings[f]}</div>
                </div>
              ))}
            </div>
            {/* Open-to toggles */}
            {['openToWork', 'openToFunding', 'openToDeals', 'openToCollabs', 'openToCollab'].some(k => user.roleSettings[k]) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                {user.roleSettings.openToWork    && <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#059669', background: '#ECFDF5', padding: '3px 10px', borderRadius: 10 }}>✦ Open to work</span>}
                {user.roleSettings.openToFunding && <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#D97706', background: '#FFFBEB', padding: '3px 10px', borderRadius: 10 }}>✦ Open to investment</span>}
                {user.roleSettings.openToDeals   && <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#DB2777', background: '#FDF2F8', padding: '3px 10px', borderRadius: 10 }}>✦ Actively seeking deals</span>}
                {(user.roleSettings.openToCollabs || user.roleSettings.openToCollab) && <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#0284C7', background: '#F0F9FF', padding: '3px 10px', borderRadius: 10 }}>✦ Open to collabs</span>}
              </div>
            )}
          </div>
        )}

        {/* Interests & Goals */}
        {(user.interests?.length > 0 || user.goals?.length > 0) && (
          <div className="card">
            <h3 style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Interests & Goals</h3>
            {user.interests?.length > 0 && (
              <div style={{ marginBottom: user.goals?.length > 0 ? 12 : 0 }}>
                <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px' }}>Interests</div>
                <div className="tags">{user.interests.map(i => <span key={i} className="tag tag-secondary">{i}</span>)}</div>
              </div>
            )}
            {user.goals?.length > 0 && (
              <div>
                <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px' }}>Goals</div>
                <div className="tags">{user.goals.map(g => <span key={g} className="tag">{g}</span>)}</div>
              </div>
            )}
          </div>
        )}

        {/* Links */}
        {hasLinks && (
          <div className="card">
            <h3 style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Links</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(user.links).filter(([, v]) => v).map(([key, url]) => {
                const meta = LINK_ICONS[key] || LINK_ICONS.other;
                return (
                  <a
                    key={key}
                    href={url.startsWith('http') ? url : `https://${url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', border: '1.5px solid var(--border)',
                      borderRadius: 8, textDecoration: 'none', color: 'var(--text)',
                      transition: 'border-color .15s',
                    }}
                    onMouseOver={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                    onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <span style={{ fontSize: '1.1rem' }}>{meta.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{meta.label}</div>
                      <div style={{ fontSize: '.72rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</div>
                    </div>
                    <span style={{ color: 'var(--primary)', fontSize: '.8rem' }}>→</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {modal && (
        <FollowListModal
          userId={user.id}
          type={modal}
          title={modal === 'followers' ? `Followers · ${user.followersCount}` : `Following · ${user.followingCount}`}
          onClose={() => setModal(null)}
        />
      )}
    </Layout>
  );
}
