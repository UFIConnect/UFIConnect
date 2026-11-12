export const VENUE_LOCATION_MAX_ACCURACY = 1000;

export function isVenueFeed(mode) {
  return mode === 'restaurants' || mode === 'bars';
}
