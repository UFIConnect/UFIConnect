import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'office/.cache/pip-clean-layout-fixture.jsx');
const output = path.join(root, '.cache/audit-ui');
const API = 'https://pip-layout.invalid';
const longQuestion = 'What are eighteen useful ways to review my overview?';
const longReply = Array.from({ length: 18 }, (_, index) => `Review step ${index + 1}: Check the latest service observation, compare it with the previous result, and record any action that needs attention. Keep a clear note of the evidence and follow up when the next update arrives.`).join('\n\n');
const sizes = [[360, 740], [390, 844], [546, 737], [1440, 1000], [844, 390]];
await fs.mkdir(path.dirname(fixture), { recursive: true });
await fs.mkdir(output, { recursive: true });
await fs.writeFile(fixture, `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import PipDock from '../src/PipDock.jsx';
import OfficeAI from '../src/OfficeAI.jsx';
const welcome = {id:'synthetic-layout-update', text:'Welcome back. I am Pip. Here are the latest Office updates. API database is connected. The API feed currently has 40564 posts. API is reporting memory critical. Pipeline database is connected. Six sources are degraded and zero are paused. Pipeline is reporting memory pressure. Web health is healthy. App web shell health is healthy. Native installed app health is not monitored by these checks. Counts are based on the most recent service observation.'};
const request = (url, options = {}) => fetch(url, {...options, headers: {...options.headers, 'x-office-token': 'synthetic-layout-token'}});
function Fixture() {
 const [open, setOpen] = useState(true), [workspace, setWorkspace] = useState(false);
 return <main style={{padding:16,maxWidth:1400,margin:'auto'}}><h1>Office overview</h1><p>Review current service activity.</p><PipDock open={open} workspace={workspace} welcomeBriefing={welcome} onOpenChange={value => {setOpen(value); if(!value)setWorkspace(false);}} onOpenWorkspace={() => setWorkspace(true)}><OfficeAI apiBase='${API}' request={request} compact={!workspace} active={open} /></PipDock></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`);

const server = await createServer({
  root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  cacheDir: path.join(root, 'office/.cache/pip-layout-vite'),
  server: { host: '127.0.0.1', port: 5273, strictPort: false, hmr: false },
  plugins: [{ name: 'pip-clean-layout-audit', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url?.split('?')[0] !== '/pip-layout-audit') return next();
      const html = await vite.transformIndexHtml('/pip-layout-audit', '<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#080f1c;color:#e2e8f0;font-family:Arial,sans-serif"><div id="root"></div><script type="module" src="/.cache/pip-clean-layout-fixture.jsx"></script></body></html>');
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  } }],
});

let checks = 0, browser, currentPage;
const report = { checks: 0, sizes: [], screenshots: [] };
const check = (value, message) => { assert.ok(value, message); checks++; };

async function inspect(page, label, width, height) {
  const dimensions = await page.evaluate(() => {
    const shown = element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const panel = document.querySelector('.pip-dock-panel');
    const rect = panel.getBoundingClientRect();
    return {
      compact: Boolean(panel.closest('.pip-dock-floating')),
      pageWidth: document.documentElement.scrollWidth,
      rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
      overflow: [...panel.querySelectorAll('*')].filter(shown).filter(element => {
        const style = getComputedStyle(element);
        return ['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
      }).map(element => element.className),
      nestedScrolls: [...panel.querySelectorAll('.office-ai-transcript,.office-ai-call,.pip-dock-welcome')].filter(shown).filter(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)).map(element => element.className),
    };
  });
  check(dimensions.pageWidth <= width + 1, `${label}: document fits ${width}px (${JSON.stringify(dimensions)})`);
  check(!dimensions.overflow.length, `${label}: no horizontal scrolling (${JSON.stringify(dimensions)})`);
  if (dimensions.compact) check(!dimensions.nestedScrolls.length, `${label}: dock content owns scrolling (${JSON.stringify(dimensions)})`);
  if (label !== 'workspace') check(dimensions.rect.x >= 0 && dimensions.rect.y >= 0 && dimensions.rect.right <= width + 1 && dimensions.rect.bottom <= height + 1, `${label}: panel fits viewport (${JSON.stringify(dimensions)})`);
}

async function setup(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], sent = [], conversations = new Map();
  page.setDefaultTimeout(15000);
  currentPage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    class Recognition {
      start() { queueMicrotask(() => this.onstart?.()); }
      abort() {}
      stop() { this.onend?.(); }
    }
    window.SpeechRecognition = Recognition;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { async getUserMedia() { throw new DOMException('Synthetic denied camera', 'NotAllowedError'); } } });
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== API) {
      if (url.hostname === '127.0.0.1') return route.continue();
      return route.abort('blockedbyclient');
    }
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ headers, status: 204 });
    const body = req.postData() ? req.postDataJSON() : null;
    const reply = json => route.fulfill({ headers, json });
    if (url.pathname === '/office/ai') return reply({ configured: true, provider: 'Cloudflare', model: 'synthetic-layout', voiceConversationAvailable: true });
    if (url.pathname === '/office/ai/tools') return reply({ tools: [] });
    if (url.pathname === '/office/controls') return reply({ controls: [], history: [] });
    if (url.pathname === '/office/connections') return reply({ connections: [] });
    if (url.pathname === '/office/ai/tasks') return reply({ tasks: [], capabilities: { repository: 'synthetic/layout', editCode: true, publish: true, deploy: true, operate: true, deployTargets: [] } });
    if (url.pathname === '/office/ai/conversations') {
      if (req.method() === 'GET') return reply({ conversations: [...conversations.values()] });
      const conversation = { id: body.clientRequestId, ...body, version: 1, updatedAt: new Date().toISOString() };
      conversations.set(conversation.id, conversation); return reply({ conversation });
    }
    if (url.pathname.startsWith('/office/ai/conversations/')) {
      const id = url.pathname.split('/').at(-1);
      const conversation = { ...conversations.get(id), ...body, id, version: 2, updatedAt: new Date().toISOString() };
      conversations.set(id, conversation); return reply({ conversation });
    }
    if (url.pathname === '/office/ai/chat') {
      sent.push(body);
      const response = body.message === longQuestion ? longReply : body.message === 'What should I review next?' ? 'Review your latest results, then choose the next task.' : 'Your overview is ready to review.';
      return reply({ reply: response, research: { status: 'off' }, generatedAt: new Date().toISOString() });
    }
    if (url.pathname === '/office/ai/studio') return reply({ capabilities: { photo: true, video: true, movie: true }, projects: [] });
    if (url.pathname === '/office/ai/studio/projects') return reply({ projects: [] });
    if (url.pathname === '/office/ai/memory') return reply({ entries: [] });
    if (url.pathname === '/office/ai/activity') return reply({ records: [], alerts: [] });
    if (url.pathname === '/office/ai/functions') return reply({ functions: [] });
    if (url.pathname === '/office/ai/terminal') return reply({ sessions: [], capabilities: {} });
    return reply({});
  });
  await page.goto(server.resolvedUrls.local[0] + 'pip-layout-audit', { waitUntil: 'networkidle' });
  await page.locator('.office-ai-primary-nav').waitFor();
  return { page, context, errors, sent };
}

try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of sizes) {
    const { page, context, errors, sent } = await setup(width, height);
    const nav = page.locator('.office-ai-primary-nav');
    await inspect(page, 'initial', width, height);
    check(await nav.getByRole('button').count() === 3, 'Only three primary navigation buttons at ' + width);
    check(!await page.locator('.office-ai-tabs').isVisible(), 'Extra destinations start hidden at ' + width);
    check(!await page.getByLabel('Pip tone', { exact: true }).isVisible(), 'Tone starts tucked into settings at ' + width);
    check(!await page.locator('.pip-dock-launcher').isVisible(), 'Duplicate launcher hidden while open at ' + width);
    const headerTargets = await page.locator('.pip-dock-header button').evaluateAll(elements => elements.map(element => ({ name: element.ariaLabel, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
    check(headerTargets.every(item => item.width >= 44 && item.height >= 44), `Header controls have 44px targets at ${width}: ${JSON.stringify(headerTargets)}`);
    const update = page.locator('details.pip-dock-welcome');
    check(await update.count() === 1 && await update.getAttribute('open') === null, 'Long Office update starts collapsed at ' + width);
    await update.locator('summary').click();
    check(await update.getAttribute('open') !== null, 'Office update can be expanded at ' + width);
    await inspect(page, 'expanded-update', width, height);
    await update.locator('summary').click();
    const screenshot = `pip-clean-${width}x${height}.png`;
    await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
    report.screenshots.push(screenshot);

    await page.getByLabel('Message Pip', { exact: true }).fill('What is a useful next step?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Your overview is ready to review.', { exact: true }).waitFor();
    check(sent.length === 1 && sent[0].message === 'What is a useful next step?', 'Chat sends the requested message at ' + width);
    await inspect(page, 'reply', width, height);

    await page.getByLabel('Message Pip', { exact: true }).fill(longQuestion);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Review step 18:', { exact: false }).waitFor();
    await page.waitForFunction(() => {
      const content = document.querySelector('.pip-dock-content').getBoundingClientRect();
      const form = document.querySelector('.office-ai-composer').getBoundingClientRect();
      return form.y >= content.y - 1 && form.bottom <= content.bottom + 1;
    });
    check(await page.getByRole('button', { name: 'Send', exact: true }).evaluate(element => {
      const button = element.getBoundingClientRect(), content = element.closest('.pip-dock-content').getBoundingClientRect();
      return button.y >= content.y && button.bottom <= content.bottom + 1;
    }), 'Send remains visible after an eighteen-paragraph reply at ' + width);
    check(await page.locator('.office-ai-composer textarea').evaluate(element => {
      const field = element.getBoundingClientRect(), content = element.closest('.pip-dock-content').getBoundingClientRect();
      return field.y >= content.y && field.bottom <= content.bottom + 1;
    }), 'Message field remains visible after a long reply at ' + width);
    await page.getByLabel('Message Pip', { exact: true }).fill('What should I review next?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Review your latest results, then choose the next task.', { exact: true }).waitFor();
    check(sent.length === 3 && sent[2].message === 'What should I review next?', 'A follow-up can be sent after a long reply at ' + width);
    await inspect(page, 'long-reply', width, height);

    await nav.getByRole('button', { name: 'Studio', exact: true }).click();
    await page.getByRole('region', { name: 'Photo and movie studio', exact: true }).waitFor();
    await inspect(page, 'studio', width, height);
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    check(await page.getByText('Your overview is ready to review.', { exact: true }).isVisible(), 'Returning from Studio preserves chat at ' + width);

    for (const [name, regionName] of [['Memory', 'Pip memory'], ['Functions', 'Cloudflare extensions']]) {
      await nav.getByRole('button', { name: 'More', exact: true }).click();
      await page.locator('.office-ai-tabs').getByRole('button', { name, exact: true }).click();
      await page.getByRole('region', { name: regionName, exact: true }).waitFor();
      await inspect(page, name.toLowerCase(), width, height);
      await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    }

    await nav.getByRole('button', { name: 'More', exact: true }).click();
    await page.locator('.office-ai-tabs').waitFor();
    await inspect(page, 'more', width, height);
    await page.keyboard.press('Escape');
    check(!await page.locator('.office-ai-tabs').isVisible(), 'Escape closes More at ' + width);
    check(await nav.getByRole('button', { name: 'More', exact: true }).evaluate(element => element === document.activeElement), 'Escape returns focus to More at ' + width);
    check(await page.locator('.pip-dock-panel').isVisible(), 'Escape in More keeps Pip open at ' + width);
    await nav.getByRole('button', { name: 'More', exact: true }).click();
    await page.locator('.office-ai-tabs').getByRole('button', { name: 'Settings & history', exact: true }).click();
    await page.getByLabel('Pip tone', { exact: true }).selectOption('calm');
    check(await page.getByLabel('Pip tone', { exact: true }).inputValue() === 'calm', 'Tone can be changed from settings at ' + width);
    await inspect(page, 'settings', width, height);

    // Return to Chat before exercising keyboard close/reopen and workspace continuity.
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('button', { name: 'Start voice', exact: true }).click();
    const call = page.locator('.office-ai-call:visible');
    await call.waitFor();
    await call.getByRole('alert').waitFor();
    check(!await call.locator('.office-ai-self-preview').isVisible(), 'Camera-off preview does not obscure the call at ' + width);
    check(await call.getByRole('alert').count() === 1 && await page.locator('.office-ai-sensors > .office-ai-error:visible').count() === 0, 'Call errors are displayed once at ' + width);
    await inspect(page, 'camera-off-call', width, height);
    const callScreenshot = `pip-clean-call-${width}x${height}.png`;
    await page.screenshot({ path: path.join(output, callScreenshot), fullPage: true });
    report.screenshots.push(callScreenshot);
    await call.getByRole('button', { name: 'End call', exact: true }).click();
    await page.getByLabel('Message Pip', { exact: true }).fill('Keep this draft while I resize Pip.');
    await page.getByRole('button', { name: 'Minimize Pip', exact: true }).click();
    const launcher = page.getByRole('button', { name: 'Open Pip', exact: true });
    await launcher.waitFor();
    check(await launcher.evaluate(element => element === document.activeElement), 'Minimizing returns keyboard focus to launcher at ' + width);
    await launcher.click();
    check(await page.getByLabel('Message Pip', { exact: true }).inputValue() === 'Keep this draft while I resize Pip.', 'Closing and reopening preserves draft at ' + width);
    await page.getByRole('button', { name: 'Open Pip workspace', exact: true }).click();
    await page.locator('.pip-dock-workspace').waitFor();
    check(await page.getByLabel('Message Pip', { exact: true }).inputValue() === 'Keep this draft while I resize Pip.', 'Expanding workspace preserves draft at ' + width);
    await inspect(page, 'workspace', width, height);
    check(!errors.length, `No runtime errors at ${width}: ${errors.join('; ')}`);
    report.sizes.push({ width, height });
    await context.close();
    console.log(`Checked clean Pip layout at ${width}x${height}`);
  }
  report.checks = checks;
  await fs.writeFile(path.join(output, 'pip-clean-layout.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: path.join(output, 'pip-clean-layout-failure.png'), fullPage: true }).catch(() => {});
    console.error((await currentPage.locator('body').innerText()).slice(0, 3000));
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
  await fs.rm(fixture, { force: true });
}
