// Real PostHeader, synthetic author/media fixtures, no provider/account writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/app-update-20261013/x-identity-qa');
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {PostHeader} from '/src/components/PostCardChrome.jsx';
import '/src/index.css';
const base={id:'twitter_123456789',source:'twitter',sourceLabel:'X',createdAt:'2026-10-12T12:00:00Z',
 sourceUrl:'https://x.com/Real_Creator/status/123456789',author:{name:'Creator Display Name',avatarUrl:'/audit-avatar.svg',profileUrl:'https://x.com/Real_Creator'}};
const cases=[
 ['canonical',base,{to:'/people/incorrect-local-profile'}],
 ['derived',{...base,id:'twitter_987654321',sourceUrl:'https://twitter.com/LegacyMaker/status/987654321',author:{...base.author,profileUrl:undefined}},{}],
 ['no-photo',{...base,author:{...base.author,avatarUrl:null}},{}],
 ['invalid',{...base,sourceUrl:'https://example.invalid/Real_Creator/status/123456789',author:{...base.author,profileUrl:'https://example.invalid/Real_Creator'}},{}],
 ['mastodon',{...base,id:'mastodon_123',source:'mastodon',sourceUrl:'https://social.example/@maker/123',author:{...base.author,profileUrl:'https://social.example/@maker'}},{}],
 ['member',{...base,id:'native_123',source:'uficonnect',author:{...base.author,id:'member-123',title:'Engineer',organization:'Example',profileUrl:null}}, {member:true,to:'/people/member-123'}],
];
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(AuthProvider,null,
 React.createElement('main',{style:{maxWidth:720,margin:'0 auto',padding:12}},cases.map(([name,post,props])=>React.createElement('section',{'aria-label':name,key:name,style:{padding:'18px 0'}},React.createElement(PostHeader,{post,...props})))))));`;
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/audit-vite-x-identity'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(''), 'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify('') },
  plugins: [{ name: 'x-identity-fixture',
    resolveId(id) { if (id === 'virtual:x-identity-audit.jsx') return '\0virtual:x-identity-audit.jsx'; },
    load(id) { if (id === '\0virtual:x-identity-audit.jsx') return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (new URL(req.url, 'http://fixture.invalid').pathname !== '/') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:x-identity-audit.jsx"></script></body></html>'));
    }); },
  }], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
const report = { checkedAt: new Date().toISOString(), fixturesOnly: true, checks: 0, results: [] };
const check = (value, message) => { assert.ok(value, message); report.checks++; };
let browser;
try {
  await fs.mkdir(output, { recursive: true }); await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(); const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) {
        if (request.resourceType() === 'image' && ['cdn.simpleicons.org', 'www.google.com'].includes(url.hostname)) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>' });
        external.push(url.href); return route.abort();
      }
      if (url.pathname === '/audit-avatar.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#247ac7"/></svg>' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: url.pathname === '/api/auth/session' ? 401 : 200, json: {} });
      return route.continue();
    });
    await page.goto(origin);
    const canonical = page.getByRole('region', { name: 'canonical', exact: true });
    await canonical.getByText('@Real_Creator', { exact: true }).waitFor();
    for (const [name, profile, handle, original] of [
      ['canonical', 'https://x.com/Real_Creator', '@Real_Creator', 'https://x.com/Real_Creator/status/123456789'],
      ['derived', 'https://twitter.com/LegacyMaker', '@LegacyMaker', 'https://twitter.com/LegacyMaker/status/987654321'],
      ['no-photo', 'https://x.com/Real_Creator', '@Real_Creator', 'https://x.com/Real_Creator/status/123456789'],
    ]) {
      const region = page.getByRole('region', { name, exact: true });
      check(await region.locator('a.post-chrome-avatar').getAttribute('href') === profile, `${name}: avatar opens the actual X profile`);
      check(await region.locator('a.post-chrome-identity').getAttribute('href') === profile, `${name}: display name and handle open the actual X profile`);
      check(await region.locator('.post-chrome-name').innerText() === 'Creator Display Name' && await region.locator('.post-chrome-handle').innerText() === handle, `${name}: original display name and @username remain visible`);
      check(await region.locator('a.post-chrome-time').getAttribute('href') === original, `${name}: original timestamp opens the original X post`);
      check((await region.locator('a.post-chrome-time').getAttribute('aria-label')).includes('Open post on X'), `${name}: timestamp link has an accessible source label`);
      check(await region.locator('button.post-chrome-avatar-button').count() === 0, `${name}: avatar does not open a duplicate photo viewer`);
    }
    const invalid = page.getByRole('region', { name: 'invalid', exact: true });
    check(!(await invalid.locator('.post-chrome-handle').innerText()).startsWith('@'), 'Unrelated profile URLs do not invent a verified X handle');
    check((await invalid.locator('.post-chrome-time').getAttribute('href')).startsWith('/p/'), 'Unrelated source URLs do not become original X timestamp links');
    const mastodon = page.getByRole('region', { name: 'mastodon', exact: true });
    check(await mastodon.locator('.post-chrome-time').getAttribute('href') === 'https://social.example/@maker/123', 'Mastodon keeps its original timestamp link');
    await mastodon.getByRole('button', { name: "View Creator Display Name's profile photo", exact: true }).click();
    await page.getByRole('dialog', { name: "Creator Display Name's profile photo", exact: true }).waitFor();
    check(await page.getByRole('dialog').getByRole('link', { name: 'Go to profile', exact: true }).getAttribute('href') === 'https://social.example/@maker', 'Other source photo viewers retain their profile destination');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const member = page.getByRole('region', { name: 'member', exact: true });
    check(await member.locator('.post-chrome-identity').getAttribute('href') === '/people/member-123' && (await member.locator('.post-chrome-handle').innerText()).includes('Engineer'), 'Member identity links and professional details are unchanged');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Headers fit the viewport');
    check(errors.length === 0 && external.length === 0, `No browser exceptions or external requests: ${JSON.stringify({ errors, external })}`);
    await page.screenshot({ path: path.join(output, `x-identity-${width}.png`) });
    report.results.push({ width, passed: true, errors, external }); await context.close();
  }
  report.passed = true; console.log(`PASS ${report.checks} X identity and existing source/member checks`);
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); await server.close();
}
