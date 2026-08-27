import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import client from '../api/client';

export default function ForgotPassword() {
  const [email,     setEmail]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) { setError('Enter your email address.'); return; }
    setLoading(true);
    setError('');
    try {
      await client.post('/auth/forgot-password', { email: email.trim() });
      setSubmitted(true);
    } catch {
      // The backend always responds generically, so a request-level failure
      // here means the server itself is unreachable, not "email not found".
      setError('Server is starting up — wait 30 seconds and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Forgot Password | UFIconnect</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <div className="auth-logo-icon">UF</div>
            <span className="auth-logo-name">UFIconnect</span>
          </div>

          <h1 className="auth-heading">Reset your password</h1>
          <p className="auth-sub">
            {submitted
              ? "Check your email for a reset link — it expires in 30 minutes."
              : "Enter your email and we'll send you a link to reset your password."}
          </p>

          {error && <div className="auth-error">{error}</div>}

          {!submitted && (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email address</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Send reset link'}
              </button>
            </form>
          )}

          <div className="auth-footer">
            <Link to="/login">← Back to sign in</Link>
          </div>
        </div>
      </div>
    </>
  );
}
