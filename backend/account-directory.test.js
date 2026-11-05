'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const directory = require('./account-directory.json');
const { createAppHarness, member } = require('./test-support/app-harness');

const additions = {
  video: ['kick', 'dailymotion', 'netflix', 'disneyplus', 'primevideo', 'crunchyroll'],
  social: ['whatsapp', 'snapchat', 'nextdoor', 'quora', 'signal'],
  design: ['canva', 'adobeexpress', 'artstation', 'deviantart', 'sketch', 'webflow'],
  audio: ['applemusic', 'amazonmusic', 'youtubemusic', 'tidal', 'deezer', 'bandcamp'],
};
const addedKeys = Object.values(additions).flat();

test('expanded account destinations have distinct providers and safe public URLs', () => {
  const sites = new Set();
  for (const [category, keys] of Object.entries(additions)) {
    for (const key of keys) {
      const entry = directory[key];
      assert.equal(entry.category, category, key);
      assert.ok(entry.name && entry.description && entry.icon, key);
      assert.match(entry.color, /^#[\da-f]{6}$/i);
      assert.equal(entry.feedSupported, undefined, `${key} must not claim a feed adapter`);
      assert.ok(!sites.has(entry.siteUrl), `${key} duplicates a destination`);
      sites.add(entry.siteUrl);
      for (const target of [entry.siteUrl, entry.loginUrl].filter(Boolean)) {
        const url = new URL(target);
        assert.equal(url.protocol, 'https:');
        assert.equal(url.username + url.password + url.search + url.hash, '', `${key} must not store credentials, OAuth state, or tracking parameters`);
      }
    }
  }
  assert.equal(directory.signal.loginUrl, null, 'Signal has no browser account login');
  assert.match(directory.signal.description, /Download the Signal app/);
  assert.equal(directory.whatsapp.loginUrl, 'https://web.whatsapp.com/');
  assert.equal(directory.snapchat.loginUrl, 'https://www.snapchat.com/web/');
  assert.equal(directory.tidal.loginUrl, 'https://account.tidal.com/');
});

test('popular discovery ordering preserves categories, future providers, and input order', async () => {
  const { accountSections, accountCategory } = await import('../shared/accountCategories.js');
  const entries = Object.entries(directory).concat([
    ['youtube', { name: 'YouTube' }], ['facebook', { name: 'Facebook' }], ['figma', { name: 'Figma' }],
    ['newdesignz', { name: 'Z Design', category: 'design' }], ['newdesigna', { name: 'A Design', category: 'design' }],
  ]);
  const before = JSON.stringify(entries);
  const sections = accountSections(entries);
  for (const [category, first] of [['social', 'facebook'], ['video', 'youtube'], ['design', 'canva'], ['audio', 'spotify']]) {
    const section = sections.find(item => item.id === category);
    assert.equal(section.items[0][0], first);
    for (const key of additions[category]) assert.equal(section.items.filter(([id]) => id === key).length, 1);
  }
  const design = sections.find(item => item.id === 'design').items.map(([key]) => key);
  assert.deepEqual(design.slice(-2), ['newdesigna', 'newdesignz'], 'Future providers remain visible after curated entries');
  for (const category of ['work', 'publishing', 'career', 'travel']) {
    const section = sections.find(item => item.id === category);
    if (!section) continue;
    const names = section.items.map(([key, entry]) => String(entry.name || key));
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), `${category} keeps the established alphabetical order`);
  }
  assert.equal(JSON.stringify(entries), before, 'Sorting cannot mutate caller-owned entries');
  assert.equal(accountCategory('linkedin', {}, { business: true }), 'career');
  assert.equal(accountCategory('dribbble'), 'design');
});

test('invalid and legacy All selection opens one available category, including Business and empty catalogs', async () => {
  const { accountSections, selectedAccountSections } = await import('../shared/accountCategories.js');
  const sections = accountSections(Object.entries(directory));
  for (const selection of ['all', 'old-category', '', undefined]) {
    assert.deepEqual(selectedAccountSections(sections, selection), [sections[0]]);
  }
  assert.deepEqual(selectedAccountSections(sections, 'audio'), [sections.find(section => section.id === 'audio')]);
  const business = accountSections([['linkedin', { name: 'LinkedIn' }], ['indeed', directory.indeed]], { business: true });
  assert.deepEqual(selectedAccountSections(business, 'social').map(section => section.id), ['career']);
  assert.deepEqual(selectedAccountSections([], 'all'), []);
});

test('external account additions cannot become OAuth connections or feed and publishing capabilities', async t => {
  const app = await createAppHarness({ env: { GITHUB_CLIENT_ID: 'fixture-client', GITHUB_CLIENT_SECRET: 'fixture-secret',
    WORDPRESS_CLIENT_ID: 'fixture-wordpress', WORDPRESS_CLIENT_SECRET: 'fixture-wordpress-secret', OFFICE_TOKEN: 'fixture-office' } });
  t.after(() => app.close());
  const legacyTokens = Object.fromEntries(addedKeys.map(key => [key, 'untrusted-legacy-token']));
  app.seedUser(member('directory-expansion', { socialTokens: legacyTokens }));
  app.seedUser(member('directory-business', { plan: 'business' }));
  const { sourceAuthorizationState } = await import('../web/src/components/sourceAuthorization.mjs');
  const catalog = await app.request('/social/platforms', { userId: 'directory-expansion' });
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.platforms.github.configured, true, 'Existing implemented OAuth readiness remains credential-driven');
  for (const key of ['github', 'wordpress', 'mastodon', 'devto', 'hashnode_blog']) {
    assert.equal(catalog.data.platforms[key].canStartAuthorization, true, `${key} has a working configured account connection`);
    assert.equal(catalog.data.platforms[key].locked, false, `${key} does not require a paid membership to connect`);
  }
  for (const key of ['twitter', 'pinterest']) assert.equal(catalog.data.platforms[key].canStartAuthorization, false, `${key} still needs its credentials`);
  const office = await app.request('/office/oauth-status', { headers: { 'x-office-token': 'fixture-office' } });
  assert.equal(office.status, 200);
  for (const key of ['github', 'wordpress', 'mastodon', 'devto', 'hashnode_blog', 'twitter', 'pinterest']) {
    assert.equal(office.data.platforms[key].canStartAuthorization, catalog.data.platforms[key].canStartAuthorization, `${key} readiness agrees across catalogs`);
  }
  assert.equal(sourceAuthorizationState(catalog.data.platforms.github).ready, true);
  for (const key of addedKeys) {
    const platform = catalog.data.platforms[key];
    assert.equal(platform.connectionMode, 'external', key);
    assert.equal(platform.configured, false, key);
    assert.equal(platform.canStartAuthorization, false, `${key} has no account connection adapter`);
    assert.equal(catalog.data.connected[key], false, `${key} legacy values are not authorization`);
    assert.equal(platform.crossPost.supported, false, key);
    assert.equal(platform.ownContent.supported, false, key);
    assert.deepEqual(platform.feed, { home: false, following: null }, key);
    assert.equal(sourceAuthorizationState(platform).ready, false, key);
    assert.equal(sourceAuthorizationState({ ...platform, configured: true }).ready, false, `${key} stays unsupported even if readiness metadata is mistaken`);
    const start = await app.request(`/auth/social/${key}/start`, { userId: 'directory-expansion' });
    assert.equal(start.status, 404, `${key} has no installed authorization adapter`);
    assert.equal(start.headers.location, undefined, `${key} cannot redirect to a fabricated OAuth provider`);
  }
  const fakeConnect = await app.request('/social/connect', { userId: 'directory-expansion', method: 'POST', body: { platform: 'canva', accessToken: 'untrusted' } });
  assert.equal(fakeConnect.status, 410, 'Website visits cannot create synthetic connections');
  const business = await app.request('/social/platforms', { userId: 'directory-business' });
  assert.equal(business.status, 200);
  assert.ok(addedKeys.every(key => !Object.hasOwn(business.data.platforms, key)), 'Business keeps its career-only account directory');
});
