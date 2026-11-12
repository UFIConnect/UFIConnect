import { normalizeFeedLocation } from './feedLocation.mjs';

export const VENUE_LOCATION_MAX_ACCURACY = 1000;
const STATE_AND_PROVINCE_CODES = new Set(
  'AB AK AL AR AZ BC CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MB MD ME MI MN MO MS MT NB NC ND NE NH NJ NL NM NS NT NU NV NY OH OK ON OR PA PE QC RI SC SD SK TN TX UT VA VT WA WI WV WY YT'.split(' '),
);

export function isVenueFeed(mode) {
  return mode === 'restaurants' || mode === 'bars';
}

export function parseVenueFeedSearch(value, mode) {
  const input = String(value || '').trim().slice(0, 500);
  const genericName = mode === 'restaurants' ? /^restaurants?$/i : /^bars?(?: and clubs)?$/i;
  const keyword = value => genericName.test(value.trim()) ? '' : value.trim();
  const nearby = /(?:^|\s)near\s+me$/i.exec(input);
  if (nearby) return { query: keyword(input.slice(0, nearby.index)), useDevice: true };

  const location = /^in\s+/i.exec(input) || (input.includes(',') ? [...input.matchAll(/\sin\s+/gi)].at(-1) : null);
  if (!location) return { query: keyword(input) };

  const parts = input.slice(location.index + location[0].length).split(',').map(part => part.trim());
  const countryInput = parts.pop();
  // A bare two-letter code after a city can also be a state or province.
  if (parts.length === 1 && STATE_AND_PROVINCE_CODES.has(countryInput.toUpperCase())) {
    return { error: 'Spell out the country name. For a state or province, enter “in City, Region, Country”.' };
  }
  const country = /^uk$/i.test(countryInput) ? 'GB' : countryInput;
  const area = normalizeFeedLocation({ city: parts.join(', '), country });
  if (!area.country || parts.some(part => !part) || (parts.length && !area.city)) {
    return { error: 'Enter a location as “in City, Country”.' };
  }
  return { query: keyword(input.slice(0, location.index)), area };
}
