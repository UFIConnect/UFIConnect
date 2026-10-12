import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import client from '../api/client';
import { getAccessToken } from '../auth/session';
import './SettingsEmailAddress.css';

export default function SettingsEmailAddress({ profile, onProfileUpdate }) {
  const location = useLocation();
  const accountId = profile?.id, token = getAccessToken();
  const missing = profile?.hasEmail === false;
  const owner = useRef(accountId); owner.current = accountId;
  const generation = useRef(0), operation = useRef(null);
  const [available, setAvailable] = useState(null);
  const [email, setEmail] = useState(''), [code, setCode] = useState('');
  const [verification, setVerification] = useState(null);
  const [resendAt, setResendAt] = useState(0), [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [success, setSuccess] = useState(false), [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    generation.current++; operation.current?.abort(); operation.current = null;
    setEmail(''); setCode(''); setVerification(null); setResendAt(0); setBusy(false); setError(''); setSuccess(false);
    const clear = () => {
      generation.current++; operation.current?.abort(); operation.current = null;
      setEmail(''); setCode(''); setVerification(null); setBusy(false);
    };
    window.addEventListener('ufi-session-cleared', clear);
    return () => { clear(); window.removeEventListener('ufi-session-cleared', clear); };
  }, [accountId, token]);
  useEffect(() => {
    if (!missing || !accountId || !token) return undefined;
    const abort = new AbortController(), epoch = generation.current;
    setAvailable(null);
    client.get('/auth/email/config', { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal })
      .then(({ data }) => { if (!abort.signal.aborted && epoch === generation.current && token === getAccessToken()) setAvailable(data?.available === true); })
      .catch(() => { if (!abort.signal.aborted && epoch === generation.current) setAvailable(false); });
    return () => abort.abort();
  }, [accountId, token, missing, revision]);
  useEffect(() => {
    if (!verification && resendAt <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const time = Date.now(); setNow(time);
      if (time >= Math.max(verification?.expiresAt || 0, resendAt)) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [verification, resendAt]);
  useEffect(() => {
    if (location.hash !== '#email') return undefined;
    const frame = requestAnimationFrame(() => document.getElementById('email')?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [location.hash]);
  function begin() {
    if (operation.current || !accountId || !token || token !== getAccessToken() || owner.current !== accountId) return null;
    const abort = new AbortController(), epoch = generation.current;
    operation.current = abort; setBusy(true); setError('');
    return { abort, current: () => !abort.signal.aborted && owner.current === accountId && generation.current === epoch && token === getAccessToken() };
  }
  function finish(work) { if (operation.current === work.abort) { operation.current = null; setBusy(false); } }
  async function requestCode(event) {
    event?.preventDefault();
    if (!missing || available !== true || Date.now() < resendAt) return;
    const candidate = email.trim().toLowerCase();
    if (candidate.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) { setError('Enter a valid email address.'); return; }
    const work = begin(); if (!work) return;
    try {
      const { data } = await client.post('/auth/email/request', { email: candidate }, { headers: { Authorization: `Bearer ${token}` }, signal: work.abort.signal });
      if (!work.current()) return;
      if (!data?.verificationId) throw new Error('The verification request could not be confirmed.');
      const sentAt = Date.now();
      setVerification({ id: data.verificationId, email: candidate, expiresAt: sentAt + Math.min(600, Math.max(1, Number(data.expiresIn) || 600)) * 1000 });
      setResendAt(sentAt + Math.max(60, Math.min(3600, Number(data.resendAfter) || 60)) * 1000);
      setEmail(candidate); setCode(''); setNow(sentAt);
    } catch (failure) {
      if (!work.current()) return;
      setError(failure?.response?.data?.message || 'The email could not be sent. Please try again.');
      const retry = Number(failure?.response?.data?.retryAfter);
      if (retry > 0) { setResendAt(Date.now() + Math.min(3600, retry) * 1000); setNow(Date.now()); }
    } finally { finish(work); }
  }
  async function verifyCode(event) {
    event.preventDefault();
    if (!verification || Date.now() >= verification.expiresAt) { setError('This code expired. Request a new verification email.'); return; }
    if (!/^\d{6}$/.test(code)) { setError('Enter the six-digit code from your email.'); return; }
    const work = begin(); if (!work) return;
    try {
      const { data } = await client.post('/auth/email/verify', { verificationId: verification.id, code }, { headers: { Authorization: `Bearer ${token}` }, signal: work.abort.signal });
      if (!work.current()) return;
      if (data?.profile?.id !== accountId || data.profile.hasEmail !== true || data.profile.email?.toLowerCase() !== verification.email) throw new Error('Email update unconfirmed.');
      onProfileUpdate(data.profile); setSuccess(true); setVerification(null); setEmail(''); setCode('');
    } catch (failure) { if (work.current()) { setCode(''); setError(failure?.response?.data?.message || 'That code could not be verified. Please try again.'); } }
    finally { finish(work); }
  }
  return <section id="email" className="card settings-email-address" aria-labelledby="settings-email-title">
    <div className="settings-email-heading"><Mail size={18} aria-hidden="true" /><h2 id="settings-email-title">Email address</h2></div>
    {success && <p className="settings-email-success" role="status"><ShieldCheck size={17} aria-hidden="true" />Email verified and added. Your phone sign-in stays available.</p>}
    {missing ? <>
      <p className="settings-email-helper">Email is optional for your phone account. Verify ownership before adding an address. You can keep signing in with your phone; no password is required.</p>
      {available === null ? <p className="settings-email-helper" role="status">Checking email verification…</p> : available !== true ? <p className="settings-email-helper" role="status">Email verification is temporarily unavailable. <button className="btn btn-ghost btn-sm" type="button" onClick={() => setRevision(value => value + 1)}>Check again</button></p> : verification ? <form onSubmit={verifyCode}>
        <p className="settings-email-helper">Enter the six-digit code sent to <strong>{verification.email}</strong>. It expires after 10 minutes.</p>
        <div className="form-group"><label className="form-label" htmlFor="settings-email-code">Email verification code</label><input id="settings-email-code" className="form-input" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy} required /></div>
        {now >= verification.expiresAt && <p className="settings-email-helper" role="status">The code expired. Request a new email to continue.</p>}
        <div className="settings-email-actions"><button className="btn btn-primary" type="submit" disabled={busy || now >= verification.expiresAt}>{busy ? 'Verifying…' : 'Verify and add email'}</button><button className="btn btn-ghost" type="button" disabled={busy || now < resendAt} onClick={requestCode}>{now < resendAt ? `Resend in ${Math.ceil((resendAt - now) / 1000)}s` : 'Resend email'}</button><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setVerification(null); setCode(''); setError(''); }}>Use another email</button></div>
      </form> : <form onSubmit={requestCode}>
        <div className="form-group"><label className="form-label" htmlFor="settings-new-email">New email address</label><input id="settings-new-email" className="form-input" type="email" autoComplete="email" value={email} maxLength={254} onChange={event => setEmail(event.target.value)} disabled={busy} required placeholder="you@example.com" /></div>
        <button className="btn btn-primary" type="submit" disabled={busy || now < resendAt}>{busy ? 'Sending…' : now < resendAt ? `Try again in ${Math.ceil((resendAt - now) / 1000)}s` : 'Send verification email'}</button>
      </form>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </> : <><p className="settings-email-helper">{profile?.email}</p><p className="settings-email-helper">Contact support if you need to change this address.</p></>}
  </section>;
}
