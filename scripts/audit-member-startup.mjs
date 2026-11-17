import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';

// Exercise the published HTML and real browser boot. Deliberately avoid the
// audit-session navigation helpers: signing in again would mask reload bugs.
const TOKEN = 'startup-audit-memory-only-bearer';
const profile = {
  id: 'startup-audit-member', name: 'Startup Audit', email: 'startup@example.invalid',
  onboardingComplete: true, joinedGroups: [], skills: [], interests: [], goals: [],
  preferences: { interests: [], goals: [] }, roleSettings: {}, connectedAccounts: {},
};
const post = {
  id: 'startup-audit-story', source: 'reddit', title: 'Startup audit community story',
  content: 'A synthetic community post for session restoration checks.',
  createdAt: new Date().toISOString(), sourceUrl: 'https://example.invalid/community',
  author: { id: 'startup-audit-author', name: 'Audit Author' },
};
const server = await startBuiltServer({ port: 0 });
let browser;
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
const sessionRequest = request => new URL(request.url()).pathname.endsWith('/auth/session');

try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    const requests = [];
    let sessionMode = 'member';
    let scriptGate = null;
    let sessionGate = null;
    let sessionResponseOverride = null;
    let homepageArtRequests = 0;
    let memberRoleSettings = {};
    let manualRefreshGate = null;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === server.origin && url.pathname.startsWith('/homepage-app-network-2026-10')) homepageArtRequests++;
      if (['script', 'stylesheet'].includes(request.resourceType()) && url.origin === server.origin && scriptGate) await scriptGate.promise;
      const endpoint = url.pathname.replace(/^\/(api|fallback)(?=\/)/, '');
      const isApi = /^\/(api|fallback)\//.test(url.pathname)
        || ['xhr', 'fetch', 'eventsource'].includes(request.resourceType()) && !url.pathname.startsWith('/assets/');
      if (!isApi) return url.origin === server.origin ? route.continue() : route.abort();
      const headers = {
        'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'content-type,authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      requests.push({ endpoint, url: url.href, method: request.method(), headers: await request.allHeaders() });
      const reply = (json, status = 200) => route.fulfill({ status, headers, json });
      if (endpoint === '/feed/refresh' && request.method() === 'POST') {
        if (manualRefreshGate) await manualRefreshGate.promise;
        return reply({ queued: true }, 202);
      }
      if (endpoint === '/auth/session') {
        const responseOverride = sessionResponseOverride;
        if (sessionGate) await sessionGate.promise;
        if (responseOverride) {
          try { return await reply(responseOverride.json, responseOverride.status); }
          finally { responseOverride.delivered.release(); }
        }
        if (sessionMode === 'offline') return route.abort('internetdisconnected');
        if (sessionMode === 'unavailable') return reply({ message: 'Synthetic temporary outage.' }, 503);
        if (sessionMode === 'guest') return reply({ message: 'Sign in required.' }, 401);
        return reply({ token: TOKEN, profile: { ...profile, roleSettings: memberRoleSettings } });
      }
      if (endpoint === '/auth/login') {
        sessionMode = 'member';
        return reply({ token: TOKEN, profile });
      }
      if (endpoint === '/profile' || endpoint === '/auth/me') return reply(endpoint === '/profile' ? profile : { profile });
      if (/events|stream/.test(endpoint)) return route.abort();
      if (/^\/office\/feed\/(videos|music)/.test(endpoint)) return reply({ posts: [], hasMore: false, waitingForNew: true });
      if (['/office/feed', '/feed', '/posts'].includes(endpoint)) return reply({ posts: [post], hasMore: false, sourceErrors: {}, nativeUficonnectIncluded: true });
      return reply({ ok: true, connected: {}, sources: [], users: [], groups: [], categories: [], jobs: [],
        posts: [], postIds: [], notifications: [], messages: [], comments: [], requests: [],
        hasMore: false, totalCount: 0, registeredCount: 0, unread: 0, total: 0 });
    });
    const currentPath = () => { const url = new URL(page.url()); return url.pathname + url.search + url.hash; };
    async function noMarketingOrLogin(label) {
      check(!await page.locator('.landing-hero-refined').isVisible(), `${width}px ${label}: marketing homepage is not displayed`);
      check(!await page.locator('#login-email').isVisible(), `${width}px ${label}: sign-in form is not displayed before session resolution`);
    }
    async function ready(pathname) {
      const selector = /^\/(videos|music)/.test(pathname) ? '.video-feed-view'
        : pathname.startsWith('/search') ? '.search-page-shell' : '.home-feed-layout';
      await page.locator(selector).waitFor({ state: 'visible' });
      await noMarketingOrLogin(`restored ${pathname}`);
    }
    async function checkStorage() {
      check(await page.evaluate(token => [localStorage, sessionStorage].every(storage =>
        Object.keys(storage).every(key => !key.includes(token) && !String(storage.getItem(key)).includes(token))), TOKEN),
      `${width}px: restored bearer never enters localStorage or sessionStorage`);
      check(await page.evaluate(async token => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) if ((await (await cache.match(request)).text()).includes(token)) return false;
        }
        return true;
      }, TOKEN), `${width}px: restored bearer never enters Cache Storage`);
    }
    async function checkPolicyLinks(container, label) {
      const policies = container.getByRole('navigation', { name: 'Policies and support', exact: true });
      await policies.waitFor({ state: 'visible' });
      for (const [name, href] of [['Privacy policy', '/privacy'], ['Terms of use', '/terms'], ['Contact support', 'mailto:support@uficonnect.org']]) {
        const link = policies.getByRole('link', { name, exact: true });
        check(await link.isVisible() && await link.getAttribute('href') === href, `${width}px ${label}: ${name} has its appropriate destination`);
      }
      const childSafety = policies.locator('a[href="/child-safety"]');
      check(!await childSafety.isVisible(), `${width}px ${label}: child safety is organized under Safety and help`);
      const toggle = policies.locator('summary');
      await toggle.click();
      check(await childSafety.isVisible(), `${width}px ${label}: expanded help makes child safety easy to find`);
      check(await policies.getByRole('link', { name: 'Report a safety concern', exact: true }).getAttribute('href') === 'mailto:support@uficonnect.org?subject=Safety%20concern', `${width}px ${label}: safety concerns have a support contact`);
      check(await policies.locator('a, summary').evaluateAll(elements => elements.every(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= -1 && bounds.right <= innerWidth + 1;
      })), `${width}px ${label}: expanded policies and help fit the viewport`);
      await toggle.click();
    }

    // Delay modules and stylesheets to check the initial HTML while assets are
    // still downloading. The inline startup style must prevent a public-page
    // flash before React or external CSS can load.
    for (const target of ['/', '/videos', '/messages/startup-audit-peer']) {
      scriptGate = gate();
      await page.goto(server.origin + target, { waitUntil: 'commit' });
      await page.locator('[data-session-shell]').waitFor({ state: 'attached' });
      await page.getByText('Opening UFIconnect…', { exact: true }).waitFor({ state: 'visible' });
      await noMarketingOrLogin(`before JavaScript at ${target}`);
      check(!await page.getByRole('link', { name: 'Sign in to search', exact: true }).isVisible(), `${width}px ${target}: generic search guide is hidden during boot`);
      check(currentPath() === target, `${width}px ${target}: static boot preserves the requested URL`);
      // Cancel this navigation before releasing its module requests. The next
      // test independently observes session restoration in a fresh document.
      const oldGate = scriptGate;
      scriptGate = null;
      const navigation = page.goto('about:blank');
      oldGate.release();
      await navigation;
    }

    for (const target of ['/', '/videos?source=reddit', '/music?genre=jazz', '/?feed=restaurants', '/search?tab=people&q=design']) {
      for (const reload of [false, true]) {
        const requestsBeforeRestore = requests.length;
        sessionGate = gate();
        const requested = page.waitForRequest(sessionRequest);
        if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
        else await page.goto(server.origin + target, { waitUntil: 'domcontentloaded' });
        await requested;
        await page.locator('.splash').getByText('Opening UFIconnect…', { exact: true }).waitFor();
        await noMarketingOrLogin(`${reload ? 'reload' : 'open'} pending ${target}`);
        check(currentPath() === target, `${width}px ${target}: delayed restoration retains path, query, and fragment`);
        sessionGate.release(); sessionGate = null;
        await ready(target);
        check(currentPath() === target, `${width}px ${target}: successful restoration retains the destination`);
        check(!requests.slice(requestsBeforeRestore).some(request => request.endpoint === '/profile' && request.method === 'GET'),
          `${width}px ${target}: uses the full profile from the cookie session response`);
        if (target.startsWith('/search')) {
          check(await page.getByRole('tab', { name: 'People', exact: true }).getAttribute('aria-selected') === 'true', `${width}px: refreshed search keeps its people tab`);
          const search = page.getByRole('search', { name: 'Search UFIconnect', exact: true });
          const input = search.getByRole('searchbox', { name: 'Search UFIconnect', exact: true });
          check(await input.getAttribute('placeholder') === 'Search people' && await input.inputValue() === 'design', `${width}px: refreshed people search keeps its query in the shared header`);
        }
        await checkStorage();
      }
    }
    check(homepageArtRequests === 0, `${width}px: member startup skips guest homepage artwork`);

    const deliveredProfileFallback = gate();
    sessionResponseOverride = { status: 200, json: { token: TOKEN }, delivered: deliveredProfileFallback };
    const profileRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/profile') && request.method() === 'GET');
    await page.goto(server.origin + '/', { waitUntil: 'domcontentloaded' });
    await deliveredProfileFallback.promise;
    sessionResponseOverride = null;
    check((await (await profileRequest).allHeaders()).authorization === `Bearer ${TOKEN}`,
      `${width}px: a cookie response without a profile makes an authenticated profile request`);
    await ready('/');

    for (const failure of ['unavailable', 'offline']) {
      sessionMode = failure;
      const target = failure === 'unavailable' ? '/videos?source=reddit#return-here' : '/music?genre=jazz';
      await page.goto(server.origin + target, { waitUntil: 'domcontentloaded' });
      await page.getByText('We couldn’t restore your session', { exact: true }).waitFor();
      await noMarketingOrLogin(`${failure} restoration`);
      check(currentPath() === target, `${width}px ${failure}: temporary failure does not redirect away`);
      sessionMode = 'member';
      const retryRequest = page.waitForRequest(sessionRequest);
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await retryRequest;
      await ready(target);
      check(currentPath() === target, `${width}px ${failure}: explicit retry opens the original destination`);
    }

    sessionMode = 'guest';
    const protectedTarget = '/videos?source=reddit#after-sign-in';
    await page.goto(server.origin + protectedTarget, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.pathname === '/login');
    await page.locator('#login-email:not(:disabled)').fill('startup@example.invalid');
    await page.locator('#login-password:not(:disabled)').fill('A synthetic audit passphrase only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await ready(protectedTarget);
    check(currentPath() === protectedTarget, `${width}px: sign-in after 401 returns to the protected URL, including query and fragment`);
    await checkStorage();

    // A direct sign-in can finish before the page's initial cookie lookup.
    // Neither an older account nor a stale 401 may replace that fresh session.
    for (const staleStatus of [200, 401]) {
      const staleToken = `startup-audit-stale-bearer-${staleStatus}`;
      const delivered = gate();
      sessionResponseOverride = { status: staleStatus, delivered, json: staleStatus === 200
        ? { token: staleToken, profile: { ...profile, id: 'stale-audit-member', name: 'Stale Audit Member' } }
        : { message: 'Synthetic old session expired.' } };
      sessionGate = gate();
      const oldLookup = page.waitForRequest(sessionRequest);
      await page.goto(server.origin + '/login', { waitUntil: 'domcontentloaded' });
      await oldLookup;
      await page.locator('#login-email:not(:disabled)').fill('startup@example.invalid');
      await page.locator('#login-password:not(:disabled)').fill('A synthetic audit passphrase only');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await ready('/');
      check(currentPath() === '/', `${width}px stale ${staleStatus}: successful sign-in opens the feed without waiting for the older lookup`);
      sessionGate.release(); sessionGate = null;
      // An implementation may cancel the obsolete request before the server
      // answers. Wait for our handler, rather than requiring an aborted
      // browser request to emit a response event.
      await delivered.promise;
      sessionResponseOverride = null;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const feedSearch = page.getByRole('search', { name: 'Search UFIconnect', exact: true });
      const query = `session guard ${staleStatus}`;
      const searchRequest = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname.endsWith('/office/feed') && url.searchParams.get('q') === query;
      });
      const input = feedSearch.getByRole('searchbox', { name: 'Search UFIconnect', exact: true });
      await input.fill(query);
      await input.press('Enter');
      check((await (await searchRequest).allHeaders()).authorization === `Bearer ${TOKEN}`, `${width}px stale ${staleStatus}: subsequent feed reads keep the freshly signed-in bearer`);
      check(!requests.some(request => request.headers.authorization === `Bearer ${staleToken}`), `${width}px stale ${staleStatus}: older restoration never authenticates an API request`);
      check(!await page.getByText('Stale Audit Member', { exact: true }).isVisible(), `${width}px stale ${staleStatus}: older member profile never replaces the current member`);
      await checkStorage();
    }

    await page.goto(server.origin + '/settings', { waitUntil: 'domcontentloaded' });
    const helpAndPolicies = page.getByRole('region', { name: 'Help and policies', exact: true });
    await helpAndPolicies.waitFor({ state: 'visible' });
    await checkPolicyLinks(helpAndPolicies, 'Settings');

    const layoutWidth = width < 600 ? 320 : 1920;
    await page.setViewportSize({ width: layoutWidth, height: 950 });
    memberRoleSettings = { homeFeedLastMode: 'following', homeFeedView_feed: { activeTabs: ['github'] } };
    await page.goto(server.origin + '/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('group', { name: 'Home sources', exact: true }).waitFor();
    const homeNav = page.locator(width < 600 ? '.bottom-nav' : '.global-primary-nav');
    const home = homeNav.getByRole('link', { name: 'Home', exact: true });
    check(currentPath() === '/' && await home.getAttribute('href') === '/' && await home.getAttribute('aria-current') === 'page',
      `${layoutWidth}px: bare Home shows the Home feed even after using Following`);

    const layout = await page.locator('.home-feed-content').evaluate(feed => {
      const rect = element => element.getBoundingClientRect();
      const header = document.querySelector('.global-app-header');
      return {
        overflows: document.documentElement.scrollWidth > innerWidth + 1,
        feedWidth: rect(feed).width,
        desktopHeaderOffset: Math.abs(rect(header).left - rect(feed).left),
        desktopHeaderWidthOffset: Math.abs(rect(header).width - rect(feed).width),
      };
    });
    check(!layout.overflows, `${layoutWidth}px: Home has no page-level horizontal overflow`);
    check(width < 600 ? layout.feedWidth >= layoutWidth - 32
      : layout.desktopHeaderOffset <= 1 && layout.desktopHeaderWidthOffset <= 1,
    `${layoutWidth}px: Home uses the available width and aligns with the desktop header`);

    await page.goto(server.origin + '/?feed=following', { waitUntil: 'domcontentloaded' });
    await page.getByRole('group', { name: 'Following sources', exact: true }).waitFor();
    check(await home.getAttribute('aria-current') !== 'page', `${layoutWidth}px: Following does not mark Home current`);
    await home.click();
    await page.getByRole('group', { name: 'Home sources', exact: true }).waitFor();
    check(currentPath() === '/', `${layoutWidth}px: Home navigation returns to the canonical URL`);

    await page.goto(server.origin + '/?feed=feed&source=reddit', { waitUntil: 'domcontentloaded' });
    const snaps = page.getByRole('region', { name: 'Snaps', exact: true });
    await snaps.waitFor();
    const refresh = page.getByRole('status', { name: /^(Pull to refresh|Release to refresh|Refreshing feed)$/ });
    check(!await refresh.isVisible() && !await page.getByRole('button', { name: 'Refresh feed', exact: true }).count(),
      `${layoutWidth}px: idle Home shows no refresh controls`);
    const pull = type => page.locator('.home-feed-content').evaluate((target, type) => {
      const touch = new Touch({ identifier: 1, target, clientX: 32, clientY: type === 'touchstart' ? 80 : 160 });
      target.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [touch], changedTouches: [touch] }));
    }, type);
    const refreshStart = requests.length;
    manualRefreshGate = gate();
    try {
      const refreshRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/feed/refresh'));
      const feedRead = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/office/feed') && url.searchParams.get('source') === 'reddit';
      });
      await pull('touchstart');
      await pull('touchmove');
      await page.getByRole('status', { name: 'Release to refresh', exact: true }).waitFor();
      const [indicatorBounds, snapBounds] = await Promise.all([refresh.boundingBox(), snaps.boundingBox()]);
      check(indicatorBounds.y + indicatorBounds.height <= snapBounds.y + 1, `${layoutWidth}px: pull indicator appears above Snaps`);
      await pull('touchend');
      const queued = await refreshRequest;
      await feedRead;
      await page.getByRole('status', { name: 'Refreshing feed', exact: true }).waitFor();
      await pull('touchstart');
      await pull('touchmove');
      await pull('touchend');
      check(queued.postDataJSON().sources.join(',') === 'reddit', `${layoutWidth}px: manual refresh keeps the chosen source`);
      check(requests.slice(refreshStart).filter(request => request.endpoint === '/feed/refresh').length === 1,
        `${layoutWidth}px: repeated pulls queue one refresh`);
      check(currentPath() === '/?feed=feed&source=reddit', `${layoutWidth}px: refresh keeps the current feed URL`);
    } finally {
      manualRefreshGate.release();
      manualRefreshGate = null;
    }
    await refresh.waitFor({ state: 'hidden' });
    const savedHomeRead = page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/office/feed') && url.searchParams.get('mode') === 'feed' && url.searchParams.get('source') === 'github';
    });
    await home.click();
    await savedHomeRead;
    check(currentPath() === '/', `${layoutWidth}px: Home restores its saved source after leaving a source link`);
    await page.setViewportSize({ width, height: 950 });

    sessionMode = 'guest';
    await page.goto(server.origin + '/', { waitUntil: 'domcontentloaded' });
    await page.locator('.landing-hero-refined').waitFor({ state: 'visible' });
    check(currentPath() === '/', `${width}px: confirmed guests still receive the public homepage`);
    const heroImage = page.locator('.landing-network-art img');
    await heroImage.evaluate(image => image.decode());
    check(await heroImage.evaluate(image => /\.webp$/.test(image.currentSrc)), `${width}px: guest Home loads responsive artwork`);
    await checkPolicyLinks(page, 'public footer');
    check(requests.some(request => request.endpoint === '/profile' && request.headers.authorization === `Bearer ${TOKEN}`), `${width}px: restored bearer is used in memory for authenticated API reads`);
    check(!requests.some(request => request.url.includes(TOKEN)), `${width}px: session credentials never enter request URLs`);
    assert.deepEqual(errors, [], `${width}px: startup scenarios have no JavaScript crashes`); checks++;
    await context.close();

    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 950 }, serviceWorkers: 'block' });
    const publicPage = await noJs.newPage();
    await noJs.route('**/*', route => new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort());
    await publicPage.goto(server.origin + '/', { waitUntil: 'load' });
    check(await publicPage.locator('.landing-hero-refined h1').isVisible(), `${width}px: homepage remains readable without JavaScript`);
    await noJs.close();
    console.log(`PASS: member startup, real reload, retry and sign-in return at ${width}px`);
  }
  console.log(`PASS: ${checks} built-browser member startup checks`);
} finally {
  await browser?.close();
  await server.close();
}
