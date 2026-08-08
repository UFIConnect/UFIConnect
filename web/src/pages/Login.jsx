import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login, auth0Enabled, loginWithAuth0 } = useAuth();
  const navigate  = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.email || !form.password) { setError('Please fill in all fields.'); return; }
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      navigate(user.onboardingComplete ? '/' : '/onboarding', { replace: true });
    } catch (err) {
      if (!err.response) {
        setError('Server is starting up — wait 30 seconds and try again.');
      } else {
        setError(err.response?.data?.message || 'Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Sign In | UFIConnect</title>
        <meta name="description" content="Sign in to your UFIConnect account to access your personalized feed, manage your profile, and follow communities." />
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">UF</div>
          <span className="auth-logo-name">UFIConnect</span>
        </div>
        <p className="auth-tagline">Professional networking, no ads.</p>

        <h1 className="auth-heading">Welcome back</h1>
        <p className="auth-sub">Sign in to your account to continue.</p>

        {error && <div className="auth-error">{error}</div>}

        {auth0Enabled && (
          <>
            <button
              className="btn btn-primary btn-full btn-lg"
              type="button"
              onClick={() => loginWithAuth0()}
              style={{ marginBottom: 14 }}
            >
              Continue with Auth0
            </button>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--muted)',
              fontSize: '.78rem',
              fontWeight: 700,
              margin: '0 0 14px',
              textTransform: 'uppercase',
            }}>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              Or
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email address</label>
            <input
              className="form-input"
              type="email"
              name="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="form-label">Password</label>
              <Link to="/forgot-password" style={{ fontSize: '.8rem', color: 'var(--primary)' }}>Forgot password?</Link>
            </div>
            <input
              className="form-input"
              type="password"
              name="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              autoComplete="current-password"
            />
          </div>
          <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Sign in'}
          </button>
        </form>

        <div className="auth-footer">
          Don't have an account? <Link to="/register">Create one</Link>
        </div>

        <div className="demo-hint">
          Demo credentials: <strong>maria@example.com</strong> / <strong>password123</strong>
        </div>
      </div>
    </div>
    </>
  );
}
