import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LockKeyhole, Phone } from 'lucide-react';
import client, { publicOAuthRequestConfig } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { normalizedPhoneNumber, PHONE_COUNTRIES, providerAuthorizationUrl, SIGNIN_ERRORS } from '../auth/accountAccess.mjs';
import { safeReturnPath } from '../auth/returnPath';
import './AccountAccess.css';

function ProviderMark({ provider }) {
  if (provider === 'google') return <img src="/brand/google-signin.png" width="20" height="20" alt="" aria-hidden="true" />;
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M17.05 12.54c.03 3.32 2.91 4.42 2.94 4.43-.03.08-.46 1.58-1.52 3.12-.91 1.33-1.86 2.65-3.35 2.68-1.45.03-1.93-.86-3.59-.86-1.66 0-2.2.83-3.57.89-1.44.05-2.54-1.44-3.46-2.76C2.62 17.34 1.2 12.43 3.13 9.1a5.38 5.38 0 0 1 4.56-2.76c1.43-.03 2.78.96 3.66.96.87 0 2.51-1.19 4.23-1.02.72.03 2.75.29 4.06 2.2-.1.06-2.63 1.53-2.59 4.06ZM14.32 4.48c.77-.93 1.29-2.23 1.15-3.53-1.11.05-2.46.74-3.26 1.67-.72.83-1.35 2.17-1.18 3.45 1.24.1 2.5-.64 3.29-1.59Z"/></svg>;
}

export default function AccountAccess({ mode = 'login', returnTo = '/', onSignedIn, disabled = false, onBusyChange, allowPhoneReplacement = false }) {
  const { verifyPhoneSignIn, completePhoneSignup, token } = useAuth();
  const location = useLocation();
  const id = useId();
  const [providers, setProviders] = useState(null);
  const [linked, setLinked] = useState(null);
  const [revision, setRevision] = useState(0);
  const [statusError, setStatusError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('US');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [verification, setVerification] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const signup = mode === 'signup';
  const linking = mode === 'link';
  const mounted = useRef(true), operation = useRef(null), locked = useRef(false);
  const callbackParams = new URLSearchParams(location.search);
  const callbackError = linking && callbackParams.has('auth_error') ? (callbackParams.get('auth_error') === 'account_exists' ? 'This sign-in method is already connected to another account.' : SIGNIN_ERRORS[callbackParams.get('auth_error')] || 'This sign-in method could not be connected. Please try again.') : '';
  const connected = provider => linked?.methods?.some(method => method.provider === provider) === true;
  const providerReady = provider => providers?.[provider]?.configured === true && providers?.[provider]?.enabled === true;
  const availabilityLabel = provider => !providers ? statusError ? 'Unavailable' : 'Checking availability'
    : providers[provider]?.configured !== true ? 'Setup required' : 'Unavailable';
  const replacingPhone = linking && allowPhoneReplacement && connected('phone');
  const linkedProvider = linking && ['google', 'apple', 'phone'].includes(callbackParams.get('linked')) && connected(callbackParams.get('linked')) ? callbackParams.get('linked') : null;
  const unavailable = busy || disabled || (linking && !linked);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current?.abort(); };
  }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setStatusError(''); setProviders(null); setLinked(null);
    Promise.all([
      client.get('/auth/providers', publicOAuthRequestConfig({ signal: controller.signal })),
      linking ? client.get('/auth/providers/linked', publicOAuthRequestConfig({ signal: controller.signal })) : Promise.resolve(null),
    ])
      .then(([availability, methods]) => { if (active) { setProviders(availability.data.providers || {}); setLinked(methods?.data || null); } })
      .catch(() => { if (active) setStatusError('Additional sign-in options could not load.'); });
    return () => { active = false; controller.abort(); };
  }, [revision, linking, token]);
  useEffect(() => {
    if (!verification && !registration && Date.now() >= resendAt) return undefined;
    const timer = window.setInterval(() => { const time = Date.now(); setNow(time); if (time >= Math.max(verification?.expiresAt || 0, registration?.expiresAt || 0) && time >= resendAt) window.clearInterval(timer); }, 1000);
    return () => window.clearInterval(timer);
  }, [verification, registration, resendAt]);

  function begin() { locked.current = true; const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); return controller; }
  function finish(controller) { if (operation.current !== controller) return; operation.current = null; locked.current = false; if (mounted.current) setBusy(false); }
  function current(controller) { return mounted.current && !controller.signal.aborted; }

  async function startProvider(provider) {
    if (locked.current || unavailable || connected(provider) || !providerReady(provider)) return;
    const controller = begin();
    try {
      const { data } = await client.post(`/auth/providers/${provider}/${linking ? 'link' : 'start'}`, linking ? { client: 'web' } : { client: 'web', mode, returnTo: safeReturnPath(returnTo) }, publicOAuthRequestConfig({ signal: controller.signal }));
      if (current(controller)) window.location.assign(providerAuthorizationUrl(provider, data.authorizationUrl || data.url));
    } catch (failure) { if (current(controller)) setError(failure.response?.data?.message || failure.message || 'Sign-in could not start.'); finish(controller); }
  }

  async function sendCode(event) {
    event?.preventDefault();
    if (locked.current || unavailable || !providerReady('phone') || Date.now() < resendAt) return;
    const phoneNumber = normalizedPhoneNumber(phone, country);
    if (!phoneNumber) { setError('Enter a valid phone number for the selected country, or paste an international number with +.'); return; }
    if (signup && !name.trim()) { setError('Enter your name to create your account.'); return; }
    const controller = begin();
    try {
      const { data } = await client.post(linking ? '/auth/phone/link' : '/auth/phone/request', linking ? { phoneNumber, ...(replacingPhone ? { replacePhone: true } : {}) } : { phoneNumber, mode, ...(signup ? { name: name.trim() } : {}) }, publicOAuthRequestConfig({ signal: controller.signal }));
      if (!current(controller)) return;
      if (!data.verificationId) throw new Error('The verification request could not be confirmed. Please try again.');
      setPhone(phoneNumber);
      setVerification({ id: data.verificationId, expiresAt: Date.now() + Math.min(Number(data.expiresIn) || 600, 600) * 1000 });
      setResendAt(Date.now() + Math.max(60, Number(data.resendAfter) || 60) * 1000); setCode(''); setNow(Date.now());
    } catch (failure) {
      if (current(controller)) {
        setError(failure.response?.data?.message || failure.message || 'The verification code could not be sent.');
        const retryAfter = Number(failure.response?.data?.retryAfter);
        if (retryAfter > 0) { setNow(Date.now()); setResendAt(Date.now() + Math.min(3600, retryAfter) * 1000); }
      }
    } finally { finish(controller); }
  }

  async function verifyCode(event) {
    event.preventDefault();
    if (locked.current || unavailable || !providerReady('phone') || !verification) return;
    if (Date.now() >= verification.expiresAt) { setError('This verification expired. Request a new code.'); return; }
    if (!/^\d{4,10}$/.test(code)) { setError('Enter the verification code from your text message.'); return; }
    const controller = begin();
    try {
      const profile = await verifyPhoneSignIn(verification.id, code, { signal: controller.signal });
      if (!current(controller)) return;
      if (profile?.requiresSignup) {
        if (!profile.registrationId || linking) throw new Error('Phone verification could not be confirmed. Request a new code.');
        setRegistration({ id: profile.registrationId, expiresAt: Date.now() + Math.min(Number(profile.expiresIn) || 300, 300) * 1000 });
        setVerification(null); setCode(''); setNow(Date.now());
        return;
      }
      setCode(''); setPhone(''); setName(''); setVerification(null);
      if (linking) setRevision(value => value + 1);
      onSignedIn?.(profile);
    } catch (failure) { if (current(controller)) setError(failure.response?.data?.message || 'That code could not be verified. Please try again.'); }
    finally { if (mounted.current) setCode(''); finish(controller); }
  }

  async function createPhoneAccount(event) {
    event.preventDefault();
    if (locked.current || unavailable || !providerReady('phone') || !registration) return;
    if (Date.now() >= registration.expiresAt) { setError('Phone verification expired. Request a new code.'); return; }
    if (!name.trim()) { setError('Enter your name to create your account.'); return; }
    const controller = begin();
    try {
      const profile = await completePhoneSignup(registration.id, name.trim(), { signal: controller.signal });
      if (!current(controller)) return;
      setRegistration(null); setCode(''); setPhone(''); setName(''); setVerification(null);
      onSignedIn?.(profile);
    } catch (failure) {
      if (current(controller)) {
        setError(failure.response?.data?.message || 'Your account could not be created. Please try again.');
        if (failure.response?.data?.code === 'expired') setRegistration(null);
      }
    } finally { finish(controller); }
  }

  return <section className="account-access" aria-label={linking ? 'Account sign-in methods' : signup ? 'Account creation options' : 'Sign-in options'}>
    {linking && <p className="account-access-status">Connect Google, Apple, or a verified phone number to sign in to this UFIConnect account.</p>}
    {linking && linked?.passwordAvailable && <p className="account-access-status">Email and password sign-in is available.</p>}
    {linkedProvider && !callbackError && <p className="account-access-success" role="status">{linkedProvider === 'phone' ? 'Phone number' : linkedProvider === 'google' ? 'Google' : 'Apple'} is connected for sign-in.</p>}
    {callbackError && <p className="auth-error" role="alert">{callbackError}</p>}
    <div className="account-access-providers">
      {['google', 'apple'].map(provider => <button key={provider} type="button" className={`account-access-provider account-access-provider-${provider}`} disabled={unavailable || connected(provider) || !providerReady(provider)} onClick={() => startProvider(provider)}>
        <ProviderMark provider={provider} /><span>{linking ? 'Connect' : signup ? 'Sign up with' : 'Sign in with'} {provider === 'google' ? 'Google' : 'Apple'}</span>
        {connected(provider) ? <small>Connected</small> : !providerReady(provider) && <small><LockKeyhole size={12} aria-hidden="true" />{availabilityLabel(provider)}</small>}
      </button>)}
      <button type="button" className="account-access-provider" disabled={unavailable || (connected('phone') && !replacingPhone) || !providerReady('phone')} aria-expanded={phoneOpen} onClick={() => { setPhoneOpen(value => !value); setCode(''); setError(''); }}>
        <Phone size={20} aria-hidden="true" /><span>{replacingPhone ? 'Change phone number' : linking ? 'Connect phone number' : 'Continue with phone number'}</span>{connected('phone') ? <small>Connected</small> : !providerReady('phone') && <small><LockKeyhole size={12} aria-hidden="true" />{availabilityLabel('phone')}</small>}
      </button>
    </div>
    {!linking && <p className="account-access-status">Google and Apple authenticate your account directly. No separate UFIConnect password is needed.</p>}
    {statusError && <p className="account-access-status" role="status">{statusError} <button type="button" onClick={() => setRevision(value => value + 1)}>Retry options</button></p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {phoneOpen && <div className="account-access-phone">
      {registration ? <form onSubmit={createPhoneAccount}>
        <h2>Create your phone account</h2><p>Your phone number is verified. Add your name to finish creating your account. No email or password is required.</p>
        <div className="form-group"><label className="form-label" htmlFor={`${id}-name`}>Full name</label><input id={`${id}-name`} className="form-input" autoComplete="name" value={name} maxLength={120} onChange={event => setName(event.target.value)} disabled={busy} autoFocus required /></div>
        {now >= registration.expiresAt && <p role="status">Phone verification expired. Request a new code to continue.</p>}
        <button className="btn btn-primary btn-full" disabled={unavailable || !providerReady('phone') || now >= registration.expiresAt} type="submit">{busy ? 'Creating account…' : 'Create account with phone'}</button>
        <div className="account-access-resend"><button type="button" disabled={busy} onClick={() => { setRegistration(null); setVerification(null); setCode(''); setError(''); }}>Start phone verification again</button></div>
      </form> : !verification ? <form onSubmit={sendCode}>
        <h2>{replacingPhone ? 'Change your phone sign-in number' : linking ? 'Connect a phone sign-in method' : signup ? 'Create an account with your phone' : 'Sign in with your phone'}</h2>
        {signup && <div className="form-group"><label className="form-label" htmlFor={`${id}-name`}>Full name</label><input id={`${id}-name`} className="form-input" autoComplete="name" value={name} maxLength={100} onChange={event => setName(event.target.value)} disabled={busy} required /></div>}
        <div className="form-group"><label className="form-label" htmlFor={`${id}-country`}>Country or region</label><select id={`${id}-country`} className="form-input" autoComplete="country" value={country} onChange={event => setCountry(event.target.value)} disabled={busy}>{PHONE_COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.name} (+{item.callingCode})</option>)}</select></div>
        <div className="form-group"><label className="form-label" htmlFor={`${id}-phone`}>Phone number</label><input id={`${id}-phone`} className="form-input" type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="Your phone number" disabled={busy} aria-describedby={`${id}-phone-help`} required /><small id={`${id}-phone-help`}>Enter your local number or paste a full international number beginning with +.</small></div>
        <p>We’ll text a verification code to this number. Your phone number stays private.</p>
        <button className="btn btn-primary btn-full" disabled={unavailable || !providerReady('phone') || now < resendAt} type="submit">{busy ? 'Sending…' : now < resendAt ? `Try again in ${Math.ceil((resendAt - now) / 1000)}s` : 'Send verification code'}</button>
      </form> : <form onSubmit={verifyCode}>
        <h2>Verify your phone number</h2><p>Enter the code sent to {phone}. It expires in 10 minutes.</p>
        <div className="form-group"><label className="form-label" htmlFor={`${id}-code`}>Verification code</label><input id={`${id}-code`} className="form-input" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={10} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy} autoFocus required /></div>
        <button className="btn btn-primary btn-full" disabled={unavailable || !providerReady('phone') || now >= verification.expiresAt} type="submit">{busy ? 'Verifying…' : replacingPhone ? 'Verify and change phone number' : linking ? 'Verify and connect phone' : signup ? 'Verify and create account' : 'Verify and sign in'}</button>
        <div className="account-access-resend"><button type="button" disabled={unavailable || !providerReady('phone') || now < resendAt} onClick={sendCode}>{now < resendAt ? `Resend in ${Math.ceil((resendAt - now) / 1000)}s` : 'Resend code'}</button><button type="button" disabled={busy} onClick={() => { setVerification(null); setCode(''); setError(''); }}>Use a different number</button></div>
      </form>}
    </div>}
    {!linking && <div className="account-access-divider"><span />Or continue with email<span /></div>}
  </section>;
}
