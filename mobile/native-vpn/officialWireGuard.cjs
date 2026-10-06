'use strict';
const PROFILE_URL = 'https://uficonnect.org/vault#vpn';
const INSTALL_URL = 'https://apps.apple.com/app/wireguard/id1441195209';
function hasPaidAccess(status, now = Date.now()) {
  if (status?.vpnConnectorAddon !== true || !Array.isArray(status.subscriptions)) return false;
  const matches = status.subscriptions.filter(value => value?.kind === 'vpn_connector');
  if (matches.length !== 1) return false;
  const subscription = matches[0];
  return subscription.status === 'active' && typeof subscription.currentPeriodEnd === 'number' &&
    Number.isFinite(subscription.currentPeriodEnd) && subscription.currentPeriodEnd * 1000 > now;
}
async function checkProfileAccess({session, getMembership, isCurrent = () => true}) {
  if (!session) return 'inactive';
  const status = await getMembership(session);
  if (!isCurrent()) return 'stale';
  return hasPaidAccess(status) ? 'active' : 'inactive';
}
async function openMemberVpnProfile({session, getMembership, isCurrent, openURL}) {
  const state = await checkProfileAccess({session, getMembership, isCurrent});
  if (state !== 'active' || !isCurrent()) return state;
  // Browser authentication stays in the browser. No app token, account ID,
  // tunnel key, or payment action is encoded in this fixed destination.
  await openURL(PROFILE_URL);
  return isCurrent() ? 'opened' : 'stale';
}
module.exports = {PROFILE_URL, INSTALL_URL, hasPaidAccess, checkProfileAccess, openMemberVpnProfile};
