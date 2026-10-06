import { PASSWORD_GUIDANCE, validateNewPassword } from '../auth/passwordPolicy';
import PasswordInput from '../components/PasswordInput';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import client from '../api/client';
import { clearSession } from '../auth/session';

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const [token] = useState(() => (
    new URLSearchParams(location.hash.slice(1)).get('token')
    || new URLSearchParams(location.search).get('token')
    || ''
  ));

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (!query.has('token') && !fragment.has('token')) return;
    query.delete('token');
    fragment.delete('token');
    navigate({ pathname: location.pathname, search: query.toString(), hash: fragment.toString() }, { replace: true });
  }, [location.pathname, location.search, location.hash, navigate]);

  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword]  = useState('');
  const [loading,         setLoading]          = useState(false);
  const [error,           setError]            = useState('');
  const [done,            setDone]             = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password || !confirmPassword) { setError('Fill in both fields.'); return; }
    const passwordError = validateNewPassword(password);
    if (passwordError) { setError(passwordError); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    setError('');
    try {
      await client.post('/auth/reset-password', { token, password });
      setPassword('');
      setConfirmPassword('');
      clearSession();
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
          <Link to="/" className="auth-logo" aria-label="UFIConnect home"><img src="/uficonnect-wordmark.svg?v=blue-ufi-20261006" alt="UFIConnect" width="180" height="36" /></Link>

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
              <p id="reset-password-help" className="auth-sub">{PASSWORD_GUIDANCE}</p>
              {error && <div className="auth-error">{error}</div>}
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="form-label" htmlFor="reset-password">New password</label>
                  <PasswordInput
                    className="form-input"
                    id="reset-password"
                    name="password"
                    aria-describedby="reset-password-help"
                    placeholder="At least 15 characters"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    autoComplete="new-password"
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="reset-confirm-password">Confirm new password</label>
                  <PasswordInput
                    className="form-input"
                    id="reset-confirm-password"
                    name="confirmPassword"
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
