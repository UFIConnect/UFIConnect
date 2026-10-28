import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../api/client';
import { billingReturnPath, billingReturnState, hostedBillingUrl } from '../api/hostedBilling.mjs';
import PricingModal from './PricingModal';
import { isNativeRuntime } from '../nativeRuntime.mjs';
import { isBusinessAccount, membershipTiersForAccount } from '../businessAccount.mjs';

export default function BillingSettings({ profile, onProfileUpdate }) {
  return <AccountBillingSettings key={profile?.id || 'signed-out'} profile={profile} onProfileUpdate={onProfileUpdate} />;
}

function AccountBillingSettings({ profile, onProfileUpdate }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [opening, setOpening] = useState(null);
  const updateProfile = useRef(onProfileUpdate);
  updateProfile.current = onProfileUpdate;
  const returnState = useRef(billingReturnState().result);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false; let timer; let finishWait;
    const returned = billingReturnState();
    if (returned.hasMarker) navigate(returned.returnPath, { replace: true });
    async function check() {
      setChecking(true);
      if (returnState.current === 'success') setNotice('Checking your membership with Stripe…');
      else if (returnState.current === 'cancelled') setNotice('Checkout was closed. Review your membership status below.');
      try {
        for (let attempt = 0; attempt < 4 && !stopped; attempt++) {
          const { data } = await client.get('/billing/status', { signal: controller.signal });
          if (stopped) return;
          setStatus(data);
          if (['free', 'pro', 'business'].includes(data.plan)) updateProfile.current({ plan: data.effectivePlan || data.plan, personalPlan: data.plan, ...(['personal', 'business'].includes(data.accountType) ? { accountType: data.accountType } : {}), businessTeam: data.businessTeam || null, businessSeats: data.plan === 'business' ? data.businessSeats : data.businessTeam?.active ? data.businessTeam.seats : data.businessSeats || 0, resumeBuilderAddon: Boolean(data.resumeBuilderAddon), vpnConnectorAddon: Boolean(data.vpnConnectorAddon) });
          if (returnState.current !== 'success') break;
          if (['pro', 'business'].includes(data.plan)) {
            setNotice(`Your ${data.plan === 'pro' ? 'Pro' : 'Business'} membership is active.`);
            returnState.current = null;
            break;
          }
          setNotice('Your membership is not active yet. Payment may still be processing. Check status again shortly.');
          if (attempt < 3) await new Promise(resolve => { finishWait = resolve; timer = window.setTimeout(resolve, 2000); });
        }
      } catch {
        if (!stopped) setNotice('We could not confirm your billing status. Try again before starting another checkout.');
      } finally { if (!stopped) setChecking(false); }
    }
    check();
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); finishWait?.(); };
  }, [refresh, navigate]);

  async function openBilling(tier, quantity = 1) {
    if (isNativeRuntime()) return;
    if (opening) return;
    if (tier !== 'portal' && !membershipTiersForAccount(profile).includes(tier)) {
      setNotice(isBusinessAccount(profile) ? 'Use your Business membership page to manage this account.' : 'Business accounts are created through public registration. This personal account cannot be converted.');
      return;
    }
    setOpening(tier); setNotice('');
    try {
      const portal = tier === 'portal';
      const returnPath = billingReturnPath();
      const { data } = await client.post(portal ? '/billing/create-portal-session' : '/billing/create-checkout-session', portal ? { returnPath } : { tier, quantity, returnPath });
      window.location.assign(hostedBillingUrl(data.url, portal ? 'portal' : 'checkout'));
    } catch (error) {
      setNotice(error?.response?.data?.message || 'Could not open secure billing. Please try again.');
      setOpening(null);
    }
  }

  const plan = status?.plan || profile.personalPlan || profile.plan || 'free';
  const businessAccount = isBusinessAccount(profile);
  const teamMember = profile.businessTeam?.active && plan !== 'business';
  const hasBillingAccount = status?.hasBillingAccount || plan !== 'free' || profile.resumeBuilderAddon || profile.vpnConnectorAddon;
  const pending = status?.subscriptions?.some(item => item.kind === 'plan' && !['canceled', 'incomplete_expired'].includes(item.status));
  return <section className="card" aria-labelledby="membership-settings-title" style={{ padding: '18px', display: 'grid', gap: 12 }}>
    <div>
      <h2 id="membership-settings-title" style={{ margin: 0, fontSize: '1rem' }}>{teamMember ? 'Business team membership' : plan === 'business' ? 'Business plan' : plan === 'pro' ? 'Pro plan' : 'Free plan'}</h2>
      <p style={{ fontSize: '.85rem', margin: '6px 0 0', color: 'var(--muted)' }}>{isNativeRuntime() ? 'Review your existing membership and subscription status.' : 'Review your membership, payment methods, invoices, and cancellation options.'}</p>
    </div>
    {teamMember && <p style={{ margin: 0, fontSize: '.85rem' }}>Your company manages this Business membership. Any personal subscriptions below are billed separately. <Link to="/recruiting">Open recruiting workspace</Link></p>}
    {plan === 'business' && <p style={{ margin: 0, fontSize: '.85rem' }}>{status?.businessSeats || profile.businessSeats || 1} {Number(status?.businessSeats || profile.businessSeats || 1) === 1 ? 'person' : 'people'} in your recruiting membership. <Link to="/recruiting">Open recruiting workspace</Link></p>}
    {profile.plan === 'business' && <p style={{ margin: 0, fontSize: '.85rem' }}><Link to="/vault">Open Vault and recovery</Link>{profile.resumeBuilderAddon && <> · <Link to="/resume-builder">Open Resume Builder</Link></>}</p>}
    {status?.subscriptions?.map(item => <div key={item.kind} style={{ fontSize: '.82rem', lineHeight: 1.6 }}>
      <strong>{item.kind === 'vpn_connector' ? 'UFI Vault' : item.kind === 'resume_builder' ? 'Resume Builder' : item.tier === 'business' ? 'Business' : 'Pro'}:</strong>{' '}{String(item.status).replaceAll('_', ' ')}
      {item.cancelAtPeriodEnd && <> · Cancellation scheduled{item.currentPeriodEnd ? ` for ${new Date(item.currentPeriodEnd * 1000).toLocaleDateString()}` : ''}</>}
    </div>)}
    {status?.billingNotice && <p role="alert" style={{ margin: 0, fontSize: '.85rem', lineHeight: 1.6 }}>{status.billingNotice}</p>}
    {notice && !pricingOpen && <p role="status" style={{ margin: 0, fontSize: '.85rem', lineHeight: 1.6 }}>{notice}</p>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {!isNativeRuntime() && hasBillingAccount && <button type="button" onClick={() => openBilling('portal')} disabled={Boolean(opening)} className="btn btn-ghost btn-sm">{opening === 'portal' ? 'Opening…' : 'Manage billing'}</button>}
      {!isNativeRuntime() && businessAccount && plan === 'free' && !profile.businessTeam?.active && <Link className="btn btn-primary btn-sm" to="/business/enrollment">Continue Business membership</Link>}
      {!isNativeRuntime() && !businessAccount && plan === 'free' && !pending && !profile.businessTeam && <button type="button" onClick={() => { setNotice(''); setPricingOpen(true); }} disabled={Boolean(opening) || checking || !status} className="btn btn-primary btn-sm">Upgrade</button>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={checking || Boolean(opening)} onClick={() => setRefresh(value => value + 1)}>{checking ? 'Checking billing…' : 'Check billing status'}</button>
    </div>
    {!isNativeRuntime() && <p style={{ margin: 0, color: 'var(--muted)', fontSize: '.75rem' }}>Payment details are entered and managed on Stripe’s secure website.</p>}
    {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} onSelectTier={openBilling} loadingTier={opening} error={notice} />}
  </section>;
}
