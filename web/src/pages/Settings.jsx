import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';
import { ALL_ROLES, EXTRA_INTERESTS } from '../data/roles';

// ── Shared preference constants ───────────────────────────────────────────────
const GOALS = [
  { value: 'networking',  icon: '🤝', label: 'Grow my network',       desc: 'Meet peers, collaborators, and mentors' },
  { value: 'jobs',        icon: '💼', label: 'Find a new role',        desc: 'Discover jobs, gigs, and contracts' },
  { value: 'learning',    icon: '📚', label: 'Learn new skills',       desc: 'Courses, tutorials, and expert guides' },
  { value: 'build',       icon: '🛠',  label: 'Build in public',        desc: 'Share work, get feedback, find collaborators' },
  { value: 'hiring',      icon: '🔍', label: 'Hire great talent',      desc: 'Find exceptional people for your team' },
  { value: 'funding',     icon: '🏦', label: 'Raise funding',          desc: 'Connect with investors, grants, and VCs' },
  { value: 'mentorship',  icon: '🧑‍🏫', label: 'Find a mentor',         desc: 'Learn from experienced professionals' },
  { value: 'events',      icon: '📅', label: 'Attend events',          desc: 'Conferences, meetups, and virtual summits' },
  { value: 'expertise',   icon: '💡', label: 'Share my expertise',     desc: 'Teach, write, and speak to others' },
  { value: 'sideproject', icon: '🔨', label: 'Launch a side project',  desc: 'Build something new and find early users' },
];

const EXPERIENCE = [
  { value: 'student',   icon: '🌱', label: 'Early-stage',       desc: 'Student or entry-level, 0–1 year' },
  { value: 'junior',    icon: '📗', label: 'Junior',             desc: '1–3 years of experience' },
  { value: 'mid',       icon: '📘', label: 'Mid-level',          desc: '3–6 years of experience' },
  { value: 'senior',    icon: '📙', label: 'Senior',             desc: '6–10 years of experience' },
  { value: 'principal', icon: '🏅', label: 'Principal / Staff',  desc: '10+ years, deep expertise' },
  { value: 'exec',      icon: '🏆', label: 'Executive',          desc: 'C-suite, VP, or Founder' },
];

const BASE_INTERESTS = [
  'AI & Machine Learning', 'Generative AI', 'LLMs & Chatbots', 'Computer Vision',
  'Data Science', 'Developer Tools', 'Open Source', 'Cybersecurity',
  'Cloud & DevOps', 'Frontend Dev', 'Backend Dev', 'Mobile Dev',
  'Web3 / Crypto', 'Blockchain', 'Hardware / IoT', 'Robotics',
  'AR / VR', 'Quantum Computing', 'Game Dev', 'No-Code / Low-Code',
  'SaaS', 'B2B / Enterprise', 'Marketplaces', 'D2C / Consumer Apps',
  'Bootstrapping', 'Venture Capital', 'Angel Investing', 'Fundraising',
  'Growth Marketing', 'Product-Led Growth', 'Sales & Revenue', 'Partnerships',
  'UI/UX Design', 'Design Systems', 'Brand Identity', 'Motion Design',
  '3D & CGI', 'Photography', 'Film & Video', 'Music Production',
  'Visual Storytelling', 'Brand Strategy',
  'FinTech', 'Corporate Finance', 'Personal Finance', 'Real Estate',
  'Supply Chain', 'Customer Experience', 'Operations Excellence', 'Business Strategy',
  'Health Tech', 'BioTech', 'Climate Tech', 'EdTech',
  'LegalTech', 'GovTech', 'AgriTech', 'SpaceTech',
  'PropTech', 'RetailTech', 'FoodTech', 'SportsTech',
  'Nonprofit Impact', 'Sustainability', 'Wellness', 'Hospitality',
  'Remote Work', 'Future of Work', 'Recruiting & Hiring', 'Leadership',
  'Diversity & Inclusion', 'Mental Health & Wellness', 'People Ops',
  'Creator Economy', 'Podcasting', 'Newsletter & Writing',
  'YouTube & Video', 'Social Media', 'SEO & Content',
  'E-commerce', 'Career Growth', 'Productivity', 'Public Speaking',
  'Side Projects', 'Freelancing', 'Social Impact',
  'Fitness & Gym', 'Yoga & Meditation', 'Running & Cycling',
  'Nutrition & Diet', 'Sports & Athletics',
  'Music Discovery', 'Cooking & Recipes', 'Travel & Adventure',
  'Fashion & Style', 'Reading & Book Clubs', 'Video Games',
  'Mindfulness & Meditation', 'Philosophy & Ethics', 'Parenting & Family',
];
const ALL_INTERESTS = [...new Set([...BASE_INTERESTS, ...EXTRA_INTERESTS])];

// ── Role → icon / color metadata (for badge display) ─────────────────────────
const ROLE_META = {
  'Engineer / Developer':    { icon: '💻', color: '#2563EB', bg: '#EFF6FF', tagline: 'Software, ML, DevOps',          fields: [{ key: 'primaryStack', label: 'Primary tech stack', placeholder: 'e.g. React, Node.js, Python, Rust' }, { key: 'preferredRole', label: 'Preferred role type', placeholder: 'e.g. Full-stack, Backend, ML, DevOps' }, { key: 'yearsExp', label: 'Years of coding experience', placeholder: 'e.g. 5' }, { key: 'openToWork', label: 'Open to new opportunities', type: 'toggle' }, { key: 'remoteOnly', label: 'Remote only', type: 'toggle' }] },
  'Designer / Creative':     { icon: '🎨', color: '#7C3AED', bg: '#F3EEFF', tagline: 'UI/UX, Brand, Motion',          fields: [{ key: 'designTools', label: 'Design tools', placeholder: 'e.g. Figma, Sketch, Adobe XD' }, { key: 'specialization', label: 'Specialization', placeholder: 'e.g. UI/UX, Brand Identity, Motion, 3D' }, { key: 'portfolioUrl', label: 'Portfolio URL', placeholder: 'https://yourportfolio.com' }, { key: 'openToWork', label: 'Open to new opportunities', type: 'toggle' }] },
  'Product Manager':         { icon: '📋', color: '#0284C7', bg: '#F0F9FF', tagline: 'Strategy & execution',          fields: [{ key: 'domain', label: 'Product domain', placeholder: 'e.g. B2B SaaS, Consumer, FinTech, API' }, { key: 'methodology', label: 'Methodology', placeholder: 'e.g. Agile, Shape Up, OKRs' }, { key: 'teamSize', label: 'Typical team size', placeholder: 'e.g. 5–10 engineers' }, { key: 'openToWork', label: 'Open to new opportunities', type: 'toggle' }] },
  'Marketer / Growth':       { icon: '📈', color: '#059669', bg: '#ECFDF5', tagline: 'SEO, Content, Ads',             fields: [{ key: 'channels', label: 'Marketing channels', placeholder: 'e.g. SEO, Paid, Content, Email' }, { key: 'tools', label: 'Tools & stack', placeholder: 'e.g. HubSpot, GA4, Segment, Hotjar' }, { key: 'industryFocus', label: 'Industry focus', placeholder: 'e.g. B2B SaaS, E-commerce' }, { key: 'openToWork', label: 'Open to new opportunities', type: 'toggle' }] },
  'Founder / Entrepreneur':  { icon: '🚀', color: '#D97706', bg: '#FFFBEB', tagline: 'Building something new',        fields: [{ key: 'companyName', label: 'Company / Startup name', placeholder: 'e.g. Acme Inc. (or Stealth)' }, { key: 'stage', label: 'Stage', placeholder: 'e.g. Idea, MVP, Pre-seed, Seed' }, { key: 'industryFocus', label: 'Industry / vertical', placeholder: 'e.g. FinTech, HealthTech' }, { key: 'lookingFor', label: 'Currently looking for', placeholder: 'e.g. Co-founder, Engineers, Investors' }, { key: 'openToFunding', label: 'Open to investment discussions', type: 'toggle' }] },
  'Investor / VC':           { icon: '💰', color: '#DB2777', bg: '#FDF2F8', tagline: 'VC, Angel, LP',                 fields: [{ key: 'checkSize', label: 'Typical check size', placeholder: 'e.g. $25k–$500k' }, { key: 'stagePreference', label: 'Stage preference', placeholder: 'e.g. Pre-seed, Seed, Series A' }, { key: 'sectors', label: 'Sectors of interest', placeholder: 'e.g. AI, FinTech, Climate' }, { key: 'openToDeals', label: 'Actively looking for deals', type: 'toggle' }] },
  'Data / Analytics':        { icon: '📊', color: '#EA580C', bg: '#FFF7ED', tagline: 'Data Sci, BI, MLOps',           fields: [{ key: 'tools', label: 'Tools & stack', placeholder: 'e.g. Python, SQL, dbt, Looker' }, { key: 'domain', label: 'Domain', placeholder: 'e.g. Product Analytics, ML Ops, BI' }, { key: 'openToWork', label: 'Open to new opportunities', type: 'toggle' }] },
  'Student / Learner':       { icon: '🎓', color: '#7C3AED', bg: '#F3EEFF', tagline: 'Growing & exploring',           fields: [{ key: 'school', label: 'School / Bootcamp', placeholder: 'e.g. MIT, General Assembly, Self-taught' }, { key: 'graduationYear', label: 'Graduation year', placeholder: 'e.g. 2025' }, { key: 'targetRole', label: 'Target role', placeholder: 'e.g. Software Engineer, Product Manager' }, { key: 'currentlyLearning', label: 'Currently learning', placeholder: 'e.g. React, Machine Learning' }, { key: 'openToWork', label: 'Open to internships', type: 'toggle' }] },
  'Sales / Business Dev':    { icon: '🤝', color: '#2563EB', bg: '#EFF6FF', tagline: 'Revenue & partnerships',        fields: [{ key: 'dealType', label: 'Deal type', placeholder: 'e.g. SMB, Mid-market, Enterprise' }, { key: 'industryFocus', label: 'Industry focus', placeholder: 'e.g. SaaS, FinTech, Healthcare' }, { key: 'tools', label: 'CRM & tools', placeholder: 'e.g. Salesforce, HubSpot, Outreach' }, { key: 'openToWork', label: 'Open to new opportunities', type: 'toggle' }] },
  'Operations / Finance':    { icon: '⚙️', color: '#059669', bg: '#ECFDF5', tagline: 'Ops, accounting, strategy',    fields: [{ key: 'specialization', label: 'Specialization', placeholder: 'e.g. Finance, RevOps, Legal, Strategy' }, { key: 'industryFocus', label: 'Industry', placeholder: 'e.g. Tech, Healthcare, Finance' }, { key: 'companyStage', label: 'Company stage preference', placeholder: 'e.g. Startup, Scale-up, Enterprise' }, { key: 'openToWork', label: 'Open to new opportunities', type: 'toggle' }] },
  'Content Creator':         { icon: '🎬', color: '#D97706', bg: '#FFFBEB', tagline: 'Video, writing, podcasts',      fields: [{ key: 'platforms', label: 'Platforms', placeholder: 'e.g. YouTube, Newsletter, Podcast, TikTok' }, { key: 'niche', label: 'Niche / topic', placeholder: 'e.g. Tech, Finance, Productivity, Fitness' }, { key: 'audienceSize', label: 'Audience size', placeholder: 'e.g. 10k followers' }, { key: 'openToCollabs', label: 'Open to collaborations', type: 'toggle' }] },
  'HR / People Ops':         { icon: '👥', color: '#DB2777', bg: '#FDF2F8', tagline: 'Recruiting, culture, L&D',      fields: [{ key: 'specialization', label: 'Specialization', placeholder: 'e.g. Recruiting, L&D, HRBP, Comp & Ben' }, { key: 'companySize', label: 'Company size focus', placeholder: 'e.g. Startup, Mid-size, Enterprise' }, { key: 'industryFocus', label: 'Industry', placeholder: 'e.g. Tech, Finance, Healthcare' }, { key: 'openToWork', label: 'Open to new opportunities', type: 'toggle' }] },
};
const DEFAULT_META = { icon: '👤', color: 'var(--primary)', bg: 'var(--primary-light)', tagline: 'UFIConnect Member', fields: [] };

// ── Sub-components ────────────────────────────────────────────────────────────
function Toggle({ value, onChange }) {
  return (
    <button type="button" onClick={onChange} style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: value ? 'var(--primary)' : 'var(--border)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: value ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
    </button>
  );
}

function SectionHeading({ children }) {
  return <h3 style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 14 }}>{children}</h3>;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Settings() {
  const { profile, updateProfileLocally, logout } = useAuth();
  const role = profile?.preferences?.role || '';
  const meta = ROLE_META[role] || DEFAULT_META;
  const [activeTab, setActiveTab] = useState('general');
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'preferences') setActiveTab('preferences');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── General / role-specific settings state ────────────────────────────────
  const [form, setForm] = useState({
    name:         profile?.name         || '',
    title:        profile?.title        || '',
    bio:          profile?.bio          || '',
    organization: profile?.organization || '',
    skills:       (profile?.skills || []).join(', '),
  });
  const [roleSettings, setRoleSettings] = useState({ ...(profile?.roleSettings || {}) });
  const [notifs, setNotifs] = useState({
    emailDigest:      roleSettings.notifs_emailDigest      ?? true,
    communityUpdates: roleSettings.notifs_communityUpdates ?? true,
    newOpportunities: roleSettings.notifs_newOpportunities ?? true,
    mentions:         roleSettings.notifs_mentions         ?? true,
  });
  const [privacy, setPrivacy] = useState({
    publicProfile: roleSettings.privacy_publicProfile ?? true,
    showEmail:     roleSettings.privacy_showEmail     ?? false,
    showSkills:    roleSettings.privacy_showSkills    ?? true,
    showGroups:    roleSettings.privacy_showGroups    ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');

  function handleChange(e)    { setForm(f => ({ ...f, [e.target.name]: e.target.value })); }
  function handleRoleField(e) { setRoleSettings(r => ({ ...r, [e.target.name]: e.target.value })); }
  function handleRoleToggle(k){ setRoleSettings(r => ({ ...r, [k]: !r[k] })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setError(''); setSaved(false);
    try {
      const merged = {
        ...roleSettings,
        notifs_emailDigest:      notifs.emailDigest,
        notifs_communityUpdates: notifs.communityUpdates,
        notifs_newOpportunities: notifs.newOpportunities,
        notifs_mentions:         notifs.mentions,
        privacy_publicProfile:   privacy.publicProfile,
        privacy_showEmail:       privacy.showEmail,
        privacy_showSkills:      privacy.showSkills,
        privacy_showGroups:      privacy.showGroups,
      };
      const payload = { ...form, skills: form.skills.split(',').map(s => s.trim()).filter(Boolean), roleSettings: merged };
      const { data } = await client.patch('/profile', payload);
      updateProfileLocally(data.profile || data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setError('Failed to save. Please try again.'); }
    finally { setSaving(false); }
  }

  // ── Preferences tab state ─────────────────────────────────────────────────
  const [prefRole,       setPrefRole]       = useState(profile?.preferences?.role       || '');
  const [prefExperience, setPrefExperience] = useState(profile?.preferences?.experience || '');
  const [prefGoals,      setPrefGoals]      = useState(profile?.preferences?.goals      || []);
  const [prefInterests,  setPrefInterests]  = useState(profile?.preferences?.interests  || []);
  const [interestSearch, setInterestSearch] = useState('');
  const [roleSearch,     setRoleSearch]     = useState('');
  const [prefSaving,     setPrefSaving]     = useState(false);
  const [prefSaved,      setPrefSaved]      = useState(false);
  const [prefError,      setPrefError]      = useState('');

  function toggleGoal(v)     { setPrefGoals(g => g.includes(v) ? g.filter(x => x !== v) : [...g, v]); }
  function toggleInterest(v) { setPrefInterests(i => i.includes(v) ? i.filter(x => x !== v) : [...i, v]); }

  const filteredRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    if (!q) return ALL_ROLES;
    return ALL_ROLES.filter(r => r.value.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q));
  }, [roleSearch]);

  const filteredInterests = useMemo(() => {
    const q = interestSearch.trim().toLowerCase();
    if (!q) return ALL_INTERESTS;
    return ALL_INTERESTS.filter(i => i.toLowerCase().includes(q));
  }, [interestSearch]);

  async function handlePrefSave(e) {
    e.preventDefault();
    setPrefSaving(true); setPrefError(''); setPrefSaved(false);
    try {
      const { data } = await client.post('/profile/onboarding', {
        role: prefRole, experience: prefExperience,
        goals: prefGoals, interests: prefInterests,
      });
      updateProfileLocally(data.profile || data);
      setPrefSaved(true);
      setTimeout(() => setPrefSaved(false), 3000);
    } catch { setPrefError('Failed to save preferences. Please try again.'); }
    finally { setPrefSaving(false); }
  }

  if (!profile) return (
    <Layout><div className="empty-state"><span className="spinner spinner-primary" /></div></Layout>
  );

  const TABS = [
    { key: 'general',     label: 'General' },
    { key: 'preferences', label: '🎯 Preferences' },
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
          <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
            style={{ padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: activeTab === tab.key ? 700 : 500, fontSize: '.875rem', color: activeTab === tab.key ? 'var(--primary)' : 'var(--muted)', borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent', marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {tab.label}
            {tab.badge ? <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: 10, fontSize: '.65rem', fontWeight: 700, padding: '1px 6px', lineHeight: 1.4 }}>{tab.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* ── Preferences tab ──────────────────────────────────────────────────── */}
      {activeTab === 'preferences' && (
        <form onSubmit={handlePrefSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {prefError && <div className="auth-error">{prefError}</div>}
          {prefSaved && (
            <div style={{ background: '#ECFDF5', color: '#059669', padding: '10px 14px', borderRadius: 8, fontSize: '.875rem', fontWeight: 600 }}>
              ✓ Preferences saved — your feed and recommendations will update shortly.
            </div>
          )}

          {/* Role */}
          <div className="card">
            <SectionHeading>🎭 Your Role</SectionHeading>
            <input
              className="form-input"
              placeholder="Search roles…"
              value={roleSearch}
              onChange={e => setRoleSearch(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {filteredRoles.map(r => {
                const sel = prefRole === r.value;
                return (
                  <button key={r.value} type="button" onClick={() => setPrefRole(r.value)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, background: sel ? 'var(--primary-light)' : 'var(--surface)', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>{r.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '.82rem', color: sel ? 'var(--primary)' : 'var(--text)' }}>{r.value}</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--muted)', lineHeight: 1.3 }}>{r.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            {prefRole && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--primary-light)', fontSize: '.82rem', color: 'var(--primary)', fontWeight: 600 }}>
                Selected: {prefRole}
                <button type="button" onClick={() => setPrefRole('')} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '.9rem' }}>×</button>
              </div>
            )}
          </div>

          {/* Experience */}
          <div className="card">
            <SectionHeading>📈 Experience Level</SectionHeading>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {EXPERIENCE.map(exp => {
                const sel = prefExperience === exp.value;
                return (
                  <button key={exp.value} type="button" onClick={() => setPrefExperience(exp.value)}
                    style={{ padding: '12px', borderRadius: 10, border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, background: sel ? 'var(--primary-light)' : 'var(--surface)', cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{exp.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: '.82rem', color: sel ? 'var(--primary)' : 'var(--text)' }}>{exp.label}</div>
                    <div style={{ fontSize: '.68rem', color: 'var(--muted)', marginTop: 2 }}>{exp.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Goals */}
          <div className="card">
            <SectionHeading>🎯 Goals</SectionHeading>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {GOALS.map(goal => {
                const sel = prefGoals.includes(goal.value);
                return (
                  <button key={goal.value} type="button" onClick={() => toggleGoal(goal.value)}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px', borderRadius: 10, border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, background: sel ? 'var(--primary-light)' : 'var(--surface)', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>{goal.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '.82rem', color: sel ? 'var(--primary)' : 'var(--text)' }}>{goal.label}</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: 2, lineHeight: 1.3 }}>{goal.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interests */}
          <div className="card">
            <SectionHeading>💡 Interests</SectionHeading>
            <input
              className="form-input"
              placeholder="Search interests…"
              value={interestSearch}
              onChange={e => setInterestSearch(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            {prefInterests.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {prefInterests.map(i => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: 'var(--primary)', color: '#fff', fontSize: '.78rem', fontWeight: 600 }}>
                    {i}
                    <button type="button" onClick={() => toggleInterest(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, fontSize: '.9rem', opacity: .8 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {filteredInterests.map(i => {
                const sel = prefInterests.includes(i);
                if (sel) return null;
                return (
                  <button key={i} type="button" onClick={() => toggleInterest(i)}
                    style={{ padding: '5px 12px', borderRadius: 20, border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '.78rem', fontWeight: 500, cursor: 'pointer' }}>
                    {i}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--muted)' }}>
              {prefInterests.length} selected
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, paddingBottom: 32 }}>
            <button className="btn btn-primary" type="submit" disabled={prefSaving}>
              {prefSaving ? <span className="spinner" /> : 'Save preferences'}
            </button>
          </div>
        </form>
      )}

      {/* ── General tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && <div className="auth-error">{error}</div>}
          {saved && (
            <div style={{ background: '#ECFDF5', color: '#059669', padding: '10px 14px', borderRadius: 8, fontSize: '.875rem', fontWeight: 600 }}>
              ✓ Settings saved
            </div>
          )}

          {/* Account info */}
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
            </div>
            <div className="form-group" style={{ marginBottom: 4 }}>
              <label className="form-label">Email address</label>
              <input className="form-input" value={profile.email} disabled style={{ background: 'var(--bg-secondary)', color: 'var(--muted)' }} />
              <span style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 3, display: 'block' }}>Email cannot be changed. Contact support if you need help.</span>
            </div>
          </div>

          {/* Role badge */}
          {role && (
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }}>{meta.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '.95rem', color: meta.color }}>{role}</div>
                <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 2 }}>{meta.tagline}</div>
              </div>
              <button type="button" onClick={() => setActiveTab('preferences')} className="btn btn-ghost btn-sm">
                Edit preferences →
              </button>
            </div>
          )}

          {/* General profile */}
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

          {/* Role-specific fields */}
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

          {/* Notifications */}
          <div className="card">
            <SectionHeading>🔔 Notifications</SectionHeading>
            {[
              { key: 'emailDigest',       label: 'Weekly email digest',     desc: 'A summary of top posts and opportunities in your groups.' },
              { key: 'communityUpdates',  label: 'Community updates',       desc: 'New members, posts, and announcements from your groups.' },
              { key: 'newOpportunities',  label: 'New opportunities',       desc: 'Job listings, gigs, and grants matching your profile.' },
              { key: 'mentions',          label: 'Mentions and replies',    desc: 'When someone mentions or replies to you.' },
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

          {/* Privacy */}
          <div className="card">
            <SectionHeading>🔒 Privacy</SectionHeading>
            {[
              { key: 'publicProfile',  label: 'Public profile',    desc: 'Allow anyone on UFIConnect to view your profile.' },
              { key: 'showEmail',      label: 'Show email address', desc: 'Display your email on your public profile.' },
              { key: 'showSkills',     label: 'Show skills',        desc: 'Display your skill tags on your profile card.' },
              { key: 'showGroups',     label: 'Show groups',        desc: 'Let others see which groups you belong to.' },
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

          {/* Danger zone */}
          <div className="card" style={{ borderColor: '#FCA5A5' }}>
            <SectionHeading>⚠️ Danger Zone</SectionHeading>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '.875rem' }}>Delete account</div>
                <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 2 }}>Permanently remove your account and all associated data. This cannot be undone.</div>
              </div>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteModal(true)}>Delete account</button>
            </div>
          </div>

          {/* Delete confirmation modal */}
          {deleteModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
              <div className="card" style={{ width: '100%', maxWidth: 440, padding: 28, borderRadius: 20 }}>
                <div style={{ fontSize: '2rem', marginBottom: 12, textAlign: 'center' }}>⚠️</div>
                <h3 style={{ margin: '0 0 8px', textAlign: 'center' }}>Delete your account?</h3>
                <p style={{ fontSize: '.85rem', color: 'var(--muted)', textAlign: 'center', marginBottom: 20, lineHeight: 1.6 }}>
                  This will permanently delete your profile, posts, and all account data. This action <strong>cannot be undone</strong>.
                </p>
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">Type <strong>DELETE</strong> to confirm</label>
                  <input className="form-input" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="Type DELETE here" autoFocus />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setDeleteModal(false); setDeleteConfirm(''); }}>Cancel</button>
                  <button className="btn btn-danger" style={{ flex: 1 }} disabled={deleteConfirm !== 'DELETE' || deleting}
                    onClick={async () => {
                      setDeleting(true);
                      try { await client.delete('/profile'); logout(); } catch {
                        alert('Failed to delete account. Please contact support@uficonnect.org.');
                        setDeleting(false);
                      }
                    }}>
                    {deleting ? <span className="spinner" /> : 'Permanently delete'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Save */}
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
