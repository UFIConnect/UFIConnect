export function isBusinessRouteAllowed(pathname, profile = {}) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (['/policies', '/copyright', '/vault-device', '/how-office-works'].includes(path)) return true;
  // Vault recovery must remain reachable even after its membership ends.
  if (['/vault', '/vault/device'].includes(path)) return true;
  if (['/resume-builder', '/resume-builder/cover-letter/preview'].includes(path)) return profile.resumeBuilderAddon === true;
  return ['/recruiting', '/people', '/connected-accounts', '/messages', '/settings', '/privacy', '/terms', '/child-safety', '/login', '/register', '/forgot-password', '/reset-password', '/onboarding'].includes(path)
    || /^\/messages\/[^/]+$/.test(path);
}
