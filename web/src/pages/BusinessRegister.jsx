import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import { isBusinessAccount } from '../businessAccount.mjs';
import { safeReturnPath } from '../auth/returnPath';
import { PASSWORD_GUIDANCE, validateNewPassword } from '../auth/passwordPolicy';
import client, { publicOAuthRequestConfig } from '../api/client';
import PublicBrand from '../components/PublicBrand';
import PublicFooter from '../components/PublicFooter';
import PasswordInput from '../components/PasswordInput';
import './BusinessEnrollment.css';

export default function BusinessRegister() {
  const { profile, loading: sessionLoading, register, logout } = useAuth();
  const location = useLocation();
  const returnPath = safeReturnPath(location.state?.from);
  const invitation = returnPath?.startsWith('/recruiting#') && new URLSearchParams(returnPath.split('#')[1]).has('invite') ? returnPath : null;
  const [form, setForm] = useState({ name: '', email: '', organization: '', businessIndustryId: '', password: '', confirmPassword: '' });
  const [industries, setIndustries] = useState([]), [catalogError, setCatalogError] = useState(''), [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError('');
    client.get('/auth/business-options', publicOAuthRequestConfig({ signal: controller.signal }))
      .then(({ data }) => { if (!controller.signal.aborted) setIndustries(data.industries || []); })
      .catch(() => { if (!controller.signal.aborted) setCatalogError('Industry choices could not load. Please try again.'); });
    return () => controller.abort();
  }, [retry]);
  function edit(event) { setForm(current => ({ ...current, [event.target.name]: event.target.value })); setError(''); }
  async function submit(event) {
    event.preventDefault();
    if (busy || sessionLoading || profile || !industries.some(item => item.id === form.businessIndustryId)) return;
    const passwordError = validateNewPassword(form.password);
    if (passwordError) { setError(passwordError); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await register(form.name.trim(), form.email.trim(), form.password, 'Recruiting', undefined,
        { accountType: 'business', organization: form.organization.trim(), businessIndustryId: form.businessIndustryId });
    } catch (failure) {
      setError(failure.response?.status === 409
        ? 'That email already has an account. Sign in to an existing Business account, or use a different work email for a new Business account.'
        : failure.response?.data?.message || 'Your Business account could not be created. Please try again.');
    } finally { setBusy(false); }
  }
  if (profile && isBusinessAccount(profile)) return <Navigate to={invitation || (profile.plan === 'business' ? '/recruiting' : '/business/enrollment')} replace />;
  return <div className="business-enrollment-page">
    <Helmet><title>Create a Business account | UFIconnect</title><meta name="description" content="Create a company recruiting account for industry spaces, job posting, candidate conversations, and Business cross-posting." /><link rel="canonical" href="https://uficonnect.org/business/register" /></Helmet>
    <header className="business-enrollment-header"><PublicBrand /><Link to="/login" state={{ from: invitation || '/business/enrollment' }}>Business sign in</Link></header>
    <main className="business-registration-grid">
      <section className="business-registration-intro">
        <span className="recruiting-eyebrow">UFIconnect Business</span><h1>Your company’s recruiting hub</h1>
        <p>Bring your hiring work, industry resources, and company publishing into one workspace.</p>
        <ul><li>Post jobs and find candidates.</li><li>Create industry spaces with relevant source sites.</li><li>Save drafts and cross-post to UFI and connected LinkedIn accounts.</li><li>Manage teammates and recruiting conversations.</li></ul>
        <p>Create a separate Business account here. Your personal UFIconnect account stays separate.</p>
        <p>Account creation does not charge you. Review the membership price and total before paying. Invited teammates can join an existing paid team without buying another membership.</p>
        <Link to="/register">Looking for a personal account?</Link>
      </section>
      {profile ? <section className="card business-registration-form"><h2>You’re signed in to a personal account</h2><p>Business registration creates a separate company account. It cannot change your personal membership.</p><button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); await logout(); setBusy(false); }}>Sign out to create a Business account</button><Link to="/">Return to your account</Link></section>
        : <form className="card business-registration-form" aria-label="Create Business account" onSubmit={submit}>
          <h2>Create your Business account</h2>
          <label>Contact name<input className="form-input" name="name" autoComplete="name" value={form.name} onChange={edit} minLength={2} maxLength={120} required disabled={busy} /></label>
          <label>Company or organization<input className="form-input" name="organization" autoComplete="organization" value={form.organization} onChange={edit} minLength={2} maxLength={120} required disabled={busy} /></label>
          <label>Work email<input className="form-input" name="email" type="email" autoComplete="email" value={form.email} onChange={edit} maxLength={254} required disabled={busy} /></label>
          <label>Primary industry<select className="form-input" name="businessIndustryId" value={form.businessIndustryId} onChange={edit} required disabled={busy || !industries.length}><option value="">Choose your industry</option>{industries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {catalogError ? <p role="alert">{catalogError} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value + 1)}>Retry industry choices</button></p> : !industries.length && <p role="status">Loading industries…</p>}
          <label htmlFor="business-password">Password</label><PasswordInput id="business-password" className="form-input" name="password" autoComplete="new-password" value={form.password} onChange={edit} required disabled={busy} aria-describedby="business-password-help" />
          <p id="business-password-help" className="business-form-help">{PASSWORD_GUIDANCE}</p>
          <label htmlFor="business-confirm-password">Confirm password</label><PasswordInput id="business-confirm-password" className="form-input" name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={edit} required disabled={busy} />
          <p className="business-form-help">By creating an account, you agree to our <Link to="/terms">Terms</Link> and acknowledge our <Link to="/privacy">Privacy Policy</Link>.</p>
          {error && <p role="alert" className="auth-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy || sessionLoading || !industries.length}>{busy ? 'Creating your account…' : 'Create Business account'}</button>
          {sessionLoading && <p role="status">Checking your session…</p>}
          <Link to="/login" state={{ from: invitation || '/business/enrollment' }}>Already have a Business account? Sign in</Link>
        </form>}
    </main><PublicFooter />
  </div>;
}
