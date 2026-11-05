import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { API_KEY_SCOPES, API_KEY_TYPES, API_KEY_RATE_LIMIT, API_KEY_GENERATION_LIMITS } = require('../backend/api-keys.js');
const output = path.join(root, '.cache/audit-ui');
const API = 'https://api-keys.invalid';
const ownerId = '11111111-1111-4111-8111-111111111111';
const fixtureId = path.join(root, 'office', '__api-keys-fixture.jsx').replaceAll('\\', '/');
const fixture = `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import OfficeApiKeys from '/src/OfficeApiKeys.jsx';
import OfficeNavigation from '/src/OfficeNavigation.jsx';
const request=(...args)=>fetch(...args);
function Fixture(){const[view,setView]=useState('api-keys');return <><OfficeNavigation view={view} onNavigate={id=>{setView(id);return true}}/><main>{view==='api-keys'?<OfficeApiKeys apiBase=${JSON.stringify(API)} request={request}/>:<h2>Overview fixture</h2>}</main></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#080d18;color:#dce6f5;font:14px Arial,sans-serif}#root{padding:20px;box-sizing:border-box;max-width:1440px;margin:auto}main{margin-top:24px;min-width:0}@media(max-width:600px){#root{padding:12px}}</style></head><body><div id="root"></div><script type="module" src="/__api-keys-fixture.jsx"></script></body></html>';
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/api-keys-vite'), optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(API) },
  plugins: [{ name: 'api-keys-browser-fixture', resolveId(id) { if (id === '/__api-keys-fixture.jsx' || id.replaceAll('\\', '/').replace(/^\/@fs\//, '') === fixtureId) return fixtureId; },
    load(id) { if (id === fixtureId) return fixture; }, configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/__api-keys-fixture') return next();
        res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html));
      });
    } }], server: { host: '127.0.0.1', port: 0, strictPort: false },
});
const receipts = [];
let browser;
async function waitFor(check) {
  const until = Date.now() + 12000;
  while (!check()) { if (Date.now() > until) throw Error('Fixture request was not received'); await new Promise(resolve => setTimeout(resolve, 25)); }
}
async function mockAPI(context, actualApp = false) {
  const state = { keys: [], writes: [], pending: null, delayCreate: false, failList: false, failCreate: false, searches: [] };
  await context.route(`${API}/**`, async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-office-token,accept', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Cache-Control': 'no-store' };
    const reply = (json, status = 200) => route.fulfill({ status, headers, json });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (actualApp && request.headers()['x-office-token'] !== 'api-key-fixture-office') return reply({ error: 'Unauthorized' }, 401);
    if (url.pathname === '/office/api-keys' && method === 'GET') {
      if (state.failList) { state.failList = false; return reply({ error: 'API key storage is temporarily unavailable.' }, 503); }
      return reply({ keys: state.keys, scopes: API_KEY_SCOPES, types: API_KEY_TYPES, rateLimit: API_KEY_RATE_LIMIT, generationLimits: API_KEY_GENERATION_LIMITS, apiBasePath: '/api/v1' });
    }
    if (url.pathname === '/office/users' && method === 'GET') {
      state.searches.push(Object.fromEntries(url.searchParams));
      return reply({ available: true, recent: [{ id: ownerId, name: 'Example Member', email: 'member@example.test' }], pagination: { total: 1, pages: 1 } });
    }
    if (url.pathname === '/office/api-keys' && method === 'POST') {
      const body = request.postDataJSON(); state.writes.push({ method, body });
      if (state.failCreate) { state.failCreate = false; return reply({ error: 'This example key could not be created. Try again.' }, 503); }
      const now = new Date();
      const apiKey = { id: randomUUID(), name: body.name, type: body.type, ownerId: body.ownerId || null, prefix: `ufi_live_demo_${state.writes.length}`, scopes: body.scopes,
        createdAt: now.toISOString(), expiresAt: body.expiresInDays === null ? null : new Date(+now + body.expiresInDays * 86400000).toISOString(), lastUsedAt: null, revokedAt: null, status: 'active' };
      const key = `ufi_live_browser_fixture_${apiKey.id}`;
      const complete = async () => { state.keys.unshift(apiKey); try { await reply({ key, apiKey }, 201); } catch { /* The component may have aborted this fixture request. */ } };
      if (state.delayCreate) {
        state.delayCreate = false;
        await new Promise(resolve => { state.pending = { release: async () => { await complete(); state.pending = null; resolve(); } }; });
        return;
      }
      return complete();
    }
    if (url.pathname.startsWith('/office/api-keys/') && method === 'DELETE') {
      state.writes.push({ method, id: url.pathname.split('/').at(-1) });
      const key = state.keys.find(item => item.id === state.writes.at(-1).id);
      assert.ok(key); key.status = 'revoked'; key.revokedAt = new Date().toISOString(); return reply({ apiKey: key });
    }
    return reply({ error: 'Unrelated Office service unavailable in isolated browser test.' }, 503);
  });
  return state;
}
try {
  await server.listen(); await fs.mkdir(output, { recursive: true }); browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('Fixture clipboard denied'); } } }));
    const state = await mockAPI(context), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
    await page.goto(server.resolvedUrls.local[0] + '__api-keys-fixture', { waitUntil: 'domcontentloaded' });
    const keyType = type => page.locator(`input[name="api-key-type"][value="${type}"]`);
    const scope = id => page.getByRole('checkbox', { name: new RegExp('^' + API_KEY_SCOPES.find(item => item.id === id).label) });
    const generate = page.getByRole('button', { name: 'Generate API key', exact: true });
    const secret = page.getByRole('textbox', { name: 'New API key', exact: true });
    const dismiss = async () => { await page.getByRole('button', { name: 'I saved my key', exact: true }).click(); assert.equal(await secret.count(), 0); };
    await page.getByRole('heading', { name: 'No API keys yet', exact: true }).waitFor().catch(async error => { console.error({ initialPage: await page.locator('body').innerText(), errors }); throw error; });
    assert.equal(await page.getByRole('radio').count(), 4); assert.equal(await keyType('data').isChecked(), true);
    assert.equal((await page.locator('.oak-guide pre').innerText()).includes(API + '/api/v1/topics'), true, 'Quickstart requests use the configured API host');
    for (const id of ['topics:read', 'feed:read']) assert.equal(await scope(id).isChecked(), true);
    for (const id of ['posts:publish', 'posts:edit']) assert.equal(await scope(id).isChecked(), false);
    await page.getByLabel('Key name', { exact: true }).fill('Platform integration');
    await scope('posts:edit').check(); assert.equal(await generate.isDisabled(), true);
    await page.getByLabel('Find a member', { exact: true }).fill('Example'); await page.getByRole('button', { name: 'Search accounts', exact: true }).click();
    await page.getByLabel('Publish as', { exact: true }).selectOption(ownerId).catch(async error => { console.error({ searches: state.searches, ownerPanel: await page.locator('.oak-owner').innerText(), errors }); throw error; });
    assert.equal(await generate.isDisabled(), true, 'Editing-only keys cannot generate even after the publishing member is selected');
    await page.getByText('Enable Publish posts so this key can create the posts it edits.', { exact: true }).waitFor();
    await scope('posts:publish').check(); assert.equal(await generate.isEnabled(), true);
    assert.deepEqual(state.searches.at(-1), { q: 'Example', state: 'all', days: 'all', page: '1' });
    await page.getByLabel('Find a member', { exact: true }).fill('Another member');
    assert.equal(await generate.isDisabled(), true, 'Changing the member query clears the previously selected publishing account');
    assert.equal(await page.getByLabel('Publish as', { exact: true }).count(), 0, 'Old member results are removed as soon as the query changes');
    await page.getByRole('button', { name: 'Search accounts', exact: true }).click();
    await page.getByLabel('Publish as', { exact: true }).selectOption(ownerId); assert.equal(await generate.isEnabled(), true);
    await page.getByLabel('Example request', { exact: true }).selectOption('publish'); assert.match(await page.locator('.oak-guide pre').innerText(), /REQUEST_UUID/);
    await page.getByLabel('Example request', { exact: true }).selectOption('edit'); assert.match(await page.locator('.oak-guide pre').innerText(), /expectedVersion/);
    await generate.click(); await secret.waitFor();
    assert.deepEqual(state.writes.at(-1).body, { type: 'data', name: 'Platform integration', scopes: ['topics:read', 'feed:read', 'posts:edit', 'posts:publish'], ownerId, expiresInDays: 30 });
    const value = await secret.inputValue(); assert.equal(await generate.isDisabled(), true); assert.equal(await keyType('media').isDisabled(), true);
    await page.getByRole('button', { name: 'Copy key', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'could not copy' }).waitFor();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedFixtureKey = value; } } }));
    await page.getByRole('button', { name: 'Copy key', exact: true }).click(); await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__copiedFixtureKey), value);
    assert.equal(await page.evaluate(secretValue => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }).includes(secretValue), value), false);
    assert.equal((await page.locator('.oak-key-list').innerText()).includes(value), false);
    assert.equal((await page.locator('.oak-guide pre').innerText()).includes(value), false);
    await dismiss(); await page.getByRole('button', { name: 'Refresh keys', exact: true }).click(); await page.getByRole('button', { name: 'Revoke Platform integration', exact: true }).waitFor(); assert.equal(await secret.count(), 0);
    const writesBeforeRevoke = state.writes.length;
    await page.getByRole('button', { name: 'Revoke Platform integration', exact: true }).click(); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.equal(state.writes.length, writesBeforeRevoke);
    await page.getByRole('button', { name: 'Revoke Platform integration', exact: true }).click(); await page.getByRole('button', { name: 'Confirm revoke', exact: true }).click(); await page.locator('.oak-status.oak-revoked').waitFor();
    assert.equal(state.writes.at(-1).method, 'DELETE');
    await keyType('ai-chat').check(); assert.equal(await page.getByRole('checkbox').count(), 1); assert.equal(await scope('ai:chat').isChecked(), true);
    await page.getByLabel('Key name', { exact: true }).fill('Chat integration'); await generate.click(); await secret.waitFor();
    assert.deepEqual(state.writes.at(-1).body, { type: 'ai-chat', name: 'Chat integration', scopes: ['ai:chat'], expiresInDays: 30 }); await dismiss();
    await keyType('media').check(); await scope('images:generate').uncheck(); assert.equal(await scope('videos:generate').isChecked(), true);
    assert.equal(await page.getByLabel('Example request', { exact: true }).inputValue(), 'video'); assert.match(await page.locator('.oak-guide pre').innerText(), /"seconds":4/);
    await page.getByLabel('Key name', { exact: true }).fill('Video integration'); await page.getByLabel('Expiration', { exact: true }).selectOption('90'); await generate.click(); await secret.waitFor();
    assert.deepEqual(state.writes.at(-1).body, { type: 'media', name: 'Video integration', scopes: ['videos:generate'], expiresInDays: 90 }); await dismiss();
    await keyType('ai-content').check(); await page.getByLabel('Content format', { exact: true }).selectOption('email'); await page.getByLabel('Tone', { exact: true }).selectOption('professional');
    assert.match(await page.locator('.oak-guide pre').innerText(), /"kind":"email"/); assert.match(await page.locator('.oak-guide pre').innerText(), /"tone":"professional"/);
    assert.match(await page.locator('.oak-create').innerText(), /Daily limit: 100/);
    await page.getByLabel('Key name', { exact: true }).fill('Content integration'); await page.getByLabel('Expiration', { exact: true }).selectOption('never'); await generate.click(); await secret.waitFor();
    assert.deepEqual(state.writes.at(-1).body, { type: 'ai-content', name: 'Content integration', scopes: ['content:generate'], expiresInDays: null }); await dismiss();
    await keyType('data').check(); for (const id of ['posts:publish', 'posts:edit']) assert.equal(await scope(id).isChecked(), false);
    assert.equal(await page.getByLabel('Publish as', { exact: true }).count(), 0);
    state.failCreate = true; await page.getByLabel('Key name', { exact: true }).fill('Retry integration'); await generate.click(); await page.getByRole('alert').filter({ hasText: 'could not be created' }).waitFor(); assert.equal(await secret.count(), 0);
    state.failList = true; await page.getByRole('button', { name: 'Refresh keys', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'storage is temporarily unavailable' }).waitFor();
    await page.getByRole('button', { name: 'Refresh keys', exact: true }).click(); await page.getByRole('button', { name: 'Revoke Content integration', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `office-api-keys-${width}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}: API keys fit viewport`);
    // A late creation response cannot restore a key after switching Office credentials.
    state.delayCreate = true; await generate.click(); await waitFor(() => state.pending); state.keys = [];
    await page.evaluate(() => window.dispatchEvent(new Event('office-token-changed'))); await page.getByRole('heading', { name: 'No API keys yet', exact: true }).waitFor();
    await state.pending.release(); await page.waitForTimeout(100); assert.equal(await secret.count(), 0); assert.equal(await page.getByLabel('Key name', { exact: true }).inputValue(), '');
    // Unmounting and remounting the tab also discards the one-time secret.
    await page.getByLabel('Key name', { exact: true }).fill('Navigation integration'); await generate.click(); await secret.waitFor();
    await page.getByRole('button', { name: 'Overview', exact: true }).click(); await page.getByRole('heading', { name: 'Overview fixture', exact: true }).waitFor();
    await page.getByRole('button', { name: 'API Keys', exact: true }).click(); await page.getByRole('button', { name: 'Revoke Navigation integration', exact: true }).waitFor(); assert.equal(await secret.count(), 0);
    state.delayCreate = true; await page.getByLabel('Key name', { exact: true }).fill('Delayed navigation integration'); await generate.click(); await waitFor(() => state.pending);
    await page.getByRole('button', { name: 'Overview', exact: true }).click(); await state.pending.release(); await page.getByRole('button', { name: 'API Keys', exact: true }).click();
    await page.getByRole('button', { name: 'Revoke Delayed navigation integration', exact: true }).waitFor(); assert.equal(await secret.count(), 0);
    assert.deepEqual(errors, [], `${width}: no browser exceptions`);
    receipts.push({ width, passed: true, createdTypes: [...new Set(state.writes.filter(item => item.method === 'POST').map(item => item.body.type))], checks: ['type-scoped bodies', 'read-only defaults', 'write owner binding', 'option examples', 'expiry', 'copy denial and success', 'one-time display', 'revoke confirmation', 'error recovery', 'no key storage or URL', 'token reset and stale response', 'unmount and stale response', 'responsive layout'] });
    await context.close(); console.log(`API keys ${width}px: categories, scopes, member binding, examples, creation/copy/revoke, failure recovery, lifecycle clearing and layout passed`);
  }
  // Exercise the real App's navigation and Office authentication integration.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await mockAPI(context, true); const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); await page.goto(server.resolvedUrls.local[0] + '#api-keys', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Access token', { exact: true }).fill('api-key-fixture-office'); await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
  await page.getByRole('heading', { name: 'No API keys yet', exact: true }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Office sections' }).getByRole('button', { name: 'API Keys', exact: true }).getAttribute('aria-current'), 'page');
  assert.deepEqual(errors, []); await page.screenshot({ path: path.join(output, 'office-api-keys-app-1440.png') }); await context.close();
  receipts.push({ actualApp: true, passed: true, checks: ['direct #api-keys route', 'Office authentication', 'primary navigation integration'] });
  await fs.writeFile(path.join(output, 'office-api-keys-receipt.json'), JSON.stringify({ fixtureOnly: true, liveProviderWrites: false, receipts }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
