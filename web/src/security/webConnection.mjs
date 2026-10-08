// Accept only the dedicated API's current web-session report. A VPN profile,
// app launch, or generic health response cannot verify browser protection.
export function verifiedWebConnection(value) {
  if (value?.scope !== 'uficonnect-web' || value?.session?.verified !== true
    || typeof value?.transport?.encrypted !== 'boolean'
    || !['https', 'http'].includes(value?.transport?.protocol)
    || value.transport.encrypted !== (value.transport.protocol === 'https')
    || typeof value?.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt))) {
    throw new Error('Web protection could not be verified.');
  }
  const protections = {};
  for (const name of ['revocableSession', 'privateResponses', 'privateMessages', 'validatedImports']) {
    if (typeof value?.protections?.[name] !== 'boolean') throw new Error('Web protection could not be verified.');
    protections[name] = value.protections[name];
  }
  return { scope: value.scope, transport: { encrypted: value.transport.encrypted, protocol: value.transport.protocol },
    session: { verified: true }, protections, checkedAt: value.checkedAt };
}

export function webConnectionProtected(status) {
  return status?.scope === 'uficonnect-web' && status?.transport?.encrypted === true
    && status?.transport?.protocol === 'https' && status?.session?.verified === true;
}
