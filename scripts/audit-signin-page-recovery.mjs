import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 5284, strictPort: false } });
let browser;
try {
  await server.listen(); const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const provider of ['google', 'apple']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
    await page.addInitScript(() => { localStorage.setItem('uficonnect.analytics.consent.v1', 'denied'); localStorage.setItem('uficonnect.ads.consent.v1', 'denied'); });
    const profile = { id: 'synthetic-restored-member', name: 'Provider Member', email: 'provider@example.test', plan: 'free', authProvider: provider,
      onboardingComplete: false, skills: [], joinedGroups: [], preferences: {}, roleSettings: {} };
    let failRoute = true, restored = 0, blockedChunks = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (route.request().resourceType() === 'document') {
        const response = await route.fetch();
        return route.fulfill({ response, body: (await response.text()).replace('<div id="root"></div>', '<div id="root" data-session-shell="true"></div>') });
      }
      if (url.pathname === '/src/pages/Onboarding.jsx' && failRoute) { blockedChunks++; return route.abort('failed'); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4);
      if (endpoint === '/auth/session') { restored++; return route.fulfill({ json: { token: 'synthetic-restored-session', profile } }); }
      if (endpoint === '/profile') return route.fulfill({ json: profile });
      if (endpoint === '/auth/providers') return route.fulfill({ json: { providers: { google: { configured: true, enabled: true }, apple: { configured: true, enabled: true }, phone: { configured: true, enabled: true } } } });
      if (/events|stream/.test(endpoint)) return route.fulfill({ contentType: 'text/event-stream', body: '' });
      if (endpoint.startsWith('/analytics/')) return route.fulfill({ status: 204 });
      return route.fulfill({ json: {} });
    });
    await page.goto(base + 'login?provider=' + provider);
    await page.waitForFunction(() => Boolean(sessionStorage.getItem('uficonnect.route-recovery.v1')));
    await page.waitForFunction(() => document.querySelector('.session-recovery button')?.textContent === 'Reload page');
    await page.waitForTimeout(150);
    await page.getByRole('heading', { name: 'We could not open this page', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Reload page', exact: true }).isVisible(), true);
    assert.equal(await page.locator('#root').getAttribute('data-session-shell'), null);
    assert.equal(blockedChunks, 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const before = restored;
    failRoute = false;
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await page.getByRole('heading', { name: 'What best describes you?', exact: true }).waitFor();
    assert.ok(restored > before);
    assert.equal(new URL(page.url()).pathname, '/onboarding');
    assert.equal(await page.locator('input[type="email"],input[type="password"]').count(), 0);
    await context.close();
    console.log(`PASS ${provider}: failed post-callback route stays visible, reload restores session and onboarding`);
  }
} finally { await browser?.close(); await server.close(); }
