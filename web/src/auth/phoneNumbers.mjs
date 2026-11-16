import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/min';

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const PHONE_COUNTRIES = getCountries().map(code => ({ code, name: countryNames.of(code) || code, callingCode: getCountryCallingCode(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function normalizedPhoneNumber(value, country) {
  if (typeof value !== 'string' || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  if (!value.trim().startsWith('+') && !PHONE_COUNTRIES.some(item => item.code === country)) return null;
  try {
    const phone = parsePhoneNumberFromString(value.trim(), { defaultCountry: country, extract: false });
    return phone && !phone.ext && phone.isPossible() && /^\+[1-9]\d{7,14}$/.test(phone.number) ? phone.number : null;
  } catch { return null; }
}
