// Navigation state never authorizes a route or accepts an external URL.
export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
    || /[\\\u0000-\u0020]/.test(value)) return '/';
  try {
    const target = new URL(value, 'https://uficonnect.invalid');
    if (target.origin !== 'https://uficonnect.invalid'
      || /^\/(?:login|register|forgot-password|reset-password|onboarding)(?:\/|$)/.test(target.pathname)) return '/';
    return target.pathname + target.search + target.hash;
  } catch { return '/'; }
}
