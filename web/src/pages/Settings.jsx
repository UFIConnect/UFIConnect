import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

const SOCIAL_PLATFORMS = [
  { id: 'linkedin',  emoji: '🔷', name: 'LinkedIn',    color: '#0A66C2', desc: 'Posts & articles from your professional network' },
  { id: 'twitter',   emoji: '🐦', name: 'X / Twitter', color: '#1DA1F2', desc: 'Tweets and threads matching your interests' },
  { id: 'instagram', emoji: '📸', name: 'Instagram',   color: '#E1306C', desc: 'Posts from accounts you follow' },
  { id: 'facebook',  emoji: '📘', name: 'Facebook',    color: '#1877F2', desc: 'Page and group posts matching your topics' },
];

const SOCIAL_LOCKED = true; // flip to false when real OAuth credentials are ready

// ── Role metadata ────────────────────────────────────────────────────────────
const ROLE_META = {
  'Engineer / Developer': {
    icon: '💻', color: '#2563EB', bg: '#EFF6FF',
    tagline: 'Software, ML, DevOps',
    fields: [
      { key: 'primaryStack',   label: 'Primary tech stack',      placeholder: 'e.g. React, Node.js, Python, Rust' },
      { key: 'preferredRole',  label: 'Preferred role type',     placeholder: 'e.g. Full-stack, Backend, ML, DevOps' },
      { key: 'yearsExp',       label: 'Years of coding experience', placeholder: 'e.g. 5' },
      { key: 'openToWork',     label: 'Open to new opportunities', type: 'toggle' },
      { key: 'remoteOnly',     label: 'Remote only',              type: 'toggle' },
    ],
  },
  'Designer / Creative': {
    icon: '🎨', color: '#7C3AED', bg: '#F3EEFF',
    tagline: 'UI/UX, Brand, Motion',
    fields: [
      { key: 'designTools',    label: 'Design tools',             placeholder: 'e.g. Figma, Sketch, Adobe XD, Principle' },
      { key: 'specialization', label: 'Specialization',           placeholder: 'e.g. UI/UX, Brand Identity, Motion, 3D' },
      { key: 'portfolioUrl',   label: 'Portfolio URL',            placeholder: 'https://yourportfolio.com' },
      { key: 'openToWork',     label: 'Open to new opportunities', type: 'toggle' },
    ],
  },
  'Product Manager': {
    icon: '📋', color: '#0284C7', bg: '#F0F9FF',
    tagline: 'Strategy & execution',
    fields: [
      { key: 'domain',         label: 'Product domain',           placeholder: 'e.g. B2B SaaS, Consumer, FinTech, API' },
      { key: 'methodology',    label: 'Methodology',              placeholder: 'e.g. Agile, Shape Up, OKRs, Basecamp' },
      { key: 'teamSize',       label: 'Typical team size',        placeholder: 'e.g. 5–10 engineers' },
      { key: 'openToWork',     label: 'Open to new opportunities', type: 'toggle' },
    ],
  },
  'Marketer / Growth': {
    icon: '📈', color: '#059669', bg: '#ECFDF5',
    tagline: 'SEO, Content, Ads',
    fields: [
      { key: 'channels',       label: 'Marketing channels',       placeholder: 'e.g. SEO, Paid, Content, Email, ABM' },
      { key: 'tools',          label: 'Tools & stack',            placeholder: 'e.g. HubSpot, GA4, Segment, Hotjar' },
      { key: 'industryFocus',  label: 'Industry focus',           placeholder: 'e.g. B2B SaaS, E-commerce, FinTech' },
      { key: 'openToWork',     label: 'Open to new opportunities', type: 'toggle' },
    ],
  },
  'Founder / Entrepreneur': {
    icon: '🚀', color: '#D97706', bg: '#FFFBEB',
    tagline: 'Building something new',
    fields: [
      { key: 'companyName',    label: 'Company / Startup name',   placeholder: 'e.g. Acme Inc. (or Stealth)' },
      { key: 'stage',          label: 'Stage',                    placeholder: 'e.g. Idea, MVP, Pre-seed, Seed, Series A' },
      { key: 'industryFocus',  label: 'Industry / vertical',      placeholder: 'e.g. FinTech, HealthTech, Dev Tools' },
      { key: 'lookingFor',     label: 'Currently looking for',    placeholder: 'e.g. Co-founder, Engineers, Investors' },
      { key: 'openToFunding',  label: 'Open to investment discussions', type: 'toggle' },
    ],
  },
  'Investor / VC': {
    icon: '💰', color: '#DB2777', bg: '#FDF2F8',
    tagline: 'VC, Angel, LP',
    fields: [
      { key: 'checkSize',      label: 'Typical check size',       placeholder: 'e.g. $25k–$500k' },
      { key: 'stagePreference',label: 'Stage preference',         placeholder: 'e.g. Pre-seed, Seed, Series A' },
      { key: 'sectors',        label: 'Sectors of interest',      placeholder: 'e.g. AI, FinTech, Climate, HealthTech' },
      { key: 'portfolioSize',  label: 'Portfolio companies',      placeholder: 'e.g. 12' },
      { key: 'openToDeals',    label: 'Actively looking for deals', type: 'toggle' },
    ],
  },
  'Data / Analytics': {
    icon: '📊', color: '#EA580C', bg: '#FFF7ED',
    tagline: 'Data Sci, BI, MLOps',
    fields: [
      { key: 'tools',          label: 'Tools & stack',            placeholder: 'e.g. Python, SQL, dbt, Looker, Spark' },
      { key: 'domain',         label: 'Domain',                   placeholder: 'e.g. Product Analytics, ML Ops, BI' },
      { key: 'openToWork',     label: 'Open to new opportunities', type: 'toggle' },
    ],
  },
  'Student / Learner': {
    icon: '🎓', color: '#7C3AED', bg: '#F3EEFF',
    tagline: 'Growing & exploring',
    fields: [
      { key: 'school',         label: 'School / Bootcamp',        placeholder: 'e.g. MIT, General Assembly, Self-taught' },
      { key: 'graduationYear', label: 'Graduation / completion year', placeholder: 'e.g. 2025' },
      { key: 'targetRole',     label: 'Target role',              placeholder: 'e.g. Software Engineer, Product Manager' },
      { key: 'currentlyLearning', label: 'Currently learning',   placeholder: 'e.g. React, Machine Learning, SQL' },
      { key: 'openToWork',     label: 'Open to internships',      type: 'toggle' },
    ],
  },
  'Sales / Business Dev': {
    icon: '🤝', color: '#2563EB', bg: '#EFF6FF',
    tagline: 'Revenue & partnerships',
    fields: [
      { key: 'dealType',       label: 'Deal type',                placeholder: 'e.g. SMB, Mid-market, Enterprise' },
      { key: 'industryFocus',  label: 'Industry focus',           placeholder: 'e.g. SaaS, FinTech, Healthcare' },
      { key: 'tools',          label: 'CRM & tools',              placeholder: 'e.g. Salesforce, HubSpot, Outreach' },
      { key: 'openToWork',     label: 'Open to new opportunities', type: 'toggle' },
    ],
  },
  'Operations / Finance': {
    icon: '⚙️', color: '#059669', bg: '#ECFDF5',
    tagline: 'Ops, accounting, strategy',
    fields: [
      { key: 'specialization', label: 'Specialization',           placeholder: 'e.g. Finance, RevOps, Legal, Strategy' },
      { key: 'industryFocus',  label: 'Industry',                 placeholder: 'e.g. Tech, Healthcare, Finance' },
      { key: 'companyStage',   label: 'Company stage preference', placeholder: 'e.g. Startup, Scale-up, Enterprise' },
      { key: 'openToWork',     label: 'Open to new opportunities', type: 'toggle' },
    ],
  },
  'Content Creator': {
    icon: '🎬', color: '#D97706', bg: '#FFFBEB',
    tagline: 'Video, writing, podcasts',
    fields: [
      { key: 'platforms',      label: 'Platforms',                placeholder: 'e.g. YouTube, Newsletter, Podcast, TikTok' },
      { key: 'niche',          label: 'Niche / topic',            placeholder: 'e.g. Tech, Finance, Productivity, Fitness' },
      { key: 'audienceSize',   label: 'Audience size',            placeholder: 'e.g. 10k followers, 5k subscribers' },
      { key: 'openToCollabs',  label: 'Open to collaborations',   type: 'toggle' },
    ],
  },
  'Community Manager': {
    icon: '🌐', color: '#0284C7', bg: '#F0F9FF',
    tagline: 'Grow & engage communities',
    fields: [
      { key: 'platforms',      label: 'Community platforms',      placeholder: 'e.g. Discord, Slack, Circle, Mighty' },
      { key: 'communitySize',  label: 'Community size',           placeholder: 'e.g. 5,000 members' },
      { key: 'industryFocus',  label: 'Industry / niche',         placeholder: 'e.g. Tech, Gaming, Creator economy' },
      { key: 'openToWork',     label: 'Open to new opportunities', type: 'toggle' },
    ],
  },
  'Researcher / Academic': {
    icon: '🔬', color: '#7C3AED', bg: '#F3EEFF',
    tagline: 'R&D, academia, science',
    fields: [
      { key: 'institution',    label: 'Institution',              placeholder: 'e.g. Stanford, MIT, DeepMind, Independent' },
      { key: 'field',          label: 'Field of research',        placeholder: 'e.g. NLP, Computational Biology, Physics' },
      { key: 'output',         label: 'Primary output',           placeholder: 'e.g. Papers, Patents, Open-source, Reports' },
      { key: 'openToCollab',   label: 'Open to research collaborations', type: 'toggle' },
    ],
  },
  'HR / People Ops': {
    icon: '👥', color: '#DB2777', bg: '#FDF2F8',
    tagline: 'Recruiting, culture, L&D',
    fields: [
      { key: 'specialization', label: 'Specialization',           placeholder: 'e.g. Recruiting, L&D, HRBP, Comp & Ben' },
      { key: 'companySize',    label: 'Company size focus',       placeholder: 'e.g. Startup, Mid-size, Enterprise' },
      { key: 'industryFocus',  label: 'Industry',                 placeholder: 'e.g. Tech, Finance, Healthcare' },
      { key: 'openToWork',     label: 'Open to new opportunities', type: 'toggle' },
    ],
  },
};

const DEFAULT_META = {
  icon: '👤', color: 'var(--primary)', bg: 'var(--primary-light)',
  tagline: 'UFIConnect Member',
  fields: [],
};

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
        background: value ? 'var(--primary)' : 'var(--border)',
        position: 'relative', transition: 'background .2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: value ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left .2s',
      }} />
    </button>
  );
}

function SectionHeading({ children }) {
  return (
    <h3 style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 14 }}>
      {children}
    </h3>
  );
}

export default function Settings() {
  const { profile, updateProfileLocally, logout } = useAuth();
  const navigate = useNavigate();
  const role = profile?.preferences?.role || '';
  const meta = ROLE_META[role] || DEFAULT_META;
  const [activeTab, setActiveTab] = useState('general');
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Connect tab state
  const [connectedSocial, setConnectedSocial] = useState({});
  const [socialConnecting, setSocialConnecting] = useState(null);
  const [socialDisconnecting, setSocialDisconnecting] = useState(null);
  const [socialFlash, setSocialFlash] = useState(null);

  useEffect(() => {
    client.get('/profile/social').then(({ data }) => setConnectedSocial(data.connected || {})).catch(() => {});
    // Handle OAuth callback redirects
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('social_connected');
    const errored   = params.get('social_error');
    if (connected) {
      setConnectedSocial(prev => ({ ...prev, [connected]: true }));
      setSocialFlash({ type: 'success', platform: connected });
      setActiveTab('connect');
      window.history.replaceState({}, '', '/settings');
      setTimeout(() => setSocialFlash(null), 5000);
    } else if (errored) {
      const reason = params.get('reason');
      const name   = ['linkedin','twitter','instagram','facebook'].includes(errored)
        ? SOCIAL_PLATFORMS.find(p => p.id === errored)?.name || errored
        : errored;
      const msg = reason === 'invalid_state'
        ? `OAuth session expired — please try connecting ${name} again.`
        : reason
          ? `Could not connect ${name}: ${reason.replace(/_/g, ' ')}.`
          : `Could not connect ${name}. Please try again.`;
      setSocialFlash({ type: 'error', platform: errored, msg });
      setActiveTab('connect');
      window.history.replaceState({}, '', '/settings');
      setTimeout(() => setSocialFlash(null), 7000);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function connectSocial(platform) {
    setSocialConnecting(platform);
    try {
      await client.post('/social/connect', { platform });
      setConnectedSocial(prev => ({ ...prev, [platform]: true }));
      setSocialFlash({ type: 'success', platform });
      setTimeout(() => setSocialFlash(null), 5000);
    } catch (err) {
      const serverMsg = err?.response?.data?.error || null;
      setSocialFlash({ type: 'error', platform, msg: serverMsg || `Could not connect ${SOCIAL_PLATFORMS.find(p => p.id === platform)?.name}. Try again.` });
      setTimeout(() => setSocialFlash(null), 7000);
    } finally {
      setSocialConnecting(null);
    }
  }

  async function disconnectSocial(platform) {
    setSocialDisconnecting(platform);
    try {
      await client.delete(`/profile/social/${platform}`);
      setConnectedSocial(prev => ({ ...prev, [platform]: false }));
      setSocialFlash({ type: 'disconnected', platform });
      setTimeout(() => setSocialFlash(null), 4000);
    } catch {
      setSocialFlash({ type: 'error', platform });
      setTimeout(() => setSocialFlash(null), 5000);
    } finally {
      setSocialDisconnecting(null);
    }
  }

  const [form, setForm] = useState({
    name:         profile?.name         || '',
    title:        profile?.title        || '',
    bio:          profile?.bio          || '',
    organization: profile?.organization || '',
    skills:       (profile?.skills || []).join(', '),
  });
  const [roleSettings, setRoleSettings] = useState({ ...(profile?.roleSettings || {}) });

  // Notification prefs (stored in roleSettings under 'notifs_*')
  const [notifs, setNotifs] = useState({
    emailDigest:    roleSettings.notifs_emailDigest    ?? true,
    communityUpdates: roleSettings.notifs_communityUpdates ?? true,
    newOpportunities: roleSettings.notifs_newOpportunities ?? true,
    mentions:       roleSettings.notifs_mentions       ?? true,
  });

  // Privacy prefs
  const [privacy, setPrivacy] = useState({
    publicProfile:  roleSettings.privacy_publicProfile  ?? true,
    showEmail:      roleSettings.privacy_showEmail      ?? false,
    showSkills:     roleSettings.privacy_showSkills     ?? true,
    showGroups:     roleSettings.privacy_showGroups     ?? true,
  });

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }
  function handleRoleField(e) {
    setRoleSettings(r => ({ ...r, [e.target.name]: e.target.value }));
  }
  function handleRoleToggle(key) {
    setRoleSettings(r => ({ ...r, [key]: !r[key] }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const merged = {
        ...roleSettings,
        notifs_emailDigest:       notifs.emailDigest,
        notifs_communityUpdates:  notifs.communityUpdates,
        notifs_newOpportunities:  notifs.newOpportunities,
        notifs_mentions:          notifs.mentions,
        privacy_publicProfile:    privacy.publicProfile,
        privacy_showEmail:        privacy.showEmail,
        privacy_showSkills:       privacy.showSkills,
        privacy_showGroups:       privacy.showGroups,
      };
      const payload = {
        ...form,
        skills: form.skills.split(',').map(s => s.trim()).filter(Boolean),
        roleSettings: merged,
      };
      const { data } = await client.patch('/profile', payload);
      updateProfileLocally(data.profile || data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
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

  const TABS = [
    { key: 'general', label: 'General' },
    { key: 'connect', label: '🔗 Connect', badge: Object.values(connectedSocial).filter(Boolean).length || null },
  ];

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage your profile, preferences, and account details.</p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 700 : 500,
              fontSize: '.875rem',
              color: activeTab === tab.key ? 'var(--primary)' : 'var(--muted)',
              borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {tab.label}
            {tab.badge ? (
              <span style={{
                background: 'var(--primary)', color: '#fff',
                borderRadius: 10, fontSize: '.65rem', fontWeight: 700,
                padding: '1px 6px', lineHeight: 1.4,
              }}>{tab.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ── Connect tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'connect' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {socialFlash && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: '.875rem', fontWeight: 500,
              lineHeight: 1.5,
              background: socialFlash.type === 'success' ? '#ECFDF5' : socialFlash.type === 'disconnected' ? '#F8FAFC' : '#FEF2F2',
              color:      socialFlash.type === 'success' ? '#059669' : socialFlash.type === 'disconnected' ? '#64748B' : '#DC2626',
              border:     socialFlash.type === 'error' ? '1px solid #FECACA' : 'none',
            }}>
              {socialFlash.type === 'success'      && `✓ ${SOCIAL_PLATFORMS.find(p => p.id === socialFlash.platform)?.name} connected successfully`}
              {socialFlash.type === 'disconnected' && `${SOCIAL_PLATFORMS.find(p => p.id === socialFlash.platform)?.name} disconnected`}
              {socialFlash.type === 'error'        && (socialFlash.msg || `Could not connect ${SOCIAL_PLATFORMS.find(p => p.id === socialFlash.platform)?.name}. Try again.`)}
            </div>
          )}

          <div className="card">
            <SectionHeading>🔗 Connected Accounts</SectionHeading>
            <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
              Connect your social accounts to personalise your feed with content from your own network and follows.
            </p>
            {SOCIAL_PLATFORMS.map(platform => {
              const isConnected   = !!connectedSocial[platform.id];
              const isConnecting  = socialConnecting  === platform.id;
              const isDisconnecting = socialDisconnecting === platform.id;
              return (
                <div key={platform.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: `${platform.color}18`,
                    border: `1.5px solid ${platform.color}33`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.2rem',
                  }}>{platform.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '.875rem' }}>{platform.name}</div>
                    <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 2 }}>{platform.desc}</div>
                  </div>
                  {SOCIAL_LOCKED ? (
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      fontSize: '.72rem', fontWeight: 600, color: '#94A3B8',
                      background: '#F1F5F9', padding: '4px 10px', borderRadius: 6,
                      border: '1px solid var(--border)',
                    }}>
                      🔒 Coming Soon
                    </span>
                  ) : isConnected ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '.72rem', fontWeight: 600, color: '#059669', background: '#ECFDF5', padding: '3px 8px', borderRadius: 6 }}>
                        ✓ Connected
                      </span>
                      <button
                        type="button"
                        onClick={() => disconnectSocial(platform.id)}
                        disabled={isDisconnecting}
                        style={{
                          padding: '5px 12px', borderRadius: 7,
                          border: '1.5px solid var(--border)', background: 'none',
                          color: 'var(--muted)', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        {isDisconnecting ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Disconnect'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => connectSocial(platform.id)}
                      disabled={isConnecting}
                      style={{
                        padding: '7px 16px', borderRadius: 8, border: 'none',
                        background: platform.color, color: '#fff',
                        fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
                        opacity: isConnecting ? 0.7 : 1,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {isConnecting ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Connect'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── General tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'general' && (
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div className="auth-error">{error}</div>}
        {saved && (
          <div style={{ background: '#ECFDF5', color: '#059669', padding: '10px 14px', borderRadius: 8, fontSize: '.875rem', fontWeight: 600 }}>
            ✓ Settings saved
          </div>
        )}

        {/* ── Account info ── */}
        <div className="card">
          <SectionHeading>Account</SectionHeading>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '.9rem' }}>
              {(profile.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{profile.name}</div>
              <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{profile.email}</div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <Link to="/profile/connected-accounts">
                <button type="button" className="btn btn-ghost btn-sm">Manage connected accounts →</button>
              </Link>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 4 }}>
            <label className="form-label">Email address</label>
            <input className="form-input" value={profile.email} disabled style={{ background: 'var(--bg-secondary)', color: 'var(--muted)' }} />
            <span style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 3, display: 'block' }}>Email cannot be changed. Contact support if you need help.</span>
          </div>
        </div>

        {/* ── Role badge ── */}
        {role && (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }}>
              {meta.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: meta.color }}>{role}</div>
              <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 2 }}>{meta.tagline}</div>
            </div>
            <span style={{ fontSize: '.72rem', color: 'var(--muted)', background: 'var(--surface)', padding: '3px 8px', borderRadius: 6, fontWeight: 500 }}>
              Set during onboarding
            </span>
          </div>
        )}

        {/* ── General profile ── */}
        <div className="card">
          <SectionHeading>Profile</SectionHeading>
          <div className="form-group">
            <label className="form-label">Full name</label>
            <input className="form-input" name="name" value={form.name} onChange={handleChange} placeholder="Your name" />
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
            <textarea className="form-textarea" name="bio" value={form.bio} onChange={handleChange} rows={3} placeholder="Tell people what you're working on…" />
          </div>
          <div className="form-group">
            <label className="form-label">Skills <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(comma-separated)</span></label>
            <input className="form-input" name="skills" value={form.skills} onChange={handleChange} placeholder="React, Python, Product Strategy…" />
          </div>
        </div>

        {/* ── Role-specific fields ── */}
        {meta.fields.length > 0 && (
          <div className="card">
            <SectionHeading>{meta.icon} {role} details</SectionHeading>
            {meta.fields.map(({ key, label, placeholder, type }) =>
              type === 'toggle' ? (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 600, fontSize: '.875rem' }}>{label}</span>
                  <Toggle value={!!roleSettings[key]} onChange={() => handleRoleToggle(key)} />
                </div>
              ) : (
                <div key={key} className="form-group">
                  <label className="form-label">{label}</label>
                  <input className="form-input" name={key} value={roleSettings[key] || ''} onChange={handleRoleField} placeholder={placeholder} />
                </div>
              )
            )}
          </div>
        )}

        {/* ── Notifications ── */}
        <div className="card">
          <SectionHeading>🔔 Notifications</SectionHeading>
          {[
            { key: 'emailDigest',       label: 'Weekly email digest',           desc: 'A summary of top posts and opportunities in your groups.' },
            { key: 'communityUpdates',  label: 'Community updates',             desc: 'New members, posts, and announcements from your groups.' },
            { key: 'newOpportunities',  label: 'New opportunities',             desc: 'Job listings, gigs, and grants matching your profile.' },
            { key: 'mentions',          label: 'Mentions and replies',          desc: 'When someone mentions or replies to you.' },
          ].map(({ key, label, desc }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{label}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 2 }}>{desc}</div>
              </div>
              <Toggle value={!!notifs[key]} onChange={() => setNotifs(n => ({ ...n, [key]: !n[key] }))} />
            </div>
          ))}
        </div>

        {/* ── Privacy ── */}
        <div className="card">
          <SectionHeading>🔒 Privacy</SectionHeading>
          {[
            { key: 'publicProfile',  label: 'Public profile',     desc: 'Allow anyone on UFIConnect to view your profile.' },
            { key: 'showEmail',      label: 'Show email address',  desc: 'Display your email on your public profile.' },
            { key: 'showSkills',     label: 'Show skills',         desc: 'Display your skill tags on your profile card.' },
            { key: 'showGroups',     label: 'Show groups',         desc: 'Let others see which groups you belong to.' },
          ].map(({ key, label, desc }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{label}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 2 }}>{desc}</div>
              </div>
              <Toggle value={!!privacy[key]} onChange={() => setPrivacy(p => ({ ...p, [key]: !p[key] }))} />
            </div>
          ))}
        </div>

        {/* ── Danger zone ── */}
        <div className="card" style={{ borderColor: '#FCA5A5' }}>
          <SectionHeading>⚠️ Danger Zone</SectionHeading>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '.875rem' }}>Delete account</div>
              <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 2 }}>
                Permanently remove your account and all associated data. This action cannot be undone.
              </div>
            </div>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteModal(true)}>
              Delete account
            </button>
          </div>
        </div>

        {/* ── Delete confirmation modal ── */}
        {deleteModal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
            <div className="card" style={{ width: '100%', maxWidth: 440, padding: 28, borderRadius: 20 }}>
              <div style={{ fontSize: '2rem', marginBottom: 12, textAlign: 'center' }}>⚠️</div>
              <h3 style={{ margin: '0 0 8px', textAlign: 'center' }}>Delete your account?</h3>
              <p style={{ fontSize: '.85rem', color: 'var(--muted)', textAlign: 'center', marginBottom: 20, lineHeight: 1.6 }}>
                This will permanently delete your profile, posts, and all account data.
                This action <strong>cannot be undone</strong>.
              </p>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Type <strong>DELETE</strong> to confirm</label>
                <input
                  className="form-input"
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder="Type DELETE here"
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setDeleteModal(false); setDeleteConfirm(''); }}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                  disabled={deleteConfirm !== 'DELETE' || deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await client.delete('/profile');
                      logout();
                      navigate('/');
                    } catch {
                      alert('Failed to delete account. Please contact support@uficonnect.org.');
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? <span className="spinner" /> : 'Permanently delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Save ── */}
        <div style={{ display: 'flex', gap: 10, paddingBottom: 32 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save all settings'}
          </button>
        </div>
      </form>
      )}
    </Layout>
  );
}
