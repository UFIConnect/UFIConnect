// Exercise real account controls using synthetic readiness and click handlers.
// This audit never signs in, calls OAuth, or allows external network access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-configured-connections');
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import AccountConnectionAction from '/src/components/AccountConnectionAction.jsx';
import '/src/index.css';
window.__connectionCalls=[];
const cases=[
  ['github',{name:'GitHub',configured:true,locked:true,canStartAuthorization:true},{}],
  ['youtube',{name:'YouTube',configured:true,locked:true},{isConnected:true}],
  ['gitlab',{name:'GitLab',configured:true},{connecting:true}],
  ['twitter',{name:'X',configured:false},{}],
  ['twitch',{name:'Twitch',configured:true,canStartAuthorization:false},{}],
  ['dribbble',{name:'Dribbble',configured:true,authorizationAvailable:false,approvalRequired:true,authorizationReason:'Provider permission is required.'},{}],
  ['indeed',{name:'Indeed',configured:true,connectionMode:'external'},{}],
  ['figma',{name:'Figma',configured:true},{onConnect:undefined}],
  ['discord',{name:'Discord',configured:true,connectionMode:'api-key'},{onConnect:undefined}],
  ['devto',{name:'DEV Community',configured:true,connectionMode:'api-key'},{onConnect:undefined}]
];
function Fixture(){return React.createElement('main',{style:{maxWidth:900,margin:'24px auto',padding:12}},
  React.createElement('h1',null,'Configured account connections'),
  React.createElement('p',null,'Synthetic connection controls. No accounts are accessed.'),
  ...cases.map(([key,platform,props])=>React.createElement('section',{key,'data-source':key,className:'card account-platform-card',style:{marginTop:12}},
    React.createElement('div',{className:'account-platform-card-header'},
      React.createElement('strong',null,platform.name),
      React.createElement('div',{className:'account-platform-card-actions'},React.createElement(AccountConnectionAction,{
        platformKey:key,platform,onConnect:()=>window.__connectionCalls.push(key),...props
      }))))));}
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(AuthProvider,null,React.createElement(Fixture))));`;

const results = [];
let checks = 0;
const check = (condition, description) => { assert.ok(condition, description); checks++; };
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
try {
  for (const [name, source] of [['release', root]]) {
    const server = await createServer({
      root: path.join(source, 'web'), configFile: path.join(source, 'web/vite.config.js'), envDir: false,
      define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api'),
        'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(''), 'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify('') },
      plugins: [{
        name: 'configured-connections-audit',
        resolveId(id) { if (id === 'virtual:configured-connections-audit.jsx') return '\0virtual:configured-connections-audit.jsx'; },
        load(id) { if (id === '\0virtual:configured-connections-audit.jsx') return fixture; },
        configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
          if (new URL(req.url, 'http://fixture.invalid').pathname !== '/') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Configured connections audit</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:configured-connections-audit.jsx"></script></body></html>'));
        }); },
      }],
      server: { host: '127.0.0.1', port: 5283, strictPort: false },
    });
    try {
      await server.listen();
      const base = server.resolvedUrls.local[0];
      for (const width of [1440, 390, 320]) {
        const context = await browser.newContext({ viewport: { width, height: 1050 }, serviceWorkers: 'block' });
        const page = await context.newPage();
        const errors = [], external = [], apiCalls = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== new URL(base).origin) { external.push({ url: url.href, type: route.request().resourceType() }); return route.fulfill({ status: 403, body: 'External access blocked by audit.' }); }
          if (url.pathname.startsWith('/api/')) { apiCalls.push({ method: route.request().method(), path: url.pathname }); return route.fulfill({ status: 200, json: {} }); }
          return route.continue();
        });
        try {
          await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
          const section = key => page.locator(`[data-source="${key}"]`);
          const connect = section('github').getByRole('button', { name: /^Connect GitHub/ });
          check(await connect.isEnabled(), `${name}/${width}: configured account ignores legacy membership lock`);
          check((await connect.innerText()).includes('Connect'), `${name}/${width}: Connect is visible`);
          await connect.click();
          const reconnect = section('youtube').getByRole('button', { name: /^Reconnect YouTube/ });
          check(await reconnect.isEnabled() && (await reconnect.innerText()).includes('Reconnect'), `${name}/${width}: connected account exposes Reconnect`);
          await reconnect.click();
          check(JSON.stringify(await page.evaluate(() => window.__connectionCalls)) === JSON.stringify(['github', 'youtube']), `${name}/${width}: eligible controls invoke their real click handlers`);
          const busy = section('gitlab').getByRole('button', { name: /^Connecting/ });
          check(await busy.isDisabled() && await busy.getAttribute('aria-busy') === 'true', `${name}/${width}: pending connection blocks duplicate activation`);
          for (const key of ['gitlab', 'twitter', 'twitch', 'dribbble', 'figma', 'discord']) {
            const button = section(key).getByRole('button');
            check(await button.isDisabled(), `${name}/${width}: ${key} remains disabled`);
            await button.evaluate(element => element.click());
          }
          check(JSON.stringify(await page.evaluate(() => window.__connectionCalls)) === JSON.stringify(['github', 'youtube']), `${name}/${width}: unavailable controls never invoke authorization`);
          check((await section('dribbble').getByRole('button').getAttribute('title')).includes('Locked'), `${name}/${width}: provider denial remains explained`);
          check(await section('indeed').getByRole('button').isDisabled(), `${name}/${width}: website-only service cannot authorize an account`);
          const site = section('indeed').getByRole('link', { name: 'Visit Indeed website', exact: true });
          check(await site.isVisible() && await site.getAttribute('href') === 'https://www.indeed.com/', `${name}/${width}: official website action is available`);
          const keyConnect = section('devto').getByRole('button', { name: 'Connect DEV Community with an API key', exact: true });
          check(await keyConnect.isEnabled(), `${name}/${width}: implemented API-key setup is actionable without an OAuth handler`);
          await keyConnect.click();
          const keyDialog = page.getByRole('dialog', { name: 'Connect DEV Community', exact: true });
          check(await keyDialog.isVisible(), `${name}/${width}: API-key connection opens its existing dialog`);
          check(await keyDialog.getByLabel('DEV API key', { exact: true }).getAttribute('type') === 'password', `${name}/${width}: API key remains masked`);
          check(await keyDialog.getByRole('button', { name: 'Connect account', exact: true }).isDisabled(), `${name}/${width}: empty API keys cannot submit`);
          await keyDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
          check(await keyDialog.count() === 0 && !apiCalls.some(call => call.method === 'POST'), `${name}/${width}: cancelling key setup writes no credentials`);
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}/${width}: controls do not overflow viewport`);
          check(errors.length === 0, `${name}/${width}: no runtime errors: ${errors.join('; ')}`);
          check(external.every(request => request.type === 'image'), `${name}/${width}: only remote icons were blocked, with no provider navigation or external API requests`);
          const screenshot = `${name}-${width}.png`;
          await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
          results.push({ source: name, width, runtimeErrors: errors, blockedRemoteIcons: external.length, externalNetworkRequests: 0, screenshot });
        } finally { await context.close(); }
      }
    } finally { await server.close(); }
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, results }, null, 2) + '\n');
  console.log(`PASS: ${checks} configured connection checks against release at 1440, 390 and 320 pixels.`);
} finally { await browser.close(); }
