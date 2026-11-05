import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.office-ai.invalid', PIPELINE = 'https://pipeline.office-ai.invalid';
const fixturePath = path.join(root, 'office/.cache/office-ai-fixture.jsx');
const output = path.join(root, '.cache/audit-ui');
await fs.mkdir(path.dirname(fixturePath), { recursive: true });
await fs.mkdir(output, { recursive: true });
await fs.writeFile(fixturePath, `import React from 'react';
import {createRoot} from 'react-dom/client';
import OfficeAI from '../src/OfficeAI.jsx';
const request=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'x-office-token':'synthetic-office-ai-token'}});
createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:1400,margin:'auto'}}><OfficeAI apiBase='${API}' pipelineBase='${PIPELINE}' request={request} onNavigate={value=>window.fixtureNavigation=value}/></main>);`);
const server = await createServer({
  root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  server: { host: '127.0.0.1', port: 5243, strictPort: false },
  plugins: [{ name: 'office-ai-fixture-page', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/office-ai-audit') return next();
    const html = await vite.transformIndexHtml('/office-ai-audit', '<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#080f1c;color:#e2e8f0;font-family:Arial,sans-serif"><div id="root"></div><script type="module" src="/.cache/office-ai-fixture.jsx"></script></body></html>');
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  }); } }],
});

const command = { id: 'health.security', label: 'Run security check', category: 'Health', description: 'Read configuration checks.', target: 'api', impact: 'low', available: true, requiresConfirmation: false };
const { BASE_OFFICE_CONTROLS } = createRequire(import.meta.url)('../backend/office-controls.js');
const commands = [command, ...BASE_OFFICE_CONTROLS.filter(item => item.id !== command.id)];
let checks = 0, browser;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage();
    const requests = [], errors = [];
    let tools = [], failChat = false, slowChat = false, configured = true, researchStatus = 'verified';
    let connections = ['github', 'render', 'cloudflare', 'expo', 'notion', 'slack', 'linear'].map(id => ({ id, configured: false, chatSource: ['notion', 'slack', 'linear'].includes(id), ...(id === 'expo' ? { projectUrl: 'https://expo.dev/accounts/uficonnect/projects/ufic' } : {}) }));
    let stallConnectionRead = false, stalledConnectionRoute = null, statusReadDelayMs = 0, connectionReadDelayMs = 0;
    let holdChat = false, releaseChat = null, heldChatReady = null, failChatNetwork = false;
    const conversations = new Map();
    let saveFailure = false, saveConflict = false, abortCreateOnce = false, markdownReply = false, task = null, terminal = null, terminalOutput = '', taskCreateFailure = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (![API, PIPELINE].includes(url.origin)) return route.continue();
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      check(req.headers()['x-office-token'] === 'synthetic-office-ai-token' && !url.href.includes('synthetic-office-ai-token'), 'Office credentials stay in authenticated headers');
      const body = req.postData() ? req.postDataJSON() : null;
      requests.push({ method: req.method(), path: url.pathname, body });
      if (url.pathname === '/office/ai/conversations') {
        if (req.method() === 'GET') return route.fulfill({ headers, json: { conversations: [...conversations.values()].map(({ messages, ...item }) => item), storage: 'encrypted-database' } });
        if (saveFailure) return route.fulfill({ status: 503, headers, json: { error: 'Conversation database temporarily unavailable.' } });
        if (!conversations.has(body.clientRequestId)) conversations.set(body.clientRequestId, { id: body.clientRequestId, title: body.title, messages: body.messages, version: 1, updatedAt: new Date().toISOString() });
        if (abortCreateOnce) { abortCreateOnce = false; return route.abort('connectionfailed'); }
        return route.fulfill({ headers, json: { conversation: conversations.get(body.clientRequestId) } });
      }
      if (url.pathname.startsWith('/office/ai/conversations/')) {
        const id = url.pathname.split('/').at(-1), conversation = conversations.get(id);
        if (req.method() === 'GET') return route.fulfill({ headers, json: { conversation } });
        if (saveFailure) return route.fulfill({ status: 503, headers, json: { error: 'Conversation database temporarily unavailable.' } });
        if (saveConflict || body.expectedVersion !== conversation?.version) return route.fulfill({ status: 409, headers, json: { error: 'Conversation version conflict.' } });
        if (req.method() === 'DELETE') { check(body.confirmed === true, 'Deleting a saved chat carries the explicit confirmation'); conversations.delete(id); return route.fulfill({ headers, json: { deleted: true } }); }
        const updated = { ...conversation, ...body, version: conversation.version + 1, updatedAt: new Date().toISOString() }; conversations.set(id, updated);
        return route.fulfill({ headers, json: { conversation: updated } });
      }
      if (url.pathname === '/office/ai/tasks') {
        if (req.method() === 'GET') return route.fulfill({ headers, json: { tasks: task ? [task] : [], capabilities: { repository: 'fixture/office', editCode: true, publish: true, deploy: true, operate: true, deployTargets: [{ id: 'office', label: 'Office website' }] } } });
        if (!task || task.clientRequestId !== body.clientRequestId) task = { ...body, id: 'task-fixture', status: 'working', createdAt: new Date().toISOString(), events: [{ id: 'step-read', label: 'Read repository files', status: 'succeeded', detail: 'Read the requested UI source.', at: new Date().toISOString() }], changedFiles: [{ path: 'office/src/Example.jsx', diff: '- old title\n+ requested title', status: 'modified' }], commit: { sha: 'a'.repeat(40), ref: 'office-ai/check-fixture', refType: 'tag', published: false, url: 'https://github.com/fixture/office/commit/' + 'a'.repeat(40) }, checks: [{ name: 'Verify', status: 'queued', sha: 'a'.repeat(40), url: 'https://github.com/fixture/office/actions/runs/123' }], deployments: [] };
        if (taskCreateFailure) return route.abort('connectionfailed');
        return route.fulfill({ status: 202, headers, json: { task } });
      }
      if (url.pathname.startsWith('/office/ai/tasks/')) {
        if (url.pathname.endsWith('/cancel')) task = { ...task, status: 'cancel_requested' };
        if (url.pathname.endsWith('/confirm')) { check(body.confirmationId === task.confirmation.id && body.confirmed, 'Task confirms the current specific action'); task = { ...task, status: 'working', confirmation: null }; }
        return route.fulfill({ headers, json: { task } });
      }
      if (url.pathname === '/office/ai/terminal') {
        if (req.method() === 'GET') return route.fulfill({ headers, json: { capabilities: { available: true, configured: true, repository: 'fixture/office' }, sessions: terminal ? [terminal] : [] } });
        terminal = { ...body, id: 'terminal-fixture', status: 'queued', ref: body.ref, commitSha: 'b'.repeat(40), createdAt: new Date().toISOString(), runUrl: 'https://github.com/fixture/office/actions/runs/456', exitCode: null };
        return route.fulfill({ status: 202, headers, json: { session: terminal } });
      }
      if (url.pathname.startsWith('/office/ai/terminal/')) { if (url.pathname.endsWith('/cancel')) terminal = { ...terminal, cancellationRequested: true }; return route.fulfill({ headers, json: { session: terminal, output: terminalOutput, outputTruncated: false } }); }
      if (url.pathname === '/office/ai') {
        if (statusReadDelayMs) await new Promise(resolve => setTimeout(resolve, statusReadDelayMs));
        return route.fulfill({ headers, json: { provider: 'Cloudflare', configured, model: '@cf/test/model', gateway: 'default', researchAvailable: true, missing: configured ? [] : ['CLOUDFLARE_API_TOKEN'] } });
      }
      if (url.pathname === '/office/connections') {
        if (stallConnectionRead) { stalledConnectionRoute = route; return; }
        if (connectionReadDelayMs) await new Promise(resolve => setTimeout(resolve, connectionReadDelayMs));
        return route.fulfill({ headers, json: { connections } });
      }
      const connectionMatch = url.pathname.match(/^\/office\/connections\/(github|render|cloudflare|expo|notion|slack|linear)(\/verify)?$/);
      if (connectionMatch) {
        const id = connectionMatch[1];
        if (req.method() === 'DELETE') connections = connections.map(item => item.id === id ? { ...item, configured: false } : item);
        else connections = connections.map(item => item.id === id ? { ...item, configured: true, verifiedAt: '2026-11-03T18:00:00Z', ...(id === 'github' ? { repository: 'fixture/office' } : {}), ...(id === 'render' ? { serviceIds: body.serviceIds || item.serviceIds } : {}), ...(id === 'cloudflare' ? { accountId: body.accountId || item.accountId, model: body.model || item.model, gateway: body.gateway || item.gateway, deploymentConfigured: !!body.deploymentToken || !!item.deploymentConfigured } : {}) } : item);
        return route.fulfill({ headers, json: { detail: req.method() === 'DELETE' ? 'Connection disabled.' : connectionMatch[2] ? 'Connection verified.' : 'Connection verified and saved.' } });
      }
      if (url.pathname === '/office/controls') return route.fulfill({ headers, json: { controls: commands, history: [] } });
      if (url.pathname === '/office/ai/tools') {
        if (req.method() === 'POST') { const tool = { ...body, id: '00000000-0000-4000-8000-000000000001' }; tools.push(tool); return route.fulfill({ headers, json: { tool } }); }
        return route.fulfill({ headers, json: { tools, persistence: 'database' } });
      }
      if (url.pathname.startsWith('/office/ai/tools/') && req.method() === 'DELETE') { tools = []; return route.fulfill({ headers, json: { ok: true } }); }
      if (url.pathname === '/office/ai/chat') {
        check(body.history.length <= 12 && body.history.reduce((sum, item) => sum + item.content.length, 0) <= 32000, 'Only bounded conversation context is sent');
        if (failChatNetwork) return route.abort('connectionfailed');
        if (slowChat) await new Promise(resolve => setTimeout(resolve, 1500));
        if (failChat) return route.fulfill({ status: 503, headers, json: { error: 'Cloudflare could not complete the request. Please retry.' } });
        const fulfillReply = () => route.fulfill({ headers, json: { reply: markdownReply ? '## Example\n**A safe code example**\n```js\nconsole.log("hello");\n```\n[Unsafe link](javascript:alert(1))\n<img src=x onerror=alert(1)>' : 'A grounded answer with alternatives and limitations.', provider: 'Cloudflare', model: '@cf/test/model', generatedAt: '2026-11-03T18:00:00Z', research: { status: researchStatus, checkedAt: '2026-11-03T18:00:00Z' }, connectedSources: (body.sourceIds || []).map(id => ({ id, status: 'retrieved', count: 1 })),
          sources: researchStatus === 'official-updates' ? [{ title: 'Official model announcement', url: 'https://blog.google/technology/ai/fixture-announcement/', publisher: 'Google AI', publishedAt: '2026-11-02T12:00:00Z' }] : researchStatus === 'verified' ? [{ title: 'Official update', url: 'https://developers.cloudflare.com/changelog/', description: 'A current release.' }, { title: 'Unsafe script', url: 'javascript:alert(1)' }, { title: 'Credential URL', url: 'https://secret:password@example.org/' }] : [], actions: [command], toolsUsed: body.toolIds } });
        if (holdChat) { releaseChat = fulfillReply; heldChatReady?.(); return; }
        return fulfillReply();
      }
      throw Error('Unexpected Pip fixture route ' + url.pathname);
    });
    await page.goto(server.resolvedUrls.local[0] + 'office-ai-audit');
    await page.getByText('Cloudflare configured', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Conversation', exact: true }).getAttribute('aria-pressed') === 'true', 'Conversation is the default without automatic work');
    check(!requests.some(row => row.method === 'POST'), 'Opening the app never starts a task or mutation');
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Catch up on AI' }).click();
    check((await page.getByLabel('Message Pip').inputValue()).includes('latest important AI updates'), 'Latest AI starter asks for current evidence');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('A grounded answer with alternatives and limitations.', { exact: true }).waitFor();
    const firstChat = requests.find(row => row.path.endsWith('/chat'));
    check(firstChat.body.mode === 'chat' && firstChat.body.memory === true, 'Conversation explicitly answers with relevant memory enabled');
    check(!requests.some(row => row.path === '/office/ai/tasks' && row.method === 'POST'), 'An ordinary question never creates an autonomous task');
    check(firstChat.body.research && firstChat.body.perspective === 'balanced', 'New conversations use live research and balanced perspectives');
    check(!firstChat.body.sourceIds?.length, 'Workspace retrieval is opt-in for each reply');
    check(await page.getByRole('link', { name: 'Official update' }).count() === 1, 'Retrieved source is a usable citation');
    check(await page.getByRole('link', { name: /Unsafe script|Credential URL/ }).count() === 0, 'Unsafe source schemes and credentials never become links');
    await page.getByText('Conversation saved in Office', { exact: true }).waitFor();
    const initialConversation = requests.find(row => row.path === '/office/ai/conversations' && row.method === 'POST').body.clientRequestId;
    check(conversations.get(initialConversation).messages.length === 2, 'User and assistant messages are automatically persisted with versioned writes');
    await page.reload();
    await page.getByText('Cloudflare configured', { exact: true }).waitFor();
    await page.locator('.office-ai-saved-chats li>button').first().click();
    await page.getByText('A grounded answer with alternatives and limitations.', { exact: true }).waitFor();
    check(await page.locator('.office-ai-message').count() === 2, 'Saved conversation can be reopened after a browser reload');
    check(await page.getByRole('button', { name: /Run security check Review/ }).count() === 0, 'Conversation suppresses unsolicited provider command proposals');
    await page.getByRole('button', { name: 'Office controls', exact: true }).click();
    check(!requests.some(row => row.path.endsWith('/execute')), 'Control navigation never starts an operation');
    await page.getByRole('heading', { name: 'Control map', exact: true }).waitFor();
    check(await page.locator('.ocm-command').count() === commands.length, 'Every registered Office command has a map destination');
    check(await page.locator('.ocm-group-node').count() === new Set(commands.map(item => item.category)).size, 'Every command category has a functional group');
    const graph = page.getByRole('group', { name: 'Connected map of Office controls by purpose', exact: true });
    check(await graph.locator('[data-from][data-to]').count() > 0, 'Functional connections are rendered on the map');
    await page.screenshot({ path: path.join(output, `office-control-map-${width}.png`), fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Control map fits ${width}px without page overflow`);
    if (width < 800) check(await page.locator('.ocm-canvas').evaluate(element => element.clientHeight <= 440), 'Mobile map leaves room for group navigation and the command list');
    const district = page.getByRole('button', { name: 'Health, 1 commands. Open group', exact: true });
    await district.focus(); await district.press('Enter');
    check(await page.locator('.ocm-command').count() === 1, 'Functional groups can be entered with the keyboard');
    await page.getByRole('button', { name: 'All controls', exact: true }).click();
    check(await page.locator('.ocm-command').count() === commands.length, 'All controls clears the selected group');
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search control map', exact: true }).fill('health.security');
    await page.getByRole('button', { name: 'Review Run security check', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search controls' }).waitFor();
    check(await page.getByRole('textbox', { name: 'Search controls' }).inputValue() === command.id, 'Map destination opens the existing command review');
    check(!requests.some(row => row.path.endsWith('/execute')), 'Map navigation never executes a command');
    check(await page.locator('[aria-label="Command review"]').evaluate(element => element === document.activeElement), 'Opening review moves keyboard focus to the review panel');
    await page.getByRole('button', { name: 'Back to control map', exact: true }).click();
    check(await page.getByRole('searchbox', { name: 'Search control map', exact: true }).inputValue() === command.id, 'Returning from command review preserves the map search');
    await page.waitForFunction(id => document.activeElement?.getAttribute('data-control-id') === id, command.id);
    await page.getByRole('button', { name: 'Clear control search', exact: true }).click();
    await page.getByRole('button', { name: 'All controls', exact: true }).click();
    check(await page.locator('.ocm-command').count() === commands.length && !(await graph.count()), 'Directory view exposes all controls without the map');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    check(await page.locator('.office-command-map').evaluate(element => element.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')), 'System reduced-motion preference leaves no running map animation');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'My tools', exact: true }).click();
    await page.getByLabel('Tool name', { exact: true }).fill('Review an idea');
    await page.getByLabel('Description', { exact: true }).fill('Compare benefits, risks, and alternatives.');
    await page.getByLabel('Instructions', { exact: true }).fill('Consider user value, costs, privacy, and implementation risks.');
    await page.getByRole('button', { name: 'Save tool', exact: true }).click();
    await page.getByRole('heading', { name: 'Review an idea', exact: true }).waitFor();
    check(requests.some(row => row.path === '/office/ai/tools' && row.body?.kind === 'prompt'), 'Adding a prompt tool persists through the Office API');
    await page.getByRole('button', { name: 'Use in chat', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    researchStatus = 'unavailable';
    await page.getByLabel('Message Pip').fill('Review my idea.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Current information could not be verified for this reply.', { exact: false }).waitFor();
    const chats = requests.filter(row => row.path.endsWith('/chat'));
    check(chats.at(-1).body.toolIds[0] === tools[0].id && chats.at(-1).body.history.length === 2, 'Follow-up includes only selected saved tools and recent conversation');
    failChat = true;
    await page.getByLabel('Message Pip').fill('Keep this failed draft');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Cloudflare could not complete' }).waitFor();
    check(await page.getByLabel('Message Pip').inputValue() === 'Keep this failed draft', 'Failed requests preserve the draft for retry');
    check(await page.locator('.office-ai-message-user', { hasText: 'Keep this failed draft' }).count() === 0, 'Failed request is not duplicated in conversation history');
    failChat = false; slowChat = true;
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.waitForTimeout(1700);
    check(await page.getByLabel('Message Pip').inputValue() === 'Keep this failed draft', `Stopping restores the submitted draft; actual: ${await page.getByLabel('Message Pip').inputValue()}`);
    check(await page.locator('.office-ai-message-assistant').count() === 2, 'Stopped provider response does not appear later');
    slowChat = false;
    researchStatus = 'official-updates';
    await page.getByLabel('Message Pip').fill('What are the latest official AI announcements?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const officialAnswer = page.locator('.office-ai-message-assistant').last();
    await officialAnswer.getByText('Official AI announcements retrieved', { exact: true }).waitFor();
    check(await officialAnswer.getByText('Official announcement feeds were checked. Broader web research is unavailable for this reply.', { exact: true }).isVisible(), 'Official announcement fallback clearly states broader research is unavailable');
    check(await officialAnswer.getByRole('link', { name: 'Official model announcement', exact: true }).count() === 1, 'Official announcement fallback retains its source link');
    check(await officialAnswer.getByText('Google AI', { exact: false }).count() === 1 && await officialAnswer.locator('time[datetime="2026-11-02T12:00:00Z"]').count() === 1, 'Official source publisher and publication timestamp are visible');
    check(await officialAnswer.getByText('Web sources retrieved', { exact: true }).count() === 0 && await officialAnswer.getByText('Verified', { exact: false }).count() === 0, 'Official feed fallback is not presented as verified general web research');
    await page.getByRole('button', { name: /My tools/ }).click();
    await page.getByRole('button', { name: 'Remove tool Review an idea', exact: true }).click();
    await page.getByRole('heading', { name: 'Build your personal toolkit', exact: true }).waitFor();
    check(requests.some(row => row.method === 'DELETE'), 'Removing a tool updates persistent storage');
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    check(await page.locator('.office-ai-selected').count() === 0, 'Deleted tool cannot remain selected for later chats');
    await page.screenshot({ path: path.join(output, `office-ai-${width}.png`), fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Pip fits ${width}px without horizontal page overflow`);
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    await page.getByRole('button', { name: 'Knowledge sources', exact: true }).click();
    check(await page.locator('.oc-card').count() === 3, 'Knowledge source category lists all new providers');
    await page.getByRole('searchbox', { name: 'Search connections', exact: true }).fill('slack');
    check(await page.locator('.oc-card').count() === 1 && await page.getByRole('heading', { name: 'Slack', exact: true }).isVisible(), 'Connection search finds a provider');
    await page.getByRole('searchbox', { name: 'Search connections', exact: true }).fill('');
    await page.getByRole('button', { name: 'All connections', exact: true }).click();
    await page.screenshot({ path: path.join(output, `office-connections-${width}.png`), fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Connections fit ${width}px without page overflow`);
    for (const [id, name] of [['github', 'GitHub'], ['render', 'Render'], ['cloudflare', 'Cloudflare'], ['expo', 'Expo'], ['notion', 'Notion'], ['slack', 'Slack'], ['linear', 'Linear']]) {
      const card = page.locator('.oc-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
      await card.getByRole('button', { name: `Connect ${name}`, exact: true }).click();
      const credentialLabel = name + ({ render: ' API key', expo: ' access token', notion: ' internal connection token', slack: ' user OAuth token', linear: ' personal API key' }[id] || ' API token');
      await page.getByLabel(credentialLabel, { exact: true }).fill(`synthetic-${id}-private-connection-token`);
      check(await page.getByLabel(credentialLabel, { exact: true }).getAttribute('type') === 'password', 'Connection credential input is masked');
      if (id === 'render') await page.getByLabel('API service ID', { exact: true }).fill('srv-fixture-api');
      if (id === 'cloudflare') await page.getByLabel('Cloudflare account ID', { exact: true }).fill('a'.repeat(32));
      await card.getByRole('button', { name: 'Verify and save', exact: true }).click();
      await card.getByRole('button', { name: `Update connection ${name}`, exact: true }).waitFor();
      check(await page.locator('input[type=password]').count() === 0, 'Saved connection clears the credential form');
      const sent = requests.findLast(row => row.path === `/office/connections/${id}` && row.method === 'POST');
      check(sent.body.token === `synthetic-${id}-private-connection-token`, 'Credentials are sent only to the selected connection endpoint');
      await card.getByRole('button', { name: 'Verify connection', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Connection verified.' }).waitFor();
      check(requests.some(row => row.path === `/office/connections/${id}/verify` && !row.body.token), 'Stored connection can be verified without returning its credential');
      if (['notion', 'slack', 'linear'].includes(id)) {
        await page.getByRole('button', { name: 'Conversation', exact: true }).click();
        await page.getByRole('button', { name: 'Conversation', exact: true }).click();
        const source = page.getByRole('checkbox', { name: `${name} Connected · include in reply`, exact: true });
        await source.check();
        await page.getByLabel('Message Pip').fill(`Find context in ${name}`);
        const sourceSaved = page.waitForResponse(response => response.url().includes('/office/ai/conversations/') && response.request().method() === 'PATCH' && response.status() === 200 && response.request().postDataJSON()?.messages?.at(-1)?.connectedSources?.some(item => item.id === id));
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await page.locator('.office-ai-source-results').last().getByText(`${name} · Sources retrieved (1)`, { exact: true }).waitFor();
        await sourceSaved;
        check(conversations.get(initialConversation).messages.at(-1).connectedSources[0].id === id, 'Saved history retains connected source results');
        check(JSON.stringify(requests.filter(row => row.path.endsWith('/chat')).at(-1).body.sourceIds) === JSON.stringify([id]), 'Only the selected workspace source is sent to chat');
        await page.getByRole('button', { name: 'Connections', exact: true }).click();
      }
      if (id === 'cloudflare') {
        await card.getByRole('button', { name: 'Update connection Cloudflare', exact: true }).click();
        await page.getByLabel('Workers deployment token', { exact: true }).fill('synthetic-cloudflare-private-deployment-token');
        check(await page.getByLabel('Workers deployment token', { exact: true }).getAttribute('type') === 'password', 'Workers deployment credential is masked separately');
        await card.getByRole('button', { name: 'Verify and save', exact: true }).click();
        await page.getByText('Workers deployment access: configured', { exact: true }).waitFor();
        const deploymentSave = requests.findLast(row => row.path === '/office/connections/cloudflare' && row.method === 'POST');
        check(deploymentSave.body.deploymentToken === 'synthetic-cloudflare-private-deployment-token' && !Object.hasOwn(deploymentSave.body, 'token'), 'Deployment-only connection update preserves the existing AI credential');
        check(await page.locator('input[type=password]').count() === 0, 'Saving deployment access clears both credential inputs');
      }
      await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
      check(!requests.some(row => row.path === `/office/connections/${id}` && row.method === 'DELETE'), 'Disconnect waits for explicit confirmation');
      await card.getByRole('button', { name: 'Confirm disconnect', exact: true }).click();
      await card.getByRole('button', { name: `Connect ${name}`, exact: true }).waitFor();
      check(requests.some(row => row.path === `/office/connections/${id}` && row.method === 'DELETE' && row.body.confirmed === true), 'Disconnect uses the confirmed authenticated endpoint');
      if (['notion', 'slack', 'linear'].includes(id)) {
        await page.getByRole('button', { name: 'Conversation', exact: true }).click();
        await page.getByRole('button', { name: 'Conversation', exact: true }).click();
        const source = page.getByRole('checkbox', { name: `${name} Connect to use in replies`, exact: true });
        await source.waitFor();
        check(await source.isDisabled() && !(await source.isChecked()), 'Disconnect removes the source from the next reply');
        await page.getByRole('button', { name: 'Connections', exact: true }).click();
      }
    }
    await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
    await page.getByLabel('GitHub API token', { exact: true }).fill('synthetic-unsaved-private-connection-token');
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    check(await page.locator('input[type=password]').count() === 0, 'Leaving connections unmounts sensitive inputs');
    await page.getByLabel('Message Pip').fill('Explain my connections.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
    check(!requests.filter(row => row.path === '/office/ai/chat').some(row => /private-(?:connection|deployment)-token/.test(JSON.stringify(row.body))), 'Saved and unsaved provider credentials never enter chatbot payloads');
    await page.getByText('Conversation saved in Office', { exact: true }).waitFor();
    if (width === 1280) {
      const attachment = page.getByLabel('Attach file or photo', { exact: true });
      await page.getByLabel('Message Pip').fill('Review this fixture.');
      await attachment.setInputFiles({ name: 'too-large.txt', mimeType: 'text/plain', buffer: Buffer.from('x'.repeat(102401)) });
      await page.getByRole('alert').filter({ hasText: '100 KB or smaller' }).waitFor();
      check(await page.getByLabel('Message Pip').inputValue() === 'Review this fixture.', 'An oversized text attachment is rejected without truncating or replacing the draft');
      await attachment.setInputFiles({ name: 'example.json', mimeType: 'application/json', buffer: Buffer.from('{"example":true}') });
      await page.getByRole('list', { name: 'Files for your next message' }).getByText('example.json', { exact: true }).waitFor();
      check(await page.getByLabel('Message Pip').inputValue() === 'Review this fixture.', 'Attachments preserve the typed draft');
      saveFailure = true; markdownReply = true;
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('button', { name: 'Copy code', exact: true }).waitFor();
      await page.getByRole('alert').filter({ hasText: 'Conversation database temporarily unavailable.' }).waitFor();
      check(await page.getByText('Conversation changes are not saved.', { exact: true }).isVisible(), 'Failed database writes are visibly unsaved while retaining the conversation');
      check(await page.locator('.office-ai-code pre').innerText() === 'console.log("hello");', 'Fenced code renders as readable, copyable text');
      check(await page.locator('.office-ai-markdown img, .office-ai-markdown script').count() === 0 && await page.locator('.office-ai-markdown a[href^="javascript:"]').count() === 0, 'Model Markdown cannot execute HTML or unsafe links');
      const attachedRequest = requests.filter(row => row.path === '/office/ai/chat').at(-1);
      check(attachedRequest.body.message === 'Review this fixture.' && attachedRequest.body.attachments?.[0]?.name === 'example.json' && attachedRequest.body.attachments[0].data === '{"example":true}', 'Text attachments use the bounded structured chat payload');
      saveFailure = false;
      await page.getByRole('button', { name: 'Retry saving conversation', exact: true }).click();
      await page.getByText('Conversation saved in Office', { exact: true }).waitFor();
      const savedVersion = conversations.get(initialConversation).version;
      check(conversations.get(initialConversation).messages.at(-2).content.includes('example.json'), 'Retry persists the same conversation and its attachment filename');
      saveConflict = true; markdownReply = false;
      await page.getByLabel('Message Pip').fill('Keep this conflicting local message until I choose to reload.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('button', { name: 'Reload saved conversation', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
      check(conversations.get(initialConversation).version === savedVersion, 'A version conflict never overwrites the saved conversation');
      check(await page.locator('.office-ai-message-user', { hasText: 'Keep this conflicting local message' }).isVisible(), 'A save conflict preserves unsaved local messages for review');
      saveConflict = false; page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Reload saved conversation', exact: true }).click();
      await page.locator('.office-ai-message-user', { hasText: 'Keep this conflicting local message' }).waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Copy code', exact: true }).waitFor();
      check(await page.locator('.office-ai-message-user', { hasText: 'Keep this conflicting local message' }).count() === 0, 'Explicit reload resolves the conflict using the saved version');
    }
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    check(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), 'Empty task instructions cannot start work');
    await page.getByLabel('Request destination', { exact: true }).selectOption('self-update');
    await page.getByLabel('Task instructions', { exact: true }).fill('Update the example title, check it, publish, and deploy Office.');
    const taskWorkspace = page.getByRole('region', { name: 'Coding tasks', exact: true });
    check(await taskWorkspace.getByLabel('Run Office commands', { exact: true }).isChecked(), 'Operational Office commands are included in the visible default task scope');
    await taskWorkspace.getByLabel('Run Office commands', { exact: true }).check();
    await taskWorkspace.getByLabel('Office website', { exact: true }).check();
    check(await taskWorkspace.getByText('Publishing can trigger deployment.', { exact: false }).isVisible(), 'Task scope discloses the repository automatic deployment behavior');
    taskCreateFailure = true;
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The connection ended.' }).waitFor();
    taskCreateFailure = false;
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Candidate commit; not published', { exact: false }).waitFor();
    const creates = requests.filter(row => row.path === '/office/ai/tasks' && row.method === 'POST');
    check(creates.at(-1).body.clientRequestId === creates.at(-2).body.clientRequestId, 'Retry after an ambiguous task creation reuses its idempotency key');
    check(creates.at(-1).body.permissions.publish && creates.at(-1).body.permissions.deploy && creates.at(-1).body.permissions.operate && creates.at(-1).body.deployTargets[0] === 'office', 'Task submission carries explicit requested action scope and deployment target');
    check(creates.at(-1).body.target === 'self-update' && creates.at(-1).body.memory === true, 'Task submission carries a distinct destination and memory preference');
    check(await page.getByText('Candidate commit; not published', { exact: false }).isVisible() && await page.getByText('queued', { exact: true }).isVisible(), 'Queued checks and candidate commits are not represented as verified or published');
    await page.getByText('office/src/Example.jsx', { exact: true }).click();
    check(await page.getByText('- old title\n+ requested title', { exact: true }).isVisible(), 'Task file diffs are inspectable');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Task results fit ${width}px without horizontal page overflow`);
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    await page.getByText('Candidate commit; not published', { exact: false }).waitFor();
    check(await page.getByRole('heading', { name: 'Update the example title, check it, publish, and deploy Office.', exact: true }).isVisible(), 'Server-backed task is recovered after navigating away and back');
    task = { ...task, status: 'needs_confirmation', confirmation: { id: 'uncertain-action', label: 'Check an unconfirmed external operation', detail: 'Inspect the provider receipt before retrying.', uncertain: true } };
    await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
    await page.getByText('This interrupted action cannot be replayed from a confirmation button.', { exact: false }).waitFor();
    check(await page.getByRole('button', { name: 'Confirm this action', exact: true }).count() === 0, 'An uncertain external write cannot be blindly replayed through confirmation');
    task = { ...task, status: 'needs_confirmation', confirmation: { id: 'confirm-specific', label: 'Confirm destructive fixture action', detail: 'This fixture action removes a test resource.' } };
    await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm this action', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm this action', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Stop task', exact: true }).click();
    await page.getByRole('button', { name: 'Cancellation requested', exact: true }).waitFor();
    check(task.status === 'cancel_requested' && await page.getByRole('button', { name: 'Cancellation requested', exact: true }).isDisabled(), 'Stopping a task shows a request, without claiming completed work was undone');
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.getByLabel('Terminal command', { exact: true }).fill('printf "terminal fixture"');
    await page.getByRole('button', { name: 'Run command', exact: true }).click();
    await page.getByRole('link', { name: 'Open GitHub Actions run', exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Run command', exact: true }).isDisabled(), 'Only one isolated terminal session can run at a time');
    terminal = { ...terminal, status: 'completed', conclusion: 'failure', exitCode: 7 }; terminalOutput = 'fixture output\ncommand failed with exit 7';
    await page.getByRole('button', { name: 'Refresh terminal', exact: true }).click();
    await page.getByText('completed · failure · exit 7', { exact: true }).waitFor();
    check((await page.getByLabel('Command output', { exact: true }).innerText()).includes('fixture output'), 'Terminal displays actual fetched output and exit status');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Terminal fits ${width}px without horizontal page overflow`);
    await page.screenshot({ path: path.join(output, `office-ai-terminal-${width}.png`), fullPage: true });
    terminal = { ...terminal, status: 'running', conclusion: null, exitCode: null };
    await page.getByRole('button', { name: 'Refresh terminal', exact: true }).click();
    await page.getByRole('button', { name: 'Stop command', exact: true }).click();
    await page.getByRole('button', { name: 'Cancellation requested', exact: true }).waitFor();
    check(terminal.status === 'running' && terminal.cancellationRequested, 'Terminal cancellation retains the actual running status until GitHub confirms completion');
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByText('Conversation saved in Office', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Delete conversation / }).first().click();
    check(conversations.has(initialConversation), 'Saved conversation deletion waits for confirmation');
    await page.getByRole('button', { name: 'Delete saved chat', exact: true }).click();
    await page.getByRole('heading', { name: 'What are we working on?', exact: true }).waitFor();
    check(!conversations.has(initialConversation), 'Confirmed delete removes the saved conversation and clears the current transcript');
    if (width === 1280) {
      abortCreateOnce = true; holdChat = true;
      const chatPending = new Promise(resolve => { heldChatReady = resolve; });
      await page.getByLabel('Message Pip').fill('Save both messages even when the first database response is lost.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await chatPending;
      await page.getByRole('alert').filter({ hasText: 'The connection ended.' }).waitFor();
      await releaseChat(); holdChat = false;
      await page.getByText('A grounded answer with alternatives and limitations.', { exact: true }).waitFor();
      await page.getByText('Conversation saved in Office', { exact: true }).waitFor();
      const recoveredCreate = requests.findLast(row => row.path === '/office/ai/conversations' && row.method === 'POST');
      check(conversations.get(recoveredCreate.body.clientRequestId).messages.length === 2, 'An idempotent create receipt with an older snapshot is updated before the assistant reply is reported saved');
      check(conversations.size === 1, 'Recovering an ambiguous conversation create never makes duplicate chats');
      await page.getByRole('button', { name: 'New chat', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.getByLabel('Terminal command', { exact: true }).fill('Unsubmitted terminal draft to clear on auth change');
    await page.evaluate(() => window.dispatchEvent(new Event('office-token-changed')));
    await page.getByRole('heading', { name: 'What are we working on?', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.getByRole('button', { name: 'Cancellation requested', exact: true }).waitFor();
    check(await page.getByLabel('Terminal command', { exact: true }).inputValue() === '', 'Auth changes clear terminal drafts while recovering authorized server receipts');
    check(await page.getByRole('button', { name: 'Cancellation requested', exact: true }).isDisabled(), 'Recovered terminal receipt preserves its cancellation request');
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
    check(await page.getByLabel('GitHub API token', { exact: true }).inputValue() === '', 'Unsaved credential is cleared when Connections remounts');
    await page.getByLabel('GitHub API token', { exact: true }).fill('synthetic-auth-reset-private-connection-token');
    statusReadDelayMs = 100;
    await page.evaluate(() => window.dispatchEvent(new Event('office-token-changed')));
    // The card's Connect button exists before and after reset; wait for the
    // sensitive form itself to leave the DOM after React processes the event.
    await page.locator('input[type=password]').waitFor({ state: 'hidden' });
    check(await page.locator('input[type=password]').count() === 0, 'Auth changes clear provider credential forms');
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    if (width === 1280) {
      const connectionsView = page.getByRole('region', { name: 'Provider connections', exact: true });
      // Auth reset reloads the parent AI status as well as this panel. Settle
      // those real requests before advancing the shared browser clock.
      await page.getByText('Cloudflare configured', { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.office-connections')?.getAttribute('aria-busy') === 'false');
      await page.clock.install(); stallConnectionRead = true;
      await page.getByRole('button', { name: 'Refresh connections', exact: true }).click();
      await connectionsView.getByText('Checking connection settings…', { exact: true }).waitFor();
      await page.clock.fastForward(21000);
      await connectionsView.getByRole('alert').filter({ hasText: 'Connection check timed out.' }).waitFor();
      check(await page.getByRole('button', { name: 'Refresh connections', exact: true }).isEnabled(), 'A stalled connection check releases the loading state and allows retry');
      await stalledConnectionRoute?.abort().catch(() => {});
      stallConnectionRead = false; connectionReadDelayMs = 100;
      // A hidden loading label can match before React starts the retry. Wait
      // for its response and the resulting panel state instead of that absence.
      const retryResponse = page.waitForResponse(response => response.url() === `${API}/office/connections` && response.status() === 200);
      await page.getByRole('button', { name: 'Refresh connections', exact: true }).click();
      await retryResponse;
      await page.waitForFunction(() => document.querySelector('.office-connections')?.getAttribute('aria-busy') === 'false');
      await connectionsView.getByRole('alert').waitFor({ state: 'hidden' });
      check(await connectionsView.getByRole('alert').count() === 0, 'Retry recovers the connection view after a timeout');
    }
    statusReadDelayMs = 0; connectionReadDelayMs = 0;
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('heading', { name: 'What are we working on?', exact: true }).waitFor();
    check(await page.getByLabel('Message Pip').inputValue() === '', 'Auth change clears private conversation and draft');
    if (width === 1280) {
      holdChat = true;
      let pendingChat = new Promise(resolve => { heldChatReady = resolve; });
      await page.getByLabel('Message Pip').fill('Wait for a slower research response.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await pendingChat;
      await page.clock.fastForward(70000);
      check(await page.getByRole('button', { name: 'Stop', exact: true }).isVisible(), 'A research reply can exceed the former 65-second browser deadline');
      await releaseChat();
      await page.getByText('A grounded answer with alternatives and limitations.', { exact: true }).waitFor();
      check(await page.locator('.office-ai-message-assistant').count() === 1, 'A response after 70 seconds still reaches the conversation');

      pendingChat = new Promise(resolve => { heldChatReady = resolve; });
      await page.getByLabel('Message Pip').fill('Preserve this stalled research draft.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await pendingChat;
      await page.clock.fastForward(220001);
      await page.getByRole('alert').filter({ hasText: 'The response timed out. Your message is ready to retry.' }).waitFor();
      check(await page.getByLabel('Message Pip').inputValue() === 'Preserve this stalled research draft.', 'The bounded 220-second deadline restores the pending draft');
      check(await page.locator('.office-ai-message-user', { hasText: 'Preserve this stalled research draft.' }).count() === 0, 'Timed-out requests do not pollute the follow-up history');
      await releaseChat().catch(() => {}); holdChat = false;
      check(await page.locator('.office-ai-message-assistant').count() === 1, 'A late timed-out response cannot enter the conversation');

      failChatNetwork = true;
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'The connection ended before Pip could respond. Your message is ready to retry.' }).waitFor();
      check(await page.getByLabel('Message Pip').inputValue() === 'Preserve this stalled research draft.', 'A failed network response has a clear retry message and preserves the draft');
      failChatNetwork = false;
    }
    configured = false;
    await page.getByRole('button', { name: 'Refresh Pip connection', exact: true }).click();
    await page.getByText('Connect your Cloudflare AI account', { exact: true }).waitFor();
    await page.getByLabel('Message Pip').fill('Should not send before connection');
    check(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), 'Unconfigured Cloudflare never produces a pretend AI reply');
    check(errors.length === 0, `No browser exceptions at ${width}px: ${errors.join('; ')}`);
    await context.close();
  }
  console.log(`Pip browser audit passed: ${checks} checks across desktop and mobile.`);
} finally {
  await browser?.close(); await server.close(); await fs.unlink(fixturePath).catch(() => {});
}
