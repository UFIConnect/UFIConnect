import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { ADS_CONSENT_KEY, ADS_CONVERSION, TAG_MANAGER_ID } from '../web/src/analytics/googleAds.mjs';
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  for (const config of [{}, { ga: true }, { ads: true }, { ads: true, gpc: true }, { ads: true, path: '/login' }, { ads: true, member: true }]) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(({ config, key }) => {
      localStorage.setItem('uficonnect.analytics.consent.v1', config.ga ? 'granted' : 'denied');
      if (config.ads && !localStorage.getItem(key)) localStorage.setItem(key, 'granted');
      if (config.gpc) Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
    }, { config, key: ADS_CONSENT_KEY });
    let scripts = 0;
    let containers = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname === 'www.googletagmanager.com') {
        if (url.pathname === '/gtm.js' && url.searchParams.get('id') === TAG_MANAGER_ID) {
          containers++;
          return route.fulfill({ contentType: 'text/javascript', body: 'window.__tagManager = true;' });
        }
        if (url.searchParams.get('id') === 'AW-18490754953') {
          scripts++;
          return route.fulfill({ contentType: 'text/javascript', body: 'window.__adsSdk = true;' });
        }
        return route.abort();
      }
      if (['fetch', 'xhr'].includes(request.resourceType()) || request.method() === 'OPTIONS') {
        const endpoint = url.pathname.replace(/^\/api/, '');
        const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
        const profile = { id: 'ads-audit', name: 'Audit member', plan: 'free', onboardingComplete: true };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (endpoint === '/auth/session') return route.fulfill({ status: config.member ? 200 : 401, headers, json: config.member ? { token: 'audit-member-token', profile } : {} });
        return route.fulfill({ headers, json: endpoint === '/profile' ? profile : { posts: [], items: [], groups: [], notifications: [], sources: [], hasMore: false } });
      }
      return url.origin === server.origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto(server.origin + (config.path || '/') + '?gclid=A_test-click-123&email=private%40example.invalid#private-value');
    await page.waitForFunction(() => !document.querySelector('#root[data-session-shell]') && !document.querySelector('.splash'));
    if (config.ads && !config.gpc && !config.path && !config.member) {
      await page.waitForFunction(() => window.__adsSdk === true && window.__tagManager === true);
      assert.equal(containers, 1, 'The requested Tag Manager container loads once after advertising consent');
      assert.equal(await page.evaluate(() => window.dataLayer.filter(value => value.event === 'gtm.js').length), 1);
      const events = await page.evaluate(() => window.dataLayer.map(value => Array.from(value)));
      const conversions = events.filter(value => value[0] === 'event' && value[1] === 'conversion');
      assert.equal(conversions.length, 1);
      assert.equal(conversions[0][2].send_to, ADS_CONVERSION);
      assert.equal(conversions[0][2].page_location, 'https://uficonnect.org/');
      assert.ok(!JSON.stringify(events).includes('private@'));
      assert.equal(new URL(page.url()).search, '?gclid=A_test-click-123');
      assert.equal(new URL(page.url()).hash, '');
      await page.evaluate(() => history.pushState({}, '', '/login'));
      await page.waitForURL('**/login');
      await page.locator('#login-password').waitFor();
      assert.equal(await page.evaluate(() => window.__adsSdk), undefined, 'Leaving the homepage destroys the SDK document');
      assert.equal(await page.evaluate(() => window.__tagManager), undefined, 'Private routes unload Tag Manager');
      assert.equal(scripts, 1);
      assert.equal(containers, 1);
      await page.goto(server.origin + '/#analytics');
      await page.waitForFunction(() => window.__adsSdk === true && window.__tagManager === true);
      await page.getByRole('checkbox', { name: 'Allow Google Ads measurement (optional)' }).uncheck();
      await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
      await page.waitForFunction(key => localStorage.getItem(key) === 'denied' && !window.__adsSdk && !window.__tagManager, ADS_CONSENT_KEY);
      assert.equal(scripts, 2, 'Withdrawing consent unloads the SDK without loading it again');
      assert.equal(containers, 2, 'Withdrawing consent unloads Tag Manager without loading it again');
    } else {
      await page.waitForTimeout(300);
      assert.equal(scripts, 0, JSON.stringify(config));
      assert.equal(containers, 0, `Tag Manager stays off: ${JSON.stringify(config)}`);
    }
    await context.close();
    console.log('PASS Ads consent and document boundary', JSON.stringify(config));
  }
  for (const file of ['login/index.html', 'vault/index.html', 'app.html']) {
    const html = await fs.readFile(new URL('../web/dist/' + file, import.meta.url), 'utf8');
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)/)[1];
    assert.ok(!policy.includes('googletagmanager.com'), file + ' forbids Ads scripts');
  }
} finally { await browser.close(); await server.close(); }
