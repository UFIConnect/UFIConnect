import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness({ connected: true });
app.seedUser(member('post-context', { joinedGroups: ['ufi-general', 'ufi-tech'] }));
app.posts.push({ id: 'joined-tech-post', groupId: 'ufi-tech', authorId: 'post-context', source: 'uficonnect', content: 'A useful technology update from our joined community.', createdAt: new Date().toISOString(), likes: [], commentsCount: 0 });
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5209, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width <= 768, isMobile: width < 600 });
    const page = await context.newPage();
    await installAuditMember(page, app, 'post-context');
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/groups/internal', route => route.fulfill({ json: { groups: [{ id: 'ufi-tech', name: 'Technology' }] } }));
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=ufi');
    await page.getByText('A useful technology update from our joined community.', { exact: true }).waitFor();
    for (const [area, groupId, location] of [['UFI', 'ufi-general', '/?feed=ufi'], ['Shop', 'ufi-shop', '/?feed=ufi&channel=shop']]) {
      // Same-document navigation exercises state isolation, not a page reload.
      await page.evaluate(url => { history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, location);
      // Wait for the destination area to commit before using its shared Post label.
      await page.getByRole('button', { name: 'Filter UFI posts by topic', exact: true })
        .waitFor({ state: area === 'Shop' ? 'hidden' : 'visible' });
      await page.getByRole('button', { name: 'Post', exact: true }).click();
      const form = page.getByRole('form', { name: `Create ${area} post`, exact: true });
      await form.waitFor();
      assert.equal(await form.getByText('Post to:', { exact: true }).count(), 0);
      assert.equal(await form.getByRole('textbox').inputValue(), '');
      const content = `A thoughtful ${area} update from our community at ${width}.`;
      await form.getByRole('textbox').fill(content);
      const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/groups/${groupId}/posts`));
      await form.getByRole('button', { name: 'Publish', exact: true }).click();
      assert.equal((await response).status(), 201);
      assert.ok(app.queries.some(q => q.sql.includes('INSERT INTO community_posts') && q.params[1] === groupId && q.params[4] === content));
      await page.getByText(content, { exact: true }).waitFor();
      if (area === 'Shop') {
        assert.equal(await page.getByText('A useful technology update from our joined community.', { exact: true }).count(), 0);
      }
      await page.getByRole('button', { name: 'Post', exact: true }).click();
      await page.getByRole('form', { name: `Create ${area} post`, exact: true }).getByRole('textbox').fill('Unsubmitted draft stays in its posting area.');
    }
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/post-context-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Composer must fit the viewport');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'groups/ufi-tech');
    // A lazy route can retain the previous Shop UI while its module loads.
    // Wait for this group's content before using a shared button label.
    const groupName = app.groups.find(group => group.id === 'ufi-tech').name;
    await page.getByRole('heading', { name: groupName, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    const groupForm = page.getByRole('form', { name: `Create post in ${groupName}`, exact: true });
    assert.equal(await groupForm.getByRole('textbox').inputValue(), '', 'Group composer must not inherit the Shop draft');
    await groupForm.getByRole('textbox').fill(`Technology community update for ${width}.`);
    const groupResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/groups/ufi-tech/posts'));
    await groupForm.getByRole('button', { name: 'Publish', exact: true }).click();
    assert.equal((await groupResponse).status(), 201);
    await page.getByText(`Technology community update for ${width}.`, { exact: true }).waitFor();
    await page.evaluate(() => { history.pushState({}, '', '/?feed=ufi'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByText(`Technology community update for ${width}.`, { exact: true }).waitFor();
    assert.equal(await page.getByText(`A thoughtful Shop update from our community at ${width}.`, { exact: true }).count(), 0);
    await page.getByText(`A thoughtful UFI update from our community at ${width}.`, { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS: UFI, Shop and group posting contexts at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
