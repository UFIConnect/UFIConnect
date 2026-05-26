import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const LINK_FIELDS = [
  { key: 'linkedin',  label: 'LinkedIn',       icon: '🔷', placeholder: 'https://linkedin.com/in/yourname' },
  { key: 'github',    label: 'GitHub',         icon: '🐙', placeholder: 'https://github.com/yourname' },
  { key: 'portfolio', label: 'Portfolio',      icon: '🌐', placeholder: 'https://yourwebsite.com' },
  { key: 'resume',    label: 'Resume / CV',    icon: '📄', placeholder: 'https://drive.google.com/...' },
  { key: 'twitter',   label: 'X / Twitter',   icon: '🐦', placeholder: 'https://x.com/yourhandle' },
  { key: 'other',     label: 'Other link',     icon: '🔗', placeholder: 'https://...' },
];

const SOCIALS = [
  { key: 'linkedin',  label: 'LinkedIn',   icon: '🔷', color: '#0A66C2', loginUrl: 'https://www.linkedin.com/login' },
  { key: 'github',    label: 'GitHub',     icon: '🐙', color: '#24292F', loginUrl: 'https://github.com/login' },
  { key: 'twitter',   label: 'X / Twitter',icon: '🐦', color: '#000000', loginUrl: 'https://twitter.com/i/flow/login' },
  { key: 'instagram', label: 'Instagram',  icon: '📸', color: '#E1306C', loginUrl: 'https://www.instagram.com/accounts/login/' },
  { key: 'discord',   label: 'Discord',    icon: '💬', color: '#5865F2', loginUrl: 'https://discord.com/login' },
  { key: 'youtube',   label: 'YouTube',    icon: '▶️', color: '#FF0000', loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube' },
  { key: 'reddit',    label: 'Reddit',     icon: '🟠', color: '#FF4500', loginUrl: 'https://www.reddit.com/login' },
  { key: 'medium',    label: 'Medium',     icon: '📝', color: '#000000', loginUrl: 'https://medium.com/m/signin' },
  { key: 'dribbble',  label: 'Dribbble',   icon: '🎨', color: '#EA4C89', loginUrl: 'https://dribbble.com/session/new' },
  { key: 'behance',   label: 'Behance',    icon: '🖼️', color: '#1769FF', loginUrl: 'https://www.behance.net/signin' },
  { key: 'facebook',  label: 'Facebook',   icon: '🔵', color: '#1877F2', loginUrl: 'https://www.facebook.com/login' },
  { key: 'indeed',    label: 'Indeed',     icon: '💼', color: '#003A9B', loginUrl: 'https://secure.indeed.com/account/login' },
];

const TABS = ['Overview', 'Socials', 'Attachments'];

export default function Profile() {
  const { profile, updateProfileLocally } = useAuth();
  const [tab,       setTab]       = useState('Overview');
  const [editing,   setEditing]   = useState(false);
  const [form,      setForm]      = useState(null);
  const [links,     setLinks]     = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [connected, setConnected] = useState({});
  const [platforms, setPlatforms] = useState([]);

  useEffect(() => {
    client.get('/social/platforms')
      .then(({ data }) => {
        const map = {};
        (data.platforms || []).forEach(p => { map[p.id] = p; });
        setPlatforms(data.platforms || []);
        const conn = {};
        (data.platforms || []).filter(p => p.connected).forEach(p => { conn[p.id] = true; });
        setConnected(conn);
      })
      .catch(() => {});
  }, []);

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

  async function handleConnect(key) {
    const s = SOCIALS.find(s => s.key === key);
    if (s?.loginUrl) window.open(s.loginUrl, '_blank', 'noopener,noreferrer');
    try {
      await client.post('/social/connect', { platform: key, platformUserId: `demo_${key}_user`, accessToken: 'mock_token' });
      setConnected(prev => ({ ...prev, [key]: true }));
    } catch {}
  }

  async function handleDisconnect(key) {
    try {
      await client.delete(`/social/connect/${key}`);
      setConnected(prev => { const n = { ...prev }; delete n[key]; return n; });
    } catch {}
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
        <div className="profile-title">{profile.title || 'UFIConnect Member'}</div>
        {profile.organization && <div className="profile-org">🏢 {profile.organization}</div>}

        <div className="profile-actions" style={{ marginTop: 14 }}>
          {!editing && <button className="btn btn-primary btn-sm" onClick={startEdit}>Edit profile</button>}
          <Link to="/profile/connected-accounts">
            <button className="btn btn-ghost btn-sm">🔗 Connected accounts</button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'1px solid var(--border)', paddingBottom:0 }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => { setTab(t); setEditing(false); }}
            style={{
              padding:'10px 18px', border:'none', background:'none', cursor:'pointer',
              fontWeight: tab === t ? 700 : 500,
              color: tab === t ? 'var(--primary)' : 'var(--muted)',
              borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
              fontSize:'.875rem', marginBottom:'-1px', transition:'all .15s',
            }}>
            {t === 'Attachments' ? '📎 Attachments' : '👤 Overview'}
          </button>
        ))}
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
          {profile.skills?.length > 0 && (
            <div className="card">
              <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>Skills</h3>
              <div className="tags">
                {profile.skills.map((s) => <span key={s} className="tag tag-primary">{s}</span>)}
              </div>
            </div>
          )}

          {/* Preferences */}
          {profile.preferences && (
            <div className="card">
              <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:12 }}>Preferences</h3>
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

      {/* ── SOCIALS TAB ──────────────────────────────────────── */}
      {tab === 'Socials' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card">
            <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>Connected Accounts</h3>
            <p style={{ fontSize:'.8rem', color:'var(--muted)', marginBottom:16 }}>Connect your social profiles. Clicking Connect opens the platform's login page.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
              {SOCIALS.map(({ key, label, icon, color, loginUrl }) => {
                const isConnected = !!connected[key];
                return (
                  <div key={key} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 4px', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ fontSize:'1.3rem', width:32, textAlign:'center' }}>{icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:'.875rem' }}>{label}</div>
                      {isConnected && <div style={{ fontSize:'.72rem', color:'var(--success)', fontWeight:600 }}>✓ Connected</div>}
                    </div>
                    {isConnected ? (
                      <button className="btn btn-danger btn-sm" onClick={() => handleDisconnect(key)}>Disconnect</button>
                    ) : (
                      <button
                        className="btn btn-sm"
                        style={{ borderColor: color, color, border:`1.5px solid ${color}`, background:'transparent' }}
                        onClick={() => handleConnect(key)}
                      >
                        Connect
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── ATTACHMENTS TAB ──────────────────────────────────── */}
      {tab === 'Attachments' && !editing && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' }}>Files &amp; Links</h3>
              <button className="btn btn-primary btn-sm" onClick={startEdit}>Edit</button>
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
