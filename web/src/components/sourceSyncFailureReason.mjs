export function syncFailureReason(message) {
  // Provider errors can contain request URLs or other diagnostic data.
  const detail = typeof message === 'string' ? message : '';
  if (/quota|rate[ -]?limit|\b429\b/i.test(detail)) return 'The provider request limit was reached.';
  if (/reconnect|revoked|expired|invalid[ _-]token|unauthori[sz]ed|\b401\b/i.test(detail)) return 'Reconnect this account to resume syncing.';
  if (/permission|scope|forbidden|\b403\b/i.test(detail)) return 'The provider denied access to this feed.';
  if (/timed out|timeout/i.test(detail)) return 'The provider took too long to respond.';
  return 'The provider is temporarily unavailable.';
}
