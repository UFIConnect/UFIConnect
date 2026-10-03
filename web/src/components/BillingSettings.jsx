import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../api/client';
import { hostedBillingUrl } from '../api/hostedBilling.mjs';
import PricingModal from './PricingModal';

export default function BillingSettings({ profile, onProfileUpdate }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [opening, setOpening] = useState(null);
  const updateProfile = useRef(onProfileUpdate);
  updateProfile.current = onProfileUpdate;
  const returnState = useRef(new URLSearchParams(window.location.search).get('upgrade'));

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false; let timer; let finishWait;
    const params = new URLSearchParams(window.location.search);
    if (params.has('upgrade')) {
      params.delete('upgrade');
      window.history.replaceState(window.history.state, '', window.location.pathname + (params.size ? `?${params}` : '') + window.location.hash);
    }
    async function check() {
      setChecking(true);
      if (returnState.current === 'success') setNotice('Checking your membership with Stripe…');
      else if (returnState.current === 'cancelled') setNotice('Checkout was closed. Review your membership status below.');
      try {
        for (let attempt = 0; attempt < 4 && !stopped; attempt++) {
          const { data } = await client.get('/billing/status', { signal: controller.signal });
          if (stopped) return;
          setStatus(data);
          if (['free', 'pro', 'business'].includes(data.plan)) updateProfile.current({ plan: data.effectivePlan || data.plan, personalPlan: data.plan, businessTeam: data.businessTeam || null, businessSeats: data.plan === 'business' ? data.businessSeats : data.businessTeam?.active ? data.businessTeam.seats : data.businessSeats || 0, resumeBuilderAddon: Boolean(data.resumeBuilderAddon), vpnConnectorAddon: Boolean(data.vpnConnectorAddon) });
          if (returnState.current !== 'success') break;
          if (['pro', 'business'].includes(data.plan)) {
            setNotice(`Your ${data.plan === 'pro' ? 'Pro' : 'Business'} membership is active.`);
            returnState.current = null;
            if (data.plan === 'business') navigate('/recruiting', { replace: true });
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
  }, [refresh]);

  async function openBilling(tier, quantity = 1) {
    if (opening) return;
    setOpening(tier); setNotice('');
    try {
      const portal = tier === 'portal';
      const { data } = await client.post(portal ? '/billing/create-portal-session' : '/billing/create-checkout-session', portal ? {} : { tier, quantity });
      window.location.assign(hostedBillingUrl(data.url, portal ? 'portal' : 'checkout'));
    } catch (error) {
      setNotice(error?.response?.data?.message || 'Could not open secure billing. Please try again.');
      setOpening(null);
    }
  }

  const plan = status?.plan || profile.personalPlan || profile.plan || 'free';
  const teamMember = profile.businessTeam?.role === 'member' && profile.businessTeam?.active;
  const hasBillingAccount = status?.hasBillingAccount || plan !== 'free' || profile.resumeBuilderAddon || profile.vpnConnectorAddon;
  const pending = status?.subscriptions?.some(item => item.kind === 'plan' && !['canceled', 'incomplete_expired'].includes(item.status));
  return <section className="card" aria-labelledby="membership-settings-title" style={{ padding: '18px', display: 'grid', gap: 12 }}>
    <div>
      <h2 id="membership-settings-title" style={{ margin: 0, fontSize: '1rem' }}>{teamMember ? 'Business team membership' : plan === 'business' ? 'Business plan' : plan === 'pro' ? 'Pro plan' : 'Free plan'}</h2>
      <p style={{ fontSize: '.85rem', margin: '6px 0 0', color: 'var(--muted)' }}>Review your membership, payment methods, invoices, and cancellation options.</p>
    </div>
    {teamMember && <p style={{ margin: 0, fontSize: '.85rem' }}>Your company manages this Business membership. Any personal subscriptions below are billed separately. <Link to="/recruiting">Open recruiting workspace</Link></p>}
    {plan === 'business' && <p style={{ margin: 0, fontSize: '.85rem' }}>{status?.businessSeats || profile.businessSeats || 1} {Number(status?.businessSeats || profile.businessSeats || 1) === 1 ? 'person' : 'people'} in your recruiting membership. <Link to="/recruiting">Open recruiting workspace</Link></p>}
    {status?.subscriptions?.map(item => <div key={item.kind} style={{ fontSize: '.82rem', lineHeight: 1.6 }}>
      <strong>{item.kind === 'vpn_connector' ? 'UFI Vault' : item.kind === 'resume_builder' ? 'Resume Builder' : item.tier === 'business' ? 'Business' : 'Pro'}:</strong>{' '}{String(item.status).replaceAll('_', ' ')}
      {item.cancelAtPeriodEnd && <> · Cancellation scheduled{item.currentPeriodEnd ? ` for ${new Date(item.currentPeriodEnd * 1000).toLocaleDateString()}` : ''}</>}
    </div>)}
    {notice && !pricingOpen && <p role="status" style={{ margin: 0, fontSize: '.85rem', lineHeight: 1.6 }}>{notice}</p>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {hasBillingAccount && <button type="button" onClick={() => openBilling('portal')} disabled={Boolean(opening)} className="btn btn-ghost btn-sm">{opening === 'portal' ? 'Opening…' : 'Manage billing'}</button>}
      {plan === 'free' && !pending && !profile.businessTeam && <button type="button" onClick={() => { setNotice(''); setPricingOpen(true); }} disabled={Boolean(opening) || checking || !status} className="btn btn-primary btn-sm">Upgrade</button>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={checking || Boolean(opening)} onClick={() => setRefresh(value => value + 1)}>{checking ? 'Checking billing…' : 'Check billing status'}</button>
    </div>
    <p style={{ margin: 0, color: 'var(--muted)', fontSize: '.75rem' }}>Payment details are entered and managed on Stripe’s secure website.</p>
    {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} onSelectTier={openBilling} loadingTier={opening} error={notice} />}
  </section>;
}
