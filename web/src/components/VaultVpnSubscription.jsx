import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { hostedBillingUrl } from '../api/hostedBilling.mjs';

export function useVpnSubscription(accountId, preview) {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(true);
  const [opening, setOpening] = useState('');
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const operation = useRef(0);
  const openingRef = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setChecking(true);
    if (preview) { setChecking(false); return; }
    try {
      const [configResponse, statusResponse] = await Promise.all([client.get('/billing/config'), client.get('/billing/status')]);
      if (request !== sequence.current) return;
      setConfig(configResponse.data); setStatus(statusResponse.data);
      const result = new URLSearchParams(window.location.search).get('upgrade');
      setNotice(result === 'success' ? statusResponse.data.vpnConnectorAddon ? 'Your UFI Vault membership is active.' : 'Payment is still being confirmed. Check status again shortly before starting another checkout.' : result === 'cancelled' ? 'Checkout was closed. No subscription was activated here.' : '');
    } catch {
      if (request === sequence.current) { setStatus(null); setNotice('Could not confirm Vault billing. Check status again before subscribing.'); }
    } finally { if (request === sequence.current) setChecking(false); }
  }, [accountId, preview]);
  useEffect(() => { operation.current++; openingRef.current = false; setConfig(null); setStatus(null); setOpening(''); refresh(); return () => { sequence.current++; operation.current++; }; }, [refresh]);
  useEffect(() => {
    if (preview) return;
    const update = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, [preview, refresh]);
  async function open(portal = false) {
    if (openingRef.current || checking || preview) return;
    openingRef.current = true;
    const request = operation.current;
    setOpening(portal ? 'portal' : 'checkout'); setNotice('');
    try {
      const { data } = await client.post(portal ? '/billing/create-portal-session' : '/billing/create-checkout-session', portal ? {} : { tier: 'vpn_connector' });
      if (request !== operation.current) return;
      window.location.assign(hostedBillingUrl(data.url, portal ? 'portal' : 'checkout'));
    } catch (error) { if (request === operation.current) setNotice(error?.response?.data?.message || 'Could not open secure billing. Try again.'); }
    finally { if (request === operation.current) { openingRef.current = false; setOpening(''); } }
  }
  const price = config?.pricing?.vpn_connector;
  return { status, checking, opening, notice, refresh, open, preview,
    active: !checking && status?.vpnConnectorAddon === true,
    available: config?.paymentsReady === true && config?.tiers?.vpn_connector === true && price?.active === true && price?.unitAmount === 394 && price?.currency === 'USD' && price?.interval === 'month' && price?.intervalCount === 1 };
}

export default function VaultVpnSubscription({ billing }) {
  const pending = billing.status?.subscriptions?.find(item => item.kind === 'vpn_connector' && !['canceled', 'incomplete_expired'].includes(item.status));
  return <section className="vault-vpn-guide vault-vpn-subscription" aria-labelledby="vpn-subscription-title">
    <h3 id="vpn-subscription-title">UFI Vault · $3.94 USD / month</h3>
    <p>Create your encrypted vault and add, edit or import passwords, documents and keys with one membership. Items are saved in this browser; keep an encrypted backup for recovery.</p>
    <p>Web protection runs automatically throughout UFIConnect, including your Vault, without an app or download. It is available to every signed-in account. Membership also includes device VPN access in supported native clients.</p>
    <p>Your existing encrypted items remain yours: unlock, view, download, restore or delete them even without a subscription.</p>
    {billing.preview ? <><button type="button" className="vault-button vault-button--secondary" disabled>Subscribe — local preview</button><p role="status">Local review: sample Vault and connector controls only. No payment is taken and this preview does not grant a paid subscription.</p></> : <>
      {billing.active && <p role="status">Active{pending?.cancelAtPeriodEnd ? ` · Cancels${pending.currentPeriodEnd ? ` on ${new Date(pending.currentPeriodEnd * 1000).toLocaleDateString()}` : ' at the end of your billing period'}` : ''}</p>}
      {pending || billing.active ? <button className="vault-button vault-button--secondary" type="button" disabled={Boolean(billing.opening) || billing.checking} onClick={() => billing.open(true)}>Manage or cancel subscription</button> : <button className="vault-button vault-button--secondary" type="button" disabled={!billing.available || !billing.status || billing.checking || Boolean(billing.opening)} onClick={() => billing.open()}>{billing.opening ? 'Opening secure checkout…' : billing.checking ? 'Checking subscription…' : billing.available ? 'Subscribe for $3.94 USD / month' : 'Checkout unavailable'}</button>}
      <button className="vault-text-button" type="button" disabled={billing.checking || Boolean(billing.opening)} onClick={billing.refresh}>Check subscription status</button>
      {billing.notice && <p role="status">{billing.notice}</p>}
      <p className="vault-footnote">$3.94 USD per month, renewing until canceled. Review the total, including applicable tax, in Stripe before paying. Manage or cancel your subscription here or in Settings. <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link></p>
    </>}
  </section>;
}
