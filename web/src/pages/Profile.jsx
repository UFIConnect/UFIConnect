import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import FollowListModal from '../components/FollowListModal';
import PostList from '../components/PostList';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const LINK_FIELDS = [
  { key: 'linkedin',  label: 'LinkedIn',       icon: '🔷', placeholder: 'https://linkedin.com/in/yourname' },
  { key: 'github',    label: 'GitHub',         icon: '🐙', placeholder: 'https://github.com/yourname' },
  { key: 'gitlab',    label: 'GitLab',         icon: 'GL', placeholder: 'https://gitlab.com/yourname' },
  { key: 'portfolio', label: 'Portfolio',      icon: '🌐', placeholder: 'https://yourwebsite.com' },
  { key: 'resume',    label: 'Resume / CV',    icon: '📄', placeholder: 'https://drive.google.com/...' },
  { key: 'twitter',   label: 'X / Twitter',   icon: '🐦', placeholder: 'https://x.com/yourhandle' },
  { key: 'other',     label: 'Other link',     icon: '🔗', placeholder: 'https://...' },
];

const TABS = ['Overview', 'Connected Accounts', 'Sources', 'Posts', 'Skills', 'Attachments'];
// These two navigate to their existing standalone pages instead of rendering inline.
const NAV_TABS = { 'Connected Accounts': '/connected-accounts', 'Sources': '/sources' };

export default function Profile() {
  const { profile, updateProfileLocally } = useAuth();
  const navigate = useNavigate();
  const [tab,         setTab]         = useState('Overview');
  const [editing,     setEditing]     = useState(false);
  const [form,        setForm]        = useState(null);
  const [links,       setLinks]       = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  // Skills tab state
  const [skillInput,    setSkillInput]    = useState('');
  const [skills,        setSkills]        = useState([]);
  const [skillSaving,   setSkillSaving]   = useState(false);
  // Posts
  const [posts,        setPosts]        = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  // Follow stats
  const [followStats, setFollowStats] = useState({ followersCount: 0, followingCount: 0 });
  const [followModal, setFollowModal] = useState(null); // 'followers' | 'following' | null

  // Sync skills from profile when profile loads or tab changes
  useEffect(() => {
    if (Array.isArray(profile?.skills)) setSkills(profile.skills);
  }, [profile, tab]);

  // Load follow counts
  useEffect(() => {
    if (!profile?.id) return;
    client.get(`/users/${profile.id}`)
      .then(({ data }) => setFollowStats({ followersCount: data.followersCount, followingCount: data.followingCount }))
      .catch(() => {});
  }, [profile?.id]);

  // Load posts created by this member
  useEffect(() => {
    if (!profile?.id) return;
    setPostsLoading(true);
    client.get(`/users/${profile.id}/posts`)
      .then(({ data }) => setPosts(data.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setPostsLoading(false));
  }, [profile?.id]);


  function addSkill() {
    const trimmed = skillInput.trim();
    if (!trimmed || skills.includes(trimmed)) { setSkillInput(''); return; }
    setSkills(prev => [...prev, trimmed]);
    setSkillInput('');
  }

  function removeSkill(s) {
    setSkills(prev => prev.filter(x => x !== s));
  }

  async function saveSkills() {
    setSkillSaving(true);
    try {
      const payload = { name: profile.name, title: profile.title, bio: profile.bio, organization: profile.organization, skills, links: profile.links || {} };
      const { data } = await client.patch('/profile', payload);
      updateProfileLocally(data.profile || data);
    } catch {}
    finally { setSkillSaving(false); }
  }

  function startEdit() {
    setForm({
      name:         profile?.name         || '',
      title:        profile?.title        || '',
      bio:          profile?.bio          || '',
      organization: profile?.organization || '',
      skills:       (profile?.skills || []).join(', '),
    });
    setLinks({ ...(profile?.links || {}) });
    setEditing(true);
    setError('');
  }

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleLinkChange(e) {
    setLinks((l) => ({ ...l, [e.target.name]: e.target.value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
        links,
      };
      const data = await client.patch('/profile', payload).then(r => r.data);
      // Support both { profile: {...} } and flat profile shapes
      updateProfileLocally(data.profile || data);
      setEditing(false);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return (
    <Layout>
      <div className="empty-state"><span className="spinner spinner-primary" /></div>
    </Layout>
  );

  const profileLinks = profile.links || {};
  const hasLinks = Object.values(profileLinks).some(Boolean);

  return (
    <Layout>
      {/* Cover */}
      <div className="profile-cover" />

      {/* Header card */}
      <div className="profile-header">
        <div className="profile-avatar-wrap">
          <div className="avatar avatar-xl">{initials(profile.name)}</div>
        </div>
        <div className="profile-name">{profile.name}</div>
        <div className="profile-title">{profile.title || 'UFconnect Member'}</div>
        {profile.organization && <div className="profile-org">🏢 {profile.organization}</div>}

        {/* Follow stats */}
        <div style={{ display: 'flex', gap: 20, marginTop: 14, justifyContent: 'center' }}>
          {[
            { type: 'followers', count: followStats.followersCount, label: 'Followers' },
            { type: 'following', count: followStats.followingCount, label: 'Following' },
          ].map(({ type, count, label }) => (
            <button
              key={type}
              onClick={() => setFollowModal(type)}
              style={{ textAlign: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 8, transition: 'background .15s' }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--hover)'}
              onMouseOut={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{count}</div>
              <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{label}</div>
            </button>
          ))}
        </div>

        <div className="profile-actions" style={{ marginTop: 14 }}>
          {!editing && <button className="btn btn-primary btn-sm" onClick={startEdit}>Edit profile</button>}
          <Link to={`/u/${profile.id}`}>
            <button className="btn btn-ghost btn-sm">👁 Public view</button>
          </Link>
        </div>
      </div>

      {followModal && (
        <FollowListModal
          userId={profile.id}
          type={followModal}
          title={followModal === 'followers'
            ? `Followers · ${followStats.followersCount}`
            : `Following · ${followStats.followingCount}`}
          onClose={() => setFollowModal(null)}
        />
      )}

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--border)', overflowX:'auto' }}>
        {TABS.map((t) => {
          const icons = { Overview: '👤', 'Connected Accounts': '🔗', Sources: '📡', Posts: '✏️', Skills: '🛠', Attachments: '📎' };
          const comingSoon = new Set(['Attachments']);
          return (
            <button key={t} onClick={() => {
              if (NAV_TABS[t]) { navigate(NAV_TABS[t]); return; }
              setTab(t); setEditing(false);
            }}
              style={{
                padding:'10px 16px', border:'none', background:'none', cursor:'pointer', whiteSpace:'nowrap',
                fontWeight: tab === t ? 700 : 500,
                color: tab === t ? 'var(--primary)' : 'var(--muted)',
                borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
                fontSize:'.875rem', marginBottom:'-1px', transition:'all .15s',
                display:'flex', alignItems:'center', gap:6,
              }}>
              {icons[t]} {t}
              {comingSoon.has(t) && (
                <span style={{ fontSize:'.6rem', fontWeight:700, background:'var(--primary)', color:'#fff', padding:'1px 6px', borderRadius:10, letterSpacing:'.3px' }}>
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────────── */}
      {tab === 'Overview' && !editing && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {/* Bio */}
          <div className="card">
            <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>About</h3>
            <p style={{ fontSize:'.9rem', lineHeight:1.7, color: profile.bio ? 'var(--text)' : 'var(--muted)' }}>
              {profile.bio || 'No bio yet — click Edit profile to add one.'}
            </p>
          </div>

          {/* Skills */}
          {Array.isArray(profile.skills) && profile.skills.length > 0 && (
            <div className="card">
              <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>Skills</h3>
              <div className="tags">
                {profile.skills.map((s) => <span key={s} className="tag tag-primary">{s}</span>)}
              </div>
            </div>
          )}

          {/* Visibility */}
          <div className="card">
            <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:12 }}>Visibility</h3>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
              <div>
                <div style={{ fontWeight:600, fontSize:'.9rem', marginBottom:3 }}>
                  🌐 Profile visible to members
                </div>
                <div style={{ fontSize:'.8rem', color:'var(--muted)', lineHeight:1.5 }}>
                  Everyone with an account can find your profile, follow you, view your posts, and message you.
                </div>
              </div>
              <span style={{ flexShrink:0, fontSize:'.72rem', fontWeight:700, color:'#059669', background:'#ECFDF5', padding:'4px 10px', borderRadius:10 }}>
                Active
              </span>
            </div>
          </div>

          {/* Connected Accounts */}
          <div className="card" id="social">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div>
                <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>Connected Accounts</h3>
                <p style={{ fontSize:'.78rem', color:'var(--muted)', margin:0, lineHeight:1.5 }}>
                  Connect your social accounts to bring your existing feeds into UFconnect.
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/connected-accounts')} style={{ flexShrink:0 }}>
                Manage →
              </button>
            </div>
          </div>

          {/* Preferences */}
          {profile.preferences && (
            <div className="card">
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', margin:0 }}>Preferences</h3>
                <Link to="/settings?tab=preferences">
                  <button className="btn btn-ghost btn-sm" type="button">Edit →</button>
                </Link>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                {profile.preferences.role && (
                  <div>
                    <div style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:3 }}>Role</div>
                    <div style={{ fontWeight:600, fontSize:'.875rem' }}>{profile.preferences.role}</div>
                  </div>
                )}
                {profile.preferences.experience && (
                  <div>
                    <div style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:3 }}>Experience</div>
                    <div style={{ fontWeight:600, fontSize:'.875rem' }}>{profile.preferences.experience}</div>
                  </div>
                )}
                {profile.preferences.goals?.length > 0 && (
                  <div style={{ gridColumn:'1/-1' }}>
                    <div style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:6 }}>Goals</div>
                    <div className="tags">{profile.preferences.goals.map((g) => <span key={g} className="tag">{g}</span>)}</div>
                  </div>
                )}
                {profile.preferences.interests?.length > 0 && (
                  <div style={{ gridColumn:'1/-1' }}>
                    <div style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:6 }}>Interests</div>
                    <div className="tags">{profile.preferences.interests.map((i) => <span key={i} className="tag tag-secondary">{i}</span>)}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── OVERVIEW EDIT FORM ───────────────────────────────── */}
      {tab === 'Overview' && editing && (
        <form className="card" onSubmit={handleSave}>
          {error && <div className="auth-error" style={{ marginBottom:14 }}>{error}</div>}
          <div className="form-group">
            <label className="form-label">Full name</label>
            <input className="form-input" name="name" value={form.name} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label className="form-label">Professional title</label>
            <input className="form-input" name="title" value={form.title} onChange={handleChange} placeholder="e.g. Senior Product Manager" />
          </div>
          <div className="form-group">
            <label className="form-label">Organization</label>
            <input className="form-input" name="organization" value={form.organization} onChange={handleChange} placeholder="Where do you work / study?" />
          </div>
          <div className="form-group">
            <label className="form-label">Bio</label>
            <textarea className="form-textarea" name="bio" value={form.bio} onChange={handleChange} placeholder="Tell people what you're working on…" />
          </div>
          <div className="form-group">
            <label className="form-label">Skills <span style={{ color:'var(--muted)', fontWeight:400 }}>(comma-separated)</span></label>
            <input className="form-input" name="skills" value={form.skills} onChange={handleChange} placeholder="React, Python, Product Strategy…" />
          </div>
          <div style={{ display:'flex', gap:10, marginTop:4 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save changes'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* ── POSTS TAB ───────────────────────────────────────── */}
      {tab === 'Posts' && !editing && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card" style={{ maxWidth: 640 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
              <div>
                <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>Your Posts</h3>
                <p style={{ fontSize:'.84rem', color:'var(--muted)', margin:0 }}>Posts you share with the UFconnect community appear here.</p>
              </div>
              <Link to="/post" className="btn btn-primary btn-sm" style={{ textDecoration:'none' }}>Write a post</Link>
            </div>
          </div>
          <PostList
            posts={posts}
            loading={postsLoading}
            emptyTitle="No posts yet"
            emptyDesc="Write your first community post and it will appear on your profile."
            emptyAction={<Link to="/post" className="btn btn-primary btn-sm" style={{ textDecoration:'none' }}>Write a post</Link>}
            currentUserId={profile?.id}
            onPostDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
          />
        </div>
      )}

      {/* ── SKILLS TAB ───────────────────────────────────────── */}
      {tab === 'Skills' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Your Skills</h3>

            {/* Existing badges */}
            {skills.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {skills.map(s => (
                  <span
                    key={s}
                    className="tag tag-primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: '.82rem' }}
                  >
                    {s}
                    <button
                      type="button"
                      onClick={() => removeSkill(s)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, fontSize: '.85rem', opacity: .7 }}
                    >×</button>
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: '.88rem', marginBottom: 14 }}>No skills added yet. Add some below.</p>
            )}

            {/* Add input */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                placeholder="Add a skill (e.g. React, Python, UX Design)…"
                value={skillInput}
                onChange={e => setSkillInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary btn-sm" type="button" onClick={addSkill} style={{ flexShrink: 0 }}>
                Add
              </button>
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <button className="btn btn-primary btn-sm" onClick={saveSkills} disabled={skillSaving}>
                {skillSaving ? <span className="spinner" /> : 'Save skills'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ATTACHMENTS TAB ──────────────────────────────────── */}
      {tab === 'Attachments' && !editing && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card" style={{ position:'relative', overflow:'hidden' }}>
            {/* Coming Soon overlay */}
            <div style={{
              position:'absolute', inset:0, zIndex:10,
              backdropFilter:'blur(5px)', WebkitBackdropFilter:'blur(5px)',
              background:'rgba(var(--bg-rgb,255,255,255),.55)',
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10,
            }}>
              <span style={{ fontSize:'1.6rem' }}>📎</span>
              <div style={{ fontWeight:700, fontSize:'.95rem' }}>Files &amp; Attachments</div>
              <span style={{
                fontSize:'.72rem', fontWeight:700, letterSpacing:'.5px',
                background:'var(--primary)', color:'#fff',
                padding:'3px 12px', borderRadius:20,
              }}>Coming Soon</span>
              <p style={{ fontSize:'.78rem', color:'var(--muted)', textAlign:'center', maxWidth:260, lineHeight:1.5, margin:0 }}>
                Resume upload and portfolio links are coming in the next update.
              </p>
            </div>

            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' }}>Files &amp; Links</h3>
            </div>
            {hasLinks ? (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {LINK_FIELDS.filter(f => profileLinks[f.key]).map(({ key, label, icon }) => (
                  <a key={key} href={profileLinks[key]} target="_blank" rel="noopener noreferrer"
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', border:'1.5px solid var(--border)', borderRadius:'var(--radius-sm)', textDecoration:'none', color:'var(--text)', transition:'all .15s' }}
                    onMouseOver={e => e.currentTarget.style.borderColor='var(--primary)'}
                    onMouseOut={e => e.currentTarget.style.borderColor='var(--border)'}
                  >
                    <span style={{ fontSize:'1.2rem' }}>{icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:'.875rem' }}>{label}</div>
                      <div style={{ fontSize:'.75rem', color:'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:280 }}>{profileLinks[key]}</div>
                    </div>
                    <span style={{ color:'var(--primary)', fontSize:'.8rem' }}>→</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding:'32px 0' }}>
                <div className="empty-icon">📎</div>
                <div className="empty-title">No files or links yet</div>
                <div className="empty-desc" style={{ marginBottom:14 }}>Upload your resume or add links to your portfolio, GitHub, and LinkedIn.</div>
                <button className="btn btn-primary btn-sm" onClick={startEdit}>Add files</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ATTACHMENTS EDIT FORM ────────────────────────────── */}
      {tab === 'Attachments' && editing && (
        <form className="card" onSubmit={handleSave}>
          {error && <div className="auth-error" style={{ marginBottom:14 }}>{error}</div>}
          <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:16 }}>Files &amp; Links</h3>

          {/* Resume upload */}
          <div className="form-group">
            <label className="form-label">📄 Resume / CV <span style={{ color:'var(--muted)', fontWeight:400 }}>(upload or link)</span></label>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <label style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', border:'2px dashed var(--border)', borderRadius:8, cursor:'pointer', fontSize:'.875rem', color:'var(--muted)' }}>
                <span>📤</span> Click to upload a file (PDF, DOCX)
                <input type="file" accept=".pdf,.doc,.docx" style={{ display:'none' }}
                  onChange={e => {
                    const file = e.target.files[0];
                    if (file) setLinks(l => ({ ...l, resume: `[${file.name}]` }));
                  }} />
              </label>
              <input className="form-input" type="url" name="resume"
                value={links?.resume?.startsWith('[') ? '' : (links?.resume || '')}
                onChange={handleLinkChange} placeholder="or paste a link: https://drive.google.com/..." />
            </div>
          </div>

          {LINK_FIELDS.filter(f => f.key !== 'resume').map(({ key, label, icon, placeholder }) => (
            <div className="form-group" key={key}>
              <label className="form-label">{icon} {label}</label>
              <input className="form-input" type="url" name={key}
                value={links?.[key] || ''} onChange={handleLinkChange} placeholder={placeholder} />
            </div>
          ))}
          <div style={{ display:'flex', gap:10, marginTop:4 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </Layout>
  );
}
