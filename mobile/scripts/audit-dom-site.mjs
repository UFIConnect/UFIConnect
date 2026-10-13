// Browser execution of the actual Expo DOM document with an in-memory native
// bridge fixture. This is not an installed-device test. No real accounts or API
// requests are used; every remote browser request is denied.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../../backend/test-support/app-harness');
const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportRoot = path.resolve(process.env.EXPO_EXPORT_DIR || path.join(mobile, '.cache/export-current-site-verified-20261011'));
const platform = process.env.DOM_AUDIT_PLATFORM || 'ios';
assert.ok(['ios', 'android'].includes(platform), 'Choose an iOS or Android DOM audit');
const output = path.resolve(process.env.CURRENT_SITE_DOM_AUDIT_DIR || path.join(mobile, '.cache/current-site-dom-qa-' + platform));
await fs.mkdir(output, { recursive: true });
const documentName = (await fs.readdir(path.join(exportRoot, 'www.bundle'))).find(name => name.endsWith('.html'));
assert.ok(documentName, 'Export contains the native DOM document');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(exportRoot, '.' + pathname);
    assert.ok(filename.startsWith(exportRoot + path.sep));
    let body;
    try { body = await fs.readFile(filename); }
    catch {
      // Expo's native embed step copies public into www.bundle. Its all-platform
      // export places public at the root, so serve the identical assets there.
      assert.ok(pathname.startsWith('/www.bundle/'));
      body = await fs.readFile(path.resolve(exportRoot, '.' + pathname.slice('/www.bundle'.length)));
    }
    if (path.extname(filename) === '.mp4' && request.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
      assert.ok(range, 'Valid media byte range');
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
      assert.ok(start <= end && end < body.length, 'Media range stays in the file');
      response.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
      response.end(body.subarray(start, end + 1)); return;
    }
    response.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const video = { id: 'native-dom-media-fixture', source: 'uficonnect', isExternal: false,
  author: { id: 'native-dom-fixture-author', name: 'Fixture member' }, title: 'Native media playback fixture',
  mediaType: 'video', directPlaybackAuthorized: true, videoDurationSeconds: 158,
  mediaUrl: origin + '/www.bundle/media/preparation/professional-introduction.mp4',
  thumbnailUrl: origin + '/www.bundle/media/preparation/professional-introduction.png',
  createdAt: new Date().toISOString(), likesCount: 0, commentsCount: 0 };
const app = await createAppHarness();
const userId = 'native-dom-fixture';
const profile = member(userId, { name: 'Alex Morgan', title: 'Product Designer', plan: 'pro', onboardingComplete: true });
app.seedUser(profile);
const report = { checkedAt: new Date().toISOString(), platform, kind: 'Expo DOM simulation in Edge; not an installed native build',
  realAccountActions: 0, remoteRequestsAllowed: 0, nativeActions: [], checks: [], screenshots: [] };
const check = (condition, message) => { assert.ok(condition, message); report.checks.push(message); };
const names = ['onApiRequest', 'onPersistSession', 'onProviderSignIn', 'onOpenExternal', 'onRequestLocation', 'onShareFile', 'onCopyText'];
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const signedIn of [false, true]) {
    let nativeHostSession = signedIn ? { token: 'synthetic-native-session', profile } : null;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    const errors = [], assetFailures = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.url().startsWith(origin) && !response.ok()) assetFailures.push(new URL(response.url()).pathname); });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.exposeFunction('__ufiFixtureNativeAction', async (actionId, args) => {
      assert.equal(args[0], 'fixture-capability-only', 'Each action includes its native capability');
      report.nativeActions.push({ action: actionId, ...(actionId === 'onApiRequest' ? { path: args[1].url, method: args[1].method } : {}) });
      if (actionId === 'onRequestLocation') return { timestamp: Date.now(), coords: { latitude: 37.77, longitude: -122.42, accuracy: 30 } };
      if (actionId === 'onPersistSession') { nativeHostSession = args[1] ? { token: args[1], profile } : null; return null; }
      if (actionId !== 'onApiRequest') throw new Error('This action is disabled in the fixture audit.');
      const request = args[1], url = new URL(request.url, 'https://api.uficonnect.org');
      if (url.pathname === '/auth/session') return nativeHostSession
        ? { status: 200, data: nativeHostSession, headers: {} }
        : { status: 401, data: { error: 'Not signed in' }, headers: {} };
      if (url.pathname === '/auth/providers') return { status: 200, data: { providers: { google: { enabled: true, configured: true }, apple: { enabled: true, configured: true }, phone: { enabled: true, configured: true } } } };
      if (url.pathname.startsWith('/analytics/') || url.pathname === '/errors/client') return { status: 200, data: { ok: true } };
      if (!['GET', 'HEAD'].includes(request.method || 'GET')) return { status: 409, data: { error: 'Member writes are disabled.' } };
      if (url.pathname === '/office/feed/videos') return { status: 200, data: { posts: [video], hasMore: false, waitingForNew: true } };
      if (['/office/feed', '/feed'].includes(url.pathname)) return { status: 200, data: { posts: [], hasMore: false, waitingForNew: true, nativeUficonnectIncluded: true } };
      if (url.pathname === '/feed/location') return { status: 200, data: { automaticLocationAvailable: true, countryCode: 'US' } };
      const result = await app.request(url.pathname + url.search, { userId: signedIn ? userId : undefined });
      return { status: result.status, data: result.data ?? {}, headers: {} };
    });
    await page.addInitScript(({ names, initialSession, platform }) => {
      window.ReactNativeWebView = {
        injectedObjectJson: () => JSON.stringify({ EXPO_DOM_HOST_OS: platform, initialProps: { names, props: {
          nativePlatform: platform, nativeAppActive: true, nativeCapability: 'fixture-capability-only', initialSession,
        } } }),
        postMessage: raw => {
          const message = JSON.parse(raw);
          if (message.type !== '$$native_action') return;
          const { actionId, args, uid } = message.data;
          window.__ufiFixtureNativeAction(actionId, args).then(result => {
            window.dispatchEvent(new CustomEvent('$$dom_event', { detail: { type: '$$native_action_result', data: { actionId, uid, result } } }));
          }).catch(error => {
            window.dispatchEvent(new CustomEvent('$$dom_event', { detail: { type: '$$native_action_result', data: { actionId, uid, error: { message: error.message, name: 'Error' } } } }));
          });
        },
      };
    }, { names, platform, initialSession: signedIn ? { token: 'synthetic-native-session', profile } : null });
    const documentUrl = origin + '/www.bundle/' + documentName;
    await page.goto(documentUrl, { waitUntil: 'domcontentloaded' });
    if (!signedIn) {
      await page.locator('.app-welcome').waitFor();
      await page.getByRole('navigation', { name: 'Get started' }).getByRole('link', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
      const decline = page.getByRole('button', { name: 'Decline analytics', exact: true });
      if (await decline.isVisible()) await decline.click();
      const provider = page.getByRole('button', { name: 'Sign in with Google', exact: true });
      await provider.click();
      await page.waitForFunction(() => !document.querySelector('.account-access-provider-google')?.disabled);
      check(report.nativeActions.some(action => action.action === 'onProviderSignIn'), 'Provider button calls the capability-scoped native action; fixture prevents external sign-in');
      await page.getByRole('link', { name: 'Create one', exact: true }).click();
      await page.getByRole('heading', { name: 'Create your account', exact: true }).waitFor();
      check(page.url() === documentUrl, 'Guest navigation stays inside MemoryRouter and the bundled document');
    } else {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('ufi-native-navigate', { detail: { path: '/?feed=feed&all=1' } })));
      await page.locator('.home-feed-layout').waitFor();
      for (const label of ['Home', 'Videos', 'Groups', 'Jobs', 'Profile']) check(await page.locator('.bottom-nav').getByRole('link', { name: label, exact: true }).isVisible(), `Native DOM shows current ${label} navigation`);
      await page.locator('.bottom-nav').getByRole('link', { name: 'Videos', exact: true }).click();
      await page.locator('.video-feed-view').waitFor();
      const media = page.locator('.video-feed-slide video').first();
      await media.waitFor({ state: 'attached' });
      await media.evaluate(async element => { element.muted = true; await element.play(); });
      check(await media.evaluate(element => !element.paused && element.readyState >= 2), 'A real local HTML video is playing through the compiled app');
      check(page.url() === documentUrl, 'Member navigation stays inside the bundled native document');
      await page.evaluate(() => {
        window.__ufiFixtureVisibilityEvents = [];
        document.addEventListener('visibilitychange', () => window.__ufiFixtureVisibilityEvents.push(document.hidden));
      });
      async function setNativeActive(active) {
        const before = await page.evaluate(active => {
          const previous = window.__ufiFixtureVisibilityEvents.length;
          const value = window.$$EXPO_INITIAL_PROPS;
          window.dispatchEvent(new CustomEvent('$$dom_event', { detail: { type: '$$props', data: {
            ...value, props: { ...value.props, nativeAppActive: active },
          } } }));
          return previous;
        }, active);
        await page.waitForFunction(({ active, before }) => document.hidden === !active
          && window.__ufiFixtureVisibilityEvents.slice(before).includes(!active), { active, before }, { timeout: 5000 });
      }
      for (const active of [false, true]) {
        await setNativeActive(active);
        await page.waitForFunction(active => {
          const element = document.querySelector('.video-feed-slide video');
          return element && element.paused === !active;
        }, active, { timeout: 5000 });
        check(await media.evaluate((element, active) => element.paused === !active, active), active
          ? 'Foreground restores the real HTML video playback intent'
          : 'The inactive native prop pauses the real HTML video while the browser document stays open');
      }
      await page.getByRole('button', { name: 'Pause video', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.video-feed-slide video')?.paused === true);
      for (const active of [false, true]) {
        await setNativeActive(active);
        check(await media.evaluate(element => element.paused), 'A manually paused HTML video stays paused across native visibility changes');
      }
      check(true, 'Native background/foreground props update document visibility without reloading the member session');
    }
    const screenshot = signedIn ? 'native-dom-videos.png' : 'native-dom-signup.png';
    await page.screenshot({ path: path.join(output, screenshot) });
    report.screenshots.push(screenshot);
    if (signedIn) {
      // Keep the original injected props stale deliberately. A fresh document
      // must ask the live native host instead of reviving its startup account.
      nativeHostSession = null;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.app-welcome').waitFor();
      check(await page.locator('.bottom-nav').count() === 0, 'DOM reload respects the current host sign-out instead of stale initial session props');
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'DOM surface fits the phone viewport');
    check(errors.length === 0, 'DOM runtime has no unhandled page exceptions: ' + errors.join(', '));
    check(assetFailures.length === 0, 'DOM scripts, styles and public assets load: ' + assetFailures.join(', '));
    await context.close();
  }
  check(report.nativeActions.some(action => action.action === 'onApiRequest'), 'Native API action bridge is exercised');
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.message; throw error; }
finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await app.close();
}
console.log(`DOM simulation passed ${report.checks.length} checks; report: ${path.relative(path.dirname(mobile), output)}/report.json`);
