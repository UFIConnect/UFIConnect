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
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setChecking(true);
    if (preview) { setChecking(false); return; }
    try {
      const [configResponse, statusResponse] = await Promise.all([client.get('/billing/config'), client.get('/billing/status')]);
      if (request !== sequence.current) return;
      setConfig(configResponse.data); setStatus(statusResponse.data);
      const result = new URLSearchParams(window.location.search).get('upgrade');
      setNotice(result === 'success' ? statusResponse.data.vpnConnectorAddon ? 'Your UFI VPN Connector subscription is active.' : 'Payment is still being confirmed. Check status again shortly before starting another checkout.' : result === 'cancelled' ? 'Checkout was closed. No subscription was activated here.' : '');
    } catch {
      if (request === sequence.current) { setStatus(null); setNotice('Could not confirm VPN Connector billing. Check status again before subscribing.'); }
    } finally { if (request === sequence.current) setChecking(false); }
  }, [accountId, preview]);
  useEffect(() => { setConfig(null); setStatus(null); setOpening(''); refresh(); return () => { sequence.current++; }; }, [refresh]);
  async function open(portal = false) {
    if (opening || checking || preview) return;
    const request = sequence.current;
    setOpening(portal ? 'portal' : 'checkout'); setNotice('');
    try {
      const { data } = await client.post(portal ? '/billing/create-portal-session' : '/billing/create-checkout-session', portal ? {} : { tier: 'vpn_connector' });
      if (request !== sequence.current) return;
      window.location.assign(hostedBillingUrl(data.url, portal ? 'portal' : 'checkout'));
    } catch (error) { if (request === sequence.current) { setNotice(error?.response?.data?.message || 'Could not open secure billing. Try again.'); setOpening(''); } }
  }
  const price = config?.pricing?.vpn_connector;
  return { status, checking, opening, notice, refresh, open, preview,
    active: !checking && status?.vpnConnectorAddon === true,
    available: config?.paymentsReady === true && config?.tiers?.vpn_connector === true && price?.unitAmount === 394 && price?.currency === 'USD' && price?.interval === 'month' && price?.intervalCount === 1 };
}

export default function VaultVpnSubscription({ billing }) {
  const pending = billing.status?.subscriptions?.find(item => item.kind === 'vpn_connector' && !['canceled', 'incomplete_expired'].includes(item.status));
  return <section className="vault-vpn-guide vault-vpn-subscription" aria-labelledby="vpn-subscription-title">
    <h3 id="vpn-subscription-title">UFI VPN Connector · $3.94 USD / month</h3>
    <p>Save up to 40 configured VPN profile labels and countries in your UFI account, then access them on your devices. Your existing VPN app controls the connection and country switching.</p>
    <p><strong>A VPN service or Proton subscription is not included.</strong> Device instructions, provider links and your password vault remain free.</p>
    {billing.preview ? <p role="status">Local review: sample connector controls only. No payment is taken and this preview does not grant a paid subscription.</p> : <>
      {billing.active && <p role="status">Active{pending?.cancelAtPeriodEnd ? ` · Cancels${pending.currentPeriodEnd ? ` on ${new Date(pending.currentPeriodEnd * 1000).toLocaleDateString()}` : ' at the end of your billing period'}` : ''}</p>}
      {pending || billing.active ? <button className="vault-button vault-button--secondary" type="button" disabled={Boolean(billing.opening) || billing.checking} onClick={() => billing.open(true)}>Manage or cancel subscription</button> : <button className="vault-button vault-button--secondary" type="button" disabled={!billing.available || !billing.status || billing.checking || Boolean(billing.opening)} onClick={() => billing.open()}>{billing.opening ? 'Opening secure checkout…' : billing.checking ? 'Checking subscription…' : billing.available ? 'Subscribe for $3.94 USD / month' : 'Checkout currently unavailable'}</button>}
      <button className="vault-text-button" type="button" disabled={billing.checking || Boolean(billing.opening)} onClick={billing.refresh}>Check subscription status</button>
      {billing.notice && <p role="status">{billing.notice}</p>}
      <p className="vault-footnote">Renews monthly until canceled. Review the total, including any applicable tax, in Stripe before paying. Cancel in Settings → Manage billing. Existing users are never subscribed automatically. <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link></p>
    </>}
  </section>;
}
