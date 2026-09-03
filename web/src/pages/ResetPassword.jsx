import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import client from '../api/client';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword]  = useState('');
  const [loading,         setLoading]          = useState(false);
  const [error,           setError]            = useState('');
  const [done,            setDone]             = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password || !confirmPassword) { setError('Fill in both fields.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    setError('');
    try {
      await client.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Reset Password | UFIconnect</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <div className="auth-logo-icon">UFI</div>
            <span className="auth-logo-name">UFIconnect</span>
          </div>

          <h1 className="auth-heading">Set a new password</h1>

          {!token ? (
            <>
              <p className="auth-sub">This reset link is missing its token.</p>
              <div className="auth-footer">
                <Link to="/forgot-password">Request a new reset link</Link>
              </div>
            </>
          ) : done ? (
            <p className="auth-sub">Password updated — redirecting you to sign in…</p>
          ) : (
            <>
              <p className="auth-sub">Choose a new password for your account.</p>
              {error && <div className="auth-error">{error}</div>}
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="form-label">New password</label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    autoComplete="new-password"
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirm new password</label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                    autoComplete="new-password"
                  />
                </div>
                <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
                  {loading ? <span className="spinner" /> : 'Reset password'}
                </button>
              </form>
              <div className="auth-footer">
                <Link to="/login">← Back to sign in</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
