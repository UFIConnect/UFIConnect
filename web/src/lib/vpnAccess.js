export function paidVpnAccess(billing, now = Date.now()) {
  if (billing?.checking || billing?.status?.vpnConnectorAddon !== true) return false;
  const active = Array.isArray(billing.status.subscriptions)
    ? billing.status.subscriptions.filter(value => value?.kind === 'vpn_connector' && value?.status === 'active') : [];
  const until = active.length === 1 ? Number(active[0].currentPeriodEnd) * 1000 : 0;
  return Number.isFinite(until) && until > now;
}
