const PROVIDER_ORIGINS = Object.freeze({ google: 'https://accounts.google.com', apple: 'https://appleid.apple.com' });

export function providerAuthorizationUrl(provider, value) {
  if (!Object.hasOwn(PROVIDER_ORIGINS, provider) || typeof value !== 'string') throw new Error('Sign-in is temporarily unavailable.');
  try {
    const url = new URL(value);
    if (url.origin !== PROVIDER_ORIGINS[provider] || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new Error('Sign-in is temporarily unavailable.'); }
}

export function normalizedPhoneNumber(value) {
  const phone = typeof value === 'string' ? value.replace(/[\s().-]/g, '') : '';
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export const SIGNIN_ERRORS = Object.freeze({
  cancelled: 'Sign-in was cancelled. You can try again.',
  access_denied: 'Sign-in was cancelled. You can try again.',
  invalid_flow: 'This sign-in expired. Please start again.',
  expired: 'This sign-in expired. Please start again.',
  account_exists: 'This email already has an account. Sign in with your existing method first.',
  unavailable: 'This sign-in service is temporarily unavailable. Please try again.',
});
