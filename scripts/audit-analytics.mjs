// Runs the production app and bridge with every Google request intercepted.
// A deterministic tag fixture checks our integration; the real SDK is probed
// separately without sending any events to the production Analytics property.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { browserSecurityPolicy, analyticsBridgeSecurityPolicy } from '../web/securityPolicy.mjs';
import { ANALYTICS_CONSENT_KEY, ANALYTICS_CLIENT_KEY } from '../web/src/analytics/googleAnalytics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web/dist');
const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
const bridge = await fs.readFile(path.join(root, 'backend/public/analytics-bridge.html'), 'utf8');
const origin = 'https://uficonnect.org';
const bridgeOrigin = 'https://api.uficonnect.org';
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };
const tagFixture = `
(() => {
  let clientId;
  let parentBlocked = false;
  try { void parent.document.documentElement; } catch { parentBlocked = true; }
  window.__fixtureIsolation = {parentBlocked,referrer:document.referrer,cookie:document.cookie};
  function command(args) {
    if (args[0] === 'config') clientId = args[2].client_id;
    if (args[0] === 'event' && args[1] === 'page_view' && !window['ga-disable-G-F68DRQ6CC5']) {
      const fields = args[2];
      const query = new URLSearchParams({tid:'G-F68DRQ6CC5',en:'page_view',cid:clientId,
        dl:fields.page_location,dt:fields.page_title,dr:fields.page_referrer});
      fetch('https://www.google-analytics.com/g/collect?' + query, {method:'POST',credentials:'omit',referrerPolicy:'no-referrer'}).catch(() => {});
    }
  }
  window.dataLayer.forEach(command);
  window.dataLayer.push = function(args) { command(args); return Array.prototype.push.call(this,args); };
})();`;

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const googleRequests = [];
    const pageViews = [];
    const seed = 'PRIVATE_SYNTHETIC_SENTINEL_71';
    await context.addCookies([{ name: 'google_fixture_cookie', value: seed, domain: '.googletagmanager.com', path: '/', secure: true, sameSite: 'None' }]);
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname.endsWith('googletagmanager.com') || url.hostname.endsWith('google-analytics.com')) {
        googleRequests.push({ url: url.href, headers: await request.allHeaders(), body: request.postData() });
        if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
          return route.fulfill({ contentType: 'text/javascript', body: tagFixture,
            headers: { 'Access-Control-Allow-Origin': '*' } });
        }
        if (url.pathname === '/g/collect') pageViews.push(Object.fromEntries(url.searchParams));
        return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      if (url.origin === bridgeOrigin && url.pathname === '/analytics-bridge.html') {
        return route.fulfill({ contentType: 'text/html', body: bridge, headers: {
          'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': analyticsBridgeSecurityPolicy(bridge) + "; frame-ancestors https://uficonnect.org",
        } });
      }
      if (url.pathname.endsWith('/auth/login')) return route.fulfill({ json: { token: 'synthetic-memory-token', profile: {
        id: 'synthetic-member', name: 'Synthetic member', email: 'fixture@example.invalid', onboardingComplete: true,
        role: 'member', interests: [], skills: [], roleSettings: {},
      } } });
      if (url.origin !== origin || url.pathname.startsWith('/api/')) {
        return route.fulfill({ status: 200, json: { items: [], posts: [], groups: [], messages: [], notifications: [], results: [],
          passwordChangeAvailable: true, passwordMinimumCharacters: 15, passwordMaximumUtf8Bytes: 72, sessionLifetimeSeconds: 2592000 } });
      }
      if (url.pathname.startsWith('/assets/')) {
        const file = path.resolve(dist, '.' + url.pathname);
        if (!file.startsWith(dist + path.sep)) return route.abort();
        return route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript' });
      }
      return route.fulfill({ contentType: 'text/html', body: html, headers: {
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': browserSecurityPolicy(html),
      } });
    });

    await page.goto(`${origin}/login?email=${seed}#${seed}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#login-password').fill(seed);
    await page.evaluate(secret => { document.title = secret; }, seed);
    check(googleRequests.length === 0, 'No Google requests before consent');
    check(await page.locator('iframe[title="Optional page analytics"]').count() === 0, 'No analytics frame before consent');
    const accept = page.getByRole('button', { name: 'Accept analytics', exact: true });
    const decline = page.getByRole('button', { name: 'Decline analytics', exact: true });
    check(await accept.isVisible() && await decline.isVisible(), 'Both consent choices are visible');
    const sizes = await Promise.all([accept, decline].map(button => button.boundingBox()));
    check(Math.abs(sizes[0].width - sizes[1].width) < 2 && sizes[0].height === sizes[1].height, 'Consent choices have equal visual prominence');
    const initialScroll = await page.evaluate(() => scrollY);
    await decline.click();
    check(Math.abs(await page.evaluate(() => scrollY) - initialScroll) < 2, 'Choosing consent does not move the page to the footer');
    check(googleRequests.length === 0, 'Decline makes no Google request');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#login-password').waitFor();
    // Privacy controls load in a separate lazy chunk from the login form.
    await page.waitForLoadState('networkidle');
    check(await page.evaluate(key => localStorage.getItem(key), ANALYTICS_CONSENT_KEY) === 'denied', 'Declined consent is persisted across reload');
    check(await page.locator('.analytics-privacy-panel').count() === 0, 'Remembered decline does not ask for consent again');
    check(await page.getByRole('button', { name: 'Analytics privacy', exact: true }).count() === 0, 'Pages no longer end with an analytics button');
    check(googleRequests.length === 0, 'Remembered decline prevents Google initialization');
    await openPreferences(page);
    await page.locator('#login-password').fill(seed);
    await page.evaluate(secret => { document.title = secret; }, seed);
    await page.getByRole('button', { name: 'Accept analytics', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('iframe[title="Optional page analytics"]'));
    await assertEventually(() => pageViews.length === 1);
    check(pageViews[0].dl === origin + '/login' && pageViews[0].dt === 'UFIconnect | Sign in', 'Consent sends the current canonical page exactly once');
    const frame = page.frames().find(frame => frame.url() === bridgeOrigin + '/analytics-bridge.html');
    const isolation = await frame.evaluate(() => ({ ...window.__fixtureIsolation, location: location.href, title: document.title }));
    check(isolation.parentBlocked && isolation.referrer === '', 'Browser blocks analytics access to the parent document and referrer');
    check(isolation.location === bridgeOrigin + '/analytics-bridge.html' && isolation.title === 'UFIconnect analytics', 'The analytics document has no private URL or title');
    check(await page.locator('iframe[title="Optional page analytics"]').getAttribute('sandbox') === 'allow-scripts allow-same-origin', 'Bridge sandbox permits only scripts and its separate origin');
    check(await page.evaluate(() => typeof window.gtag) === 'undefined', 'Google code never runs in the app document');
    const beforeUnsafeEmbeds = googleRequests.length;
    for (const suffix of ['?token=' + seed, '#' + seed]) {
      await page.evaluate(({ url }) => new Promise(resolve => {
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.sandbox = 'allow-scripts allow-same-origin';
        frame.referrerPolicy = 'no-referrer';
        frame.onload = () => {
          frame.contentWindow.postMessage({ type: 'ufi-analytics-page', version: 1, clientId: 'a'.repeat(32), category: 'login', visit: 1 }, new URL(url).origin);
          setTimeout(() => { frame.remove(); resolve(); }, 100);
        };
        frame.src = url;
        document.body.appendChild(frame);
      }), { url: bridgeOrigin + '/analytics-bridge.html' + suffix });
    }
    check(googleRequests.length === beforeUnsafeEmbeds, 'Bridge URLs with a query or fragment cannot initialize Google');

    await page.locator('input[name="email"]').fill('fixture@example.invalid');
    await page.locator('#login-password').fill('Synthetic audit passphrase');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/');
    await assertEventually(() => pageViews.at(-1)?.dl === origin + '/');
    if (width <= 768) await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
    await page.getByRole('link', { name: 'Analytics privacy', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/privacy' && url.hash === '#analytics');
    await page.waitForFunction(() => document.activeElement?.id === 'analytics-privacy-title');
    check(await page.getByRole('button', { name: 'Decline analytics', exact: true }).isVisible(), 'Account navigation opens preferences without reaching the feed footer');
    await page.keyboard.press('Escape');
    await page.locator('.analytics-privacy-panel').waitFor({ state: 'detached' });
    check(await page.getByRole('heading', { name: 'Privacy Policy', exact: false }).first().isVisible(), 'Closing linked preferences leaves the privacy policy in place');
    const routes = [
      ['/settings', '/settings'], ['/messages/' + seed, '/messages/conversation'],
      ['/groups/' + seed, '/groups/details'], ['/u/' + seed, '/u/member'],
      ['/p/' + seed, '/p/details'], ['/search?q=' + seed, '/search'], ['/privacy', '/privacy'],
      ['/reset-password?token=' + seed + '#' + seed, '/reset-password'], ['/settings', '/settings'],
    ];
    for (const [route, expectedPath] of routes) {
      const before = pageViews.length;
      await page.evaluate(value => { history.pushState({ key: crypto.randomUUID() }, '', value); dispatchEvent(new PopStateEvent('popstate')); }, route);
      await assertEventually(() => pageViews.length > before);
      check(pageViews.length === before + 1 && pageViews.at(-1).dl === origin + expectedPath, 'SPA navigation records one canonical view: ' + expectedPath);
    }
    // Login redirects existing members to their feed. End the member session
    // through the real control before checking guest login navigation.
    if (width <= 768) await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
    const beforeLogout = pageViews.length;
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await page.locator('#login-email').waitFor();
    await assertEventually(() => pageViews.at(-1)?.dl === origin + '/login');
    check(pageViews.length === beforeLogout + 1, 'Signing out records one canonical login view');
    const beforeFragment = pageViews.length;
    await page.evaluate(secret => { history.pushState({}, '', '/login?password=' + secret + '#' + secret); dispatchEvent(new PopStateEvent('popstate')); }, seed);
    await page.waitForTimeout(150);
    check(pageViews.length === beforeFragment, 'Query and fragment changes do not create extra pageviews');
    const beforeForge = pageViews.length;
    await page.evaluate(({ bridgeOrigin, seed }) => {
      const frame = document.querySelector('iframe[title="Optional page analytics"]');
      frame.contentWindow.postMessage({ type: 'ufi-analytics-page', version: 1, clientId: 'a'.repeat(32), category: 'login', visit: 999, password: seed }, bridgeOrigin);
    }, { bridgeOrigin, seed });
    await page.waitForTimeout(150);
    check(pageViews.length === beforeForge, 'Bridge rejects unapproved payload fields');
    check(googleRequests.every(request => !request.headers.referer), 'All Google requests omit HTTP referrers');
    check(googleRequests.every(request => !request.headers.cookie), 'The tag loader omits pre-existing Google credentials');
    check(!JSON.stringify(googleRequests).includes(seed), 'No private title, URL, fragment, message ID or password reaches Google');
    check(pageViews.every(view => view.dr === '' && view.tid === 'G-F68DRQ6CC5'), 'Every view uses the correct property and empty referrer');
    const oldClient = pageViews[0].cid;
    await openPreferences(page);
    await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
    await page.locator('iframe[title="Optional page analytics"]').waitFor({ state: 'detached' });
    check(await page.evaluate(key => localStorage.getItem(key), ANALYTICS_CLIENT_KEY) === null, 'Revocation deletes the local analytics identifier');
    const countAfterStop = googleRequests.length;
    await page.evaluate(() => { history.pushState({}, '', '/privacy'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForTimeout(150);
    check(googleRequests.length === countAfterStop, 'Revocation stops subsequent Google requests');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    check(await page.evaluate(key => localStorage.getItem(key), ANALYTICS_CONSENT_KEY) === 'denied', 'Revocation persists across reload');
    await openPreferences(page);
    await page.getByRole('button', { name: 'Accept analytics', exact: true }).click();
    await assertEventually(() => pageViews.at(-1)?.dl === origin + '/privacy' && pageViews.at(-1)?.cid !== oldClient);
    check(pageViews.at(-1).cid !== oldClient, 'New consent generates a new random identifier');
    await page.evaluate(() => { history.pushState({}, '', '/global'); dispatchEvent(new PopStateEvent('popstate')); });
    const guestPreferences = page.locator('.guest-header').getByRole('link', { name: 'Analytics privacy', exact: true });
    await guestPreferences.waitFor();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Guest analytics navigation fits the viewport');
    await guestPreferences.click();
    await page.waitForFunction(() => document.activeElement?.id === 'analytics-privacy-title');
    check(new URL(page.url()).hash === '#analytics', 'Guest infinite feeds have direct access to analytics preferences');
    const beforeCloseScroll = await page.evaluate(() => scrollY);
    await page.keyboard.press('Escape');
    await page.locator('.analytics-privacy-panel').waitFor({ state: 'detached' });
    check(Math.abs(await page.evaluate(() => scrollY) - beforeCloseScroll) < 2, 'Closing preferences preserves page position');
    check(await page.locator('.analytics-privacy').count() === 0, 'Closed preferences leave nothing at the bottom of the page');
    await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
    await openPreferences(page);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/analytics-preferences-${width}.png`) });
    await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
    await page.locator('iframe[title="Optional page analytics"]').waitFor({ state: 'detached' });
    const requestsBeforeFailedSave = googleRequests.length;
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('uficonnect.analytics.')) throw new DOMException('Storage blocked', 'QuotaExceededError');
        return originalSetItem.call(this, key, value);
      };
    });
    await openPreferences(page);
    await page.getByRole('button', { name: 'Accept analytics', exact: true }).click();
    check(await page.locator('.analytics-privacy-panel [role="status"]').filter({ hasText: 'could not save your choice' }).isVisible(), 'Failed consent saves display a warning even when consent stays denied');
    check(await page.getByRole('button', { name: 'Accept analytics', exact: true }).isVisible(), 'Failed choices keep preferences open for review');
    check(googleRequests.length === requestsBeforeFailedSave, 'A failed opt-in remains off without Google requests');
    console.log(`PASS: consent, SPA coverage, sensitive-data isolation and revocation at ${width}px`);
    await context.close();
  }
  console.log(`${checks} analytics browser checks passed; all Google requests were intercepted.`);
} finally { await browser.close(); }

// "Analytics privacy" links open preferences through #analytics; this opens them on the current page.
async function openPreferences(page) {
  await page.evaluate(() => {
    history.pushState({ key: crypto.randomUUID() }, '', `${location.pathname}${location.search}#analytics`);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.locator('.analytics-privacy-panel').waitFor();
}

async function assertEventually(condition) {
  for (let i = 0; i < 100; i += 1) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(condition(), 'Expected analytics event did not arrive');
}
