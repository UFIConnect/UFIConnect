import { deviceFeedLocationKey } from './deviceFeedLocation.mjs';
import { isNativeRuntime } from '../nativeRuntime.mjs';
import { isVenueFeed, VENUE_LOCATION_MAX_ACCURACY } from '../../../shared/venue-location.mjs';

export function normalizeFeedLocation(value = {}) {
  return {
    country: String(value?.country || '').replace(/[<>]/g, '').trim().slice(0, 80),
    city: String(value?.city || '').replace(/[<>]/g, '').trim().slice(0, 80),
  };
}

export function savedFeedLocation(settings = {}, mode) {
  const scoped = settings?.feedLocations;
  if (scoped && Object.hasOwn(scoped, mode)) return normalizeFeedLocation(scoped[mode]);
  return normalizeFeedLocation(usesAccurateVenueLocation(mode) ? null : settings?.feedLocation);
}

export function usesAccurateVenueLocation(mode) {
  return isVenueFeed(mode) && !isNativeRuntime();
}

export function regionalFeedLocation(settings = {}) {
  return { mode: 'auto', country: '', city: '' };
}

export function feedLocationKey(settings = {}, mode = 'feed') {
  if (usesAccurateVenueLocation(mode)) {
    const destination = savedFeedLocation(settings, mode);
    const device = destination.city || destination.country ? ''
      : deviceFeedLocationKey(Date.now(), { precision: 1000, maxAccuracy: VENUE_LOCATION_MAX_ACCURACY });
    return JSON.stringify({ destination, device });
  }
  return JSON.stringify(['countries', 'restaurants', 'bars', 'local'].includes(mode)
    ? { regional: regionalFeedLocation(settings), destination: savedFeedLocation(settings, mode), device: deviceFeedLocationKey() }
    : { regional: regionalFeedLocation(settings), device: deviceFeedLocationKey() });
}
