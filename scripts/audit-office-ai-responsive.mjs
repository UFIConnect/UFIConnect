import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(workspace, 'office');
const directory = path.join(workspace, '.cache/office-ai-responsive');
const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
await fs.mkdir(directory, { recursive: true });
const report = { checks: [], viewports: [], errors: [], requests: [] };
const now = () => new Date().toISOString();
let detailRequests = 0, chatCalls = 0, taskCreates = 0, cancels = 0;
const active = {
  id: 'responsive-active', status: 'running',
  message: 'Improve messaging navigation and discover groups in the public website',
  summary: 'Reviewing the website and checking the responsive navigation before saving the changes.',
  createdAt: now(), updatedAt: now(),
  route: { target: 'public-web', reason: 'The current request refers to the public website.' },
  memoryState: { status: 'retrieved', entries: [{ id: 'memory-responsive', title: 'Website layout preference', kind: 'execution', status: 'recorded', referenceId: 'previous-receipt', createdAt: now() }] },
  limits: { modelTurns: 128, toolCalls: 512 }, progress: { modelTurns: 12, toolCalls: 10 },
  plan: { steps: Array.from({ length: 14 }, (_, i) => ({ id: `plan-${i}`, title: `Step ${i + 1}: Review layout and navigation behavior for narrow screens and keyboard users`, status: i < 2 ? 'completed' : i === 2 ? 'in_progress' : 'pending' })) },
  events: Array.from({ length: 20 }, (_, i) => ({ id: `event-${i}`, kind: 'inspection', status: 'succeeded', label: `Inspection ${i + 1}`, detail: 'Read the relevant interface files and checked layout behavior. '.repeat(3), at: now() })),
  changedFiles: [{ path: 'web/src/components/NavigationWithAVeryLongUnbrokenFileNameForResponsiveOverflowChecks.jsx', status: 'modified', diff: '+ const responsiveNavigation = true;' }],
};
const previous = { id: 'responsive-previous', status: 'succeeded', message: 'Previous completed website layout task', summary: 'Completed website navigation review.', createdAt: now(), events: [] };
const capabilities = { deploymentApprovalRequired: true, editCode: true, publish: true, deploy: true, operate: true, deployTargets: ['api', 'office'], limits: active.limits };
const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#1c1a2a;color:#e8eef8;font-family:Arial,sans-serif}#root{max-width:1500px;margin:auto}@media(max-width:600px){body{padding:10px}}</style></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import '/src/OfficeAI.css';import OfficeAITasks from '/src/OfficeAITasks.jsx';createRoot(document.getElementById('root')).render(React.createElement('main',{className:'office-ai','data-settings-open':'false'},React.createElement(OfficeAITasks,{apiBase:'/mock',request:fetch})));</script></body></html>`;
async function mock(route) {
  const req = route.request(), pathname = new URL(req.url()).pathname.replace('/mock', ''), method = req.method();
  report.requests.push({ pathname, method });
  const reply = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  if (pathname === '/office/ai/tasks' && method === 'GET') return reply({ tasks: [active, previous], capabilities });
  if (pathname === '/office/ai/tasks' && method === 'POST') { taskCreates++; return reply({ task: active }); }
  if (pathname === '/office/ai/tasks/responsive-active' && method === 'GET') { detailRequests++; return reply({ task: active }); }
  if (pathname === '/office/ai/tasks/responsive-previous' && method === 'GET') return reply({ task: previous });
  if (pathname === '/office/ai/tasks/responsive-active/cancel') { cancels++; active.status = 'cancelled'; active.summary = 'Stopped the synthetic responsive task.'; return reply({ task: active }); }
  if (pathname === '/office/ai/chat') { chatCalls++; return reply({ reply: 'The task is still running. You can review the recent work while it continues.', research: { status: 'off' } }); }
  throw Error(`Unexpected request ${method} ${pathname}`);
}

let server, browser, page;
try {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), cacheDir: path.join(workspace, '.cache/responsive-vite'), envDir: false, server: { host: '127.0.0.1', port: 0, strictPort: false }, plugins: [{ name: 'responsive-task-harness', configureServer(dev) { dev.middlewares.use('/__responsive_tasks', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await dev.transformIndexHtml('/__responsive_tasks', harness)); }); } }] });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/mock/**', mock);
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__responsive_tasks`;
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 872, height: 787 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.goto(url);
    const transcript = page.getByRole('log', { name: 'Task agent conversation', exact: true });
    await transcript.getByRole('heading', { name: active.message, exact: true }).waitFor();
    const prompt = page.getByRole('textbox', { name: 'Task instructions', exact: true });
    await prompt.waitFor();
    // Open the long receipts in-place to exercise the actual nested content.
    await transcript.getByText('View work & receipts', { exact: true }).evaluate(el => { el.parentElement.open = true; });
    const dimensions = await page.evaluate(() => {
      const log = document.querySelector('.office-ai-task-workspace .office-ai-transcript');
      const composer = document.querySelector('.office-ai-task-workspace .office-ai-composer');
      const textarea = composer.querySelector('textarea');
      const logBox = log.getBoundingClientRect(), composerBox = composer.getBoundingClientRect();
      const body = document.querySelector('.office-ai-task-detail > .office-ai-markdown');
      return { pageWidth: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth, transcriptHeight: logBox.height, transcriptScrollHeight: log.scrollHeight, composerTop: composerBox.top, transcriptBottom: logBox.bottom, composerHeight: composerBox.height, editorFont: parseFloat(getComputedStyle(textarea).fontSize), detailFont: parseFloat(getComputedStyle(body).fontSize) };
    });
    assert.ok(dimensions.documentWidth <= dimensions.pageWidth + 1, `No horizontal overflow at ${viewport.width}: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.composerTop >= dimensions.transcriptBottom - 1, `Composer stays below transcript at ${viewport.width}`);
    assert.ok(dimensions.transcriptHeight >= 200, `Readable transcript height at ${viewport.width}`);
    assert.ok(dimensions.transcriptScrollHeight > dimensions.transcriptHeight, `Long work remains scrollable at ${viewport.width}`);
    assert.ok(dimensions.editorFont >= 16, `Editor text at least 16px at ${viewport.width}`);
    assert.ok(dimensions.detailFont >= 14, `Readable task body at ${viewport.width}`);
    for (const label of ['Work settings', 'Recent tasks']) {
      const control = page.getByRole('button', { name: label, exact: true });
      await control.waitFor();
      const box = await control.boundingBox();
      assert.ok(box.height >= 44, `${label} touch target at ${viewport.width}`);
      await control.click();
      const context = page.locator('.office-ai-task-workspace .office-ai-context');
      assert.ok(await context.isVisible(), `${label} context can be reached at ${viewport.width}`);
      if (label === 'Work settings') await page.getByRole('combobox', { name: 'Request destination', exact: true }).waitFor();
      else await context.getByRole('button', { name: /Previous completed website layout task/ }).waitFor();
      await control.click();
    }
    await transcript.evaluate(el => { el.scrollTop = 0; });
    const beforePoll = detailRequests;
    await page.waitForFunction(() => document.querySelector('.office-ai-transcript').scrollTop < 2);
    await page.waitForTimeout(3300);
    assert.ok(detailRequests > beforePoll, 'Task polled during reading');
    assert.ok(await transcript.evaluate(el => el.scrollTop < 2), `Polling preserves reading position at ${viewport.width}`);
    const latest = page.getByRole('button', { name: 'Latest updates', exact: true });
    await latest.click();
    await page.waitForFunction(() => { const el = document.querySelector('.office-ai-transcript'); return el.scrollTop + el.clientHeight >= el.scrollHeight - 3; });
    await transcript.evaluate(el => { el.scrollTop = 0; });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(directory, `task-agent-${viewport.width}x${viewport.height}.png`), fullPage: true });
    report.viewports.push({ ...viewport, ...dimensions });
    report.checks.push(`${viewport.width}x${viewport.height}: no overflow/overlap, readable text, scrolling, reachable settings/history, polling keeps reading position`);
  }
  for (const scenario of ['narrow-desktop-panel', 'desktop-200-percent-zoom']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    const transcript = page.getByRole('log', { name: 'Task agent conversation', exact: true });
    await transcript.getByRole('heading', { name: active.message, exact: true }).waitFor();
    await page.evaluate(name => {
      if (name === 'narrow-desktop-panel') document.querySelector('#root').style.width = '390px';
      else document.body.style.zoom = '2';
    }, scenario);
    await page.getByRole('button', { name: 'Work settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Request destination', exact: true }).waitFor();
    const dimensions = await page.evaluate(() => {
      const context = document.querySelector('.office-ai-task-workspace .office-ai-context').getBoundingClientRect();
      const chat = document.querySelector('.office-ai-task-workspace .office-ai-chat').getBoundingClientRect();
      const composer = document.querySelector('.office-ai-task-workspace .office-ai-composer').getBoundingClientRect();
      const transcript = document.querySelector('.office-ai-task-workspace .office-ai-transcript').getBoundingClientRect();
      return { documentWidth: document.documentElement.scrollWidth, pageWidth: document.documentElement.clientWidth, contextBottom: context.bottom, chatTop: chat.top, composerTop: composer.top, transcriptBottom: transcript.bottom };
    });
    assert.ok(dimensions.documentWidth <= dimensions.pageWidth + 1, `${scenario} has no page overflow`);
    assert.ok(dimensions.contextBottom <= dimensions.chatTop + 1, `${scenario} uses the narrow container layout`);
    assert.ok(dimensions.composerTop >= dimensions.transcriptBottom - 1, `${scenario} keeps composer below transcript`);
    await page.getByRole('button', { name: 'Work settings', exact: true }).click();
    await page.getByRole('button', { name: 'Latest updates', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.ok(await transcript.evaluate(el => document.activeElement === el), `${scenario} allows keyboard focus into transcript`);
    assert.notEqual(await transcript.evaluate(el => getComputedStyle(el).outlineStyle), 'none', `${scenario} exposes keyboard focus`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(directory, `${scenario}.png`), fullPage: true });
    report.checks.push(`${scenario}: container layout, no overflow/overlap, visible transcript keyboard focus`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.getByRole('button', { name: 'Stop task', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('textbox', { name: 'Task instructions', exact: true }).fill('What is happening with this task?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('The task is still running. You can review the recent work while it continues.', { exact: true }).waitFor();
  assert.equal(chatCalls, 1); assert.equal(taskCreates, 0);
  report.checks.push('Ask can discuss the active task without creating another run');
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await page.getByText('Stopped the synthetic responsive task.', { exact: true }).first().waitFor();
  assert.equal(cancels, 1);
  report.checks.push('Stop task retains its cancellation behavior');
  assert.deepEqual(report.errors, []);
  report.checks.push('No browser page errors');
  await fs.writeFile(path.join(directory, 'responsive-audit.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.rm(path.join(directory, 'responsive-failure.png'), { force: true });
  console.log(JSON.stringify({ checks: report.checks, viewports: report.viewports }, null, 2));
} catch (error) {
  report.failure = error.stack || error.message;
  await fs.writeFile(path.join(directory, 'responsive-audit.json'), JSON.stringify(report, null, 2) + '\n');
  await page?.screenshot({ path: path.join(directory, 'responsive-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
