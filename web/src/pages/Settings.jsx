import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

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

export default function Settings() {
  const { profile, updateProfileLocally } = useAuth();
  const role = profile?.preferences?.role || '';
  const meta = ROLE_META[role] || DEFAULT_META;

  const [form, setForm] = useState({
    name:         profile?.name         || '',
    title:        profile?.title        || '',
    bio:          profile?.bio          || '',
    organization: profile?.organization || '',
    skills:       (profile?.skills || []).join(', '),
  });
  const [roleSettings, setRoleSettings] = useState({ ...(profile?.roleSettings || {}) });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleRoleField(e) {
    setRoleSettings(r => ({ ...r, [e.target.name]: e.target.value }));
  }

  function handleToggle(key) {
    setRoleSettings(r => ({ ...r, [key]: !r[key] }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const payload = {
        ...form,
        skills: form.skills.split(',').map(s => s.trim()).filter(Boolean),
        roleSettings,
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

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage your profile and role-specific preferences.</p>
      </div>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error  && <div className="auth-error">{error}</div>}
        {saved  && <div style={{ background: '#ECFDF5', color: '#059669', padding: '10px 14px', borderRadius: 8, fontSize: '.875rem', fontWeight: 600 }}>✓ Settings saved</div>}

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
              From onboarding
            </span>
          </div>
        )}

        {/* ── General profile ── */}
        <div className="card">
          <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 16 }}>General</h3>
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
            <textarea className="form-textarea" name="bio" value={form.bio} onChange={handleChange} placeholder="Tell people what you're working on…" />
          </div>
          <div className="form-group">
            <label className="form-label">Skills <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(comma-separated)</span></label>
            <input className="form-input" name="skills" value={form.skills} onChange={handleChange} placeholder="React, Python, Product Strategy…" />
          </div>
        </div>

        {/* ── Role-specific fields ── */}
        {meta.fields.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 16 }}>
              {meta.icon} {role} details
            </h3>
            {meta.fields.map(({ key, label, placeholder, type }) =>
              type === 'toggle' ? (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '.875rem' }}>{label}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle(key)}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                      background: roleSettings[key] ? 'var(--primary)' : 'var(--border)',
                      position: 'relative', transition: 'background .2s',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, left: roleSettings[key] ? 23 : 3,
                      width: 18, height: 18, borderRadius: '50%', background: '#fff',
                      transition: 'left .2s',
                    }} />
                  </button>
                </div>
              ) : (
                <div key={key} className="form-group">
                  <label className="form-label">{label}</label>
                  <input
                    className="form-input"
                    name={key}
                    value={roleSettings[key] || ''}
                    onChange={handleRoleField}
                    placeholder={placeholder}
                  />
                </div>
              )
            )}
          </div>
        )}

        {/* ── Save ── */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save settings'}
          </button>
        </div>
      </form>
    </Layout>
  );
}
