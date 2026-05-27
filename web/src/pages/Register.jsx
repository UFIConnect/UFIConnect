import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';

const QUICK_PROFILES = [
  { label: 'Creative Director', title: 'Creative Director at Lumina Studio', desc: 'Visual storytelling, brand systems, and creative leadership' },
  { label: 'Growth Marketer', title: 'Growth Marketing Lead at Spark Labs', desc: 'Acquisition, content, and campaign strategy' },
  { label: 'Operations Lead', title: 'Operations & Strategy Lead', desc: 'Process, logistics, and business operations' },
  { label: 'Community Builder', title: 'Community Manager at Collective', desc: 'Events, engagement, and member growth' },
  { label: 'Founder', title: 'Founder & CEO', desc: 'Leadership, product, and go-to-market' },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', title: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setError('');
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
      setError(err.response?.data?.message || 'Registration failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Join UFIConnect — Free Professional Network for All Careers</title>
        <meta name="description" content="Create your free UFIConnect account to discover communities, opportunities, and connections across business, creative, education, and leadership roles." />
      </Helmet>
      <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">UF</div>
          <span className="auth-logo-name">UFIConnect</span>
        </div>
        <p className="auth-tagline">Professional networking for business, creative, and community leaders.</p>

        <h1 className="auth-heading">Create your account</h1>
        <p className="auth-sub">Join ambitious professionals across marketing, operations, education, finance, and design.</p>

        <div style={{ margin: '20px 0', padding: '16px', borderRadius: '16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '.86rem', fontWeight: 700, marginBottom: 6 }}>Profile macros</div>
          <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 12 }}>Choose a polished headline and launch your profile in seconds.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {QUICK_PROFILES.map((profile) => (
              <button
                key={profile.label}
                type="button"
                className="btn btn-sm btn-outline"
                style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '12px 14px' }}
                onClick={() => setForm((f) => ({ ...f, title: profile.title }))}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{profile.label}</div>
                <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{profile.desc}</div>
              </button>
            ))}
          </div>
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
            <label className="form-label">Professional title <span style={{color:'var(--muted)', fontWeight:400}}>(optional)</span></label>
            <input className="form-input" type="text" name="title"
              placeholder="e.g. Operations Lead, Creative Director, Community Manager" value={form.title} onChange={handleChange} />
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
            {loading ? <span className="spinner" /> : 'Create account'}
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
