import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { billingReturnPath, hostedBillingUrl } from '../api/hostedBilling.mjs';
import { getAccessToken, subscribeToSession } from '../auth/session';
import { paidVpnAccess } from '../lib/vpnAccess';
import { isNativeRuntime } from '../nativeRuntime.mjs';

export default function useVaultSubscription(accountId, preview, enabled = true) {
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
    if (!enabled || preview || !accountId || !token || !current()) { setChecking(false); return; }
    const pending = new AbortController();
    controller.current = pending;
    setChecking(true);
    try {
      const options = { headers: { Authorization: `Bearer ${token}` }, signal: pending.signal };
      const [configResponse, statusResponse] = await Promise.all([client.get('/billing/config', options), client.get('/billing/status', options)]);
      if (!current() || pending.signal.aborted) return;
      setConfig({ data: configResponse.data, accountId, token }); setStatus({ data: statusResponse.data, accountId, token, confirmedAt: Date.now() });
      const result = new URLSearchParams(window.location.search).get('upgrade');
      setNotice({ accountId, token, message: result === 'success' ? paidVpnAccess({ status: statusResponse.data }) ? 'Your UFI Vault membership is active.' : 'Payment is still being confirmed. Check status again shortly before starting another checkout.' : result === 'cancelled' ? 'Checkout was closed. No subscription was activated here.' : '' });
    } catch {
      if (current() && !pending.signal.aborted) { setStatus(null); setNotice({ accountId, token, message: 'Could not confirm Vault billing. Check status again before subscribing.' }); }
    } finally { if (current() && !pending.signal.aborted) setChecking(false); if (controller.current === pending) controller.current = null; }
  }, [accountId, preview, token, enabled]);
  useEffect(() => { operation.current++; openingRef.current = false; setConfig(null); setStatus(null); setOpening(''); setNotice(null); refresh(); return () => { sequence.current++; operation.current++; controller.current?.abort(); }; }, [refresh]);
  const currentSession = Boolean(enabled && accountId && token && token === getAccessToken());
  const config = currentSession && configReport?.accountId === accountId && configReport?.token === token ? configReport.data : null;
  const status = currentSession && statusReport?.accountId === accountId && statusReport?.token === token ? statusReport.data : null;
  const notice = currentSession && noticeReport?.accountId === accountId && noticeReport?.token === token ? noticeReport.message : '';
  const currentChecking = checking || Boolean(currentSession && statusReport && !status);
  const active = currentSession && paidVpnAccess({ status, checking: currentChecking });
  const periodActive = currentSession && paidVpnAccess({ status });
  const paidUntil = periodActive ? Number(status.subscriptions.find(item => item?.kind === 'vpn_connector' && item?.status === 'active').currentPeriodEnd) * 1000 : 0;
  const confirmedAt = status ? statusReport.confirmedAt : 0;
  const verifiedUntil = Math.min(paidUntil, confirmedAt + 90000);
  const [expiryRevision, setExpiryRevision] = useState(0);
  const monitoringActive = Boolean(periodActive && verifiedUntil > Date.now());
  const invalidate = useCallback(() => { setStatus(null); }, []);
  useEffect(() => {
    if (!monitoringActive) return undefined;
    const expiry = window.setTimeout(() => setExpiryRevision(value => value + 1), Math.min(2147483647, Math.max(1, verifiedUntil - Date.now() + 1)));
    return () => window.clearTimeout(expiry);
  }, [monitoringActive, verifiedUntil, expiryRevision]);
  useEffect(() => {
    if (!paidUntil) return undefined;
    const expiry = window.setTimeout(refresh, Math.min(2147483647, Math.max(1, paidUntil - Date.now() + 1)));
    return () => window.clearTimeout(expiry);
  }, [paidUntil, refresh]);
  useEffect(() => {
    if (!enabled || preview || !accountId || !token) return;
    const update = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [enabled, preview, accountId, token, refresh]);
  async function open(portal = false) {
    if (isNativeRuntime()) return;
    if (openingRef.current || currentChecking || preview || !currentSession) return;
    openingRef.current = true;
    const request = operation.current;
    setOpening(portal ? 'portal' : 'checkout'); setNotice(null);
    try {
      const returnPath = billingReturnPath();
      const { data } = await client.post(portal ? '/billing/create-portal-session' : '/billing/create-checkout-session', portal ? { returnPath } : { tier: 'vpn_connector', returnPath }, { headers: { Authorization: `Bearer ${token}` } });
      if (request !== operation.current || currentAccount.current !== accountId || token !== getAccessToken()) return;
      window.location.assign(hostedBillingUrl(data.url, portal ? 'portal' : 'checkout'));
    } catch (error) { if (request === operation.current && currentAccount.current === accountId && token === getAccessToken()) setNotice({ accountId, token, message: error?.response?.data?.message || 'Could not open secure billing. Try again.' }); }
    finally { if (request === operation.current) { openingRef.current = false; setOpening(''); } }
  }
  const price = config?.pricing?.vpn_connector;
  return { status, checking: currentChecking, opening, notice, refresh, open, preview, active, monitoringActive, monitoringUntil: verifiedUntil, confirmedAt, invalidate,
    available: config?.paymentsReady === true && config?.tiers?.vpn_connector === true && price?.active === true && price?.unitAmount === 394 && price?.currency === 'USD' && price?.interval === 'month' && price?.intervalCount === 1 };
}

