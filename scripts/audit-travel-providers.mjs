// Exercises the built Travel UI with synthetic status responses. No live account or provider writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web/dist');
const output = path.resolve(process.env.TRAVEL_PROVIDER_QA_OUTPUT || path.join(root, '.cache/travel-provider-qa'));
await fs.mkdir(output, { recursive: true });
const origin = new URL(process.env.TRAVEL_PROVIDER_QA_ORIGIN || 'https://uficonnect.org').origin;
const liveAssets = process.env.TRAVEL_PROVIDER_QA_LIVE === '1';
const destinations = [
  { id: 'IT:Naples', city: 'Naples', country: 'Italy', countryCode: 'IT' },
  { id: 'KE:Nairobi', city: 'Nairobi', country: 'Kenya', countryCode: 'KE' },
  { id: 'NZ:Queenstown', city: 'Queenstown', country: 'New Zealand', countryCode: 'NZ' },
  { id: 'PE:Cusco', city: 'Cusco', country: 'Peru', countryCode: 'PE' },
];
const providers = destinations.map((city, i) => ({ ...city, destinationId: city.id, id: `camera_provider_audit_${i}`, source: 'livecamera', title: `${city.city} public camera`,
  operator: `${city.city} Tourism`, sourceUrl: `https://camera.example.com/${city.city.toLowerCase()}`, liveVerified: i < 2,
  providerStatus: ['live', 'live', 'unverified', 'offline'][i], liveCheckedAt: new Date().toISOString(), isLiveCamera: true,
  liveMediaKind: i === 1 ? 'image' : 'video', liveImageUpdatedAt: i === 1 ? new Date(Date.now() - 60000).toISOString() : null,
  liveUpdateIntervalSeconds: i === 1 ? 60 : null,
  livePlayback: { kind: 'provider', url: `https://camera.example.com/${city.city.toLowerCase()}`, providerName: `${city.city} Tourism` },
}));
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const results = []; const errors = []; let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  for (const width of [1440, 390]) {
    const profile = { id: `travel-provider-${width}`, name: 'Travel audit', email: 'travel@example.invalid', onboardingComplete: true,
      preferences: { role: '', goals: [], interests: [], experience: '' }, roleSettings: { feedLocations: { countries: { country: 'IT', city: 'Naples' } } },
      socialAccounts: {}, links: {}, plan: 'free', joinedGroups: [] };
    const app = { request: async () => ({ data: profile, status: 200 }), token: () => 'synthetic-travel-provider-session' };
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 600, isMobile: width < 600 });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'camera.example.com') return route.fulfill({ contentType: 'text/html', body: '<title>Operator destination fixture</title>' });
      if (url.hostname === 'api.uficonnect.org' || /^\/(api|fallback)\//.test(url.pathname)) {
        const endpoint = url.pathname.replace(/^\/(api|fallback)/, ''); let json = {};
        if (endpoint === '/profile') {
          if (route.request().method() === 'PATCH') { const body = route.request().postDataJSON(); profile.roleSettings = { ...profile.roleSettings, ...body.roleSettings }; }
          json = profile;
        } else if (endpoint === '/travel/destinations') json = { destinations };
        else if (/feed\/location/.test(endpoint)) json = { automaticLocationAvailable: true, countryCode: 'IT', city: 'Naples' };
        else if (/office\/feed/.test(endpoint)) {
          const saved = profile.roleSettings.feedLocations.countries;
          json = { posts: [], hasMore: false, nativeUficonnectIncluded: true, location: { available: true, source: 'member', city: saved.city, country: saved.country, countryCode: saved.country },
            liveFeeds: providers.filter(row => row.liveVerified), travel: { cameraStatus: 'ready', camerasChecking: false, cameraProviders: providers, destinationCount: 4 }, fetchedAt: new Date().toISOString() };
        } else if (/notifications/.test(endpoint)) json = { notifications: [], unreadCount: 0 };
        else if (/messages/.test(endpoint)) json = { conversations: [], messages: [], unreadCount: 0 };
        else if (/groups/.test(endpoint)) json = { groups: [] };
        else if (/accounts/.test(endpoint)) json = { accounts: [], platforms: [] };
        return route.fulfill({ status: 200, json });
      }
      if (url.origin !== origin) return route.abort();
      if (liveAssets) return ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort();
      let file = path.resolve(dist, '.' + decodeURIComponent(url.pathname)); check(file === dist || file.startsWith(dist + path.sep), 'asset stays inside dist');
      if (!path.extname(file) || url.pathname.endsWith('/')) file = path.join(dist, 'index.html');
      try { return route.fulfill({ body: await fs.readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push({ width, message: error.message }));
    await installAuditMember(page, app, profile.id);
    await auditNavigate(page, origin + '/?feed=countries');
    const rail = page.getByRole('region', { name: 'Live travel cameras' });
    const select = async city => {
      const choice = rail.locator(`[data-destination-id="${city.id}"]`);
      await choice.click();
      await page.waitForFunction(id => document.querySelector(`[data-destination-id="${id}"]`)?.getAttribute('aria-pressed') === 'true', city.id);
      await page.waitForFunction(id => !document.querySelector(`[data-destination-id="${id}"]`)?.disabled, city.id);
    };
    await rail.getByRole('link', { name: 'Watch live on Naples Tourism for Naples', exact: true }).waitFor();
    check(await rail.locator('iframe').count() === 0, 'provider camera is not falsely embedded');
    check(await rail.getByText('Live on provider', { exact: true }).count() >= 1, 'external liveness is attributed');
    const link = rail.getByRole('link', { name: 'Watch live on Naples Tourism for Naples', exact: true });
    check(await link.getAttribute('href') === providers[0].sourceUrl, 'operator destination is exact');
    check(await link.evaluate(el => el.getBoundingClientRect().height >= 44), 'provider target is touch sized');
    const popupPromise = context.waitForEvent('page'); await link.click(); const popup = await popupPromise;
    await popup.waitForURL(providers[0].sourceUrl); await popup.close();
    check(true, 'click opens the correct attributed provider in a new page');
    await page.screenshot({ path: path.join(output, `provider-live-${width}.png`) });
    await select(destinations[1]);
    await rail.getByText('Live camera image · updates every 1 minute', { exact: true }).waitFor();
    check(await rail.getByText('View live image', { exact: true }).count() === 1, 'snapshot uses image playback label');
    check(await rail.locator('time').count() === 1, 'snapshot displays actual update timestamp');
    check(await rail.locator('iframe').count() === 0, 'image feed does not pretend to be video');
    await page.screenshot({ path: path.join(output, `provider-image-${width}.png`) });
    for (const city of destinations.slice(2)) {
      await select(city);
      await rail.getByRole('link', { name: `Open camera page on ${city.city} Tourism for ${city.city}`, exact: true }).waitFor();
      check(await rail.locator('.travel-provider-camera-status').count() === 0, 'unverified/offline provider receives no live status');
      check(await rail.getByRole('link', { name: /^Watch live/ }).count() === 0, 'another city camera is never substituted');
      check(await rail.locator(`[data-destination-id="${city.id}"] .travel-city-live-badge`).count() === 0, 'unverified/offline city receives no live badge');
      check(await rail.locator('iframe').count() === 0, 'unverified page never becomes a player');
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Travel fits viewport without horizontal overflow');
    await page.screenshot({ path: path.join(output, `provider-offline-${width}.png`) });
    results.push({ width, passed: true }); await context.close();
  }
  assert.deepEqual(errors, []);
  const sourceHashes = {};
  for (const file of ['web/dist/index.html', 'web/src/pages/Feed.jsx', 'web/src/components/TravelProviderCamera.jsx', 'web/src/components/TravelProviderCamera.css', 'web/src/components/travelCameraPlayback.mjs']) sourceHashes[file] = crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
  const report = { checkedAt: new Date().toISOString(), checks, results, errors, liveAssets, origin, sourceHashes };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
