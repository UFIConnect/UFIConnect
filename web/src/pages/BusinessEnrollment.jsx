import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import BusinessAccessNotice from '../components/BusinessAccessNotice';
import { useAuth } from '../contexts/AuthContext';
import { isBusinessAccount } from '../businessAccount.mjs';
import { isNativeRuntime } from '../nativeRuntime.mjs';
import useBillingConfig from '../hooks/useBillingConfig';
import client from '../api/client';
import { billingReturnState, hostedBillingUrl } from '../api/hostedBilling.mjs';
import './BusinessEnrollment.css';

export default function BusinessEnrollment() {
  const { profile } = useAuth();
  if (!isBusinessAccount(profile)) return <Layout><BusinessAccessNotice /></Layout>;
  return <Enrollment key={profile.id} profile={profile} />;
}

function Enrollment({ profile }) {
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { config, error: configError, refresh: refreshConfig } = useBillingConfig();
  const [quantity, setQuantity] = useState('1'), [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(true), [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true), actionPending = useRef(false);
  const returned = useRef(billingReturnState());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer; let finishWait;
    if (returned.current.hasMarker) navigate(returned.current.returnPath, { replace: true });
    async function checkStatus() {
      setChecking(true);
      if (returned.current.result === 'cancelled') setNotice('Checkout was closed. You can review your membership and continue when ready.');
      try {
        for (let index = 0; index < (returned.current.result === 'success' ? 4 : 1); index++) {
          const { data } = await client.get('/billing/status', { signal: controller.signal });
          if (controller.signal.aborted) return;
          setStatus(data);
          await refreshProfile();
          if (controller.signal.aborted) return;
          if ((data.effectivePlan || data.plan) === 'business') {
            if (!controller.signal.aborted) setNotice('Your Business membership is active.');
            break;
          }
          if (returned.current.result !== 'success') break;
          setNotice('Your payment is still being confirmed. Access begins when your membership is active.');
          if (index < 3) await new Promise(resolve => { finishWait = resolve; timer = setTimeout(resolve, 2000); });
        }
      } catch { if (!controller.signal.aborted) setNotice('Billing status could not be confirmed. Check again before starting another checkout.'); }
      finally { if (!controller.signal.aborted) setChecking(false); }
    }
    checkStatus();
    return () => { controller.abort(); clearTimeout(timer); finishWait?.(); };
  }, [attempt, navigate, refreshProfile]);
  const people = Number(quantity), validPeople = Number.isInteger(people) && people >= 1 && people <= 100;
  const priceKey = people >= 2 ? 'business_team' : 'business';
  const pricing = config?.pricing?.[priceKey];
  const available = validPeople && config?.paymentsReady === true && config?.tiers?.[priceKey] === true
    && pricing?.active === true && Number.isFinite(pricing?.unitAmount) && pricing?.currency && pricing?.interval;
  const active = (status?.effectivePlan || status?.plan || profile.plan) === 'business';
  const pending = status?.subscriptions?.some(item => item.kind === 'plan' && !['canceled', 'incomplete_expired'].includes(item.status));
  const ready = Boolean(status) && !checking && !pending && !active && !status?.businessEnrollmentRequired;
  async function openBilling(kind) {
    if (isNativeRuntime() || actionPending.current || (kind === 'checkout' && (!ready || !available))) return;
    actionPending.current = true; setOpening(kind); setNotice('');
    try {
      const { data } = await client.post(kind === 'portal' ? '/billing/create-portal-session' : '/billing/create-checkout-session',
        { returnPath: '/business/enrollment', ...(kind === 'checkout' ? { tier: 'business', quantity: people } : {}) });
      if (mounted.current) window.location.assign(hostedBillingUrl(data.url, kind));
    } catch (failure) {
      if (mounted.current) { setNotice(failure.response?.data?.message || 'Secure billing could not be opened. Please try again.'); setOpening(''); actionPending.current = false; }
    }
  }
  return <Layout><div className="business-membership-setup">
    <Helmet><title>Business membership | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <header><span className="recruiting-eyebrow">Business account</span><h1>{active ? 'Your recruiting workspace is ready' : 'Complete your Business membership'}</h1><p>{profile.organization || profile.name}</p></header>
    {active ? <section className="card"><h2>Business membership active</h2><p>Your company can use industry spaces, publish jobs, and manage recruiting conversations.</p><div className="business-membership-actions"><Link className="btn btn-primary" to="/recruiting">Open recruiting workspace</Link><Link className="btn btn-outline" to="/business/industries">Set up industry spaces</Link><Link className="btn btn-ghost" to="/settings">Team and billing settings</Link></div></section>
      : <section className="card" aria-label="Business membership setup"><h2>Choose your team size</h2><p>Include yourself in the number of people. You can invite teammates after activating your membership.</p>
        {isNativeRuntime() ? <p>Your account’s existing membership determines access in this app.</p> : <>
          <label htmlFor="business-membership-people">Number of people, including you</label><input id="business-membership-people" className="form-input" type="number" min="1" max="100" step="1" value={quantity} disabled={Boolean(opening) || Boolean(pending)} onChange={event => setQuantity(event.target.value)} />
          {!validPeople && <p role="alert">Enter a whole number from 1 to 100.</p>}
          <div className="business-membership-price">{available ? new Intl.NumberFormat('en-US', { style: 'currency', currency: pricing.currency }).format(pricing.unitAmount * people / 100) : 'Price unavailable'}</div>
          {available && <p>{pricing.intervalCount > 1 ? `Every ${pricing.intervalCount} ${pricing.interval}s` : `Every ${pricing.interval}`}{people > 1 ? ` for ${people} people` : ' for one person'}.</p>}
          <p className="business-form-help">Membership renews automatically. Review the total, including any applicable tax, on Stripe before paying. Manage payment methods, invoices, and cancellation from Settings.</p>
          {pending ? <p role="status">A membership or payment is already being processed. Manage billing or check its status before starting another checkout.</p> : <button type="button" className="btn btn-primary" disabled={!ready || !available || Boolean(opening)} onClick={() => openBilling('checkout')}>{opening === 'checkout' ? 'Opening secure checkout…' : 'Continue to Business checkout'}</button>}
          {!config && !configError && <p role="status">Loading current membership pricing…</p>}
          {(configError || config && !available) && <p role="status">{configError || 'This membership price is currently unavailable.'} <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(opening)} onClick={refreshConfig}>Retry pricing</button></p>}
        </>}
        <p>Joining an existing company team? Open your invitation from the team owner. You do not need to purchase a separate membership.</p>
      </section>}
    <section className="card" aria-label="Business billing status">
      <h2>Membership status</h2>
      {notice && <p role="status">{notice}</p>}
      {status?.billingNotice && <p role="alert">{status.billingNotice}</p>}
      <div className="business-membership-actions">
        <button type="button" className="btn btn-outline" disabled={checking || Boolean(opening)} onClick={() => setAttempt(value => value + 1)}>{checking ? 'Checking status…' : 'Check membership status'}</button>
        {!isNativeRuntime() && status?.hasBillingAccount && <button type="button" className="btn btn-ghost" disabled={Boolean(opening)} onClick={() => openBilling('portal')}>{opening === 'portal' ? 'Opening billing…' : 'Manage billing'}</button>}
      </div><p className="business-form-help"><Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/settings">Account settings</Link></p>
    </section>
  </div></Layout>;
}
