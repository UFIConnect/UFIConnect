const PROVIDER_ORIGINS = Object.freeze({ google: 'https://accounts.google.com', apple: 'https://appleid.apple.com' });

export function providerAuthorizationUrl(provider, value) {
  if (!Object.hasOwn(PROVIDER_ORIGINS, provider) || typeof value !== 'string') throw new Error('Sign-in is temporarily unavailable.');
  try {
    const url = new URL(value);
    if (url.origin !== PROVIDER_ORIGINS[provider] || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new Error('Sign-in is temporarily unavailable.'); }
}

export const SIGNIN_ERRORS = Object.freeze({
  cancelled: 'Sign-in was cancelled. You can try again.',
  access_denied: 'Sign-in was cancelled. You can try again.',
  invalid_flow: 'This sign-in expired. Please start again.',
  expired: 'This sign-in expired. Please start again.',
  account_exists: 'This email already has an account. Sign in with your existing method, then connect Google or Apple in Settings → Security.',
  browser_binding: 'Allow cookies for UFIConnect and start sign-in again in this browser.',
  unavailable: 'This sign-in service is temporarily unavailable. Please try again.',
});
