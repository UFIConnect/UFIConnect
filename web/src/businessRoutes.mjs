export function isBusinessRouteAllowed(pathname) {
  return ['/recruiting', '/people', '/connected-accounts', '/messages', '/settings', '/privacy', '/terms', '/child-safety', '/login', '/register', '/forgot-password', '/reset-password', '/onboarding'].includes(pathname)
    || /^\/messages\/[^/]+\/?$/.test(pathname);
}
