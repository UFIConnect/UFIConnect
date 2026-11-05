import { auditAccountActionName } from './audit-account-action.mjs';
// Real account controls with synthetic APIs. All provider and external requests
// are intercepted; this audit never connects an account or publishes a post.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { ACCOUNT_CATEGORIES, accountCategory } from '../shared/accountCategories.js';
import { sourceAuthorizationState } from '../web/src/components/sourceAuthorization.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-linkedin-x-activation');
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, useLocation} from 'react-router-dom';
import {HelmetProvider} from 'react-helmet-async';
import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {ToastProvider} from '/src/contexts/ToastContext.jsx';
import {SavedItemsProvider} from '/src/contexts/SavedItemsContext.jsx';
import {setAccessToken} from '/src/auth/session.js';
import ConnectedAccounts from '/src/pages/ConnectedAccounts.jsx';
import CommandCenter from '/src/pages/CommandCenter.jsx';
import Feed from '/src/pages/Feed.jsx';
import '/src/index.css';
setAccessToken('synthetic-linkedin-x');
window.__connectionEvents=0;
window.addEventListener('ufi-connections-changed',()=>{window.__connectionEvents++;});
function Fixture() {
  const {pathname}=useLocation();
  return React.createElement(pathname==='/connected-accounts' ? ConnectedAccounts : pathname==='/command-center' ? CommandCenter : Feed);
}
createRoot(document.getElementById('root')).render(React.createElement(HelmetProvider,null,
  React.createElement(BrowserRouter,null,React.createElement(AuthProvider,null,
    React.createElement(SavedItemsProvider,null,React.createElement(ToastProvider,null,React.createElement(Fixture)))))));`;
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(''),
    'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify(''),
  },
  plugins: [{
    name: 'linkedin-x-activation-fixture',
    resolveId(id) { if (id === 'virtual:linkedin-x-activation.jsx') return '\0virtual:linkedin-x-activation.jsx'; },
    load(id) { if (id === '\0virtual:linkedin-x-activation.jsx') return fixture; },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!['/', '/connected-accounts', '/command-center'].includes(new URL(req.url, 'http://fixture.invalid').pathname)) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>LinkedIn and X activation audit</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:linkedin-x-activation.jsx"></script></body></html>'));
      });
    },
  }],
  server: { host: '127.0.0.1', port: 5276, strictPort: false },
});

const catalog = {
  twitter: { name: 'X (Twitter)', configured: true, forceComingSoon: false, authorizationAvailable: true, crossPost: { supported: true, media: 'link' } },
  linkedin: { name: 'LinkedIn', configured: true, forceComingSoon: false, authorizationAvailable: true, crossPost: { supported: true, media: 'native-image' } },
};
const keys = Object.keys(catalog);
let browser, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function selectCategory(scope, key, compact = false) {
  const category = accountCategory(key, catalog[key]);
  if (compact) return scope.getByRole('combobox', { name: 'Account category', exact: true }).selectOption(category);
  const label = ACCOUNT_CATEGORIES.find(([id]) => id === category)[1];
  await scope.getByRole('group', { name: 'Account categories' }).getByRole('button', { name: new RegExp(`^${label} \\d+$`) }).click();
}

try {
  await fs.mkdir(output, { recursive: true });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const key of keys) check(sourceAuthorizationState(catalog[key]).ready === true, `${key} active catalog has ready:true`);
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], oauth = [], external = [], writes = [];
    let connected = {}, platforms = structuredClone(catalog);
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const reply = (json, status = 200) => route.fulfill({ status, json }).catch(() => {});
      if (url.origin !== new URL(base).origin) {
        external.push({ url: url.href, type: request.resourceType() });
        return route.fulfill({ status: 403, body: 'External requests disabled.' });
      }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ endpoint, method: request.method() });
      if (endpoint === '/profile') return reply({
        id: 'linkedin-x-audit', name: 'LinkedIn and X audit', email: 'audit@example.invalid', plan: 'pro',
        onboardingComplete: false, role: 'developer', interests: ['Science'], preferences: {}, roleSettings: {},
        connectedPlatforms: Object.keys(connected).filter(key => connected[key]),
      });
      if (endpoint === '/social/platforms') return reply({ platforms, connected });
      if (endpoint === '/profile/social') return reply({ connected });
      if (endpoint.startsWith('/auth/social/')) {
        oauth.push({ endpoint, params: Object.fromEntries(url.searchParams), method: request.method() });
        return reply({ error: `Synthetic authorization ${oauth.length}` }, 400);
      }
      if (/events|stream/.test(endpoint)) return route.abort();
      return reply({ posts: [], postIds: [], groups: [], jobs: [], sources: [], snaps: [], users: [], notifications: [], conversations: [], items: [], hasMore: false, nativeUficonnectIncluded: true, connected: {} });
    });

    async function authorize(scope, key, returnTo, compact = false) {
      await selectCategory(scope, key, compact);
      const button = scope.getByRole('button', { name: auditAccountActionName(`${catalog[key].name}`), exact: true });
      await button.waitFor();
      check(await button.isEnabled(), `${key} Connect is enabled at ${width}px`);
      check(await button.locator('.account-action-lock').count() === 0, `${key} has no forced lock badge`);
      const prior = oauth.length;
      await button.click();
      await page.getByText(`Synthetic authorization ${prior + 1}`, { exact: true }).waitFor();
      check(oauth.length === prior + 1 && oauth[prior].endpoint === `/auth/social/${key}/start` && oauth[prior].method === 'GET', `${key} uses its exact authorization start route`);
      check(oauth[prior].params.returnTo === returnTo, `${key} preserves the intended authorization return route`);
    }

    await page.goto(base + 'connected-accounts');
    for (const key of keys) await authorize(page, key, undefined);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Connected Accounts fits the viewport');
    await page.screenshot({ path: path.join(output, `accounts-${width}.png`), fullPage: true });
    await page.goto(base + 'connected-accounts?returnTo=command-center');
    for (const key of keys) await authorize(page, key, 'command-center');

    await page.goto(base + 'command-center?tab=accounts');
    const accounts = page.getByRole('tabpanel', { name: 'Connected Accounts', exact: true });
    for (const key of keys) await authorize(accounts, key, 'command-center');

    await page.goto(base + '?feed=feed&all=1');
    if (width <= 768) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const tools = page.locator(width <= 768 ? '#mobile-feed-drawer .home-feed-side-tools' : '.home-feed-right-tabs .home-feed-side-tools');
    await tools.getByRole('button', { name: /Connected accounts/ }).click();
    for (const key of keys) await authorize(tools, key, undefined, true);

    connected = { twitter: true, linkedin: true };
    for (const key of keys) {
      await page.goto(base + `connected-accounts?social_connected=${key}`);
      await page.getByText(`${catalog[key].name} connected successfully.`, { exact: true }).waitFor();
      check(await page.evaluate(() => window.__connectionEvents) === 1, `${key} Connected Accounts confirms server connection`);
      await page.goto(base + `command-center?tab=accounts&social_connected=${key}`);
      await page.getByText(`${catalog[key].name} connected successfully.`, { exact: true }).waitFor();
      await page.waitForURL(url => url.pathname === '/command-center' && url.search === '?tab=accounts');
      check(await page.evaluate(() => window.__connectionEvents) === 1, `${key} Command Center callback returns to accounts`);
    }

    // Authorization readiness alone cannot make a publishing target selectable.
    for (const state of ['disconnected', 'unsupported', 'ready', 'reconnect', 'setup-required']) {
      connected = state === 'disconnected' ? {} : { twitter: true, linkedin: true };
      platforms = structuredClone(catalog);
      for (const key of keys) {
        platforms[key].crossPost.supported = state !== 'unsupported';
        platforms[key].reconnectRequired = state === 'reconnect';
        platforms[key].forceComingSoon = state === 'setup-required';
      }
      await page.goto(base + 'command-center?tab=crosspost');
      const category = page.getByRole('combobox', { name: 'Publishing category', exact: true });
      await category.waitFor();
      for (const key of keys) {
        await category.selectOption(accountCategory(key, platforms[key]));
        const destination = page.locator(`[aria-label="${catalog[key].name} destination"]`);
        await destination.waitFor();
        const target = destination.getByRole('button', { name: catalog[key].name, exact: true });
        if (state === 'ready') {
          check(await target.isEnabled(), `${key} connected supported publishing target is selectable`);
          await target.click();
          check(await target.getAttribute('aria-pressed') === 'true', `${key} selection is retained`);
          check(await destination.getByRole('link', { name: `Manage ${catalog[key].name}`, exact: true }).getAttribute('href') === '/command-center?tab=accounts', `${key} publishing target manages its Command Center account`);
        } else check(await target.count() === 0, `${key} ${state} publishing target cannot be selected`);
        if (state === 'disconnected') check(await destination.getByRole('link', { name: `Connect ${catalog[key].name}`, exact: true }).getAttribute('href') === '/command-center?tab=accounts', `${key} disconnected publishing target links to account authorization`);
      }
      if (state === 'ready') {
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Cross-Post fits the viewport');
        await page.screenshot({ path: path.join(output, `crosspost-${width}.png`), fullPage: true });
      }
    }
    check(oauth.length === 8, 'Only explicit Connect clicks start authorization');
    check(external.every(request => request.type === 'image'), 'Provider navigation and external APIs remain blocked');
    check(writes.every(request => ['/analytics/tab', '/analytics/pageview'].includes(request.endpoint)), `Only intercepted local analytics writes; no account changes, publishing, uploads, or paid calls: ${JSON.stringify(writes)}`);
    check(errors.length === 0, `No browser errors: ${errors.join(', ')}`);
    await context.close();
    console.log(`PASS LinkedIn and X activation UI at ${width}px`);
  }
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({ checks, widths: [1440, 390], passed: true, synthetic: true }, null, 2));
  console.log(JSON.stringify({ checks, passed: true, output: path.relative(root, output) }));
} finally {
  await browser?.close();
  await server.close();
}
