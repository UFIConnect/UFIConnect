import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';

const ROLE_MACROS = [
  {
    role: 'Engineer / Developer', icon: '💻', label: 'Developer', color: '#2563EB', bg: '#EFF6FF',
    desc: 'Build products and ship code',
    titles: ['Software Engineer', 'Full-Stack Developer', 'Backend Engineer', 'Frontend Developer', 'ML Engineer', 'DevOps Engineer'],
    bioTemplate: "Software engineer who loves building scalable systems and shipping products that make a real difference.",
    related: ['AI & Machine Learning', 'Open Source', 'Cloud & DevOps', 'Backend Dev', 'Frontend Dev'],
  },
  {
    role: 'Designer / Creative', icon: '🎨', label: 'Designer', color: '#7C3AED', bg: '#F3EEFF',
    desc: 'Create beautiful experiences',
    titles: ['UX/UI Designer', 'Product Designer', 'Brand Designer', 'Visual Designer', 'Creative Director', 'Motion Designer'],
    bioTemplate: "Designer passionate about crafting intuitive, beautiful experiences that connect people with ideas.",
    related: ['UI/UX Design', 'Design Systems', 'Brand Identity', 'Motion Design', 'Photography'],
  },
  {
    role: 'Founder / Entrepreneur', icon: '🚀', label: 'Founder', color: '#D97706', bg: '#FFFBEB',
    desc: 'Building something new',
    titles: ['Founder & CEO', 'Co-Founder', 'Startup Founder', 'Indie Hacker', 'Builder', 'Entrepreneur'],
    bioTemplate: "Founder building in public. I love turning ideas into products and finding early adopters who believe in the vision.",
    related: ['SaaS', 'Bootstrapping', 'Fundraising', 'Growth Marketing', 'Side Projects'],
  },
  {
    role: 'Marketer / Growth', icon: '📈', label: 'Marketer', color: '#059669', bg: '#ECFDF5',
    desc: 'Drive acquisition and growth',
    titles: ['Growth Marketing Lead', 'Head of Marketing', 'Digital Marketing Manager', 'Content Strategist', 'SEO Specialist', 'Brand Manager'],
    bioTemplate: "Growth marketer obsessed with finding channels that convert and stories that stick.",
    related: ['Growth Marketing', 'SEO & Content', 'Creator Economy', 'Social Media', 'Brand Identity'],
  },
  {
    role: 'Product Manager', icon: '📋', label: 'Product', color: '#0284C7', bg: '#F0F9FF',
    desc: 'Strategy, roadmaps, outcomes',
    titles: ['Senior Product Manager', 'Product Lead', 'Head of Product', 'Associate PM', 'Group PM', 'VP of Product'],
    bioTemplate: "Product manager who thrives at the intersection of user needs, business goals, and engineering constraints.",
    related: ['SaaS', 'AI & Machine Learning', 'Product-Led Growth', 'B2B / Enterprise', 'Growth Marketing'],
  },
  {
    role: 'Investor / VC', icon: '💰', label: 'Investor', color: '#DB2777', bg: '#FDF2F8',
    desc: 'Back great founders and ideas',
    titles: ['Angel Investor', 'Venture Partner', 'VC Analyst', 'Investment Manager', 'Fund Manager', 'Limited Partner'],
    bioTemplate: "Investor backing ambitious founders at the intersection of technology and human impact.",
    related: ['Venture Capital', 'Angel Investing', 'FinTech', 'SaaS', 'Health Tech'],
  },
  {
    role: 'Content Creator', icon: '🎬', label: 'Creator', color: '#EA580C', bg: '#FFF7ED',
    desc: 'Video, writing, and podcasts',
    titles: ['Content Creator', 'YouTuber', 'Podcast Host', 'Newsletter Writer', 'Social Media Creator', 'Blogger'],
    bioTemplate: "Content creator making videos, writing, and building an audience around things I genuinely care about.",
    related: ['Creator Economy', 'YouTube & Video', 'Podcasting', 'Newsletter & Writing', 'Social Media'],
  },
  {
    role: 'Data / Analytics', icon: '📊', label: 'Data', color: '#7C3AED', bg: '#F3EEFF',
    desc: 'Turn data into decisions',
    titles: ['Data Scientist', 'Data Analyst', 'ML Engineer', 'BI Lead', 'Analytics Engineer', 'Quant Researcher'],
    bioTemplate: "Data scientist who finds signal in noise and translates complex analytics into clear business decisions.",
    related: ['Data Science', 'AI & Machine Learning', 'Cloud & DevOps', 'Open Source', 'Business Strategy'],
  },
  {
    role: 'Student / Learner', icon: '🎓', label: 'Student', color: '#6D28D9', bg: '#F5F3FF',
    desc: 'Growing and exploring',
    titles: ['Student', 'Junior Developer', 'Bootcamp Graduate', 'Recent Graduate', 'Aspiring Engineer', 'Career Switcher'],
    bioTemplate: "Student and lifelong learner exploring new technologies and building projects to sharpen my skills.",
    related: ['Career Growth', 'AI & Machine Learning', 'Open Source', 'Side Projects', 'Developer Tools'],
  },
  {
    role: 'Operations / Finance', icon: '⚙️', label: 'Operations', color: '#059669', bg: '#ECFDF5',
    desc: 'Process, logistics, business',
    titles: ['Operations Manager', 'COO', 'Finance Manager', 'Business Analyst', 'Strategy Lead', 'Chief of Staff'],
    bioTemplate: "Operations and finance professional focused on building systems that scale and businesses that last.",
    related: ['Business Strategy', 'FinTech', 'Operations Excellence', 'Corporate Finance', 'Leadership'],
  },
  {
    role: 'Community Manager', icon: '🌐', label: 'Community', color: '#0284C7', bg: '#F0F9FF',
    desc: 'Grow and engage communities',
    titles: ['Community Manager', 'Head of Community', 'Developer Relations', 'Community Lead', 'Partnership Manager'],
    bioTemplate: "Community builder who thrives on creating genuine connections and spaces where people grow together.",
    related: ['Creator Economy', 'Social Media', 'Diversity & Inclusion', 'Leadership', 'EdTech'],
  },
  {
    role: 'Healthcare Professional', icon: '🩺', label: 'Healthcare', color: '#DC2626', bg: '#FEF2F2',
    desc: 'Wellness, care, and impact',
    titles: ['Healthcare Professional', 'Nurse Practitioner', 'Physician', 'Healthcare Manager', 'Medical Researcher'],
    bioTemplate: "Healthcare professional committed to improving patient outcomes and advancing evidence-based care.",
    related: ['Health Tech', 'BioTech', 'Mental Health & Wellness', 'AI & Machine Learning', 'Data Science'],
  },
  {
    role: 'Athlete / Coach', icon: '🏆', label: 'Athlete', color: '#B45309', bg: '#FEF3C7',
    desc: 'Sports, performance, coaching',
    titles: ['Personal Trainer', 'Sports Coach', 'Athletic Director', 'Performance Coach', 'Fitness Instructor'],
    bioTemplate: "Athlete and coach dedicated to unlocking human performance and helping people reach their physical best.",
    related: ['Sports & Athletics', 'Fitness & Gym', 'Running & Cycling', 'Nutrition & Diet', 'Leadership'],
  },
  {
    role: 'Musician / Artist', icon: '🎵', label: 'Musician', color: '#0891B2', bg: '#ECFEFF',
    desc: 'Music, art, and creativity',
    titles: ['Musician', 'Music Producer', 'Artist', 'Songwriter', 'DJ', 'Performer'],
    bioTemplate: "Musician and artist exploring sound, expression, and the spaces where creativity meets culture.",
    related: ['Music Discovery', 'Music Production', 'Songwriting', 'Creator Economy', 'Live Events & Concerts'],
  },
  {
    role: 'Chef / Food Creator', icon: '👨‍🍳', label: 'Chef', color: '#D97706', bg: '#FFFBEB',
    desc: 'Culinary arts and food content',
    titles: ['Executive Chef', 'Food Creator', 'Chef', 'Culinary Director', 'Recipe Developer', 'Food Blogger'],
    bioTemplate: "Chef and food creator passionate about ingredients, technique, and sharing stories through food.",
    related: ['Cooking & Recipes', 'Restaurant Culture', 'Baking & Pastry', 'FoodTech', 'Creator Economy'],
  },
  {
    role: 'Real Estate Pro', icon: '🏠', label: 'Real Estate', color: '#065F46', bg: '#ECFDF5',
    desc: 'Property, investment, development',
    titles: ['Real Estate Agent', 'Property Developer', 'Real Estate Investor', 'Mortgage Broker', 'Property Manager'],
    bioTemplate: "Real estate professional helping people find homes, build wealth, and navigate property markets.",
    related: ['Real Estate', 'PropTech', 'Personal Finance', 'Business Strategy', 'Interior Design & Decor'],
  },
];

const EXPERIENCE_LEVELS = [
  { value: 'student', icon: '🌱', label: 'Early',    desc: '0–2 yrs' },
  { value: 'junior',  icon: '📗', label: 'Junior',    desc: '2–4 yrs' },
  { value: 'mid',     icon: '📘', label: 'Mid',       desc: '4–7 yrs' },
  { value: 'senior',  icon: '📙', label: 'Senior',    desc: '7–12 yrs' },
  { value: 'exec',    icon: '🏆', label: 'Executive', desc: 'C-suite / Founder' },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form,        setForm]       = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [selectedMacro, setMacro]   = useState(null);
  const [title,       setTitle]      = useState('');
  const [bio,         setBio]        = useState('');
  const [experience,  setExperience] = useState('');
  const [error,       setError]      = useState('');
  const [loading,     setLoading]    = useState(false);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
    setError('');
  }

  function selectMacro(macro) {
    setMacro(macro);
    setTitle(macro.titles[0]);
    setBio(macro.bioTemplate);
    if (!experience) setExperience('mid');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.email || !form.password || !form.confirmPassword) {
      setError('All fields are required.'); return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.'); return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.'); return;
    }
    setLoading(true);
    try {
      await register(form.name, form.email, form.password, title);
      // Persist signup context for onboarding to read
      if (selectedMacro) {
        localStorage.setItem('ufi_signup_ctx', JSON.stringify({
          role: selectedMacro.role,
          experience,
          bio: bio.trim(),
          title: title.trim(),
          preInterests: selectedMacro.related,
        }));
      }
      navigate('/onboarding', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Join UFIConnect — Professional Network for All Careers</title>
        <meta name="description" content="Create your UFIConnect account and get a personalized feed from day one." />
      </Helmet>

      <div className="auth-page">
        <div className="auth-card" style={{ maxWidth: 580 }}>
          <div className="auth-logo">
            <div className="auth-logo-icon">UF</div>
            <span className="auth-logo-name">UFIConnect</span>
          </div>
          <h1 className="auth-heading">Create your account</h1>
          <p className="auth-sub">Pick your role to personalize your experience from day one.</p>

          {/* ── Role picker ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 7 }}>
              {ROLE_MACROS.map(macro => {
                const isSel = selectedMacro?.role === macro.role;
                return (
                  <button
                    key={macro.role}
                    type="button"
                    onClick={() => selectMacro(macro)}
                    style={{
                      padding: '11px 8px', borderRadius: 12, textAlign: 'center', cursor: 'pointer',
                      border: `2px solid ${isSel ? macro.color : 'var(--border)'}`,
                      background: isSel ? macro.bg : 'var(--surface)',
                      transition: 'all .18s',
                      transform: isSel ? 'scale(1.04)' : 'scale(1)',
                      boxShadow: isSel ? `0 4px 14px ${macro.color}30` : 'none',
                    }}
                  >
                    <div style={{ fontSize: '1.4rem', marginBottom: 3 }}>{macro.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: '.75rem', color: isSel ? macro.color : 'var(--text)' }}>
                      {macro.label}
                    </div>
                    <div style={{ fontSize: '.65rem', color: 'var(--muted)', marginTop: 1, lineHeight: 1.3 }}>
                      {macro.desc}
                    </div>
                    {isSel && <div style={{ marginTop: 4, fontSize: '.62rem', fontWeight: 700, color: macro.color }}>✓</div>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Expanded personalisation (shown after role is picked) ── */}
          {selectedMacro && (
            <div style={{
              marginBottom: 20, padding: '16px', borderRadius: 14,
              background: selectedMacro.bg, border: `1.5px solid ${selectedMacro.color}30`,
            }}>
              {/* Title suggestions */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '.75rem', fontWeight: 700, color: selectedMacro.color, marginBottom: 8 }}>
                  {selectedMacro.icon} Choose a title — or type your own below
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedMacro.titles.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTitle(t)}
                      style={{
                        padding: '5px 12px', borderRadius: 16, fontSize: '.77rem', fontWeight: title === t ? 700 : 500,
                        border: `1.5px solid ${title === t ? selectedMacro.color : selectedMacro.color + '50'}`,
                        background: title === t ? selectedMacro.color : '#fff',
                        color: title === t ? '#fff' : selectedMacro.color,
                        cursor: 'pointer',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Experience picker */}
              <div>
                <div style={{ fontSize: '.75rem', fontWeight: 700, color: selectedMacro.color, marginBottom: 8 }}>
                  Experience level
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {EXPERIENCE_LEVELS.map(({ value, icon, label, desc }) => {
                    const sel = experience === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setExperience(value)}
                        style={{
                          padding: '6px 12px', borderRadius: 20, fontSize: '.75rem', fontWeight: sel ? 700 : 500,
                          border: `1.5px solid ${sel ? selectedMacro.color : selectedMacro.color + '40'}`,
                          background: sel ? selectedMacro.color : '#fff',
                          color: sel ? '#fff' : selectedMacro.color,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {icon} {label}
                        <span style={{ fontSize: '.65rem', opacity: .75 }}>({desc})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Full name</label>
              <input className="form-input" type="text" name="name"
                placeholder="Jane Smith" value={form.name} onChange={handleChange} autoComplete="name" />
            </div>
            <div className="form-group">
              <label className="form-label">Email address</label>
              <input className="form-input" type="email" name="email"
                placeholder="jane@example.com" value={form.email} onChange={handleChange} autoComplete="email" />
            </div>
            <div className="form-group">
              <label className="form-label">
                Professional title <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                className="form-input" type="text" name="title"
                placeholder="e.g. Software Engineer, Creative Director, Founder"
                value={title} onChange={e => setTitle(e.target.value)}
              />
            </div>

            {/* Bio — shown once macro is selected */}
            {selectedMacro && (
              <div className="form-group">
                <label className="form-label">
                  Starter bio <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional — edit or keep)</span>
                </label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  placeholder="A short bio visible on your public profile…"
                  style={{ resize: 'vertical', fontSize: '.88rem', lineHeight: 1.6 }}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" name="password"
                placeholder="At least 6 characters" value={form.password} onChange={handleChange} autoComplete="new-password" />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm password</label>
              <input className="form-input" type="password" name="confirmPassword"
                placeholder="Re-enter your password" value={form.confirmPassword} onChange={handleChange} autoComplete="new-password" />
            </div>

            <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Create account →'}
            </button>
          </form>

          <div className="auth-footer">
            Already have an account? <Link to="/login">Sign in</Link>
          </div>
        </div>
      </div>
    </>
  );
}
