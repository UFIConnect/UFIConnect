import PublicBrand from '../components/PublicBrand';
import PasswordInput from '../components/PasswordInput';
﻿import { useState } from 'react';
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import PublicFooter from '../components/PublicFooter';
import { safeReturnPath } from '../auth/returnPath';

export default function Login() {
  const { login, token, profile, loading: restoring, auth0Enabled, loginWithAuth0 } = useAuth();
  const navigate  = useNavigate();
  const location = useLocation();
  const returnTo = safeReturnPath(location.state?.from);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token && !restoring) {
      const needsOnboarding = profile && !profile.onboardingComplete;
      navigate(needsOnboarding ? '/onboarding' : returnTo, { replace: true, state: needsOnboarding ? { from: returnTo } : undefined });
    }
  }, [token, profile, restoring, navigate, returnTo]);

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
      setForm({ email: '', password: '' });
      navigate(user.onboardingComplete ? returnTo : '/onboarding', {
        replace: true, state: user.onboardingComplete ? undefined : { from: returnTo },
      });
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
        <title>Sign In | UFIconnect</title>
        <meta name="description" content="Sign in to your UFIconnect account to access your personalized feed, manage your profile, and follow communities." />
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="auth-page public-auth-page">
      <main className="auth-card">
        <Link to="/" className="auth-logo" aria-label="UFIConnect home"><PublicBrand /></Link>
        <p className="auth-tagline">Social connection meets job discovery.</p>

        <h1 className="auth-heading">Welcome back</h1>
        <p className="auth-sub">Sign in to read your personalized feed, join conversations, and manage your profile.</p>

        {error && <div className="auth-error" role="alert">{error}</div>}

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
            <label className="form-label" htmlFor="login-email">Email address</label>
            <input
              id="login-email"
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
              <label className="form-label" htmlFor="login-password">Password</label>
              <Link to="/forgot-password" style={{ fontSize: '.8rem', color: 'var(--primary)' }}>Forgot password?</Link>
            </div>
            <PasswordInput
              id="login-password"
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

        <section className="public-page-guidance" aria-labelledby="login-guidance-title">
          <h2 id="login-guidance-title">Need help signing in?</h2>
          <p>Use the email address you registered with. If you cannot remember your password, <Link to="/forgot-password">request a reset link</Link>.</p>
          {auth0Enabled && <p>If you created your account through Auth0, choose Continue with Auth0 to use the same sign-in method.</p>}
          <p>You can <Link to="/global">browse the public feed</Link> before signing in.</p>
        </section>
      </main>
      <PublicFooter />
    </div>
    </>
  );
}
