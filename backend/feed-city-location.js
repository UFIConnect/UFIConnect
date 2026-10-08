'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const RADIUS_MILES = 100;
const RADIUS_KM = RADIUS_MILES * 1.609344;
let catalog;
function normalizedName(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function catalogData() {
  if (catalog) return catalog;
  const data = JSON.parse(gunzipSync(fs.readFileSync(path.join(__dirname, 'geo/feed-cities.json.gz')), { maxOutputLength: 30000000 }).toString('utf8'));
  const cells = new Map(), names = new Map();
  for (const city of data.cities) {
    const cell = `${Math.floor(city[4] * 2)}:${Math.floor(city[5] * 2)}`;
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(city);
    for (const name of new Set([normalizedName(city[0]), normalizedName(city[1])].filter(Boolean))) {
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(city);
    }
  }
  catalog = { ...data, cells, names };
  return catalog;
}
function distanceKm(left, right) {
  const radians = value => value * Math.PI / 180;
  const lat = radians(right.lat - left.lat), lon = radians(right.lon - left.lon);
  const a = Math.sin(lat / 2) ** 2 + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(lon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}
function cityLocation(city) {
  return { city: city[0], country: city[2], region: catalogData().regions[city[2] + '.' + city[3]] || null, lat: city[4], lon: city[5] };
}
function nearestFeedCity(point) {
  const { cells } = catalogData();
  const latRadius = 35 / 110, lonRadius = Math.min(180, 35 / (111 * Math.max(0.001, Math.cos(point.lat * Math.PI / 180))));
  let closest = null, shortest = 35;
  for (let lat = Math.max(-180, Math.floor((point.lat - latRadius) * 2)); lat <= Math.min(179, Math.floor((point.lat + latRadius) * 2)); lat++) {
    for (let lon = Math.floor((point.lon - lonRadius) * 2); lon <= Math.floor((point.lon + lonRadius) * 2); lon++) {
      const wrapped = ((lon + 360) % 720 + 720) % 720 - 360;
      for (const city of cells.get(`${lat}:${wrapped}`) || []) {
        const distance = distanceKm(point, { lat: city[4], lon: city[5] });
        if (distance < shortest) { closest = city; shortest = distance; }
      }
    }
  }
  return closest ? cityLocation(closest) : null;
}
function feedCityByName(name, country, region) {
  let matches = catalogData().names.get(normalizedName(name)) || [];
  if (country) matches = matches.filter(city => city[2] === country);
  if (region) {
    const expected = normalizedName(region);
    matches = matches.filter(city => normalizedName(city[3]) === expected || normalizedName(catalogData().regions[city[2] + '.' + city[3]]) === expected);
  }
  // Ambiguous names cannot establish a nearby location.
  return matches.length === 1 ? cityLocation(matches[0]) : null;
}
function deviceFeedPoint(req, now = Date.now()) {
  if (!req.user?.id) return null;
  const header = req.headers?.['x-ufi-device-location'];
  if (typeof header !== 'string' || header.length > 200) return null;
  try {
    const values = JSON.parse(header);
    if (!Array.isArray(values) || values.length !== 4) return null;
    const [lat, lon, accuracy, timestamp] = values;
    if (![lat, lon, accuracy, timestamp].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180
      || accuracy < 0 || accuracy > 10000 || timestamp > now + 60000 || now - timestamp > 15 * 60 * 1000) return null;
    return { lat, lon, accuracy };
  } catch { return null; }
}
module.exports = { RADIUS_MILES, RADIUS_KM, distanceKm, nearestFeedCity, feedCityByName, deviceFeedPoint };
