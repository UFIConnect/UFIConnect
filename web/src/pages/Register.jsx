import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';

const ROLE_MACROS = [
  {
    role: 'Engineer / Developer',
    icon: '💻',
    label: 'Developer',
    title: 'Software Engineer',
    desc: 'Build products and ship code',
    color: '#2563EB', bg: '#EFF6FF',
    related: ['AI & Machine Learning', 'Open Source', 'Cloud & DevOps', 'Side Projects'],
  },
  {
    role: 'Designer / Creative',
    icon: '🎨',
    label: 'Designer',
    title: 'UX/UI Designer',
    desc: 'Create beautiful experiences',
    color: '#7C3AED', bg: '#F3EEFF',
    related: ['UI/UX Design', 'Design Systems', 'Brand Identity', 'Motion Design'],
  },
  {
    role: 'Founder / Entrepreneur',
    icon: '🚀',
    label: 'Founder',
    title: 'Founder & CEO',
    desc: 'Building something new',
    color: '#D97706', bg: '#FFFBEB',
    related: ['SaaS', 'Bootstrapping', 'Fundraising', 'Growth Marketing'],
  },
  {
    role: 'Marketer / Growth',
    icon: '📈',
    label: 'Marketer',
    title: 'Growth Marketing Lead',
    desc: 'Drive acquisition and growth',
    color: '#059669', bg: '#ECFDF5',
    related: ['Growth Marketing', 'SEO & Content', 'Social Media', 'Creator Economy'],
  },
  {
    role: 'Product Manager',
    icon: '📋',
    label: 'Product',
    title: 'Senior Product Manager',
    desc: 'Strategy, roadmaps, outcomes',
    color: '#0284C7', bg: '#F0F9FF',
    related: ['SaaS', 'AI & Machine Learning', 'Product-Led Growth', 'B2B / Enterprise'],
  },
  {
    role: 'Investor / VC',
    icon: '💰',
    label: 'Investor',
    title: 'Venture Capital / Angel Investor',
    desc: 'Back great founders and ideas',
    color: '#DB2777', bg: '#FDF2F8',
    related: ['Venture Capital', 'Angel Investing', 'FinTech', 'SaaS'],
  },
  {
    role: 'Content Creator',
    icon: '🎬',
    label: 'Creator',
    title: 'Content Creator',
    desc: 'Video, writing, and podcasts',
    color: '#EA580C', bg: '#FFF7ED',
    related: ['Creator Economy', 'YouTube & Video', 'Newsletter & Writing', 'Social Media'],
  },
  {
    role: 'Data / Analytics',
    icon: '📊',
    label: 'Data',
    title: 'Data Scientist / Analyst',
    desc: 'Turn data into decisions',
    color: '#7C3AED', bg: '#F3EEFF',
    related: ['Data Science', 'AI & Machine Learning', 'Cloud & DevOps', 'Open Source'],
  },
  {
    role: 'Student / Learner',
    icon: '🎓',
    label: 'Student',
    title: 'Student / Early Career',
    desc: 'Growing and exploring new fields',
    color: '#6D28D9', bg: '#F5F3FF',
    related: ['Career Growth', 'AI & Machine Learning', 'Open Source', 'Side Projects'],
  },
  {
    role: 'Operations / Finance',
    icon: '⚙️',
    label: 'Operations',
    title: 'Operations & Strategy Lead',
    desc: 'Process, logistics, and business',
    color: '#059669', bg: '#ECFDF5',
    related: ['Business Strategy', 'FinTech', 'Operations Excellence', 'Corporate Finance'],
  },
  {
    role: 'Community Manager',
    icon: '🌐',
    label: 'Community',
    title: 'Community Manager',
    desc: 'Grow and engage communities',
    color: '#0284C7', bg: '#F0F9FF',
    related: ['Creator Economy', 'Social Media', 'Diversity & Inclusion', 'Leadership'],
  },
  {
    role: 'Healthcare Professional',
    icon: '🩺',
    label: 'Healthcare',
    title: 'Healthcare Professional',
    desc: 'Wellness, care, and patient experience',
    color: '#DC2626', bg: '#FEF2F2',
    related: ['Health Tech', 'BioTech', 'Mental Health & Wellness', 'AI & Machine Learning'],
  },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', title: '' });
  const [selectedRole, setSelectedRole] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setError('');
  }

  function selectMacro(macro) {
    setSelectedRole(macro);
    setForm(f => ({ ...f, title: macro.title }));
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
      await register(form.name, form.email, form.password, form.title);
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
        <meta name="description" content="Create your UFIConnect account to discover communities, opportunities, and connections across business, creative, education, and leadership roles." />
      </Helmet>
      <div className="auth-page">
        <div className="auth-card" style={{ maxWidth: 520 }}>
          <div className="auth-logo">
            <div className="auth-logo-icon">UF</div>
            <span className="auth-logo-name">UFIConnect</span>
          </div>
          <p className="auth-tagline">Professional networking for business, creative, and community leaders.</p>

          <h1 className="auth-heading">Create your account</h1>
          <p className="auth-sub">Join ambitious professionals across technology, design, marketing, finance, and beyond.</p>

          {/* Role macros */}
          <div style={{ margin: '20px 0' }}>
            <div style={{ fontSize: '.86rem', fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>
              What best describes you?
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 14 }}>
              Select your role to personalise your profile and feed from day one.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
              {ROLE_MACROS.map((macro) => {
                const isSel = selectedRole?.role === macro.role;
                return (
                  <button
                    key={macro.role}
                    type="button"
                    onClick={() => selectMacro(macro)}
                    style={{
                      padding: '12px 10px', borderRadius: 12, textAlign: 'center', cursor: 'pointer',
                      border: `2px solid ${isSel ? macro.color : 'var(--border)'}`,
                      background: isSel ? macro.bg : 'var(--surface)',
                      transition: 'all .18s',
                      transform: isSel ? 'scale(1.04)' : 'scale(1)',
                      boxShadow: isSel ? `0 4px 14px ${macro.color}30` : 'none',
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>{macro.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: '.78rem', color: isSel ? macro.color : 'var(--text)' }}>
                      {macro.label}
                    </div>
                    <div style={{ fontSize: '.68rem', color: 'var(--muted)', marginTop: 2, lineHeight: 1.3 }}>
                      {macro.desc}
                    </div>
                    {isSel && (
                      <div style={{ marginTop: 6, fontSize: '.65rem', fontWeight: 700, color: macro.color }}>✓ Selected</div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Related interests preview */}
            {selectedRole && (
              <div style={{ marginTop: 14, padding: '12px 14px', background: selectedRole.bg,
                borderRadius: 10, border: `1px solid ${selectedRole.color}30` }}>
                <div style={{ fontSize: '.75rem', fontWeight: 700, color: selectedRole.color, marginBottom: 8 }}>
                  {selectedRole.icon} Your feed will include topics like:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedRole.related.map(topic => (
                    <span key={topic} style={{ padding: '4px 10px', borderRadius: 16, background: '#fff',
                      color: selectedRole.color, fontSize: '.72rem', fontWeight: 600,
                      border: `1px solid ${selectedRole.color}40` }}>
                      {topic}
                    </span>
                  ))}
                  <span style={{ padding: '4px 10px', borderRadius: 16, background: 'transparent',
                    color: 'var(--muted)', fontSize: '.72rem', fontStyle: 'italic' }}>
                    + more in setup →
                  </span>
                </div>
              </div>
            )}
          </div>

          {error && <div className="auth-error">{error}</div>}

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
              <input className="form-input" type="text" name="title"
                placeholder="e.g. Operations Lead, Creative Director, Software Engineer"
                value={form.title} onChange={handleChange} />
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
