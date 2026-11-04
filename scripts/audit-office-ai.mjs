import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
let checks = 0, browser;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage();
    const requests = [], errors = [];
    let tools = [], failChat = false, slowChat = false, configured = true, researchStatus = 'verified';
    let connections = ['github', 'render', 'cloudflare'].map(id => ({ id, configured: false }));
    let stallConnectionRead = false, stalledConnectionRoute = null, statusReadDelayMs = 0, connectionReadDelayMs = 0;
    let holdChat = false, releaseChat = null, heldChatReady = null, failChatNetwork = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (![API, PIPELINE].includes(url.origin)) return route.continue();
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      check(req.headers()['x-office-token'] === 'synthetic-office-ai-token' && !url.href.includes('synthetic-office-ai-token'), 'Office credentials stay in authenticated headers');
      const body = req.postData() ? req.postDataJSON() : null;
      requests.push({ method: req.method(), path: url.pathname, body });
      if (url.pathname === '/office/ai') {
        if (statusReadDelayMs) await new Promise(resolve => setTimeout(resolve, statusReadDelayMs));
        return route.fulfill({ headers, json: { provider: 'Cloudflare', configured, model: '@cf/test/model', gateway: 'default', researchAvailable: true, missing: configured ? [] : ['CLOUDFLARE_API_TOKEN'] } });
      }
      if (url.pathname === '/office/connections') {
        if (stallConnectionRead) { stalledConnectionRoute = route; return; }
        if (connectionReadDelayMs) await new Promise(resolve => setTimeout(resolve, connectionReadDelayMs));
        return route.fulfill({ headers, json: { connections } });
      }
      const connectionMatch = url.pathname.match(/^\/office\/connections\/(github|render|cloudflare)(\/verify)?$/);
      if (connectionMatch) {
        const id = connectionMatch[1];
        if (req.method() === 'DELETE') connections = connections.map(item => item.id === id ? { id, configured: false } : item);
        else connections = connections.map(item => item.id === id ? { id, configured: true, verifiedAt: '2026-11-03T18:00:00Z', ...(id === 'github' ? { repository: 'fixture/office' } : {}), ...(id === 'render' ? { serviceIds: body.serviceIds || item.serviceIds } : {}), ...(id === 'cloudflare' ? { accountId: body.accountId || item.accountId, model: body.model || item.model, gateway: body.gateway || item.gateway } : {}) } : item);
        return route.fulfill({ headers, json: { detail: req.method() === 'DELETE' ? 'Connection disabled.' : connectionMatch[2] ? 'Connection verified.' : 'Connection verified and saved.' } });
      }
      if (url.pathname === '/office/controls') return route.fulfill({ headers, json: { controls: [command], history: [] } });
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
        const fulfillReply = () => route.fulfill({ headers, json: { reply: 'A grounded answer with alternatives and limitations.', provider: 'Cloudflare', model: '@cf/test/model', generatedAt: '2026-11-03T18:00:00Z', research: { status: researchStatus, checkedAt: '2026-11-03T18:00:00Z' },
          sources: researchStatus === 'official-updates' ? [{ title: 'Official model announcement', url: 'https://blog.google/technology/ai/fixture-announcement/', publisher: 'Google AI', publishedAt: '2026-11-02T12:00:00Z' }] : researchStatus === 'verified' ? [{ title: 'Official update', url: 'https://developers.cloudflare.com/changelog/', description: 'A current release.' }, { title: 'Unsafe script', url: 'javascript:alert(1)' }, { title: 'Credential URL', url: 'https://secret:password@example.org/' }] : [], actions: [command], toolsUsed: body.toolIds } });
        if (holdChat) { releaseChat = fulfillReply; heldChatReady?.(); return; }
        return fulfillReply();
      }
      throw Error('Unexpected Office AI fixture route ' + url.pathname);
    });
    await page.goto(server.resolvedUrls.local[0] + 'office-ai-audit');
    await page.getByText('Cloudflare configured', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Catch up on AI' }).click();
    check((await page.getByLabel('Message Office AI').inputValue()).includes('latest important AI updates'), 'Latest AI starter asks for current evidence');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('A grounded answer with alternatives and limitations.', { exact: true }).waitFor();
    const firstChat = requests.find(row => row.path.endsWith('/chat'));
    check(firstChat.body.research && firstChat.body.perspective === 'balanced', 'New conversations use live research and balanced perspectives');
    check(await page.getByRole('link', { name: 'Official update' }).count() === 1, 'Retrieved source is a usable citation');
    check(await page.getByRole('link', { name: /Unsafe script|Credential URL/ }).count() === 0, 'Unsafe source schemes and credentials never become links');
    await page.getByRole('button', { name: 'Run security check Review in Office commands' }).click();
    await page.getByRole('textbox', { name: 'Search controls' }).waitFor();
    check(await page.getByRole('textbox', { name: 'Search controls' }).inputValue() === command.id, 'Suggested command opens the canonical control filter');
    check(!requests.some(row => row.path.endsWith('/execute')), 'Reading a model command proposal never executes an Office command');
    await page.getByRole('button', { name: 'My tools', exact: true }).click();
    await page.getByLabel('Tool name', { exact: true }).fill('Review an idea');
    await page.getByLabel('Description', { exact: true }).fill('Compare benefits, risks, and alternatives.');
    await page.getByLabel('Instructions', { exact: true }).fill('Consider user value, costs, privacy, and implementation risks.');
    await page.getByRole('button', { name: 'Save tool', exact: true }).click();
    await page.getByRole('heading', { name: 'Review an idea', exact: true }).waitFor();
    check(requests.some(row => row.path === '/office/ai/tools' && row.body?.kind === 'prompt'), 'Adding a prompt tool persists through the Office API');
    await page.getByRole('button', { name: 'Use in chat', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    researchStatus = 'unavailable';
    await page.getByLabel('Message Office AI').fill('Review my idea.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Current information could not be verified for this reply.', { exact: false }).waitFor();
    const chats = requests.filter(row => row.path.endsWith('/chat'));
    check(chats.at(-1).body.toolIds[0] === tools[0].id && chats.at(-1).body.history.length === 2, 'Follow-up includes only selected saved tools and recent conversation');
    failChat = true;
    await page.getByLabel('Message Office AI').fill('Keep this failed draft');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Cloudflare could not complete' }).waitFor();
    check(await page.getByLabel('Message Office AI').inputValue() === 'Keep this failed draft', 'Failed requests preserve the draft for retry');
    check(await page.locator('.office-ai-message-user', { hasText: 'Keep this failed draft' }).count() === 0, 'Failed request is not duplicated in conversation history');
    failChat = false; slowChat = true;
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.waitForTimeout(1700);
    check(await page.getByLabel('Message Office AI').inputValue() === 'Keep this failed draft', `Stopping restores the submitted draft; actual: ${await page.getByLabel('Message Office AI').inputValue()}`);
    check(await page.locator('.office-ai-message-assistant').count() === 2, 'Stopped provider response does not appear later');
    slowChat = false;
    researchStatus = 'official-updates';
    await page.getByLabel('Message Office AI').fill('What are the latest official AI announcements?');
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
    check(await page.locator('.office-ai-selected').count() === 0, 'Deleted tool cannot remain selected for later chats');
    await page.screenshot({ path: path.join(output, `office-ai-${width}.png`), fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Office AI fits ${width}px without horizontal page overflow`);
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    for (const [id, name] of [['github', 'GitHub'], ['render', 'Render'], ['cloudflare', 'Cloudflare']]) {
      const card = page.locator('.oc-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
      await card.getByRole('button', { name: `Connect ${name}`, exact: true }).click();
      const credentialLabel = name + (id === 'render' ? ' API key' : ' API token');
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
      await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
      check(!requests.some(row => row.path === `/office/connections/${id}` && row.method === 'DELETE'), 'Disconnect waits for explicit confirmation');
      await card.getByRole('button', { name: 'Confirm disconnect', exact: true }).click();
      await card.getByRole('button', { name: `Connect ${name}`, exact: true }).waitFor();
      check(requests.some(row => row.path === `/office/connections/${id}` && row.method === 'DELETE' && row.body.confirmed === true), 'Disconnect uses the confirmed authenticated endpoint');
    }
    await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
    await page.getByLabel('GitHub API token', { exact: true }).fill('synthetic-unsaved-private-connection-token');
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    check(await page.locator('input[type=password]').count() === 0, 'Leaving connections unmounts sensitive inputs');
    await page.getByLabel('Message Office AI').fill('Explain my connections.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
    check(!requests.filter(row => row.path === '/office/ai/chat').some(row => JSON.stringify(row.body).includes('private-connection-token')), 'Saved and unsaved provider credentials never enter chatbot payloads');
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
    await page.getByRole('heading', { name: 'What are we working on?', exact: true }).waitFor();
    check(await page.getByLabel('Message Office AI').inputValue() === '', 'Auth change clears private conversation and draft');
    if (width === 1280) {
      holdChat = true;
      let pendingChat = new Promise(resolve => { heldChatReady = resolve; });
      await page.getByLabel('Message Office AI').fill('Wait for a slower research response.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await pendingChat;
      await page.clock.fastForward(70000);
      check(await page.getByRole('button', { name: 'Stop', exact: true }).isVisible(), 'A research reply can exceed the former 65-second browser deadline');
      await releaseChat();
      await page.getByText('A grounded answer with alternatives and limitations.', { exact: true }).waitFor();
      check(await page.locator('.office-ai-message-assistant').count() === 1, 'A response after 70 seconds still reaches the conversation');

      pendingChat = new Promise(resolve => { heldChatReady = resolve; });
      await page.getByLabel('Message Office AI').fill('Preserve this stalled research draft.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await pendingChat;
      await page.clock.fastForward(100001);
      await page.getByRole('alert').filter({ hasText: 'The response timed out. Your message is ready to retry.' }).waitFor();
      check(await page.getByLabel('Message Office AI').inputValue() === 'Preserve this stalled research draft.', 'The bounded 100-second deadline restores the pending draft');
      check(await page.locator('.office-ai-message-user', { hasText: 'Preserve this stalled research draft.' }).count() === 0, 'Timed-out requests do not pollute the follow-up history');
      await releaseChat().catch(() => {}); holdChat = false;
      check(await page.locator('.office-ai-message-assistant').count() === 1, 'A late timed-out response cannot enter the conversation');

      failChatNetwork = true;
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'The connection ended before Office AI could respond. Your message is ready to retry.' }).waitFor();
      check(await page.getByLabel('Message Office AI').inputValue() === 'Preserve this stalled research draft.', 'A failed network response has a clear retry message and preserves the draft');
      failChatNetwork = false;
    }
    configured = false;
    await page.getByRole('button', { name: 'Refresh AI connection', exact: true }).click();
    await page.getByText('Connect your Cloudflare AI account', { exact: true }).waitFor();
    await page.getByLabel('Message Office AI').fill('Should not send before connection');
    check(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), 'Unconfigured Cloudflare never produces a pretend AI reply');
    check(errors.length === 0, `No browser exceptions at ${width}px: ${errors.join('; ')}`);
    await context.close();
  }
  console.log(`Office AI browser audit passed: ${checks} checks across desktop and mobile.`);
} finally {
  await browser?.close(); await server.close(); await fs.unlink(fixturePath).catch(() => {});
}
