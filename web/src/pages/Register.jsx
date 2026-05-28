import { useState, useMemo } from 'react';
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

// Per-category title focuses for 500+ combinations
const ROLE_FOCUSES = {
  'Engineer / Developer': [
    'Software Engineer', 'Full-Stack Developer', 'Frontend Engineer', 'Backend Engineer',
    'Mobile Developer', 'iOS Developer', 'Android Developer', 'DevOps Engineer',
    'Cloud Architect', 'Platform Engineer', 'ML Engineer', 'Data Engineer',
    'QA Engineer', 'Security Engineer', 'Site Reliability Engineer', 'AI Engineer',
    'Blockchain Developer', 'Game Developer', 'Embedded Engineer', 'Infrastructure Engineer',
  ],
  'Designer / Creative': [
    'UX Designer', 'UI Designer', 'Product Designer', 'Visual Designer', 'Brand Designer',
    'Graphic Designer', 'Motion Designer', 'Creative Director', 'Art Director',
    'Web Designer', 'Industrial Designer', 'Illustrator', 'Design Systems Lead',
    'User Researcher', 'Interaction Designer', 'Typography Designer',
  ],
  'Founder / Entrepreneur': [
    'Founder', 'Co-Founder', 'CEO', 'Entrepreneur', 'Startup Founder',
    'Indie Hacker', 'Product Builder', 'Venture Builder', 'Solopreneur',
  ],
  'Marketer / Growth': [
    'Marketing Manager', 'Growth Manager', 'Digital Marketer', 'Content Marketer',
    'SEO Specialist', 'Brand Manager', 'Social Media Manager', 'Performance Marketer',
    'Email Marketer', 'Demand Gen Manager', 'Product Marketer', 'Growth Hacker',
    'Marketing Analyst', 'Content Creator', 'Influencer Marketer',
  ],
  'Product Manager': [
    'Product Manager', 'Product Owner', 'Technical PM', 'Product Lead',
    'Product Strategist', 'Group PM', 'Enterprise PM', 'Consumer PM',
    'Platform PM', 'Growth PM', 'Data PM',
  ],
  'Investor / VC': [
    'Angel Investor', 'Venture Partner', 'VC Analyst', 'Investment Manager',
    'Fund Manager', 'Portfolio Manager', 'Investment Analyst', 'LP',
    'Deal Sourcing Analyst', 'Investment Director',
  ],
  'Content Creator': [
    'Content Creator', 'YouTuber', 'Podcast Host', 'Newsletter Writer',
    'Video Creator', 'Social Media Creator', 'Blogger', 'Journalist',
    'Content Strategist', 'Vlogger', 'Live Streamer', 'Screenwriter',
  ],
  'Data / Analytics': [
    'Data Scientist', 'Data Analyst', 'Analytics Engineer', 'BI Analyst',
    'ML Engineer', 'Quant Researcher', 'Research Scientist', 'Data Engineer',
    'Statistician', 'Data Architect', 'Business Intelligence Lead',
  ],
  'Student / Learner': [
    'Student', 'Research Assistant', 'Graduate Student', 'Teaching Assistant',
    'Intern', 'Bootcamp Graduate', 'Career Switcher', 'Self-Taught Developer',
    'Academic Researcher', 'PhD Candidate',
  ],
  'Operations / Finance': [
    'Operations Manager', 'COO', 'Finance Manager', 'Business Analyst',
    'Strategy Consultant', 'Chief of Staff', 'Financial Analyst', 'Accountant',
    'Controller', 'Procurement Manager', 'Logistics Manager', 'Revenue Operations Manager',
  ],
  'Community Manager': [
    'Community Manager', 'Head of Community', 'Developer Advocate',
    'Developer Relations', 'Partnership Manager', 'Community Lead',
    'Community Builder', 'Events Manager', 'Brand Ambassador',
  ],
  'Healthcare Professional': [
    'Physician', 'Nurse', 'Nurse Practitioner', 'Healthcare Manager',
    'Medical Researcher', 'Pharmacist', 'Physical Therapist', 'Healthcare Consultant',
    'Medical Director', 'Clinical Lead', 'Surgeon', 'Psychologist',
    'Dentist', 'Public Health Specialist',
  ],
  'Athlete / Coach': [
    'Personal Trainer', 'Sports Coach', 'Athletic Director', 'Performance Coach',
    'Fitness Instructor', 'Strength Coach', 'Wellness Coach', 'Sports Analyst',
    'Nutritionist', 'Physical Conditioning Coach',
  ],
  'Musician / Artist': [
    'Musician', 'Music Producer', 'Songwriter', 'DJ', 'Performer',
    'Artist', 'Recording Artist', 'Session Musician', 'Composer',
    'Sound Designer', 'Music Director', 'Beatmaker',
  ],
  'Chef / Food Creator': [
    'Chef', 'Executive Chef', 'Pastry Chef', 'Food Creator', 'Culinary Director',
    'Recipe Developer', 'Food Blogger', 'Catering Manager', 'Sous Chef',
    'Food Scientist', 'Nutritionist',
  ],
  'Real Estate Pro': [
    'Real Estate Agent', 'Property Manager', 'Real Estate Investor', 'Property Developer',
    'Mortgage Broker', 'Real Estate Consultant', 'Commercial Agent', 'Leasing Agent',
    'Real Estate Analyst', 'Appraiser',
  ],
};

const TITLE_PREFIXES = [
  '', 'Junior ', 'Senior ', 'Lead ', 'Principal ', 'Staff ',
  'Head of ', 'Director of ', 'VP of ', 'Chief ', 'Associate ', 'Entry-Level ',
];

function getAllTitlesForCategory(categoryRole) {
  const focuses = ROLE_FOCUSES[categoryRole] || [];
  const all = new Set();
  for (const prefix of TITLE_PREFIXES) {
    for (const focus of focuses) {
      all.add((prefix + focus).trim());
    }
  }
  return [...all];
}

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

  const [step,          setStep]        = useState(0);
  const [form,          setForm]        = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [selectedMacro, setMacro]       = useState(null);
  const [title,         setTitle]       = useState('');
  const [titleSearch,   setTitleSearch] = useState('');
  const [showDropdown,  setShowDropdown]= useState(false);
  const [bio,           setBio]         = useState('');
  const [experience,    setExperience]  = useState('');
  const [error,         setError]       = useState('');
  const [loading,       setLoading]     = useState(false);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
    setError('');
  }

  function handleStep1(e) {
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
    setError('');
    setStep(1);
  }

  function selectMacro(macro) {
    setMacro(macro);
    setTitle(macro.titles[0]);
    setTitleSearch(macro.titles[0]);
    setBio(macro.bioTemplate);
    if (!experience) setExperience('mid');
    setShowDropdown(false);
  }

  function pickTitle(t) {
    setTitle(t);
    setTitleSearch(t);
    setShowDropdown(false);
  }

  const allTitles = useMemo(
    () => selectedMacro ? getAllTitlesForCategory(selectedMacro.role) : [],
    [selectedMacro?.role]
  );

  const filteredTitles = useMemo(() => {
    const q = titleSearch.toLowerCase().trim();
    if (!q) return allTitles.slice(0, 20);
    return allTitles.filter(t => t.toLowerCase().includes(q)).slice(0, 20);
  }, [allTitles, titleSearch]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await register(form.name, form.email, form.password, title);
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
      if (!err.response) {
        setError('Server is starting up — wait 30 seconds and try again.');
      } else if (err.response.status === 409) {
        setError('That email is already registered. Sign in instead.');
      } else {
        setError(err.response?.data?.message || 'Registration failed. Please try again.');
      }
      setStep(0);
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
        <div className="auth-card" style={{ maxWidth: step === 0 ? 460 : 620 }}>
          <div className="auth-logo">
            <div className="auth-logo-icon">UF</div>
            <span className="auth-logo-name">UFIConnect</span>
          </div>

          {/* ── Step indicator ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
            {[0, 1].map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '.75rem', fontWeight: 700,
                  background: step === s ? 'var(--primary)' : step > s ? 'var(--primary)' : 'var(--border)',
                  color: step >= s ? '#fff' : 'var(--muted)',
                }}>
                  {step > s ? '✓' : s + 1}
                </div>
                {s === 0 && <div style={{ width: 32, height: 2, background: step >= 1 ? 'var(--primary)' : 'var(--border)', borderRadius: 1 }} />}
              </div>
            ))}
          </div>

          {/* ─────────── STEP 0: Account ─────────── */}
          {step === 0 && (
            <>
              <h1 className="auth-heading" style={{ marginBottom: 6 }}>Create your account</h1>
              <p className="auth-sub" style={{ marginBottom: 24 }}>Join thousands of professionals on UFIConnect — free forever.</p>

              {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

              <form onSubmit={handleStep1}>
                <div className="form-group">
                  <label className="form-label">Full name</label>
                  <input className="form-input" type="text" name="name"
                    placeholder="Jane Smith" value={form.name} onChange={handleChange} autoComplete="name" autoFocus />
                </div>
                <div className="form-group">
                  <label className="form-label">Email address</label>
                  <input className="form-input" type="email" name="email"
                    placeholder="jane@example.com" value={form.email} onChange={handleChange} autoComplete="email" />
                </div>
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

                <button className="btn btn-primary btn-full btn-lg" type="submit">
                  Continue →
                </button>
              </form>

              <div className="auth-footer">
                Already have an account? <Link to="/login">Sign in</Link>
              </div>
            </>
          )}

          {/* ─────────── STEP 1: Role personalization ─────────── */}
          {step === 1 && (
            <>
              <h1 className="auth-heading" style={{ marginBottom: 6 }}>Who are you professionally?</h1>
              <p className="auth-sub" style={{ marginBottom: 20 }}>
                Pick your category — then choose your specific title from 500+ options.
              </p>

              {/* Role category grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: 7, marginBottom: 20 }}>
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
                      <div style={{ fontSize: '.63rem', color: 'var(--muted)', marginTop: 1, lineHeight: 1.3 }}>
                        {macro.desc}
                      </div>
                      {isSel && <div style={{ marginTop: 4, fontSize: '.62rem', fontWeight: 700, color: macro.color }}>✓ selected</div>}
                    </button>
                  );
                })}
              </div>

              {/* ── Personalization panel (shown once category is picked) ── */}
              {selectedMacro && (
                <div style={{
                  marginBottom: 20, padding: '18px', borderRadius: 14,
                  background: selectedMacro.bg, border: `1.5px solid ${selectedMacro.color}30`,
                }}>
                  {/* Title search + suggestions */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: '.75rem', fontWeight: 700, color: selectedMacro.color, marginBottom: 8 }}>
                      {selectedMacro.icon} Your professional title
                      <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--muted)', fontSize: '.68rem' }}>
                        ({allTitles.length}+ options)
                      </span>
                    </div>

                    {/* Quick-pick pills */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                      {selectedMacro.titles.map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => pickTitle(t)}
                          style={{
                            padding: '4px 11px', borderRadius: 16, fontSize: '.75rem', fontWeight: title === t ? 700 : 500,
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

                    {/* Searchable title input */}
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input"
                        placeholder="Search or type your exact title…"
                        value={titleSearch}
                        onChange={e => {
                          setTitleSearch(e.target.value);
                          setTitle(e.target.value);
                          setShowDropdown(true);
                        }}
                        onFocus={() => setShowDropdown(true)}
                        onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                        style={{ fontSize: '.88rem' }}
                      />
                      {showDropdown && filteredTitles.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                          background: '#fff', border: '1px solid var(--border)', borderRadius: 10,
                          boxShadow: '0 8px 24px rgba(0,0,0,.1)', marginTop: 4, maxHeight: 220, overflowY: 'auto',
                        }}>
                          {filteredTitles.map(t => (
                            <button
                              key={t}
                              type="button"
                              onMouseDown={() => pickTitle(t)}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                                fontSize: '.84rem', background: 'none', border: 'none', cursor: 'pointer',
                                borderBottom: '1px solid var(--border)',
                                fontWeight: title === t ? 700 : 400,
                                color: title === t ? selectedMacro.color : 'var(--text)',
                              }}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Experience level */}
                  <div style={{ marginBottom: 16 }}>
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
                            <span style={{ fontSize: '.63rem', opacity: .75 }}>({desc})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Starter bio */}
                  <div>
                    <div style={{ fontSize: '.75rem', fontWeight: 700, color: selectedMacro.color, marginBottom: 6 }}>
                      Starter bio <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(edit or keep)</span>
                    </div>
                    <textarea
                      className="form-textarea"
                      rows={2}
                      value={bio}
                      onChange={e => setBio(e.target.value)}
                      placeholder="A short bio visible on your public profile…"
                      style={{ resize: 'vertical', fontSize: '.86rem', lineHeight: 1.6 }}
                    />
                  </div>
                </div>
              )}

              {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-lg"
                  style={{ flex: '0 0 auto' }}
                  onClick={() => setStep(0)}
                >
                  ← Back
                </button>
                <button
                  className="btn btn-primary btn-full btn-lg"
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  {loading ? <span className="spinner" /> : selectedMacro ? 'Create account →' : 'Skip & create account →'}
                </button>
              </div>

              <div className="auth-footer">
                Already have an account? <Link to="/login">Sign in</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
