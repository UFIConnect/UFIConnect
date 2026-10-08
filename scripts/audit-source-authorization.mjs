// Real frontend with synthetic API responses. No production credentials,
// account writes, provider navigation or external network requests are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { SOURCE_META } from '../web/src/components/sourceMeta.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-source-authorization');
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, useLocation} from 'react-router-dom';
import {HelmetProvider} from 'react-helmet-async';
import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {ToastProvider} from '/src/contexts/ToastContext.jsx';
import {SavedItemsProvider} from '/src/contexts/SavedItemsContext.jsx';
import {setAccessToken, privateSessionStorage} from '/src/auth/session.js';
import ConnectedAccounts from '/src/pages/ConnectedAccounts.jsx';
import CommandCenter from '/src/pages/CommandCenter.jsx';
import Feed from '/src/pages/Feed.jsx';
import '/src/index.css';
setAccessToken('synthetic-source-a');
if(new URL(location.href).searchParams.has('audit-stale')) privateSessionStorage.setItem('ufi_feed_state:source-a',JSON.stringify({viewMode:'following',activeTabs:['facebook','spotify','hackernews'],filters:{sources:['facebook','hackernews'],sort:'newest',topics:[],timeRange:'all'}}));
function Fixture() {
  const {pathname}=useLocation();
  return React.createElement(pathname==='/connected-accounts' ? ConnectedAccounts : pathname==='/command-center' ? CommandCenter : Feed);
}
createRoot(document.getElementById('root')).render(React.createElement(HelmetProvider,null,
  React.createElement(BrowserRouter,null,React.createElement(AuthProvider,null,
    React.createElement(SavedItemsProvider,null,React.createElement(ToastProvider,null,React.createElement(Fixture)))))));`;
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(''), 'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify('') },
  plugins: [{ name: 'source-authorization-fixture',
    resolveId(id) { if (id === 'virtual:source-authorization-audit.jsx') return '\0virtual:source-authorization-audit.jsx'; },
    load(id) { if (id === '\0virtual:source-authorization-audit.jsx') return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (!['/', '/connected-accounts', '/command-center'].includes(new URL(req.url, 'http://fixture.invalid').pathname)) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Source authorization audit</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:source-authorization-audit.jsx"></script></body></html>'));
    }); },
  }], server: { host: '127.0.0.1', port: 5273, strictPort: false } });
const catalog = {
  youtube: { name: 'YouTube', configured: true },
  twitter: { name: 'X (Twitter)', configured: false },
  linkedin: { name: 'LinkedIn', configured: true, forceComingSoon: true, commandCenterOnly: true },
  indeed: { name: 'Indeed', category: 'career', configured: false, connectionMode: 'external' },
  spotify: { name: 'Spotify', category: 'audio', configured: true, connectionMode: 'external' },
  medium: { name: 'Medium', configured: 'true' },
  mastodon: { name: 'Mastodon', configured: false, reconnectRequired: true },
  bluesky: { name: 'Bluesky', configured: true, needsHandle: true },
  gitlab: { name: 'GitLab', configured: true, locked: true },
  discord: { name: 'Discord', configured: true, authorizationSupported: false },
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let browser, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  await fs.mkdir(output, { recursive: true });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], oauth = [], feeds = [], external = [];
    let hold = deferred(), failed = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const reply = (json, status = 200) => route.fulfill({ status, json }).catch(() => {});
      if (url.origin !== new URL(base).origin) { external.push({ url: url.href, type: request.resourceType() }); return route.fulfill({ status: 403, body: 'External requests disabled.' }); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4);
      if (endpoint === '/profile') return reply({ id: 'source-a', name: 'Source audit', email: 'audit@example.invalid', plan: 'pro',
        onboardingComplete: false, role: 'developer', interests: ['Science'], preferences: {},
        roleSettings: { feedSourceFavorites: { feed: [], following: ['twitter', 'facebook', 'hackernews', 'future-unsupported', 'youtube'] } }, connectedPlatforms: ['mastodon'] });
      if (endpoint === '/social/platforms') {
        if (hold) await hold.promise;
        return failed ? reply({ error: 'Synthetic catalog unavailable' }, 400) : reply({ platforms: catalog, connected: { mastodon: true } });
      }
      if (endpoint.startsWith('/auth/social/')) { oauth.push({ endpoint, params: Object.fromEntries(url.searchParams) }); return reply({ error: 'Synthetic provider response' }, 400); }
      if (endpoint === '/office/feed') {
        feeds.push(Object.fromEntries(url.searchParams));
        const posts = url.searchParams.get('mode') === 'following' ? [
          { id: 'followed-youtube', source: 'youtube', title: 'Followed channel update', content: 'A channel you follow has a new update.', authorName: 'Followed publisher', createdAt: new Date().toISOString() },
          { id: 'followed-twitter', source: 'twitter', title: 'Followed X account update', content: 'An account you follow has a new update.', authorName: 'Followed publisher', createdAt: new Date().toISOString() },
          { id: 'stale-directory', source: 'spotify', title: 'Stale website source must stay hidden', createdAt: new Date().toISOString() },
          { id: 'stale-interests', source: 'facebook', title: 'Interest search must stay hidden', createdAt: new Date().toISOString() },
          { id: 'stale-twitter-interests', source: 'twitter', matchedByInterest: true, title: 'Legacy X interest search must stay hidden', createdAt: new Date().toISOString() },
          { id: 'public-hackernews', source: 'hackernews', title: 'Public Hacker News row must stay outside Following', content: 'A public Hacker News story about developer tools.', authorName: 'HN author', sourceUrl: 'https://news.ycombinator.com/item?id=123', createdAt: new Date().toISOString() },
          { id: 'unknown-adapter', source: 'future-unsupported', title: 'Unknown adapter must stay hidden', createdAt: new Date().toISOString() },
        ] : [];
        return reply({ posts, hasMore: false, nativeUficonnectIncluded: true, totalAvailable: posts.length });
      }
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/billing/status') return reply({});
      return reply({ posts: [], postIds: [], groups: [], jobs: [], sources: [], snaps: [], users: [], notifications: [], conversations: [], items: [], hasMore: false, connected: {} });
    });

    await page.goto(base + 'connected-accounts?connect=mastodon');
    await page.locator('.spinner-primary').first().waitFor();
    check(await page.getByRole('dialog').count() === 0, 'Pending catalog cannot open a connection modal');
    hold.resolve(); hold = null;
    await page.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).waitFor();
    check(await page.getByRole('dialog').count() === 0, 'Unconfigured deep link stays locked after readiness arrives');
    for (const name of ['Indeed', 'Spotify', 'Medium', 'Mastodon', 'GitLab', 'Discord', 'X (Twitter)']) {
      const button = page.getByRole('button', { name: `Sign in and connect ${name}`, exact: true });
      check(await button.isDisabled(), `${name} authorization is inert`);
      check(await button.locator('.account-action-lock').count() === 1 && (await button.getAttribute('title')).includes('Locked'), `${name} lock badge is visible`);
      await button.evaluate(element => element.click());
    }
    check(oauth.length === 0, 'Locked source controls make no authorization requests');
    const website = page.getByRole('link', { name: 'Visit Indeed website', exact: true });
    check(await website.getAttribute('href') === 'https://www.indeed.com/', 'Website visits open the official home page');
    check(await page.getByRole('link', { name: /Sign in/ }).count() === 0, 'Website links do not pretend to authorize accounts');
    check(await website.locator('.account-action-icon').count() === 1 && !/Sign in|Visit/.test(await website.innerText()), 'Website action preserves the icon appearance with an accessible name');
    check(await page.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).locator('.account-action-icon').count() === 1, 'Configured authorization preserves its account icon');
    await page.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).click();
    await page.getByText('Synthetic provider response', { exact: true }).waitFor();
    check(oauth.length === 1 && oauth[0].endpoint === '/auth/social/youtube/start', 'Configured authorization remains active');
    await page.getByRole('button', { name: 'Sign in and connect Bluesky', exact: true }).click();
    await page.getByRole('dialog', { name: 'Connect Bluesky', exact: true }).waitFor();
    check(oauth.length === 1, 'Configured federated authorization waits for the handle');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.screenshot({ path: path.join(output, `connected-accounts-${width}.png`), fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Source accounts fit the viewport');

    failed = true;
    await page.goto(base + 'connected-accounts?connect=bluesky');
    await page.getByText('Sign-in is locked until this connection is set up.', { exact: true }).waitFor();
    check(await page.getByRole('dialog').count() === 0, 'Failed catalog cannot open authorization through a deep link');
    check(oauth.length === 1, 'Failed catalog sends no new authorization request');
    failed = false;

    await page.goto(base + 'command-center?tab=accounts');
    const accounts = page.getByRole('tabpanel', { name: 'Connected Accounts', exact: true });
    await accounts.getByRole('button', { name: 'Sign in and connect LinkedIn', exact: true }).waitFor();
    check(await accounts.getByRole('button', { name: 'Sign in and connect LinkedIn', exact: true }).isDisabled(), 'Command Center preserves force-coming-soon lock');
    check(await accounts.getByRole('button', { name: 'Sign in and connect Indeed', exact: true }).isDisabled(), 'Command Center external accounts remain locked');
    check(await accounts.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).isEnabled(), 'Command Center configured provider remains active');
    check(await accounts.getByRole('link', { name: /Sign in/ }).count() === 0, 'Command Center has no external sign-in bypass');
    await page.screenshot({ path: path.join(output, `command-center-${width}.png`), fullPage: true });

    await page.goto(base + '?feed=feed&all=1');
    const home = page.getByRole('group', { name: 'Home sources', exact: true });
    for (const key of ['weworkremotely', 'cntraveler', 'hackernews']) {
      const button = home.getByRole('button', { name: SOURCE_META[key].label, exact: true });
      await button.waitFor();
      const response = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/office/feed' && url.searchParams.get('mode') === 'feed'
          && (url.searchParams.get('source') === key || url.searchParams.get('sources')?.split(',').includes(key));
      });
      await button.click(); await response;
      check(feeds.some(value => value.mode === 'feed' && (value.source === key || value.sources?.split(',').includes(key))), `${key} routes to Home discovery`);
    }
    if (width <= 768) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const tools = page.locator(width <= 768 ? '#mobile-feed-drawer .home-feed-side-tools' : '.home-feed-right-tabs .home-feed-side-tools');
    await tools.getByRole('button', { name: /Connected accounts/ }).click();
    await tools.getByRole('button', { name: 'Sign in and connect Indeed', exact: true }).waitFor();
    check(await tools.getByRole('button', { name: 'Sign in and connect Indeed', exact: true }).isDisabled(), 'Home account tools preserve the external lock');
    check(await tools.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).isEnabled(), 'Home tools keep configured authorization');
    check(await tools.getByRole('link', { name: /Sign in/ }).count() === 0, 'Home tools have no external sign-in bypass');
    const priorFeedCount = feeds.length;
    await page.goto(base + '?feed=following&audit-stale=1');
    const following = page.getByRole('group', { name: 'Following sources', exact: true });
    await following.getByRole('button', { name: 'YouTube', exact: true }).waitFor();
    await page.getByText('Followed channel update', { exact: true }).waitFor();
    await page.getByText('Followed X account update', { exact: true }).waitFor();
    for (const title of ['Stale website source must stay hidden', 'Interest search must stay hidden', 'Legacy X interest search must stay hidden', 'Public Hacker News row must stay outside Following', 'Unknown adapter must stay hidden']) check(await page.getByText(title, { exact: true }).count() === 0, `${title}: response rows are gated by the follow adapter allowlist`);
    for (const key of ['uficonnect', 'youtube', 'github', 'gitlab', 'reddit', 'twitch', 'bluesky', 'mastodon', 'twitter']) check(await following.getByRole('button', { name: SOURCE_META[key].label, exact: true }).count() === 1, `${key} has a Following selector`);
    for (const key of ['facebook', 'hackernews', 'indeed', 'spotify', 'linkedin', 'instagram']) check(await following.getByRole('button', { name: SOURCE_META[key].label, exact: true }).count() === 0, `${key} cannot advertise an unsupported follow feed`);
    check(feeds.slice(priorFeedCount).every(value => value.mode === 'following' && !value.source && !value.sources), 'Removed saved selections reset to the full Following feed');
    await page.getByRole('button', { name: 'View all feed sources', exact: true }).click();
    await page.getByText('2 selected', { exact: true }).waitFor();
    check(await page.getByText('2 selected', { exact: true }).count() === 1, 'Valid X and YouTube favorites survive while unsupported favorites are removed');
    await page.getByRole('button', { name: 'View all feed sources', exact: true }).click();
    const response = page.waitForResponse(response => response.url().includes('/office/feed?') && new URL(response.url()).searchParams.get('mode') === 'following' && new URL(response.url()).searchParams.get('source') === 'youtube');
    await following.getByRole('button', { name: 'YouTube', exact: true }).click(); await response;
    check(feeds.some(value => value.mode === 'following' && value.source === 'youtube'), 'Following selection requests the personal follow feed');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Following selectors fit the viewport');
    check(external.every(request => request.type === 'image'), 'No provider navigation or external API calls; remote icons were blocked');
    check(errors.length === 0, `No browser errors: ${errors.join(', ')}`);
    await page.screenshot({ path: path.join(output, `following-${width}.png`), fullPage: true });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({ checks, widths: [1440, 390], passed: true }, null, 2));
  console.log(JSON.stringify({ checks, passed: true, output: path.relative(root, output) }));
} finally { if (browser) await browser.close(); await server.close(); }
