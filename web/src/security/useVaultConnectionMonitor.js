import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAccessToken } from '../auth/session';
import { paidVpnAccess } from '../lib/vpnAccess';
import useWebConnection from './useWebConnection';

function readPreference(key) {
  if (!key) return true;
  try { return window.localStorage.getItem(key) !== 'off'; } catch { return true; }
}

export default function useVaultConnectionMonitor(accountId, billing) {
  const key = accountId ? `ufi:vault-monitoring:${encodeURIComponent(accountId)}` : null;
  const token = getAccessToken();
  const identity = useRef({ accountId, token, key }); identity.current = { accountId, token, key };
  const saved = useMemo(() => readPreference(key), [key]);
  const [preference, setPreference] = useState(null);
  const [denied, setDenied] = useState(null);
  const monitoring = preference?.key === key ? preference.enabled : saved;
  const billingPaid = billing?.monitoringActive == null ? paidVpnAccess(billing) : billing.monitoringActive;
  const locked = Boolean(denied && denied.accountId === accountId && denied.token === token);
  const paid = Boolean(billingPaid && !locked);
  const enabled = Boolean(accountId && token && paid && monitoring);
  const onDenied = useCallback(() => {
    if (identity.current.accountId !== accountId || identity.current.token !== token || token !== getAccessToken()) return;
    setDenied({ accountId, token });
    billing.invalidate?.();
    void billing.refresh();
  }, [accountId, token, billing.refresh, billing.invalidate]);
  const canCheck = () => identity.current.accountId === accountId && token === getAccessToken() && monitoring && !locked
    && paidVpnAccess({ status: billing.status }) && (billing.monitoringUntil == null || billing.monitoringUntil > Date.now());
  const connection = useWebConnection(accountId, enabled, { endpoint: '/security/vault-connection', onDenied, canCheck });
  const setMonitoring = useCallback(value => {
    if (!paid || !accountId || !connection.authenticated || identity.current.accountId !== accountId || token !== getAccessToken()) return;
    const next = Boolean(value);
    setPreference({ key, enabled: next });
    try { if (key) window.localStorage.setItem(key, next ? 'on' : 'off'); } catch { /* Browser storage is optional. */ }
  }, [paid, accountId, connection.authenticated, token, key]);
  const refreshBilling = useCallback(async () => {
    await billing.refresh();
    if (identity.current.accountId === accountId && identity.current.token === token && token === getAccessToken()) setDenied(null);
  }, [accountId, token, billing.refresh]);
  useEffect(() => {
    if (!billingPaid && !billing.checking) setDenied(null);
  }, [billingPaid, billing.checking]);
  useEffect(() => {
    const sync = event => {
      if (identity.current.key !== key) return;
      let storage;
      try { storage = window.localStorage; } catch { return; }
      if (event.storageArea === storage && (event.key === key || event.key === null)) setPreference({ key, enabled: readPreference(key) });
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);
  return { ...connection, accountId, billing, paid, enabled, monitoring, setMonitoring, refreshBilling, locked };
}
