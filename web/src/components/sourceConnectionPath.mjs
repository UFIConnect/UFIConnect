export function sourceConnectionPath(source, { publishing = false, returnTo } = {}) {
  if (typeof source !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(source)) return '/connected-accounts';
  const params = new URLSearchParams({ connect: source });
  if (publishing === true) params.set('publishing', '1');
  if (returnTo === 'command-center') params.set('returnTo', returnTo);
  return `/connected-accounts?${params}`;
}
