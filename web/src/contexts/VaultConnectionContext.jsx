import { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { VaultBillingContext } from './VaultBillingContext';
import useVaultSubscription from '../security/useVaultSubscription';
import useVaultConnectionMonitor from '../security/useVaultConnectionMonitor';

const VaultConnectionContext = createContext(null);

export function VaultConnectionProvider({ children }) {
  // The profile may still belong to the previous token during an account change.
  const { sessionProfileId, loading } = useAuth();
  const accountId = loading ? null : sessionProfileId;
  const billing = useVaultSubscription(accountId, false);
  const monitor = useVaultConnectionMonitor(accountId, billing);
  const sharedBilling = useMemo(() => ({ ...billing, refresh: monitor.refreshBilling }), [billing, monitor.refreshBilling]);
  return <VaultBillingContext.Provider value={{ accountId, billing: sharedBilling }}>
    <VaultConnectionContext.Provider value={{ ...monitor, billing: sharedBilling }}>{children}</VaultConnectionContext.Provider>
  </VaultBillingContext.Provider>;
}

export function useVaultConnection() { return useContext(VaultConnectionContext); }
