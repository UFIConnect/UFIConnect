import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://local-web-audit.invalid';
const TOKEN = 'synthetic-local-web-audit-token';
const filePath = 'web/src/LocalPreviewAudit.jsx';
const revision = content => createHash('sha256').update(content).digest('hex');
const servers = [];
let browser;

async function start(local) {
  const server = await createServer({
    root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envFile: false,
    define: {
      'import.meta.env.MODE': JSON.stringify(local ? 'release-local' : 'production'),
      'import.meta.env.VITE_API_URL': JSON.stringify(API),
      'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(API),
    },
    server: { host: '127.0.0.1', port: local ? 5220 : 5221, strictPort: false },
  });
  await server.listen();
  servers.push(server);
  return server.resolvedUrls.local[0];
}

async function fixture(context, remote = false) {
  const state = { content: "export const label = 'Local base';\n", saves: [], publishes: [], localCalls: [], staleSave: false, failPublish: false };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.port === '4173') return route.fulfill({ contentType: 'text/html', body: '<h1>Local website preview</h1>' });
    if (url.pathname.startsWith('/__local-web/')) {
      state.localCalls.push(url.pathname);
      assert.equal(request.headers()['x-office-token'], undefined, 'Administrative tokens stay out of local file requests');
      if (url.pathname.endsWith('/status')) return route.fulfill({ json: { previewUrl: remote ? 'https://phone-preview.trycloudflare.com' : 'http://127.0.0.1:4173', phone: remote ? { remote: true } : { state: 'off' }, officeUrl: 'http://127.0.0.1:4174', writeHeader: 'X-Local-Web-Editor' } });
      if (url.pathname.endsWith('/files')) return route.fulfill({ json: { files: [{ path: filePath }] } });
      if (url.pathname.endsWith('/phone')) {
        assert.equal(request.headers()['x-local-web-editor'], '1');
        return route.fulfill({ json: request.postDataJSON().action === 'start'
          ? { state: 'ready', url: 'https://phone-office.trycloudflare.com', previewUrl: 'https://phone-preview.trycloudflare.com', code: '0123456789abcdef01234567' }
          : { state: 'off' } });
      }
      if (url.pathname.endsWith('/file') && request.method() === 'PUT') {
        const body = request.postDataJSON();
        assert.equal(request.headers()['x-local-web-editor'], '1');
        assert.equal(body.path, filePath);
        if (state.staleSave || body.expectedRevision !== revision(state.content)) return route.fulfill({ status: 409, json: { error: 'The local file changed. Reload it before saving.' } });
        state.saves.push(body);
        state.content = body.content;
      }
      return route.fulfill({ json: { path: filePath, content: state.content, revision: revision(state.content) } });
    }
    if (url.origin !== API) return route.continue();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type,accept', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.headers()['x-office-token'] !== TOKEN) return route.fulfill({ status: 401, headers, json: { error: 'Unauthorized' } });
    if (url.pathname === '/office/frontend-file') return route.fulfill({ headers, json: { path: filePath, content: "export const label = 'Public base';\n", sha: 'a'.repeat(40) } });
    if (url.pathname === '/office/controls/commit.web-frontend/execute') {
      if (state.failPublish) return route.fulfill({ status: 409, headers, json: { error: 'The public file changed. Reload it before committing.' } });
      state.publishes.push(request.postDataJSON());
      return route.fulfill({ headers, json: { result: { commitSha: 'b'.repeat(40), contentSha: 'c'.repeat(40) } } });
    }
    if (url.pathname.endsWith('/stream')) return route.fulfill({ headers, contentType: 'text/event-stream', body: 'data: {"backlog":[]}\n\n' });
    if (url.pathname === '/office/status') return route.fulfill({ headers, json: { server: { uptime: 1000, db: 'connected' } } });
    return route.fulfill({ headers, json: { agents: {}, versions: [] } });
  });
  return state;
}

// Phones show one Local web step at a time; wider screens show every section and hide the step buttons.
async function step(page, name) {
  const button = page.getByRole('group', { name: 'Local web steps' }).getByRole('button', { name, exact: true });
  if (await button.isVisible()) await button.click();
}

async function open(page, url) {
  await page.goto(`${url}#local-web`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Local web', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Access token', { exact: true }).isVisible(), false, 'Local work needs no Office sign-in');
}

try {
  const localUrl = await start(true);
  const hostedUrl = await start(false);
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, hasTouch: width <= 768, isMobile: width < 600 });
    const state = await fixture(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await open(page, localUrl);
    await page.getByLabel('Website file', { exact: true }).waitFor();
    const phoneWidth = width <= 760;
    assert.equal(await page.getByRole('navigation', { name: 'Office sections' }).evaluate(nav => getComputedStyle(nav.closest('aside')).position), 'static', 'The Office header scrolls away instead of covering the editor');
    assert.equal(await page.getByRole('group', { name: 'Local web steps' }).isVisible(), phoneWidth);
    assert.equal(await page.getByRole('heading', { name: 'Local preview', exact: true }).isVisible(), !phoneWidth, 'Phones start on the edit step only');
    assert.equal(await page.getByRole('heading', { name: 'Update the public website', exact: true }).isVisible(), !phoneWidth);

    await page.getByRole('button', { name: 'Start phone connection', exact: true }).click();
    await page.getByRole('img', { name: 'QR code for the phone workspace link', exact: true }).waitFor();
    await page.getByText('0123 4567 89ab cdef 0123 4567', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Phone workspace link', { exact: true }).inputValue(), 'https://phone-office.trycloudflare.com/#local-web');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'The phone connection panel fits the screen');
    await page.getByRole('button', { name: 'Stop phone connection', exact: true }).click();
    await page.getByRole('button', { name: 'Start phone connection', exact: true }).waitFor();

    await page.getByLabel('Website file', { exact: true }).selectOption(filePath);
    const editor = page.getByLabel(filePath, { exact: true });
    await editor.waitFor();
    const changed = "export const label = 'Reviewed local change';\n";
    await editor.fill(changed);
    await step(page, 'Publish');
    assert.ok(await page.getByRole('button', { name: 'Review for public update', exact: true }).isDisabled());
    await page.getByText('Save your edits locally before preparing the public review.', { exact: true }).waitFor();
    await step(page, 'Edit');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('navigation', { name: 'Office sections' }).getByRole('button', { name: 'Overview', exact: true }).click();
    assert.equal(await editor.inputValue(), changed, 'Declining navigation retains the unsaved draft');
    await page.getByRole('button', { name: 'Save locally', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved on this computer' }).waitFor();
    assert.equal(state.saves.length, 1);
    assert.equal(state.content, changed);
    assert.equal(state.publishes.length, 0, 'Saving locally never publishes');
    await step(page, 'Preview');
    assert.equal(await editor.isVisible(), !phoneWidth, 'The preview step replaces the editor on phones');
    await page.getByRole('button', { name: 'Mobile', exact: true }).click();
    const preview = page.getByTitle('Local UFIConnect website preview', { exact: true });
    assert.ok((await preview.boundingBox()).width <= 390, 'Mobile preview uses a narrow viewport');
    await page.frameLocator('iframe').getByRole('heading', { name: 'Local website preview' }).waitFor();
    assert.equal(await page.frameLocator('iframe').locator('body').evaluate(() => innerWidth), 390);
    await page.getByRole('button', { name: 'Desktop', exact: true }).click();
    assert.equal(await page.frameLocator('iframe').locator('body').evaluate(() => innerWidth), 1280, 'Desktop mode tests the desktop layout even in a narrow console');
    await page.getByRole('button', { name: 'Mobile', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await step(page, 'Publish');
    await page.getByRole('button', { name: 'Review for public update', exact: true }).click();
    await page.getByLabel('Access token', { exact: true }).fill(TOKEN);
    await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
    const changes = page.getByRole('region', { name: 'Changes to publish', exact: true });
    await changes.waitFor();
    assert.deepEqual(await changes.locator('del').allTextContents(), ["export const label = 'Public base';"]);
    assert.deepEqual(await changes.locator('ins').allTextContents(), ["export const label = 'Reviewed local change';"]);
    await changes.getByText('1 line added, 1 line removed', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Saved local file to publish', { exact: true }).isVisible(), false, 'Full files stay folded away');
    await page.getByText('Compare full files', { exact: true }).click();
    assert.equal(await page.getByLabel('Saved local file to publish', { exact: true }).inputValue(), changed);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'The review fits the screen');
    const publish = page.getByRole('button', { name: 'Publish this file', exact: true });
    assert.ok(await publish.isDisabled(), 'Publication requires explicit review and a message');
    await page.getByLabel('Describe this public update', { exact: true }).fill('Update the reviewed website label');
    await page.getByRole('checkbox').check();
    await publish.click();
    await page.getByRole('status').filter({ hasText: 'updates after verification passes' }).waitFor();
    assert.equal(state.publishes.length, 1);
    assert.equal(state.publishes[0].content, changed);
    assert.equal(state.publishes[0].expectedSha, 'a'.repeat(40));
    assert.equal(state.publishes[0].filePath, filePath);
    assert.equal(state.publishes[0].confirmed, true);

    await page.getByRole('button', { name: 'Review for public update', exact: true }).click();
    await changes.waitFor();
    state.content = "export const label = 'External editor change';\n";
    await page.getByLabel('Describe this public update', { exact: true }).fill('Do not overwrite an external edit');
    await page.getByRole('checkbox').check();
    await publish.click();
    await page.getByRole('alert').filter({ hasText: 'changed on disk' }).waitFor();
    assert.equal(state.publishes.length, 1, 'An external edit invalidates the reviewed local file');
    await step(page, 'Edit');
    await page.getByRole('button', { name: 'Reload file', exact: true }).click();
    await page.waitForFunction(content => document.querySelector('#local-web-content')?.value === content, state.content);
    await editor.fill('unsaved change preserved after a conflict');
    state.staleSave = true;
    await page.getByRole('button', { name: 'Save locally', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'local file changed' }).waitFor();
    assert.equal(await editor.inputValue(), 'unsaved change preserved after a conflict');
    assert.equal(state.saves.length, 1);
    state.staleSave = false;
    await page.getByRole('button', { name: 'Reset unsaved', exact: true }).click();
    assert.equal(await editor.inputValue(), state.content);
    await step(page, 'Publish');
    await page.getByRole('button', { name: 'Review for public update', exact: true }).click();
    await changes.waitFor();
    await page.getByLabel('Describe this public update', { exact: true }).fill('Review public concurrency handling');
    await page.getByRole('checkbox').check();
    state.failPublish = true;
    await publish.click();
    await page.getByRole('alert').filter({ hasText: 'public file changed' }).waitFor();
    assert.equal(state.publishes.length, 1, 'A stale public file cannot be overwritten');
    assert.equal(await editor.inputValue(), state.content, 'Publication failures preserve local work');
    assert.equal(await page.getByLabel('Current public release source', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/local-web-${width}.png`), fullPage: true });
    await context.close();
    console.log(`PASS: Local preview, edits, review, publication and conflict protection at ${width}px`);
  }
  const context = await browser.newContext();
  const state = await fixture(context);
  const page = await context.newPage();
  await open(page, hostedUrl);
  assert.equal(state.localCalls.length, 0, 'Hosted Office never probes local files or services');
  assert.equal(await page.locator('iframe').count(), 0, 'Hosted Office does not embed a local service');
  const hostedStart = page.getByRole('link', { name: 'Start phone connection', exact: true });
  assert.ok(await hostedStart.isVisible(), 'Hosted Office shows where to start a phone connection');
  assert.equal(await hostedStart.getAttribute('href'), 'http://127.0.0.1:4174/#local-web', 'Starting a phone connection opens the local workspace');
  await context.close();
  console.log('PASS: Hosted Local web tab requires the local console');
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phoneState = await fixture(phoneContext, true);
  const phonePage = await phoneContext.newPage();
  await open(phonePage, localUrl);
  await phonePage.getByLabel('Website file', { exact: true }).selectOption(filePath);
  await phonePage.getByLabel(filePath, { exact: true }).fill('phone edit');
  await phonePage.getByRole('button', { name: 'Save locally', exact: true }).click();
  await phonePage.getByRole('status').filter({ hasText: 'Refresh the phone preview' }).waitFor();
  assert.equal(phoneState.content, 'phone edit');
  assert.equal(await phonePage.getByRole('button', { name: 'Start phone connection', exact: true }).count(), 0, 'A connected phone cannot open more connections');
  await step(phonePage, 'Preview');
  const phonePreview = phonePage.getByRole('link', { name: 'Open phone preview', exact: true });
  assert.ok(await phonePreview.isVisible());
  assert.equal(await phonePreview.getAttribute('href'), 'https://phone-preview.trycloudflare.com');
  assert.equal(await phonePage.getByRole('button', { name: 'Refresh', exact: true }).count(), 0, 'The phone preview is refreshed in its own tab');
  assert.equal(await phonePage.locator('iframe').count(), 0, 'Phone preview is isolated from the file editor on its own secure origin');
  await open(phonePage, hostedUrl);
  await phonePage.getByLabel('Computer connection link', { exact: true }).fill('javascript:alert(1)');
  assert.equal(await phonePage.getByRole('link', { name: 'Connect to my computer', exact: true }).count(), 0);
  assert.ok(await phonePage.getByRole('button', { name: 'Connect to my computer', exact: true }).isDisabled());
  await phonePage.getByText('Use the https://…trycloudflare.com link shown on your computer.', { exact: true }).waitFor();
  await phonePage.getByLabel('Computer connection link', { exact: true }).fill('https://my-computer.trycloudflare.com');
  assert.equal(await phonePage.getByRole('link', { name: 'Connect to my computer', exact: true }).getAttribute('href'), 'https://my-computer.trycloudflare.com/#local-web');
  assert.equal(await phonePage.getByRole('link', { name: 'Open local web workspace', exact: true }).isVisible(), false, 'Phones are not sent to their own localhost');
  assert.equal(await phonePage.getByRole('link', { name: 'Start phone connection', exact: true }).isVisible(), false, 'Phones are not sent to their own localhost to start a connection');
  assert.ok(await phonePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await phonePage.screenshot({ path: path.join(root, '.cache/audit-ui/local-web-phone-connect.png'), fullPage: true });
  await phoneContext.close();
  console.log('PASS: Phone editing, isolated HTTPS preview and hosted phone connection flow');
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => server.close()));
}
