export function isBusinessRouteAllowed(pathname, profile = {}) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (['/policies', '/copyright', '/vault-device', '/how-it-works', '/how-office-works'].includes(path)) return true;
  // Vault recovery must remain reachable even after its membership ends.
  if (['/vault', '/vault/device'].includes(path)) return true;
  if (['/resume-builder', '/resume-builder/cover-letter/preview'].includes(path)) return profile.resumeBuilderAddon === true;
  return ['/recruiting', '/career-posts', '/business-posts', '/business/industries', '/business/cross-post', '/jobs/new', '/opportunities', '/people', '/connected-accounts', '/messages', '/settings', '/privacy', '/terms', '/child-safety', '/login', '/register', '/forgot-password', '/reset-password', '/onboarding'].includes(path)
    || /^\/opportunities\/[^/]+$/.test(path)
    || /^\/p\/[^/]+$/.test(path)
    || /^\/messages\/[^/]+$/.test(path);
}
