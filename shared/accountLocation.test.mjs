import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountSections } from './accountCategories.js';
import { accountLocationBasisLabel, accountLocationCityLabel, locationAccountSection, normalizeAccountLocationReport } from './accountLocation.js';

test('location ranking overlays base groups and preserves authoritative provider metadata', () => {
  const mastodon = { name: 'Mastodon', configured: true, siteUrl: 'https://mastodon.social/', color: '#123456' };
  const indeed = { name: 'Indeed', category: 'career', configured: false, connectionMode: 'external' };
  const entries = [['mastodon', mastodon], ['indeed', indeed]];
  const base = accountSections(entries);
  const report = normalizeAccountLocationReport({ platformIds: ['indeed', 'unknown', 'mastodon', 'indeed'], basis: 'recent_local_activity', windowDays: 7,
    activityCounts: { indeed: 4 }, locationContext: { available: true, city: 'Los Angeles', region: 'CA', countryName: 'United States', point: { latitude: 34, longitude: -118 } } });
  const overlay = locationAccountSection(entries, report);
  assert.deepEqual(overlay.items.map(([id]) => id), ['indeed', 'mastodon']);
  assert.equal(overlay.items[0][1], indeed);
  assert.equal(overlay.items[1][1], mastodon);
  assert.equal(overlay.total, 2);
  assert.deepEqual(accountSections(entries), base, 'Location does not recategorize providers');
  assert.equal(report.locationContext.point, undefined, 'The browser presentation retains only the coarse public context');
  assert.equal(accountLocationCityLabel(report), 'Los Angeles, CA, United States');
  assert.match(accountLocationBasisLabel(report), /recent public posts.*7 days/);
});

test('Business location ranking intersects career scope even when a response includes personal sources', () => {
  const entries = [['mastodon', { configured: true }], ['indeed', { category: 'career', configured: false }], ['linkedin', { configured: false }]];
  const report = { platformIds: ['mastodon', 'linkedin', 'indeed'] };
  assert.deepEqual(locationAccountSection(entries, report, { business: true }).items.map(([id]) => id), ['linkedin', 'indeed']);
  assert.ok(locationAccountSection(entries, report, { business: true }).items.every(([, metadata]) => metadata.configured === false));
});

test('unknown city and unavailable results keep a selectable empty category without invented popularity', () => {
  const report = normalizeAccountLocationReport({ platformIds: [], basis: 'local_relevance', locationContext: { available: false, city: null } });
  assert.equal(accountLocationCityLabel(report), 'Unavailable');
  assert.match(accountLocationBasisLabel(report), /City popularity data is not available/);
  assert.deepEqual(locationAccountSection([], report), { id: 'location', label: 'Location based', total: 0, showCount: true, items: [] });
  assert.equal(locationAccountSection([], null).showCount, false, 'Unloaded results do not present zero as a known source count');
  assert.equal(locationAccountSection([['github', { configured: true }]], null).total, 0);
});

test('malformed ranking metadata cannot add accounts, change capabilities or expose raw location fields', () => {
  for (const value of [null, {}, { platformIds: {}, basis: 'local_relevance' }, { platformIds: [], basis: 'invented_city_market_share' }]) assert.equal(normalizeAccountLocationReport(value), null);
  const result = normalizeAccountLocationReport({ platformIds: ['github', '../private', 'github', 12], basis: 'local_relevance', activityCounts: { github: -1 },
    windowDays: Infinity, locationContext: { city: '<Toronto>\n', token: 'private', countryName: 'Canada' } });
  assert.deepEqual(result.platformIds, ['github']);
  assert.deepEqual(result.activityCounts, {});
  assert.equal(result.windowDays, 7);
  assert.equal(accountLocationCityLabel(result), 'Toronto, Canada');
  assert.equal(result.locationContext.token, undefined);
});
