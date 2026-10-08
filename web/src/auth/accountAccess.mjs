import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/min';

const PROVIDER_ORIGINS = Object.freeze({ google: 'https://accounts.google.com', apple: 'https://appleid.apple.com' });
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const PHONE_COUNTRIES = getCountries().map(code => ({ code, name: countryNames.of(code) || code, callingCode: getCountryCallingCode(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function providerAuthorizationUrl(provider, value) {
  if (!Object.hasOwn(PROVIDER_ORIGINS, provider) || typeof value !== 'string') throw new Error('Sign-in is temporarily unavailable.');
  try {
    const url = new URL(value);
    if (url.origin !== PROVIDER_ORIGINS[provider] || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new Error('Sign-in is temporarily unavailable.'); }
}

export function normalizedPhoneNumber(value, country) {
  if (typeof value !== 'string' || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  if (!value.trim().startsWith('+') && !PHONE_COUNTRIES.some(item => item.code === country)) return null;
  try {
    const phone = parsePhoneNumberFromString(value.trim(), { defaultCountry: country, extract: false });
    return phone && !phone.ext && phone.isPossible() && /^\+[1-9]\d{7,14}$/.test(phone.number) ? phone.number : null;
  } catch { return null; }
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
