import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { browserSecurityPolicy } from '../web/securityPolicy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web/dist');
const original = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
const origin = 'https://security.example.invalid';
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  for (const withHeader of [true, false]) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    let googleRequests = 0;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.googletagmanager.com') googleRequests++;
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, json: {} });
      if (url.pathname.startsWith('/assets/')) {
        const file = path.resolve(dist, '.' + url.pathname);
        if (!file.startsWith(dist + path.sep)) return route.abort();
        return route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript' });
      }
      if (url.pathname !== '/login') return route.fulfill({ status: 404, body: '' });
      const html = original.replace('</head>', '<script>window.__untrustedScriptRan = true;</script></head>')
        .replace('</body>', '<img src="/missing" onerror="window.__untrustedHandlerRan = true"></body>');
      return route.fulfill({ contentType: 'text/html', body: html, headers: {
        'Referrer-Policy': 'no-referrer',
        ...(withHeader ? { 'Content-Security-Policy': browserSecurityPolicy(original) } : {}),
      } });
    });
    await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
    await page.locator('#login-password').waitFor();
    assert.equal(await page.locator('#login-password').getAttribute('type'), 'password');
    assert.equal(await page.evaluate(() => window.__untrustedScriptRan), undefined);
    assert.equal(await page.evaluate(() => window.__untrustedHandlerRan), undefined);
    const blocked = await page.evaluate(() => new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 3000);
      const listener = event => {
        if (event.blockedURI.startsWith('https://www.googletagmanager.com')) {
          clearTimeout(timer);
          window.removeEventListener('securitypolicyviolation', listener);
          resolve(event.effectiveDirective === 'script-src-elem' || event.effectiveDirective === 'script-src');
        }
      };
      window.addEventListener('securitypolicyviolation', listener);
      const script = document.createElement('script');
      script.src = 'https://www.googletagmanager.com/gtag/js?id=G-F68DRQ6CC5';
      document.head.appendChild(script);
    }));
    assert.equal(blocked, true, 'Google scripts must be blocked in the private application document');
    assert.equal(googleRequests, 0, 'CSP must reject the script before any request leaves the app');
    console.log(`PASS: production app boots and blocks injected script/handler and Google in the main document (${withHeader ? 'HTTP + meta CSP' : 'static-host meta CSP'})`);
    await context.close();
  }
} finally { await browser.close(); }
