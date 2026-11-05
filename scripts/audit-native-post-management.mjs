import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
app.seedUser(member('post-owner', { plan: 'pro' }));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5253, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge' });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], mutations = [];
    let post = { id: 'p_native_audit', source: 'uficonnect', isExternal: false, content: 'Original audit post', createdAt: new Date().toISOString(), authorId: 'post-owner', author: { id: 'post-owner', name: 'Post owner' }, likesCount: 0 };
    let reconnectRequired = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (endpoint === '/feed/p_native_audit') return route.fulfill({ json: { post } });
      if (endpoint === '/feed/p_native_audit/comments') return route.fulfill({ json: { comments: [], total: 0 } });
      if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: { mastodon: { label: 'Mastodon', connected: true, comment: !reconnectRequired, like: !reconnectRequired, reconnectRequired, maxLength: 500 } } } });
      if (endpoint === '/posts/p_native_audit' && route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON(); mutations.push({ method: 'PATCH', body }); post = { ...post, content: body.content };
        return route.fulfill({ json: { post } });
      }
      if (endpoint === '/posts/p_native_audit' && route.request().method() === 'DELETE') { mutations.push({ method: 'DELETE' }); return route.fulfill({ json: { deleted: true } }); }
      if (endpoint === '/social/interactions') { mutations.push(route.request().postDataJSON()); return route.fulfill({ json: { published: true, commentId: 'new-reply' } }); }
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'post-owner');
    const url = server.resolvedUrls.local[0] + 'p/p_native_audit';
    await auditNavigate(page, url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByText('Original audit post', { exact: true }).waitFor().catch(async error => { console.log('AUDIT VIEW', page.url(), errors, (await page.locator('body').innerText()).slice(0, 1600)); throw error; });
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit post', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit post' });
    await editor.getByLabel('Post text').fill('Edited audit post');
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Edited audit post', { exact: true }).waitFor();
    assert.deepEqual(mutations[0], { method: 'PATCH', body: { content: 'Edited audit post' } });
    await auditReload(page);
    await page.getByText('Edited audit post', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('menuitem', { name: 'Delete post', exact: true }).click();
    await page.waitForURL(value => value.pathname === '/');
    assert.equal(mutations.at(-1).method, 'DELETE');

    post = { ...post, authorId: 'other', author: { id: 'other', name: 'Other member' } };
    await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.getByText('Other member', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Edit post', exact: true }).count(), 0);
    assert.equal(await page.getByRole('menuitem', { name: 'Delete post', exact: true }).count(), 0);

    post = { ...post, source: 'mastodon', isExternal: true, sourceUrl: 'https://mastodon.social/@example/123', content: 'Mastodon comment test' };
    await auditReload(page);
    const comment = page.getByLabel('Write a reply on Mastodon'); await comment.waitFor();
    assert.ok((await comment.boundingBox()).height <= 45, 'Empty composer starts compact');
    await comment.fill('A line\n'.repeat(15));
    assert.ok((await comment.boundingBox()).height <= 112, 'Long comments stay bounded');
    await page.getByRole('button', { name: 'Reply on Mastodon' }).click();
    await page.waitForFunction(() => document.querySelector('.connected-post-actions textarea')?.value === '');
    assert.ok((await comment.boundingBox()).height <= 45, 'Composer shrinks after publishing');
    assert.equal(mutations.at(-1).action, 'comment');
    assert.equal(mutations.at(-1).sourceUrl, 'https://mastodon.social/@example/123');
    reconnectRequired = true;
    await page.evaluate(() => window.dispatchEvent(new Event('ufi-connections-changed')));
    const reconnect = page.getByRole('link', { name: 'Reconnect Mastodon to reply', exact: true }); await reconnect.waitFor();
    assert.equal(await reconnect.getAttribute('href'), '/connected-accounts?connect=mastodon');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('PASS native ownership, edit/save/delete, compact source replies and reconnect at ' + width);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
