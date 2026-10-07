import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
import { savedFeedLocation, regionalFeedLocation, feedLocationKey } from '../web/src/utils/feedLocation.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.deepEqual(savedFeedLocation({ feedLocation: { country: 'Japan', city: 'Tokyo' }, feedLocations: { bars: {} } }, 'bars'), { country: '', city: '' });
assert.equal(savedFeedLocation({ feedLocation: { city: 'Tokyo' } }, 'restaurants').city, 'Tokyo');
assert.equal(regionalFeedLocation({ feedLocation: { city: 'Tokyo' } }).mode, 'auto');
assert.notEqual(feedLocationKey({ feedRegionalLocation: { mode: 'manual', country: 'CA' } }), feedLocationKey({ feedRegionalLocation: { mode: 'manual', country: 'FR' } }));
const app = await createAppHarness();
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5272, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge' });
  for (const width of [1440, 390]) {
    const firstId = `area-a-${width}`, secondId = `area-b-${width}`;
    app.seedUser(member(firstId, { roleSettings: { feedLocation: { country: 'United Kingdom', city: 'London' }, feedLocations: { countries: { country: 'Japan', city: 'Tokyo' }, restaurants: { country: 'France', city: 'Paris' }, bars: { country: 'Germany', city: 'Berlin' } } } }));
    app.seedUser(member(secondId, { roleSettings: { feedRegionalLocation: { mode: 'manual', country: 'AU', city: 'Sydney' }, feedLocations: { countries: { country: 'Italy', city: 'Rome' } } } }));
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [], writes = [], reads = [];
    let userId = firstId, holdToronto = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = url.pathname.replace(/^\/api/, '');
      if (endpoint === '/profile' && request.method() === 'PATCH') {
        writes.push(request.postDataJSON());
        return route.continue();
      }
      if (endpoint === '/social/platforms') return route.fulfill({ json: { platforms: {}, connected: {} } });
      if (endpoint === '/profile/social') return route.fulfill({ json: { connected: {} } });
      if (endpoint === '/billing/status') return route.fulfill({ json: {} });
      if (endpoint === '/feed/guest') {
        assert.equal(url.searchParams.has('country'), false, 'Guest feed does not send a saved member country');
        assert.equal(url.searchParams.has('city'), false, 'Guest feed does not send a saved member city');
        return route.fulfill({ json: { posts: [], hasMore: false, locationContext: { country: 'US', countryName: 'United States', city: 'New York', source: 'network', mode: 'auto', available: true } } });
      }
      if (endpoint.startsWith('/office/feed')) {
        const profile = app.users.find(user => user.id === userId);
        const settings = profile.roleSettings;
        const mode = url.searchParams.get('mode') || (endpoint.includes('music') ? 'music' : endpoint.includes('videos') ? 'videos' : 'feed');
        const regional = regionalFeedLocation(settings);
        const destination = ['countries', 'restaurants', 'bars'].includes(mode) ? savedFeedLocation(settings, mode) : null;
        const area = destination?.city ? destination : regional.mode === 'manual' ? regional : regional.mode === 'off' ? {} : { country: 'US', city: 'San Francisco' };
        const city = area.city || 'Global';
        reads.push({ mode, city, userId });
        if (holdToronto && city === 'Toronto') await new Promise(resolve => setTimeout(resolve, 1000));
        const data = { posts: endpoint.includes('/videos') || endpoint.includes('/music') ? [] : [{ id: `${mode}-${city}`, title: `Area ${city}`, content: 'A post from this feed area.', source: 'github', isExternal: true, sourceUrl: `https://example.com/${city}`, createdAt: new Date().toISOString(), author: { name: 'Location fixture' } }], mode, nativeUficonnectIncluded: true, liveFeeds: [], travel: {}, cursor: `cursor-${city}`, hasMore: false, sourceErrors: {}, locationContext: { country: area.country || '', countryName: area.country || '', city: area.city || '', source: destination?.city || regional.mode === 'manual' ? 'member' : regional.mode === 'off' ? 'none' : 'network', available: Boolean(area.country), mode: regional.mode, feedMode: mode } };
        return route.fulfill({ json: data }).catch(() => {});
      }
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, userId);
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed&all=1');
    try { await page.getByText(/^Area San Francisco/).waitFor(); }
    catch (error) { console.log({ reads, errors, body: (await page.locator('body').innerText()).slice(-5000) }); throw error; }
    const location = page.locator('.feed-region-control');
    await location.locator('summary').click();
    await location.getByRole('combobox', { name: 'Feed location preference' }).selectOption('manual');
    await location.getByRole('textbox', { name: 'Feed country', exact: true }).fill('Canada');
    await location.getByRole('textbox', { name: 'Feed city', exact: true }).fill('Toronto');
    holdToronto = true;
    await location.getByRole('button', { name: 'Save feed location', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.feed-region-control summary')?.textContent.includes('Toronto'));
    await location.getByRole('textbox', { name: 'Feed country', exact: true }).fill('France');
    await location.getByRole('textbox', { name: 'Feed city', exact: true }).fill('Paris');
    await location.getByRole('button', { name: 'Save feed location', exact: true }).click();
    await page.getByText(/^Area Paris/).waitFor();
    await page.waitForTimeout(1200);
    assert.equal(await page.getByText(/^Area Toronto/).count(), 0, 'Late regional response cannot replace newer feed');
    assert.deepEqual(Object.keys(writes[0].roleSettings), ['feedRegionalLocation'], 'Regional update contains no stale unrelated preferences');
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=countries');
    await page.locator('[data-destination-id="JP:Tokyo"][aria-pressed="true"]').waitFor();
    await page.locator('[data-destination-id="JP:Osaka"]').click();
    await page.getByText(/^Area Osaka/).waitFor();
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=restaurants');
    await page.getByRole('searchbox', { name: 'Restaurant city', exact: true }).waitFor();
    assert.equal(await page.getByRole('searchbox', { name: 'Restaurant city', exact: true }).inputValue(), 'Paris');
    await page.getByRole('searchbox', { name: 'Restaurant city', exact: true }).fill('Lyon');
    await page.locator('.feed-location-form').getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByText(/^Area Lyon/).waitFor();
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=bars');
    await page.getByRole('searchbox', { name: 'Bars and clubs city', exact: true }).waitFor();
    assert.equal(await page.getByRole('searchbox', { name: 'Bars and clubs city', exact: true }).inputValue(), 'Berlin');
    const saved = app.users.find(user => user.id === userId).roleSettings;
    assert.equal(saved.feedLocations.countries.city, 'Osaka');
    assert.equal(saved.feedLocations.restaurants.city, 'Lyon');
    assert.equal(saved.feedLocation.city, 'London', 'Scoped saves preserve the legacy fallback');
    assert.deepEqual(Object.keys(writes[2].roleSettings.feedLocations), ['countries']);
    for (const mode of ['videos', 'music']) {
      await auditNavigate(page, server.resolvedUrls.local[0] + mode);
      await page.getByRole('button', { name: 'Filter videos', exact: true }).click();
      await page.locator('.feed-region-control summary').click();
      assert.equal(await page.getByRole('textbox', { name: 'Feed city', exact: true }).inputValue(), 'Paris');
      assert.ok(reads.some(read => read.mode === mode && read.city === 'Paris'), `${mode} uses the member's regional setting`);
    }
    await page.getByRole('combobox', { name: 'Feed location preference' }).selectOption('off');
    await page.getByRole('button', { name: 'Save feed location', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.feed-region-control summary')?.textContent.includes('Global'));
    assert.equal(app.users.find(user => user.id === userId).roleSettings.feedRegionalLocation.mode, 'off');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'maps');
    await page.getByRole('heading', { name: 'Maps', exact: true }).waitFor();
    await page.locator('.feed-region-control summary').click();
    await page.getByRole('combobox', { name: 'Feed location preference' }).selectOption('manual');
    await page.getByRole('textbox', { name: 'Feed country', exact: true }).fill('US');
    await page.getByRole('textbox', { name: 'Feed city', exact: true }).fill('Austin');
    const mapsRefreshed = page.waitForResponse(async response => response.url().includes('/api/office/feed')
      && response.request().method() === 'GET' && (await response.json()).locationContext?.city === 'Austin');
    await page.getByRole('button', { name: 'Save feed location', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.feed-region-control summary')?.textContent.includes('Austin'));
    await mapsRefreshed;
    assert.ok(reads.some(read => read.city === 'Austin' && read.userId === firstId), 'Maps refreshes for changed regional preferences');
    userId = secondId;
    await installAuditMember(page, app, userId);
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed&all=1');
    await page.getByText(/^Area Sydney/).waitFor();
    assert.equal(await page.getByText(/^Area Paris/).count(), 0, 'Another member cannot inherit regional posts');
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=countries');
    await page.locator('[data-destination-id="IT:Rome"][aria-pressed="true"]').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Location controls fit the viewport');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'global?audit-public=1');
    await page.getByText('Approximate area: New York, United States. Public recommendations may use this area.', { exact: true }).waitFor();
    assert.equal(await page.locator('.feed-region-control').count(), 0, 'Guest page does not inherit member location controls');
    assert.deepEqual(errors, []);
    console.log(`PASS member location, independent destinations, latest-request safety, video/music controls, and account isolation at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
