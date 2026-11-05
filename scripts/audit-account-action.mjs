// Match either stable authorization action while preserving the exact provider.
// Busy controls are checked separately by the focused connection audit.
export function auditAccountActionName(provider) {
  const name = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^(?:Connect|Reconnect) ' + name + '(?: with an API key)?$');
}
