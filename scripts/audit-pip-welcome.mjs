import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.pip-welcome.invalid', PIPELINE = 'https://pipeline.pip-welcome.invalid';
const output = path.join(root, '../browser-audit');
const fixturePath = path.join(root, 'office/.cache/pip-welcome-fixture.jsx');
await fs.mkdir(path.dirname(fixturePath), { recursive: true });
await fs.mkdir(output, { recursive: true });
await fs.writeFile(fixturePath, `import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '../src/App.jsx';
import OfficeAccessDialog from '../src/OfficeAccessDialog.jsx';
createRoot(document.getElementById('root')).render(<><OfficeAccessDialog/><App/></>);`);

const server = await createServer({
  root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  cacheDir: path.join(root, 'office/.cache/pip-welcome-vite'),
  define: { 'import.meta.env.MODE': JSON.stringify('release-local'), 'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(PIPELINE) },
  server: { host: '127.0.0.1', port: 5283, strictPort: false, hmr: false },
  plugins: [{ name: 'pip-welcome-audit', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/pip-welcome-audit') return next();
    const html = await vite.transformIndexHtml('/pip-welcome-audit', '<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#080f1c;color:#e2e8f0;font-family:Arial,sans-serif"><div id="root"></div><script type="module" src="/.cache/pip-welcome-fixture.jsx"></script></body></html>');
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  }); } }],
});

let browser, currentPage, checks = 0;
const report = { checks: 0, scenarios: [], widths: [] };
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const call = page => page.locator('.office-ai-sensors').getByRole('region', { name: 'Pip', exact: true });
const loginDock = page => page.getByRole('region', { name: 'Pip call', exact: true });
const chatDock = page => page.getByRole('dialog', { name: 'Pip', exact: true });
const fits = locator => locator.evaluate(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1; });

function welcomeFixture(options = {}) {
  const current = Date.now(), generatedAt = new Date(current).toISOString(), asOf = new Date(Math.floor(current / 60000) * 60000).toISOString();
  const from = new Date(current - 86400000).toISOString();
  const windows = Object.fromEntries(['past24h', 'today', 'week'].map(key => [key, { from, to: asOf }]));
  return {
    schemaVersion: 1, generatedAt, asOf, timeZone: 'America/Los_Angeles', windows,
    counts: {
      past24h: { posts: { memberCreated: 19, importedRetained: 37 }, newUsers: 8 },
      today: { posts: { memberCreated: 17, importedRetained: 29 }, newUsers: 6 },
      week: { posts: { memberCreated: 71, importedRetained: 97 }, newUsers: 22 },
    },
    sources: { memberPosts: 'available', importedPosts: 'available', newUsers: 'available' },
    analytics: { available: true, asOf, availableFrom: new Date(current - 8 * 86400000).toISOString(), windows: Object.fromEntries(Object.entries(windows).map(([key, range]) => [key, {
      ...range, complete: !options.partial, availableFrom: options.partial ? new Date(current - 3600000).toISOString() : range.from,
      web: { views: 123, clientErrors: 2 }, mobile: { views: 45, clientErrors: 1 }, views: 168, clientErrors: 3,
    }])) },
    warnings: { available: true, criticalActivityFindings: 4, serverErrors: 2, failedControls: 1, from, to: asOf, scope: 'Recorded critical findings, server errors and failed Office controls', message: 'SYNTHETIC_PRIVATE_STACK_MUST_NOT_BE_SPOKEN' },
    lastActivity: { available: true, scope: 'Shared Office activity', latest: { kind: 'control', label: 'Refresh synthetic feed', status: 'succeeded', at: new Date(current - 3600000).toISOString() }, sources: { memory: 'available', controls: 'available', tasks: 'available' } },
  };
}

async function setup(width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
  const page = await context.newPage(); currentPage = page;
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window.syntheticWelcome = { active: null, spoken: [], aborts: 0, streams: [] };
    class Recognition {
      start() { this.running = true; state.active = this; queueMicrotask(() => this.onstart?.()); }
      abort() { this.running = false; state.aborts++; if (state.active === this) state.active = null; }
      stop() { this.running = false; if (state.active === this) state.active = null; this.onend?.(); }
    }
    window.SpeechRecognition = Recognition;
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    let generation = 0;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() { generation++; },
      speak(utterance) { const current = ++generation; state.spoken.push(utterance.text); queueMicrotask(() => { if (generation !== current) return; utterance.onstart?.(); setTimeout(() => { if (generation === current) utterance.onend?.(); }, 10); }); },
    } });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { async getUserMedia(constraints) {
      if (constraints.audio !== false) throw Error('Camera requested microphone');
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      canvas.getContext('2d').fillRect(0, 0, 320, 240);
      const stream = canvas.captureStream(5); state.streams.push(stream); return stream;
    } } });
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (![API, PIPELINE].includes(url.origin)) return route.continue();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    const reply = (json, status = 200) => route.fulfill({ headers, json, status });
    if (req.method() === 'OPTIONS') return route.fulfill({ headers, status: 204 });
    requests.push({ method: req.method(), path: url.pathname, search: url.search, origin: url.origin });
    if (!req.headers()['x-office-token'] || options.invalidToken) return reply({ error: 'Office access required.' }, 401);
    if (url.pathname === '/office/welcome') return options.unavailable ? reply({ error: 'Metrics unavailable.' }, 503) : reply(welcomeFixture(options));
    if (url.pathname === '/office/status') {
      const lastRun = options.stale ? Date.now() - 86400000 : Date.now();
      return reply({ server: { serviceRole: url.origin === PIPELINE ? 'pipeline' : 'api', db: 'connected', uptime: 3600, version: 'synthetic' },
        agents: {}, workerHealth: {}, sourceGuard: {}, sources: { degraded: 0, paused: 0 },
        websiteOptimizer: { status: 'healthy', lastRun, lastStatus: 200, subAgents: { web_pwa: { status: 'healthy', lastRun, checks: 4, passed: 4 } } },
        feed: { postCount: 345 }, stability: { mode: 'normal' } });
    }
    if (url.pathname === '/office/agents') return reply({ agents: [] });
    if (url.pathname === '/office/ai') return reply({ configured: true, provider: 'Cloudflare', model: '@cf/synthetic/vision', researchAvailable: true, tonesAvailable: true, voiceConversationAvailable: true, officeContextAvailable: true });
    if (url.pathname === '/office/ai/tasks') return reply({ tasks: [], capabilities: {} });
    if (url.pathname === '/office/ai/conversations') return reply({ conversations: [], storage: 'encrypted-database' });
    if (url.pathname === '/office/ai/tools') return reply({ tools: [] });
    if (url.pathname === '/office/connections') return reply({ connections: [] });
    if (url.pathname === '/office/controls') return reply({ controls: [], history: [] });
    return reply({});
  });
  await page.goto(server.resolvedUrls.local[0] + 'pip-welcome-audit#agents', { waitUntil: 'networkidle' });
  await page.getByLabel('Access token', { exact: true }).fill('synthetic-pip-welcome-token');
  await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
  if (!options.invalidToken) {
    await loginDock(page).waitFor();
    await page.waitForFunction(() => !!window.syntheticWelcome.active?.running);
  } else await page.waitForTimeout(700);
  return { context, page, requests, errors };
}

try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390, 320]) {
    const { context, page, requests, errors } = await setup(width);
    const spoken = await page.evaluate(() => window.syntheticWelcome.spoken.join(' '));
    check(/Welcome back/i.test(spoken), 'Pip greets the authenticated user at ' + width);
    check(/24.hour|24 hour/i.test(spoken) && /123/.test(spoken) && /45/.test(spoken), 'Greeting reads measured rolling web and app analytics at ' + width);
    check(/today/i.test(spoken) && /17/.test(spoken) && /6/.test(spoken), 'Greeting includes today posts and new users at ' + width);
    check(/week/i.test(spoken) && /71/.test(spoken) && /22/.test(spoken), 'Greeting includes week posts and new users at ' + width);
    check(/Refresh synthetic feed/i.test(spoken), 'Greeting names the most recent recorded Office action at ' + width);
    check(/2/.test(spoken) && /1/.test(spoken) && /error|warning|failed/i.test(spoken), 'Greeting includes recorded serious issues at ' + width);
    check(/4 critical activity findings/.test(spoken), 'Greeting includes durable critical activity findings at ' + width);
    check(/web.*healthy|website.*healthy/i.test(spoken), 'Greeting includes verified web health at ' + width);
    check(/native.*unavailable|native.*not.*verif|installed.*not.*verif|native.*not monitored/i.test(spoken), 'PWA results do not claim installed native app health at ' + width);
    check((spoken.match(/Welcome back/gi) || []).length === 1, 'Greeting is spoken once at ' + width);
    check(requests.filter(row => row.path === '/office/welcome').length === 1, 'Welcome endpoint is read once per authenticated entry at ' + width);
    check(requests.some(row => row.path === '/office/welcome' && new URLSearchParams(row.search).get('timeZone') === 'America/Los_Angeles'), 'Welcome uses Los Angeles timezone at ' + width);
    check(requests.some(row => row.path === '/office/status' && row.origin === API) && requests.some(row => row.path === '/office/status' && row.origin === PIPELINE), 'Welcome reads both process health snapshots at ' + width);
    check(requests.every(row => row.method === 'GET'), 'Login and greeting make no task or other write requests at ' + width);
    check(new URL(page.url()).hash === '#agents', 'Login greeting preserves Office navigation at ' + width);
    check(await call(page).isVisible() && !await chatDock(page).isVisible(), 'Login opens the call alone at ' + width);
    check(await fits(loginDock(page)) && await fits(call(page)), 'Welcome call fits viewport at ' + width);
    check(!spoken.includes('SYNTHETIC_PRIVATE_STACK'), 'Greeting excludes raw error messages and stack content at ' + width);
    await page.screenshot({ path: path.join(output, 'welcome-' + width + '.png'), fullPage: true });
    await call(page).getByRole('button', { name: 'End call', exact: true }).click();
    await loginDock(page).waitFor({ state: 'hidden' });
    check(!await chatDock(page).isVisible(), 'Ending welcome keeps chat closed at ' + width);
    check(await page.evaluate(() => !window.syntheticWelcome.active && window.syntheticWelcome.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), 'Ending welcome releases microphone and camera at ' + width);
    await page.getByRole('button', { name: 'Open Pip', exact: true }).click();
    await chatDock(page).waitFor();
    check(await page.locator('.pip-dock-welcome').innerText().then(text => /Welcome back/.test(text) && /123/.test(text)), 'Opening Pip retains the readable login briefing at ' + width);
    check(await page.evaluate(() => window.syntheticWelcome.spoken.join(' ')) === spoken, 'Opening text chat never repeats the spoken welcome at ' + width);
    check(requests.every(row => row.method === 'GET'), 'Reading retained welcome starts no task or other writes at ' + width);
    check(errors.length === 0, 'Welcome has no browser errors at ' + width);
    report.widths.push(width); await context.close();
  }
  report.scenarios.push('authenticated-call-only-complete-summary');
  {
    const { context, page, requests, errors } = await setup(390, { unavailable: true });
    const spoken = await page.evaluate(() => window.syntheticWelcome.spoken.join(' '));
    check(/unavailable|could not|not.*verif/i.test(spoken), 'Missing summary is announced as unavailable');
    check(!/no serious warnings|no warnings occurred/i.test(spoken), 'Failed warning read is never announced as a clean day');
    check(!/17|71|123/.test(spoken), 'Failed summary never invents analytics or daily counts');
    check(requests.every(row => row.method === 'GET') && errors.length === 0, 'Unavailable summary stays read-only and error-free');
    await context.close(); report.scenarios.push('summary-unavailable');
  }
  {
    const { context, page, errors } = await setup(390, { stale: true, partial: true });
    const spoken = await page.evaluate(() => window.syntheticWelcome.spoken.join(' '));
    check(/partial|incomplete|coverage|since/i.test(spoken), 'New minute-bucket history is identified as partial');
    check(/stale|out.of.date|not.*verif|could not.*verif/i.test(spoken), 'Stale web and PWA observations are identified');
    check(!/website is healthy|web is healthy/i.test(spoken), 'Stale healthy snapshot never becomes a current health claim');
    check(errors.length === 0, 'Partial history and stale health have no browser errors');
    await context.close(); report.scenarios.push('partial-history-stale-health');
  }
  {
    const { context, page, requests, errors } = await setup(390, { invalidToken: true });
    check(await page.evaluate(() => window.syntheticWelcome.spoken.length === 0), 'Invalid Office token produces no spoken briefing');
    check(!await loginDock(page).isVisible(), 'Invalid Office token never opens a welcome call');
    check(requests.every(row => row.method === 'GET') && errors.length === 0, 'Invalid authentication stays read-only and error-free');
    await context.close(); report.scenarios.push('invalid-token');
  }
  report.checks = checks; await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, passed: true }));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, checks, body: await currentPage.locator('body').innerText().catch(() => ''), spoken: await currentPage.evaluate(() => window.syntheticWelcome?.spoken || []).catch(() => []) }, null, 2));
  }
  throw error;
} finally { await browser?.close(); await server.close(); }
