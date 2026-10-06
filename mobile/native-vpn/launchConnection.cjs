'use strict';
function disclosureKey(accountId) {
  const id = String(accountId ?? '');
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? `uficonnect.vpn.disclosure.20261006:${id}` : null;
}
async function connectFromIntent({session,isCurrent,automatic,accepted,acknowledge,vpn}) {
  if (!session || !isCurrent()) return false;
  if (automatic) {
    if (!accepted) return false;
    const status = await vpn.status();
    if (!isCurrent()) return false;
    if (['connected','connecting','starting','stopping'].includes(status.state)) return false;
    if (status.state !== 'disconnected') throw new Error('VPN state unavailable');
  } else {
    await acknowledge();
    if (!isCurrent()) return false;
  }
  if (!isCurrent()) return false;
  await vpn.connect(session);
  return true;
}
module.exports = {disclosureKey,connectFromIntent};
