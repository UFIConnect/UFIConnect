'use strict';

const { deviceFeedPoint, distanceKm, feedCityByName } = require('./feed-city-location');
const { isVenueFeed, VENUE_LOCATION_MAX_ACCURACY } = require('../shared/venue-location.mjs');

const VENUE_RADIUS_KM = 8;
// A 0.05° tile center is at most 4 km from a point in that tile.
const PROVIDER_RADIUS_METRES = 12000;

function usesAccurateVenueLocation(req) {
  return req.path === '/office/feed' && req.query?.venueSearch === '1' && isVenueFeed(req.query.mode);
}

function preciseVenueDevicePoint(req) {
  const point = deviceFeedPoint(req);
  return point && point.accuracy <= VENUE_LOCATION_MAX_ACCURACY ? point : null;
}

function resolveVenueCity(city, country) {
  const [name, region, ...extra] = String(city || '').split(',').map(value => value.trim());
  if (!name || !country || region === '' || extra.length) return null;
  return feedCityByName(name, country, region);
}

function venueProviderArea(point) {
  const lat = Math.round(point.lat * 20) / 20;
  const lon = ((Math.round(point.lon * 20) + 3600) % 7200 - 3600) / 20;
  return { lat, lon, radius: PROVIDER_RADIUS_METRES };
}

function venueElementsInRange(elements, point) {
  const cutoff = VENUE_RADIUS_KM - (point.accuracy || 0) / 1000;
  return elements.flatMap(element => {
    const { lat, lon } = element?.center || element || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    const distance = distanceKm(point, { lat, lon });
    return distance <= cutoff ? [{ element, distance }] : [];
  }).sort((a, b) => a.distance - b.distance).map(result => result.element);
}

module.exports = { VENUE_RADIUS_KM, usesAccurateVenueLocation, preciseVenueDevicePoint, resolveVenueCity, venueProviderArea, venueElementsInRange };
