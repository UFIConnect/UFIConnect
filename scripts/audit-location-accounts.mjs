// Built website with synthetic account/location APIs; no provider/OAuth calls.
// Optional hosted origin: UFI_ACCOUNT_LOCATION_AUDIT_ORIGIN=https://uficonnect.org
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const directory = require('../backend/account-directory.json');
const app = await createAppHarness();
const server = process.env.UFI_ACCOUNT_LOCATION_AUDIT_ORIGIN
  ? { origin: new URL(process.env.UFI_ACCOUNT_LOCATION_AUDIT_ORIGIN).origin, close: async () => {} }
  : await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const output = '.cache/audit-ui/location-accounts';
const results = [];
const external = key => ({ ...directory[key], configured: false, authorizationSupported: false,
  authorizationAvailable: false, connectionMode: 'external', note: 'Automatic account synchronization is unavailable.' });
const platforms = {
  mastodon: { name: 'Mastodon', description: 'Synthetic supported source', configured: true,
    authorizationSupported: true, authorizationAvailable: true, needsServer: true, siteUrl: 'https://mastodon.social/' },
  github: { name: 'GitHub', description: 'Synthetic supported source', configured: true,
    authorizationSupported: true, authorizationAvailable: true, siteUrl: 'https://github.com/' },
  nextdoor: external('nextdoor'), indeed: external('indeed'), glassdoor: external('glassdoor'), tripadvisor: external('tripadvisor'),
};
const positions = { losAngeles: { latitude: 34.052235, longitude: -118.243683, accuracy: 15 },
  toronto: { latitude: 43.6532, longitude: -79.3832, accuracy: 15 } };
const palette = async locator => locator.evaluate(element => {
  const style = getComputedStyle(element);
  return [style.backgroundColor, style.color, style.borderColor, style.borderRadius];
});

try {
  await fs.mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    for (const surface of ['standalone', 'home', 'command', 'business']) {
      const userId = `location-accounts-${surface}-${width}`, business = surface === 'business';
      const user = member(userId, { plan: business ? 'business' : 'pro', organization: business ? 'Fixture Recruiting' : '' });
      app.seedUser(user);
      const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block', reducedMotion: 'reduce',
        permissions: ['geolocation'], geolocation: positions.losAngeles });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      const errors = [], forbidden = [], authorizations = [], locationReads = [], deviceLeaks = [];
      let unknown = false, empty = false;
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const api = /^(?:\/api\/|\/fallback\/)/.test(url.pathname)
          || ['fetch', 'xhr', 'eventsource'].includes(request.resourceType()) && !url.pathname.startsWith('/assets/');
        if (!api) {
          if (url.origin !== server.origin && request.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#315299"/></svg>' });
          return url.origin === server.origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort();
        }
        const endpoint = url.pathname.replace(/^\/(?:api|fallback)(?=\/)/, '');
        const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-UFI-Device-Location',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Cache-Control': 'private, no-store' };
        const send = (json, code = 200) => route.fulfill({ status: code, headers, json });
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (/events|stream/.test(endpoint)) return route.abort();
        const device = request.headers()['x-ufi-device-location'];
        if (device && endpoint !== '/social/platforms/location' && !/^\/(?:office\/)?feed(?:\/(?:location|music|videos(?:\/following)?))?$/.test(endpoint)) deviceLeaks.push(endpoint);
        if (endpoint === '/social/platforms/location') {
          assert.ok(request.headers().authorization?.startsWith('Bearer '), 'City context is requested by the authenticated member');
          assert.equal(url.searchParams.has('city'), false, 'The account ranking does not trust a caller-supplied city override');
          const point = device ? JSON.parse(device) : null;
          const toronto = point && point[0] > 40;
          const city = unknown ? null : toronto ? 'Toronto' : 'Los Angeles';
          const ids = empty ? ['not-in-current-catalog'] : business
            ? ['nextdoor', 'indeed', 'mastodon', 'glassdoor', 'not-in-current-catalog']
            : unknown ? ['nextdoor', 'indeed', 'tripadvisor', 'not-in-current-catalog']
              : toronto ? ['github', 'tripadvisor', 'glassdoor', 'not-in-current-catalog']
                : ['indeed', 'mastodon', 'nextdoor', 'not-in-current-catalog'];
          locationReads.push({ city, point, business, empty });
          return send({ locationContext: { country: toronto ? 'CA' : 'US', countryName: toronto ? 'Canada' : 'United States', city,
            available: true, source: unknown ? 'network' : point ? 'device' : 'network', mode: 'auto', radiusMiles: point ? 100 : null },
            platformIds: ids, basis: unknown ? 'local_relevance' : 'recent_local_activity', windowDays: 7,
            activityCounts: unknown ? {} : toronto ? { github: 7 } : { indeed: 12, mastodon: 4 }, careerOnly: business });
        }
        if (endpoint.startsWith('/auth/social/')) { authorizations.push(endpoint); return send({ message: 'Provider authorization disabled in this audit.' }, 409); }
        if (endpoint === '/social/platforms') return send({ platforms, connected: {}, careerOnly: business });
        if (endpoint === '/profile/social') return send({ connected: {} });
        if (endpoint === '/profile') return send(app.fullProfile(user));
        if (endpoint === '/billing/status') return send({ plan: user.plan, hasBillingAccount: true, subscriptions: [{ kind: 'plan', tier: user.plan, status: 'active' }] });
        if (endpoint === '/billing/config') return send({ paymentsReady: false, tiers: {}, pricing: {} });
        if (endpoint === '/business/team') return send({ role: business ? 'owner' : 'none', active: business, seats: business ? 1 : 0, members: [], invitations: [] });
        if (request.method() !== 'GET' && !/analytics|telemetry|metrics|engaged|engagement-signal/.test(endpoint)) {
          forbidden.push(endpoint); return send({ message: 'Writes disabled in synthetic audit.' }, 409);
        }
        return send({ auth0: { enabled: false }, sources: [], posts: [], groups: [], connected: {}, jobs: [], opportunities: [], users: [],
          items: [], methods: [], providers: {}, notifications: [], unreadCount: 0, messages: [], conversations: [], requests: [],
          attachments: [], snaps: [], postIds: [], nativeUficonnectIncluded: true, hasMore: false,
          locationContext: { country: 'US', countryName: 'United States', city: 'Los Angeles', available: true, source: 'network', mode: 'auto' } });
      });
      await installAuditMember(page, app, userId);
      await auditNavigate(page, server.origin + (surface === 'home' ? '/?feed=feed&all=1' : surface === 'command' ? '/command-center?tab=accounts' : '/connected-accounts'));
      let scope = page;
      let cards;
      if (surface === 'home') {
        if (width < 769) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        scope = page.locator(width < 769 ? '#mobile-feed-drawer .home-feed-side-tools' : '.home-feed-right-tabs .home-feed-side-tools');
        await scope.getByRole('button', { name: /Connected accounts/ }).click();
        await scope.getByRole('heading', { name: 'Social', exact: true }).waitFor();
        cards = scope.locator('.home-connected-account-row');
      } else if (surface === 'command') {
        scope = page.getByRole('tabpanel', { name: 'Connected Accounts', exact: true });
        await scope.getByRole('heading', { name: 'Social', exact: true }).waitFor();
        cards = scope.locator('.member-account-card');
      } else {
        await page.getByRole('heading', { name: business ? 'Career sites' : 'Social', exact: true }).waitFor();
        cards = page.locator('.account-platform-card');
      }
      const originalPalette = await palette(cards.first());
      const category = scope.getByRole('group', { name: 'Account categories', exact: true });
      assert.equal(locationReads.length, 0, 'City account recommendations are fetched only when their category is selected');
      if (surface === 'home') {
        assert.equal(await category.locator('option[value="all"]').count(), 0);
        await category.getByRole('combobox', { name: 'Account category', exact: true }).selectOption('location');
      } else {
        assert.equal(await category.getByRole('button', { name: /^All(?: |$)/ }).count(), 0);
        await category.getByRole('button', { name: /^Location based(?: \d+)?$/ }).click();
      }
      const notice = scope.getByRole('region', { name: 'Location based account ranking', exact: true });
      await scope.getByRole('heading', { name: 'Location based', exact: true }).waitFor();
      await notice.getByText(/Los Angeles/).waitFor();
      const names = () => cards.locator(surface === 'home' ? '.home-connected-account-name' : surface === 'command' ? ':scope > div strong' : '.account-platform-card-header > div:nth-child(2) > div:first-child > span').allTextContents();
      const checkRows = async expected => {
        await page.waitForFunction(({ selector, expected }) => {
          const elements = [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length);
          return elements.length === expected.length && elements.every((element, index) => element.textContent.trim() === expected[index]);
        }, { selector: surface === 'home' ? (width < 769 ? '#mobile-feed-drawer .home-connected-account-name' : '.home-feed-right-tabs .home-connected-account-name')
          : surface === 'command' ? '.member-account-card > div strong' : '.account-platform-card-header > div:nth-child(2) > div:first-child > span', expected });
        assert.deepEqual(await names(), expected, 'Location ranking keeps the API order after catalog/membership filtering');
        for (const name of expected) {
          const card = cards.filter({ has: page.getByText(name, { exact: true }) });
          assert.equal(await card.count(), 1);
          assert.deepEqual(await palette(card), originalPalette, 'Location entries retain the existing account theme');
          const key = Object.keys(platforms).find(key => platforms[key].name === name), platform = platforms[key];
          const website = card.getByRole('link', { name: `${platform.connectionMode === 'external' ? 'Visit' : 'Open'} ${name} website`, exact: true });
          assert.equal(await website.getAttribute('href'), platform.siteUrl);
          assert.equal(await website.getAttribute('target'), '_blank');
          assert.equal(await website.getAttribute('rel'), 'noopener noreferrer');
          assert.equal(await card.locator('.account-site-link').count(), 1);
          if (platform.connectionMode === 'external') {
            const connect = card.getByRole('button', { name: `Sign in and connect ${name}`, exact: true });
            assert.ok(await connect.isDisabled(), 'Location ranking cannot enable unsupported account authorization');
            await connect.evaluate(button => button.click());
          }
        }
      };
      await checkRows(business ? ['Indeed', 'Glassdoor'] : ['Indeed', 'Mastodon', 'Nextdoor']);
      assert.match(await notice.innerText(), /7|seven/i, 'Recent activity states its time window');
      assert.ok(locationReads.some(read => read.point && Math.abs(read.point[0] - 34.052) < 0.001), 'Location ranking uses the current device city context');
      const beforeChange = locationReads.length;
      await context.setGeolocation(positions.toronto);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await notice.getByText(/Toronto/).waitFor();
      assert.ok(locationReads.length > beforeChange && locationReads.some(read => read.city === 'Toronto' && read.point?.[0] > 40));
      await checkRows(business ? ['Indeed', 'Glassdoor'] : ['GitHub', 'Tripadvisor', 'Glassdoor']);
      assert.equal(await notice.getByText(/Los Angeles/).count(), 0, 'A city change clears the previous city label');
      await page.screenshot({ path: `${output}/${surface}-${width}-city.png`, fullPage: true });
      unknown = true;
      await Promise.all([
        page.waitForResponse(response => /\/social\/platforms\/location$/.test(new URL(response.url()).pathname)),
        page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))),
      ]);
      await checkRows(business ? ['Indeed', 'Glassdoor'] : ['Nextdoor', 'Indeed', 'Tripadvisor']);
      assert.equal(await notice.getByText(/Los Angeles|Toronto/).count(), 0, 'Unknown city does not retain a previous city claim');
      assert.match(await notice.innerText(), /relevance|unavailable|unknown|could not|cannot|not available/i, 'Unknown city uses an honest local relevance fallback');
      if (business) {
        assert.equal(await category.getByRole('button', { name: /^(?:Social|Video|Work|Design|News|Travel|Music)(?: |&)/ }).count(), 0, 'Business keeps Career sites and Location based categories');
        assert.equal(await scope.getByText('Nextdoor', { exact: true }).count(), 0);
        assert.equal(await scope.getByText('Mastodon', { exact: true }).count(), 0, 'The Business location category cannot expose social sources');
      }
      empty = true;
      await Promise.all([
        page.waitForResponse(response => /\/social\/platforms\/location$/.test(new URL(response.url()).pathname)),
        page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))),
      ]);
      await notice.getByText('No matching sources for this location.', { exact: true }).waitFor();
      assert.equal(await cards.count(), 0, 'Unknown catalog IDs do not produce unauthorized or stale source cards');
      assert.equal(await scope.getByRole('heading', { name: 'Location based', exact: true }).count(), 1, 'The empty location category remains available');
      if (surface === 'home') assert.equal(await category.getByRole('combobox', { name: 'Account category', exact: true }).inputValue(), 'location');
      else assert.equal(await category.getByRole('button', { name: 'Location based 0', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.deepEqual(authorizations, [], 'Category selection and locked source clicks never start OAuth');
      assert.deepEqual(forbidden, [], 'No account mutations or provider calls');
      assert.deepEqual(deviceLeaks, [], 'Device location remains on explicit authenticated location/feed routes');
      assert.deepEqual(errors, [], 'No browser exceptions');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await page.screenshot({ path: `${output}/${surface}-${width}-empty.png`, fullPage: true });
      results.push({ surface, width, cityChanges: ['Los Angeles', 'Toronto', null], locationReads: locationReads.length,
        sourceLocksPreserved: true, themePreserved: true, emptyCategoryPreserved: true, businessCareerOnly: business, providerCalls: 0 });
      await context.close();
      console.log(`PASS Location based accounts: ${surface} ${width}px`);
    }
  }
  await fs.writeFile(`${output}/summary.json`, JSON.stringify({ origin: server.origin, results }, null, 2) + '\n');
} finally { await browser.close(); await server.close(); await app.close(); }
