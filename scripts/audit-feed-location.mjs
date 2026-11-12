import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
import { savedFeedLocation, regionalFeedLocation, feedLocationKey } from '../web/src/utils/feedLocation.mjs';
import { parseVenueFeedSearch } from '../web/src/utils/venueFeedSearch.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.deepEqual(savedFeedLocation({ feedLocation: { country: 'Japan', city: 'Tokyo' }, feedLocations: { bars: {} } }, 'bars'), { country: '', city: '' });
assert.deepEqual(regionalFeedLocation({ feedRegionalLocation: { mode: 'off' } }), { mode: 'auto', country: '', city: '' });
assert.equal(feedLocationKey({ feedRegionalLocation: { mode: 'manual', country: 'CA' } }), feedLocationKey({ feedRegionalLocation: { mode: 'manual', country: 'FR' } }));
assert.deepEqual(parseVenueFeedSearch('pizza in Portland, OR, US', 'restaurants'), { query: 'pizza', area: { city: 'Portland, OR', country: 'US' } });
assert.deepEqual(parseVenueFeedSearch('bars and clubs near me', 'bars'), { query: '', useDevice: true });
assert.deepEqual(parseVenueFeedSearch('Steak in the City', 'restaurants'), { query: 'Steak in the City' });
assert.ok(parseVenueFeedSearch('in Portland,', 'restaurants').error);
assert.ok(parseVenueFeedSearch('in Los Angeles, CA', 'restaurants').error);
assert.deepEqual(parseVenueFeedSearch('in London, UK', 'bars'), { query: '', area: { city: 'London', country: 'GB' } });
const app = await createAppHarness();
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5272, strictPort: false, headers: { 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)' }, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
  for (const width of [1440, 390]) {
    const firstId = `area-a-${width}`, secondId = `area-b-${width}`;
    app.seedUser(member(firstId, { roleSettings: { feedRegionalLocation: { mode: 'off' }, feedLocation: { country: 'United Kingdom', city: 'London' }, feedLocations: { countries: { country: 'Japan', city: 'Tokyo' }, restaurants: { country: 'France', city: 'Paris' }, bars: { country: 'Germany', city: 'Berlin' } } } }));
    app.seedUser(member(secondId, { roleSettings: { feedRegionalLocation: { mode: 'manual', country: 'AU', city: 'Sydney' }, feedLocations: { countries: { country: 'Italy', city: 'Rome' } } } }));
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['geolocation'],
      geolocation: { latitude: 34.052235, longitude: -118.243683, accuracy: 15 } });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = [], writes = [], reads = [], leakChecks = [];
    let userId = firstId, holdToronto = false, guestRequests = 0;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), headers = request.headers();
      const endpoint = url.pathname.replace(/^\/api/, '');
      const device = headers['x-ufi-device-location'];
      if (!endpoint.startsWith('/office/feed') && endpoint !== '/feed/location') leakChecks.push({ endpoint, device });
      if (endpoint === '/profile' && request.method() === 'PATCH') { writes.push(request.postDataJSON()); return route.continue(); }
      if (endpoint === '/social/platforms') return route.fulfill({ json: { platforms: {}, connected: {} } });
      if (endpoint === '/profile/social') return route.fulfill({ json: { connected: {} } });
      if (endpoint === '/billing/status') return route.fulfill({ json: {} });
      if (endpoint === '/feed/guest') {
        guestRequests++;
        assert.equal(device, undefined); assert.equal(url.searchParams.has('country'), false); assert.equal(url.searchParams.has('city'), false);
        return route.fulfill({ json: { posts: [], hasMore: false, locationContext: { country: 'US', countryName: 'United States', city: 'San Francisco', source: 'network', mode: 'auto', available: true } } });
      }
      if (endpoint.startsWith('/office/feed')) {
        const requestUserId = JSON.parse(Buffer.from(headers.authorization.split(' ')[1].split('.')[1], 'base64url').toString()).id;
        const settings = app.users.find(user => user.id === requestUserId).roleSettings;
        const mode = url.searchParams.get('mode') || (endpoint.includes('music') ? 'music' : endpoint.includes('videos') ? 'videos' : 'feed');
        const query = url.searchParams.get('q');
        const venue = ['restaurants', 'bars'].includes(mode);
        const destination = ['countries', 'restaurants', 'bars'].includes(mode) ? savedFeedLocation(settings, mode) : null;
        const point = device ? JSON.parse(device) : null;
        const automaticCity = !point ? 'San Francisco' : point[0] > 45 ? 'Paris' : point[0] > 40 ? 'Toronto' : 'Los Angeles';
        const area = destination?.city ? destination : { country: automaticCity === 'Paris' ? 'FR' : automaticCity === 'Toronto' ? 'CA' : 'US', city: automaticCity };
        reads.push({ mode, city: area.city, query, userId: requestUserId, point, authorization: headers.authorization });
        if (holdToronto && area.city === 'Toronto') await new Promise(resolve => setTimeout(resolve, 700));
        assert.equal(url.searchParams.has('latitude'), false); assert.equal(url.searchParams.has('longitude'), false);
        const post = { id: venue ? 'osm:node:1234' : `${mode}-${area.city}`, title: query ? `${query} in ${area.city}` : `Area ${area.city}`,
          content: 'A post from this feed area.', source: venue ? mode : 'github', isExternal: true,
          sourceUrl: venue ? 'https://www.openstreetmap.org/node/1234' : `https://example.com/${area.city}`,
          createdAt: new Date().toISOString(), author: { name: 'Location fixture' } };
        return route.fulfill({ json: { posts: endpoint.includes('/videos') || endpoint.includes('/music') ? [] : [post],
          mode, nativeUficonnectIncluded: true, liveFeeds: [], travel: {}, cursor: `cursor-${area.city}`, hasMore: false, sourceErrors: {},
          locationContext: { country: area.country, city: area.city, source: destination?.city ? 'member' : point ? 'device' : 'network',
            radiusMiles: point ? 100 : null, available: true, mode: destination?.city ? 'manual' : 'auto', feedMode: mode } } }).catch(() => {});
      }
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, userId);
    await auditNavigate(page, origin + 'global?audit-public=1');
    await page.getByText('Explore the global feed', { exact: true }).waitFor();
    assert.ok(guestRequests > 0);
    await auditNavigate(page, origin + '?feed=feed&all=1');
    await page.getByText(/^Area Los Angeles/).waitFor();
    assert.equal(await page.locator('.feed-region-control').count(), 0);
    assert.equal(await page.getByRole('combobox', { name: 'Feed location preference' }).count(), 0);
    const point = reads.find(read => read.point)?.point;
    assert.deepEqual(point.slice(0, 3), [34.052, -118.244, 95]);
    assert.ok(reads.filter(read => read.point).every(read => read.authorization?.startsWith('Bearer ')));
    // A foreground refresh acquires the new point; the older held request must not replace it.
    holdToronto = true;
    await context.setGeolocation({ latitude: 43.6532, longitude: -79.3832, accuracy: 15 });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    for (let attempt = 0; attempt < 60 && !reads.some(read => read.city === 'Toronto'); attempt++) await page.waitForTimeout(50);
    assert.ok(reads.some(read => read.city === 'Toronto'));
    await context.setGeolocation({ latitude: 48.8566, longitude: 2.3522, accuracy: 15 });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByText(/^Area Paris/).waitFor();
    await page.waitForTimeout(800);
    assert.equal(await page.getByText(/^Area Toronto/).count(), 0);
    assert.equal(writes.length, 0, 'automatic device location never saves profile settings');
    await auditNavigate(page, origin + '?feed=countries');
    await page.locator('[data-destination-id="JP:Tokyo"][aria-pressed="true"]').waitFor();
    await page.locator('[data-destination-id="JP:Osaka"]').click();
    await page.getByText(/^Area Osaka/).waitFor();
    await auditNavigate(page, origin + '?feed=restaurants');
    const topSearch = page.getByRole('search', { name: 'Search UFIconnect', exact: true });
    const input = topSearch.getByRole('searchbox');
    const areaHeading = page.locator('.feed-location-heading');
    async function searchVenue(value) {
      await input.fill(value);
      await input.press('Enter');
    }
    await areaHeading.getByText('Paris, France', { exact: true }).waitFor();
    assert.equal(await page.getByRole('searchbox').count(), 1, 'The header is the only visible search field');
    assert.equal(await input.getAttribute('placeholder'), 'Search restaurants');
    await searchVenue('pizza in Lyon, France');
    await page.getByText(/^pizza in Lyon/).waitFor();
    assert.ok(reads.some(read => read.mode === 'restaurants' && read.query === 'pizza' && read.city === 'Lyon'));
    await areaHeading.getByText('Lyon, FR', { exact: true }).waitFor();
    const priorWrites = writes.length;
    await searchVenue('in Lyon,');
    await page.getByText('Enter a location as “in City, Country”.', { exact: true }).waitFor();
    assert.equal(writes.length, priorWrites, 'Incomplete location input does not replace the saved city');
    await auditNavigate(page, origin + '?feed=bars');
    await areaHeading.getByText('Berlin, Germany', { exact: true }).waitFor();
    assert.equal(await page.getByRole('searchbox').count(), 1);
    assert.equal(await input.getAttribute('placeholder'), 'Search bars and clubs');
    await searchVenue('jazz');
    await page.getByText(/^jazz in Berlin/).waitFor();
    await context.setGeolocation({ latitude: 48.8566, longitude: 2.3522, accuracy: 5000 });
    await searchVenue('jazz near me');
    await page.getByText(/Could not get an accurate device location/).waitFor();
    await areaHeading.getByText('Berlin, Germany', { exact: true }).waitFor();
    await context.setGeolocation({ latitude: 48.8566, longitude: 2.3522, accuracy: 15 });
    await searchVenue('jazz near me');
    await page.getByText(/^jazz in Paris/).waitFor();
    await areaHeading.getByText('Near Paris, FR', { exact: true }).waitFor();
    assert.ok(reads.some(read => read.mode === 'bars' && read.query === 'jazz' && read.city === 'Paris' && read.point));
    const saved = app.users.find(user => user.id === userId).roleSettings;
    assert.equal(saved.feedLocations.countries.city, 'Osaka'); assert.equal(saved.feedLocations.restaurants.city, 'Lyon');
    assert.equal(saved.feedLocations.bars.city, '');
    assert.equal(saved.feedLocation.city, 'London');
    assert.deepEqual(Object.keys(writes[0].roleSettings.feedLocations), ['countries']);
    for (const mode of ['videos', 'music']) {
      await auditNavigate(page, origin + mode);
      await page.getByRole('button', { name: 'Filter videos', exact: true }).click();
      assert.equal(await page.locator('.feed-region-control').count(), 0);
      assert.ok(reads.some(read => read.mode === mode && read.city === 'Paris' && read.point));
    }
    await auditNavigate(page, origin + 'maps');
    await page.getByRole('heading', { name: 'Map', exact: true }).waitFor();
    assert.equal(await page.locator('.feed-region-control').count(), 0);
    const guestsBefore = guestRequests;
    await auditNavigate(page, origin + 'global');
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('feed') === 'feed');
    await page.getByText(/^Area Paris/).waitFor(); assert.equal(guestRequests, guestsBefore);
    // Deny browser geolocation, switch members, and verify city-level IP fallback.
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin: new URL(origin).origin, browserContextId: targetInfo.browserContextId });
    userId = secondId; await installAuditMember(page, app, userId);
    await auditNavigate(page, origin + '?feed=feed&all=1');
    await page.getByText(/^Area San Francisco/).waitFor();
    assert.equal(await page.getByText(/^Area Paris/).count(), 0);
    assert.ok(reads.filter(read => read.userId === secondId).every(read => !read.point), 'new member cannot inherit a previous device point');
    await auditNavigate(page, origin + '?feed=restaurants');
    await areaHeading.getByText('Network location is approximate', { exact: true }).waitFor();
    assert.equal(await page.getByText(/^Area San Francisco/).count(), 0, 'Network-only guesses do not show local venue cards');
    await searchVenue('near me');
    await page.getByText(/Could not get an accurate device location/).waitFor();
    await searchVenue('tacos in Toronto, Canada');
    await page.getByText(/^tacos in Toronto/).waitFor();
    await auditNavigate(page, origin + '?feed=countries');
    await page.locator('[data-destination-id="IT:Rome"][aria-pressed="true"]').waitFor();
    assert.ok(leakChecks.every(read => !read.device), 'profile, billing, auth, public and social endpoints never receive coordinates');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: venue search, confirmed areas, rounded GPS, movement, stale-response safety, saved destinations and member isolation`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
