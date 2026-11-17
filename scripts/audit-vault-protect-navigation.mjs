import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from 'playwright';
import { build } from '../web/node_modules/vite/dist/node/index.js';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const protectPath = '/vault/protect?entry=vault';
const creditId = 'credit-and-identity';
const reportsId = 'identity-reports';
const profile = {
  id: 'vault-navigation-audit', name: 'Audit member', onboardingComplete: true, plan: 'free', roleSettings: {},
};
const session = { token: 'synthetic-vault-navigation', profile };
const apiData = {
  '/auth/session': session,
  '/profile': profile,
  '/reports/identity': { reports: [] },
  '/feed/location': { automaticLocationAvailable: true },
};

const cache = join(webRoot, '.cache');
await mkdir(cache, { recursive: true });
const fixtureRoot = await mkdtemp(join(cache, 'vault-navigation-'));

// Bundle the real Expo DOM entry to run its router and bridge with a synthetic host.
async function startNativeFixture() {
  await writeFile(join(fixtureRoot, 'index.html'), `<!doctype html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body><div id="root"></div>
      <script type="module">
        import { createElement } from 'react';
        import { createRoot } from 'react-dom/client';
        import Website from '../../../mobile/current-site/Website.jsx';
        const apiData = ${JSON.stringify(apiData)};
        createRoot(document.getElementById('root')).render(createElement(Website, {
          nativePlatform: new URLSearchParams(location.search).get('platform'),
          onApiRequest: async (_, { url }) => ({
            status: 200, data: apiData[new URL(url, 'https://api.uficonnect.org').pathname] || {},
          }),
        }));
      </script>
    </body></html>`);
  await build({
    root: fixtureRoot, configFile: join(webRoot, 'vite.config.js'), envDir: false,
    publicDir: join(webRoot, 'public'), logLevel: 'error',
  });
  return startBuiltServer({ root: join(fixtureRoot, 'dist') });
}

async function auditPage(browser, device, origin, check) {
  const context = await browser.newContext({ ...device, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(expectedOrigin => {
      if (location.origin === expectedOrigin) localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
    }, origin);
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname === 'api.uficonnect.org' || url.hostname.endsWith('.onrender.com') ||
          (url.origin === origin && /^\/(?:api|fallback)\//.test(url.pathname))) {
        const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'authorization,content-type' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        return route.fulfill({ headers, json: apiData[url.pathname.replace(/^\/(?:api|fallback)\//, '/')] || {} });
      }
      if (url.origin !== origin) return route.abort();
      if (browser.browserType().name() !== 'webkit' || request.resourceType() !== 'document') return route.continue();
      // WebKit upgrades loopback subresources to HTTPS, but this fixture serves HTTP.
      const response = await route.fetch();
      const headers = response.headers();
      headers['content-security-policy'] = headers['content-security-policy'].replace('upgrade-insecure-requests', '');
      delete headers['content-length'];
      return route.fulfill({ response, headers, body: (await response.text()).replace('upgrade-insecure-requests', '') });
    });
    await check(page);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error('Audit page', page.url(), errors, (await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(0, 600));
    throw error;
  } finally {
    await context.close();
  }
}

const creditLink = page => page.getByRole('link', { name: 'Credit & identity', exact: true });

async function sectionInView(page, id) {
  await page.waitForFunction(target => {
    const section = document.getElementById(target);
    const heading = section?.querySelector('h2')?.getBoundingClientRect();
    const headerBottom = document.querySelector('.global-app-header')?.getBoundingClientRect().bottom ?? 0;
    return document.activeElement === section && heading?.top >= Math.max(0, headerBottom) &&
      heading.bottom < innerHeight / 2 && scrollY > 0;
  }, id);
}

async function followNativeLink(page, path) {
  await page.evaluate(target => {
    const anchor = document.createElement('a');
    anchor.href = new URL(target, 'https://uficonnect.org').href;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, path);
}

let website;
let native;
let browser;
let iosBrowser;
try {
  website = await startBuiltServer();
  native = await startNativeFixture();
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  iosBrowser = process.env.UFI_VAULT_AUDIT_WEBKIT === '1' ? await webkit.launch() : browser;

  for (const [engine, device] of [[browser, devices['Desktop Chrome']], [browser, devices['Pixel 7']], [iosBrowser, devices['iPhone 15']]]) {
    await auditPage(engine, device, website.origin, async page => {
      const url = website.origin + protectPath;
      assert.equal((await page.goto(url)).status(), 200);
      await creditLink(page).click();
      await sectionInView(page, creditId);
      assert.equal(page.url(), url + '#' + creditId);
      const historyLength = await page.evaluate(() => history.length);

      await page.evaluate(() => window.scrollTo(0, 0));
      await creditLink(page).focus();
      await page.keyboard.press('Enter');
      await sectionInView(page, creditId);
      assert.equal(await page.evaluate(() => history.length), historyLength);
      await page.goBack();
      await page.waitForURL(url);
      await page.goForward();
      await page.waitForURL(url + '#' + creditId);
      await sectionInView(page, creditId);

      await page.reload();
      await sectionInView(page, creditId);
      await page.goto('about:blank');
      assert.equal((await page.goto(url + '#' + reportsId)).status(), 200);
      await sectionInView(page, reportsId);
      console.log(`PASS web at ${device.viewport.width}px: activation, repeat, focus, Back/Forward, reload and direct reports link`);
    });
  }

  for (const [platform, engine, device] of [
    ['ios', iosBrowser, devices['iPhone 15']],
    ['android', browser, devices['Pixel 7']],
  ]) {
    await auditPage(engine, device, native.origin, async page => {
      const documentUrl = native.origin + '/?platform=' + platform;
      await page.goto(documentUrl);
      await page.locator('html[data-ufi-app="' + platform + '"] .shell').waitFor();
      await followNativeLink(page, protectPath);
      await creditLink(page).tap();
      await sectionInView(page, creditId);

      await page.evaluate(() => window.scrollTo(0, 0));
      await creditLink(page).tap();
      await sectionInView(page, creditId);
      assert.equal(await creditLink(page).getAttribute('href'), protectPath + '#' + creditId);

      await page.getByRole('link', { name: 'Vault Card Hardware locked' }).tap();
      assert.equal(await page.getByRole('button', { name: 'Orders are not open yet' }).isDisabled(), true);
      await followNativeLink(page, protectPath + '#' + creditId);
      await sectionInView(page, creditId);
      await followNativeLink(page, protectPath + '#' + reportsId);
      await sectionInView(page, reportsId);
      assert.equal(page.url(), documentUrl, 'Vault links keep the native document in place');
      console.log(`PASS ${platform} DOM: tap, repeat, focus, locked device route and direct links to both sections`);
    });
  }
} finally {
  if (iosBrowser !== browser) await iosBrowser?.close();
  await browser?.close();
  await native?.close();
  await website?.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}
