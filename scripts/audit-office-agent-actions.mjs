import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.agent.invalid', PIPELINE = 'https://pipeline.agent.invalid', TOKEN = 'synthetic-agent-actions-token';
const fixturePath = path.join(root, 'office/.cache/agent-actions-fixture.jsx');
await fs.mkdir(path.dirname(fixturePath), { recursive: true });
await fs.writeFile(fixturePath, `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AgentChat from '../src/AgentChat.jsx';
import '../src/LiveCity.css';
function Fixture() {
 const [agent,setAgent]=useState({id:'security',name:'Security',serviceRole:'api'}),[histories,setHistories]=useState({});
 const key=agent.serviceRole+':'+agent.id;
 const request=(url,options={})=>fetch(url,{...options,credentials:'omit',headers:{...options.headers,'x-office-token':'${TOKEN}'}});
 return <main style={{padding:12,maxWidth:800,margin:'auto',background:'#0b1523',color:'#d5e8f6'}}>
 <button onClick={()=>setAgent({id:'security',name:'Security',serviceRole:'api'})}>Security agent</button>
 <button onClick={()=>setAgent({id:'reddit',name:'Reddit',serviceRole:'pipeline'})}>Source agent</button>
 <button onClick={()=>setHistories(h=>({...h,[key]:Array.from({length:70},(_,i)=>({role:i%2?'assistant':'user',mode:'diagnostics',content:'Saved message '+i}))}))}>Seed earlier history</button>
 <AgentChat key={key} agent={agent} officeFetch={request} base={agent.serviceRole==='api'?'${API}':'${PIPELINE}'} apiBase='${API}' pipelineBase='${PIPELINE}' messages={histories[key]||[]} updateMessages={messages=>setHistories(h=>({...h,[key]:messages}))}/>
 </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`, { flag: 'wx' });
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false, server: { host: '127.0.0.1', port: 5232, strictPort: false },
  plugins: [{ name: 'agent-fixture-page', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/agent-actions-audit') return next();
    const html = await vite.transformIndexHtml('/agent-actions-audit', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0b1523"><div id="root"></div><script type="module" src="/.cache/agent-actions-fixture.jsx"></script></body></html>');
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  }); } }],
});
let checks = 0, browser;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const sha = 'a'.repeat(40), commitSha = 'c'.repeat(40), original = '<h1>Welcome to UFIConnect</h1>', next = '<h1>Your connected feed</h1>';
const webAction = { id: 'commit.web-frontend', label: 'Commit public web frontend', description: 'Review and commit a public web file.', target: 'api', input: 'frontend-file', frontendTarget: 'web', impact: 'critical', available: true, requiresConfirmation: true };
const tasks = id => [id === 'reddit'
  ? { id: 'source.refresh.reddit', label: 'Refresh Reddit', description: 'Queue source work on Pipeline.', target: 'pipeline', impact: 'low', available: true, requiresConfirmation: false }
  : { id: 'health.security', label: 'Run security check', description: 'Read authentication configuration.', target: 'both', impact: 'low', available: true, requiresConfirmation: false },
  { id: 'feed.clear-delivery-caches', label: 'Clear delivery caches', description: 'Expire feed cache keys.', target: 'api', impact: 'medium', available: true, requiresConfirmation: true }, webAction];
try {
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  await server.listen(); browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage();
    const requests = [], errors = []; let stale = false, failed = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()); if (![API, PIPELINE].includes(url.origin)) return route.continue();
      const role = url.origin === API ? 'api' : 'pipeline', headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      check(!url.href.includes(TOKEN) && req.headers()['x-office-token'] === TOKEN, 'Office credentials use headers');
      const body = req.postData() ? req.postDataJSON() : null; requests.push({ role, path: url.pathname, body });
      const actions = url.pathname.match(/^\/office\/agents\/(\w+)\/actions$/);
      if (actions) return route.fulfill({ headers, json: { agentId: actions[1], serviceRole: role, actions: tasks(actions[1]).map(action => role === 'pipeline' && action.id === 'commit.web-frontend'
        ? { ...action, available: false, unavailableReason: 'GitHub is configured on API only.' } : action) } });
      const chat = url.pathname.match(/^\/office\/agents\/(\w+)\/chat$/);
      if (chat) { check(body.history.length <= 4, 'Large conversation sends bounded recent context');
        return route.fulfill({ headers, json: { agentId: chat[1], serviceRole: role, mode: 'diagnostics', observedAt: new Date().toISOString(), reply: 'Fixture reply ' + body.message, actions: body.message.startsWith('refresh') ? [tasks(chat[1])[0]] : [], suggestions: [] } }); }
      if (url.pathname === '/office/frontend-files') return route.fulfill({ headers, json: { target: 'web', files: [{ path: 'web/index.html', sha, bytes: 100 }] } });
      if (url.pathname === '/office/frontend-file') return route.fulfill({ headers, json: { target: 'web', path: 'web/index.html', sha, content: original } });
      if (url.pathname.endsWith('/web-draft')) return route.fulfill({ headers, json: { agentId: 'reddit', serviceRole: 'api', filePath: body.filePath, expectedSha: body.expectedSha, original, content: next, summary: 'Improve public homepage heading', edits: [{ find: original, replace: next }] } });
      if (url.pathname.endsWith('/execute')) {
        if (failed) return route.fulfill({ status: 503, headers, json: { error: 'Fixture task failure' } });
        if (body.filePath && stale) return route.fulfill({ status: 409, headers, json: { error: 'This file changed. Reload before saving.' } });
        return route.fulfill({ headers, json: { ok: true, runId: 'fixture-run-42', result: body.filePath ? { commitSha, contentSha: 'd'.repeat(40), filePath: body.filePath } : url.pathname.includes('source.refresh') ? { queuedSources: ['reddit'] } : { checked: 3 } } });
      }
      throw Error('Unexpected fixture route ' + url.pathname);
    });
    await page.goto(server.resolvedUrls.local[0] + 'agent-actions-audit');
    await page.getByRole('button', { name: 'Run task: Run security check', exact: true }).waitFor();
    for (let i = 0; i < 8; i++) { await page.getByLabel('Message this agent', { exact: true }).fill('status ' + i); await page.getByRole('button', { name: 'Send message', exact: true }).click(); await page.getByText('Fixture reply status ' + i, { exact: true }).waitFor(); }
    check(await page.getByText('status 0', { exact: true }).count() === 1, 'Conversation retains messages beyond twelve');
    await page.getByRole('button', { name: 'Seed earlier history', exact: true }).click();
    check(await page.getByRole('button', { name: 'Show earlier messages (20)', exact: true }).count() === 1, 'Earlier messages are paged without being dropped');
    await page.getByRole('button', { name: 'Show earlier messages (20)', exact: true }).click();
    check(await page.getByText('Saved message 0', { exact: true }).count() === 1, 'Seventy retained messages can be read');
    await page.getByRole('button', { name: 'Source agent', exact: true }).click();
    await page.getByLabel('Message this agent', { exact: true }).fill('refresh this source'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('Fixture reply refresh this source', { exact: true }).waitFor();
    check(!requests.some(row => row.path.endsWith('/execute')), 'Typed request does not silently execute');
    await page.getByRole('button', { name: 'Run task: Refresh Reddit', exact: true }).first().click();
    await page.getByText(/Pipeline: Task queued. Run fixture-run-42/).waitFor();
    check(requests.find(row => row.path.includes('source.refresh'))?.role === 'pipeline', 'Source action calls its owning Pipeline service');
    await page.getByRole('button', { name: 'Run task: Clear delivery caches', exact: true }).first().click();
    check(!requests.some(row => row.path.includes('clear-delivery-caches')), 'Cache write waits for task review');
    await page.getByRole('button', { name: 'Confirm and run task', exact: true }).click(); await page.getByText(/API: Control completed. Run fixture-run-42/).waitFor();
    check(requests.find(row => row.path.includes('clear-delivery-caches'))?.body.confirmed === true, 'Reviewed action preserves backend confirmation');
    await page.getByRole('button', { name: 'Security agent', exact: true }).click();
    await page.getByRole('button', { name: 'Show earlier messages (20)', exact: true }).click();
    check(await page.getByText('Saved message 0', { exact: true }).count() === 1, 'Switching agents retains the prior conversation');
    failed = true; await page.getByRole('button', { name: 'Run task: Run security check', exact: true }).click(); await page.getByText(/Fixture task failure/).waitFor(); failed = false;
    check(!await page.getByText(/Control completed. Run fixture-run-42/).count(), 'Failed action does not report success');
    await page.getByRole('button', { name: 'Source agent', exact: true }).click();
    await page.getByRole('button', { name: 'Run task: Commit public web frontend', exact: true }).first().click();
    check(requests.some(row => row.role === 'api' && row.path === '/office/agents/reddit/actions'), 'Pipeline agent checks public web permissions on API');
    await page.getByRole('button', { name: 'Load current file', exact: true }).click();
    await page.getByLabel('Describe the change', { exact: true }).fill('Improve the public homepage heading');
    await page.getByRole('button', { name: 'Prepare web change', exact: true }).click(); await page.getByRole('region', { name: 'Web change preview', exact: true }).waitFor();
    check(requests.find(row => row.path.endsWith('/web-draft'))?.role === 'api', 'Public web drafts use API even from a Pipeline agent');
    check(!requests.some(row => row.body?.filePath && row.path.endsWith('/execute')), 'Preparing a web edit does not commit');
    const preview = page.getByRole('region', { name: 'Web change preview', exact: true });
    check(JSON.stringify(await preview.locator('pre').allTextContents()) === JSON.stringify([original, next]) && await preview.locator('h1').count() === 0, 'Preview renders the exact old and new code as text');
    await page.getByRole('button', { name: 'Review public web commit', exact: true }).click(); stale = true;
    await page.getByRole('button', { name: 'Confirm and commit web change', exact: true }).click(); await page.getByText(/This file changed. Reload/).waitFor();
    check(await page.getByLabel('Proposed file content', { exact: true }).inputValue() === next, 'Stale commit keeps the draft for review');
    stale = false; await page.getByRole('button', { name: 'Confirm and commit web change', exact: true }).click(); await page.getByText('Committed cccccccc. Check deployment status in Office.', { exact: true }).waitFor();
    const commit = requests.filter(row => row.path.endsWith('commit.web-frontend/execute')).at(-1);
    check(commit.role === 'api' && commit.body.confirmed === true && commit.body.expectedSha === sha && commit.body.content === next, 'Commit uses reviewed content, exact revision and audited API control');
    check(await page.getByText(/The release workflow must pass its checks before deployment/).count() === 1, 'Commit result distinguishes committed from deployed');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Agent tasks and web preview fit the viewport');
    check(errors.length === 0, 'No browser errors');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/office-agent-actions-${width}.png`), fullPage: false });
    await context.close(); console.log(`PASS: agent actions, unlimited history and public web editing at ${width}px`);
  }
  console.log(`Office agent actions audit: ${checks} checks passed without provider calls or production writes.`);
} finally { await browser?.close(); await server.close(); await fs.unlink(fixturePath); }
