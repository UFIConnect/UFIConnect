import { useContext } from 'react';
import { Link } from 'react-router-dom';
import useVaultSubscription from '../security/useVaultSubscription';
import { VaultBillingContext } from '../contexts/VaultBillingContext';
import { isNativeRuntime } from '../nativeRuntime.mjs';

export function useVpnSubscription(accountId, preview) {
  const shared = useContext(VaultBillingContext);
  const present = Boolean(!preview && shared);
  const local = useVaultSubscription(accountId, preview, !present);
  if (!present) return local;
  if (shared.accountId === accountId) return shared.billing;
  return { ...shared.billing, status: null, active: false, monitoringActive: false, monitoringUntil: 0,
    available: false, checking: true, notice: '', opening: '' };
}
export default function VaultVpnSubscription({ billing }) {
  const pending = Array.isArray(billing.status?.subscriptions) ? billing.status.subscriptions.find(item => item?.kind === 'vpn_connector' && !['canceled', 'incomplete_expired'].includes(item.status)) : null;
  if (isNativeRuntime()) return <section className="vault-vpn-guide vault-vpn-subscription" aria-labelledby="vpn-subscription-title">
    <h3 id="vpn-subscription-title">UFI Vault</h3>
    <p>Your encrypted items are stored on this device. Keep an encrypted backup for recovery. Existing items remain available to unlock, view, download, restore or delete.</p>
    <p role="status">{billing.checking ? 'Checking membership…' : billing.active ? 'Your existing membership is active.' : 'An active membership is required to add or edit vault items.'}</p>
    <p>Connection monitoring applies inside UFIConnect. Device VPN access requires a separate supported client and an available gateway.</p>
    <button className="vault-text-button" type="button" disabled={billing.checking} onClick={billing.refresh}>Check membership status</button>
    {billing.notice && <p role="status">{billing.notice}</p>}
    <p className="vault-footnote"><Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link></p>
  </section>;
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
