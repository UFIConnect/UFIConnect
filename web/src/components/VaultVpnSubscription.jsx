import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { hostedBillingUrl } from '../api/hostedBilling.mjs';
import { getAccessToken, subscribeToSession } from '../auth/session';
import { paidVpnAccess } from '../lib/vpnAccess';

export function useVpnSubscription(accountId, preview) {
  const [token, setToken] = useState(getAccessToken);
  const [configReport, setConfig] = useState(null);
  const [statusReport, setStatus] = useState(null);
  const [checking, setChecking] = useState(true);
  const [opening, setOpening] = useState('');
  const [noticeReport, setNotice] = useState(null);
  const sequence = useRef(0);
  const operation = useRef(0);
  const openingRef = useRef(false);
  const currentAccount = useRef(accountId); currentAccount.current = accountId;
  const controller = useRef(null);
  useEffect(() => subscribeToSession(value => {
    sequence.current++; operation.current++;
    controller.current?.abort(); openingRef.current = false;
    setConfig(null); setStatus(null); setNotice(null); setOpening('');
    setChecking(Boolean(currentAccount.current && value)); setToken(value);
  }), []);
  const refresh = useCallback(async () => {
    if (currentAccount.current !== accountId || token !== getAccessToken()) return;
    const request = ++sequence.current;
    controller.current?.abort();
    controller.current = null;
    const current = () => request === sequence.current && currentAccount.current === accountId && token === getAccessToken();
    if (preview || !accountId || !token || !current()) { setChecking(false); return; }
    const pending = new AbortController();
    controller.current = pending;
    setChecking(true);
    try {
      const options = { headers: { Authorization: `Bearer ${token}` }, signal: pending.signal };
      const [configResponse, statusResponse] = await Promise.all([client.get('/billing/config', options), client.get('/billing/status', options)]);
      if (!current() || pending.signal.aborted) return;
      setConfig({ data: configResponse.data, accountId, token }); setStatus({ data: statusResponse.data, accountId, token });
      const result = new URLSearchParams(window.location.search).get('upgrade');
      setNotice({ accountId, token, message: result === 'success' ? paidVpnAccess({ status: statusResponse.data }) ? 'Your UFI Vault membership is active.' : 'Payment is still being confirmed. Check status again shortly before starting another checkout.' : result === 'cancelled' ? 'Checkout was closed. No subscription was activated here.' : '' });
    } catch {
      if (current() && !pending.signal.aborted) { setStatus(null); setNotice({ accountId, token, message: 'Could not confirm Vault billing. Check status again before subscribing.' }); }
    } finally { if (current() && !pending.signal.aborted) setChecking(false); if (controller.current === pending) controller.current = null; }
  }, [accountId, preview, token]);
  useEffect(() => { operation.current++; openingRef.current = false; setConfig(null); setStatus(null); setOpening(''); setNotice(null); refresh(); return () => { sequence.current++; operation.current++; controller.current?.abort(); }; }, [refresh]);
  const currentSession = Boolean(accountId && token && token === getAccessToken());
  const config = currentSession && configReport?.accountId === accountId && configReport?.token === token ? configReport.data : null;
  const status = currentSession && statusReport?.accountId === accountId && statusReport?.token === token ? statusReport.data : null;
  const notice = currentSession && noticeReport?.accountId === accountId && noticeReport?.token === token ? noticeReport.message : '';
  const currentChecking = checking || Boolean(currentSession && statusReport && !status);
  const active = currentSession && paidVpnAccess({ status, checking: currentChecking });
  const paidUntil = active ? Number(status.subscriptions.find(item => item?.kind === 'vpn_connector' && item?.status === 'active').currentPeriodEnd) * 1000 : 0;
  useEffect(() => {
    if (!paidUntil) return undefined;
    const expiry = window.setTimeout(refresh, Math.min(2147483647, Math.max(1, paidUntil - Date.now() + 1)));
    return () => window.clearTimeout(expiry);
  }, [paidUntil, refresh]);
  useEffect(() => {
    if (preview) return;
    const update = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, [preview, refresh]);
  async function open(portal = false) {
    if (openingRef.current || currentChecking || preview || !currentSession) return;
    openingRef.current = true;
    const request = operation.current;
    setOpening(portal ? 'portal' : 'checkout'); setNotice(null);
    try {
      const { data } = await client.post(portal ? '/billing/create-portal-session' : '/billing/create-checkout-session', portal ? {} : { tier: 'vpn_connector' }, { headers: { Authorization: `Bearer ${token}` } });
      if (request !== operation.current || currentAccount.current !== accountId || token !== getAccessToken()) return;
      window.location.assign(hostedBillingUrl(data.url, portal ? 'portal' : 'checkout'));
    } catch (error) { if (request === operation.current && currentAccount.current === accountId && token === getAccessToken()) setNotice({ accountId, token, message: error?.response?.data?.message || 'Could not open secure billing. Try again.' }); }
    finally { if (request === operation.current) { openingRef.current = false; setOpening(''); } }
  }
  const price = config?.pricing?.vpn_connector;
  return { status, checking: currentChecking, opening, notice, refresh, open, preview, active,
    available: config?.paymentsReady === true && config?.tiers?.vpn_connector === true && price?.active === true && price?.unitAmount === 394 && price?.currency === 'USD' && price?.interval === 'month' && price?.intervalCount === 1 };
}

export default function VaultVpnSubscription({ billing }) {
  const pending = Array.isArray(billing.status?.subscriptions) ? billing.status.subscriptions.find(item => item?.kind === 'vpn_connector' && !['canceled', 'incomplete_expired'].includes(item.status)) : null;
  return <section className="vault-vpn-guide vault-vpn-subscription" aria-labelledby="vpn-subscription-title">
    <h3 id="vpn-subscription-title">UFI Vault · $3.94 USD / month</h3>
    <p>Create your encrypted vault and add, edit or import passwords, documents and keys with one membership. Items are saved in this browser; keep an encrypted backup for recovery.</p>
    <p>Vault connection monitoring requires an active paid membership and works inside UFIConnect without an app or download. HTTPS and account security protect every account. Device VPN access requires a supported client and an available VPN gateway.</p>
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
