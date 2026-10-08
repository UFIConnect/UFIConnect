import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountSections } from './accountCategories.js';
import { accountLocalSourceLabel, accountLocationBasisLabel, accountLocationCityLabel, locationAccountSection, normalizeAccountLocationReport } from './accountLocation.js';

const local = (overrides = {}) => ({ id: 'local_latimes', name: 'Los Angeles Times', siteUrl: 'https://www.latimes.com/',
  category: 'publication', localArea: { label: 'Los Angeles', scope: 'city' }, ...overrides });
const response = (overrides = {}) => ({ platformIds: [], localSources: [], basis: 'local_sources_and_platforms',
  locationContext: { available: true, city: 'Los Angeles', region: 'CA', countryName: 'United States' }, ...overrides });

test('local sources and popular platforms are distinct while base categories and provider capabilities stay authoritative', () => {
  const mastodon = { name: 'Mastodon', configured: true, siteUrl: 'https://mastodon.social/', color: '#123456' };
  const indeed = { name: 'Indeed', category: 'career', configured: false, connectionMode: 'external' };
  const entries = [['mastodon', mastodon], ['indeed', indeed]], base = accountSections(entries);
  const report = normalizeAccountLocationReport(response({ platformIds: ['indeed', 'unknown', 'mastodon', 'indeed'],
    localSources: [local(), local({ id: 'mastodon', name: 'Fake local Mastodon', siteUrl: 'https://bad.example/' })] }));
  const overlay = locationAccountSection(entries, report);
  assert.deepEqual(overlay.groups.map(group => [group.label, group.items.map(([id]) => id)]),
    [['Local sources', ['local_latimes']], ['Popular platforms', ['indeed', 'mastodon']]]);
  assert.equal(overlay.groups[1].items[0][1], indeed);
  assert.equal(overlay.groups[1].items[1][1], mastodon);
  assert.equal(overlay.total, 3);
  assert.deepEqual(accountSections(entries), base, 'The overlay does not recategorize providers');
  assert.equal(accountLocationCityLabel(report), 'Los Angeles, CA, United States');
  assert.match(accountLocationBasisLabel(report), /Local sources and well-known platforms/);
  assert.equal(accountLocalSourceLabel(overlay.groups[0].items[0][1]), 'Los Angeles · City source');
});

test('local website records cannot create account, feed or publishing capabilities even when the helper receives raw metadata', () => {
  const source = local({ configured: true, connected: true, authorizationAvailable: true, authorizationSupported: true,
    loginUrl: 'https://bad.example/auth', connectionMode: 'oauth', feed: { home: true, following: true },
    crossPost: { supported: true }, ownContent: { supported: true }, color: 'red' });
  const item = locationAccountSection([], response({ localSources: [source, source] })).items[0][1];
  assert.equal(item.siteUrl, 'https://www.latimes.com/');
  assert.equal(item.connectionMode, 'external');
  for (const key of ['configured', 'connected', 'authorizationAvailable', 'authorizationSupported']) assert.equal(item[key], false, key);
  assert.equal(item.loginUrl, null);
  assert.deepEqual(item.feed, { home: false, following: null });
  assert.deepEqual(item.crossPost, { supported: false });
  assert.deepEqual(item.ownContent, { supported: false });
  assert.equal(locationAccountSection([], response({ localSources: [source, source] })).total, 1);
});

test('unsafe, incomplete, non-local and colliding local records are omitted without hiding valid destinations', () => {
  const catalogLocal = { name: 'Catalog local record', category: 'publication', configured: true, siteUrl: 'https://catalog.example/' };
  const badUrls = ['javascript:alert(1)', 'http://plain.example/', 'https://name:private@bad.example/', '//bad.example/',
    'https://127.0.0.1/', 'https://localhost/', 'https://internal.local/', 'https://bad.example:8443/', 'https://bad.example/\\private'];
  const sources = badUrls.map((siteUrl, index) => local({ id: 'local_bad_' + index, siteUrl }));
  sources.push(local({ id: 'foreign', configured: true }), local({ id: 'local_empty', name: '' }),
    local({ id: 'local_scope', localArea: { label: 'Los Angeles', scope: 'country' } }),
    local({ id: 'local_catalog_collision', name: 'Forged' }), local());
  const section = locationAccountSection([['local_catalog_collision', catalogLocal]],
    response({ localSources: sources, platformIds: ['local_catalog_collision', 'local_catalog_collision'] }));
  assert.deepEqual(section.groups[0].items.map(([id]) => id), ['local_latimes']);
  assert.deepEqual(section.groups[1].items.map(([id]) => id), ['local_catalog_collision']);
  assert.equal(section.groups[1].items[0][1], catalogLocal);
});

test('Business keeps local employer careers and popular career platforms while rejecting personal sources and catalog collisions', () => {
  const entries = [['mastodon', { configured: true }], ['indeed', { category: 'career', configured: false }], ['linkedin', { configured: false }]];
  const job = local({ id: 'local_city_jobs', name: 'City careers', category: 'career', siteUrl: 'https://jobs.lacity.gov/' });
  const report = response({ platformIds: ['mastodon', 'linkedin', 'indeed'], localSources: [local(), job,
    local({ id: 'mastodon', category: 'career', configured: true })] });
  const section = locationAccountSection(entries, report, { business: true });
  assert.deepEqual(section.items.map(([id]) => id), ['local_city_jobs', 'linkedin', 'indeed']);
  assert.ok(section.items.every(([, metadata]) => metadata.configured === false));
});

test('unknown city keeps honest regional coverage or an empty local group, with source counts omitted until loaded', () => {
  const report = normalizeAccountLocationReport(response({ locationContext: { available: false, city: null, region: 'California' },
    localSources: [local({ id: 'local_calmatters', name: 'CalMatters', siteUrl: 'https://calmatters.org/',
      localArea: { label: 'California', scope: 'region' } })] }));
  assert.equal(accountLocationCityLabel(report), 'Unavailable');
  assert.match(accountLocationBasisLabel(report), /regional sources.*City-specific coverage is unavailable/);
  assert.equal(accountLocalSourceLabel(report.localSources[0]), 'California · Regional source');
  const empty = locationAccountSection([], normalizeAccountLocationReport(response({ localSources: [], locationContext: {} })));
  assert.equal(empty.total, 0);
  assert.equal(empty.showCount, true);
  assert.equal(empty.groups[0].items.length, 0);
  assert.match(empty.groups[0].emptyMessage, /No city or regional sources/);
  assert.equal(locationAccountSection([], null).showCount, false);
  assert.equal(locationAccountSection([], null).groups, null);
});

test('response normalization accepts only the source directory contract and coarse public context', () => {
  for (const value of [null, {}, { platformIds: {}, basis: 'local_sources_and_platforms' },
    { platformIds: [], basis: 'recent_local_activity' }, response({ localSources: {} })]) assert.equal(normalizeAccountLocationReport(value), null);
  const result = normalizeAccountLocationReport(response({ platformIds: ['github', '../private', 'github', 12],
    activityCounts: { github: 400 }, windowDays: 7, token: 'private', locationContext: {
      city: '<Toronto>\n', countryName: 'Canada', point: { latitude: 43, longitude: -79 }, token: 'private' } }));
  assert.deepEqual(result.platformIds, ['github']);
  assert.equal(accountLocationCityLabel(result), 'Toronto, Canada');
  assert.equal(result.activityCounts, undefined);
  assert.equal(result.windowDays, undefined);
  assert.equal(result.token, undefined);
  assert.equal(result.locationContext.point, undefined);
  assert.equal(result.locationContext.token, undefined);
});
