import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_CATEGORIES, accountCategory, accountSections, selectedAccountSections } from '../shared/accountCategories.js';
import { normalizeConnectedAccounts, nativeAccountReadiness, nativeAccountWebsite } from './connectedAccounts.js';

const require = createRequire(import.meta.url), root = path.dirname(fileURLToPath(import.meta.url));
const directory = require('../backend/account-directory.json');

test('the full public directory is categorized once, with distinct design, news, career, travel and audio groups', () => {
  const platforms = Object.fromEntries(Object.entries(directory).map(([id, value]) => [id, { ...value, configured: false }]));
  Object.assign(platforms, { dribbble: { name: 'Dribbble' }, github: { name: 'GitHub' }, youtube: { name: 'YouTube' }, mastodon: { name: 'Mastodon' } });
  const entries = normalizeConnectedAccounts({ platforms, connected: {} }, { directory });
  const sections = accountSections(entries);
  assert.deepEqual(sections.map(section => [section.id, section.label]), ACCOUNT_CATEGORIES);
  const ids = sections.flatMap(section => section.items.map(([id]) => id));
  assert.equal(new Set(ids).size, Object.keys(platforms).length);
  assert.equal(ids.length, Object.keys(platforms).length);
  assert.equal(accountCategory('dribbble', { category: 'work' }), 'design');
  assert.equal(accountCategory('figma', { category: 'work' }), 'design');
  assert.equal(accountCategory('medium', { category: 'publication' }), 'publishing');
  const design = selectedAccountSections(sections, 'design')[0];
  assert.equal(design.items[0][0], 'canva', 'The shared curated order is preserved on native');
  assert.ok(design.items.some(([id]) => id === 'dribbble'));
  assert.deepEqual(selectedAccountSections(sections, 'removed-category'), [sections[0]]);
  assert.deepEqual(selectedAccountSections(sections, 'all'), [sections[0]], 'Legacy All selections open a single category');
  assert.deepEqual(selectedAccountSections([], 'all'), []);
});

test('current object catalog and legacy arrays both keep every provider, without guessing connected state', () => {
  const platforms = Object.fromEntries(['mastodon', 'github', 'youtube', 'twitch', 'dribbble', 'medium', 'indeed', 'booking', 'spotify'].map(id => [id, { name: id, configured: true, connected: true }]));
  const object = normalizeConnectedAccounts({ platforms, connected: { github: true, youtube: 'true', twitch: false } });
  assert.equal(object.length, 9);
  assert.deepEqual(object.filter(([, item]) => item.connected).map(([id]) => id), ['github']);
  const legacy = normalizeConnectedAccounts({ platforms: Object.entries(platforms).map(([id, item]) => ({ ...item, id })) });
  assert.equal(legacy.length, 9);
  assert.ok(legacy.every(([, item]) => item.connected === true));
  assert.equal(normalizeConnectedAccounts({ platforms: { 'invalid/id': { configured: true }, empty: null } }).length, 0);
});

test('categories preserve authorization flags and never unlock unavailable or unentitled account connections', () => {
  const base = { configured: true };
  for (const platform of [ {}, { configured: 'true' }, { ...base, forceComingSoon: true }, { ...base, authorizationAvailable: false }, { ...base, authorizationSupported: false }, { ...base, connectionMode: 'external' }, { ...base, locked: true }, { ...base, locked: true, connected: 'true' } ]) {
    const sections = accountSections([['dribbble', platform]]);
    assert.equal(sections[0].items[0][1], platform);
    assert.equal(nativeAccountReadiness(sections[0].items[0][1]).ready, false);
  }
  assert.equal(nativeAccountReadiness(base).ready, true);
  assert.equal(nativeAccountReadiness({ ...base, locked: true, connected: true }).ready, true);
  assert.equal(nativeAccountReadiness({ ...base, configured: false, connected: true }).ready, false);
});

test('Business accounts include LinkedIn under Careers and exclude general social, media and travel accounts', () => {
  const platforms = { linkedin: { name: 'LinkedIn', configured: false, commandCenterOnly: true }, indeed: { name: 'Indeed', configured: false }, youtube: { name: 'YouTube', configured: true }, booking: { name: 'Booking.com', category: 'travel', configured: true } };
  const entries = normalizeConnectedAccounts({ platforms }, { business: true, directory });
  assert.deepEqual(entries.map(([id]) => id), ['linkedin', 'indeed']);
  assert.deepEqual(accountSections(entries, { business: true }).map(section => [section.id, section.total]), [['career', 2]]);
  assert.deepEqual(selectedAccountSections(accountSections(entries, { business: true }), 'social').map(section => section.id), ['career']);
  assert.equal(accountCategory('linkedin', {}, { business: false }), 'work');
  assert.equal(normalizeConnectedAccounts({ platforms }, { directory }).some(([id]) => id === 'linkedin'), false);
});

test('source website destinations remain distinct from authorization and reject unsafe URLs', () => {
  assert.equal(nativeAccountWebsite({ id: 'github', siteUrl: 'https://invalid.example/' }), 'https://github.com/');
  assert.equal(nativeAccountWebsite({ id: 'mastodon', siteUrl: 'https://fosstodon.org/@member?token=private' }), 'https://fosstodon.org/');
  assert.equal(nativeAccountWebsite({ id: 'mastodon', siteUrl: 'https://name:private@bad.example/' }), 'https://joinmastodon.org/servers');
  for (const siteUrl of ['javascript:alert(1)', 'http://plain.example/', 'https://name:private@bad.example/', '//bad.example/']) assert.equal(nativeAccountWebsite({ id: 'unknown', siteUrl }), null);
  for (const [id, metadata] of Object.entries(directory)) assert.ok(nativeAccountWebsite({ ...metadata, id })?.startsWith('https://'), `Official website available for ${id}`);
});

test('Metro watches shared taxonomy and metadata; its Babel pipeline accepts the actual maintained account modules', () => {
  const config = require('./metro.config.js');
  for (const relative of ['../shared/accountCategories.js', '../shared/accountWebsiteUrls.js', '../shared/accountLocation.js', '../backend/account-directory.json']) {
    const file = path.resolve(root, relative);
    assert.ok([config.projectRoot, ...config.watchFolders].some(folder => file.startsWith(folder + path.sep)), `Metro can see ${relative}`);
  }
  assert.ok(config.resolver.sourceExts.includes('json'));
  const babel = require('./node_modules/@babel/core');
  for (const relative of ['screens/ConnectedAccountsScreen.js', 'connectedAccounts.js', '../shared/accountCategories.js', '../shared/accountWebsiteUrls.js', '../shared/accountLocation.js']) {
    const filename = path.resolve(root, relative);
    const result = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, configFile: false, babelrc: false,
      plugins: [require.resolve('./node_modules/@babel/plugin-transform-modules-commonjs'), require.resolve('./node_modules/@babel/plugin-transform-react-jsx')] });
    assert.ok(result.code.length);
  }
});
