import { createContext, useContext, useMemo, useRef } from 'react';
import { useAuth } from './AuthContext';
import { VaultBillingContext } from './VaultBillingContext';
import { getAccessToken } from '../auth/session';
import useVaultSubscription from '../security/useVaultSubscription';
import useVaultConnectionMonitor from '../security/useVaultConnectionMonitor';

const VaultConnectionContext = createContext(null);

export function VaultConnectionProvider({ children }) {
  const { profile, token, loading } = useAuth();
  const session = useRef({ token, priorProfile: null,
    accountId: !loading && token && token === getAccessToken() ? profile?.id || null : null });
  if (session.current.token !== token) {
    session.current = { token, priorProfile: profile, accountId: null };
  }
  // Auth can briefly retain the old profile during a token change. Only a
  // profile refreshed for the current session may select an account preference.
  if (!loading && profile?.id && profile !== session.current.priorProfile && token === getAccessToken()) {
    session.current.accountId = profile.id;
  }
  const accountId = !loading && token && token === getAccessToken() ? session.current.accountId : null;
  const billing = useVaultSubscription(accountId, false);
  const monitor = useVaultConnectionMonitor(accountId, billing);
  const sharedBilling = useMemo(() => ({ ...billing, refresh: monitor.refreshBilling }), [billing, monitor.refreshBilling]);
  return <VaultBillingContext.Provider value={{ accountId, billing: sharedBilling }}>
    <VaultConnectionContext.Provider value={{ ...monitor, billing: sharedBilling }}>{children}</VaultConnectionContext.Provider>
  </VaultBillingContext.Provider>;
}

export function useVaultConnection() { return useContext(VaultConnectionContext); }
