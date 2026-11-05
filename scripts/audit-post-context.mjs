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
const { PGlite } = require('../backend/node_modules/@electric-sql/pglite');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Connected community reads use persisted rows as their source of truth.
// Keep this audit's seeded and newly published posts in a real local database.
const pg = new PGlite();
await pg.exec(`CREATE TABLE community_posts (
  id TEXT PRIMARY KEY, group_id TEXT, author_id TEXT, author_name TEXT,
  author_title TEXT, title TEXT, content TEXT NOT NULL, url TEXT,
  source TEXT DEFAULT 'uficonnect', source_label TEXT, media_url TEXT, media_type TEXT,
  likes TEXT[] DEFAULT '{}', comments_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE community_groups (id TEXT PRIMARY KEY, is_private BOOLEAN DEFAULT false, created_by TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, joined_groups TEXT[] DEFAULT '{}');
INSERT INTO community_groups (id) VALUES ('ufi-general'), ('ufi-tech'), ('ufi-shop');
INSERT INTO users (id, joined_groups) VALUES ('post-context', ARRAY['ufi-general', 'ufi-tech']);
`);
const app = await createAppHarness({ connected: true,
  // Both the post query and the subsequent group-visibility filter use the
  // same persisted membership fixture as production's permission predicates.
  query: (sql, params) => /\b(?:community_posts|community_groups)\b/.test(sql) ? pg.query(sql, params) : { rows: [], rowCount: 0 },
});
app.seedUser(member('post-context', { joinedGroups: ['ufi-general', 'ufi-tech'] }));
await app.db.query(`INSERT INTO community_posts (id, group_id, author_id, content)
  VALUES ($1, $2, $3, $4)`, ['joined-tech-post', 'ufi-tech', 'post-context', 'A useful technology update from our joined community.']);
const seededFeed = await app.request('/posts?scope=ufi', { userId: 'post-context' });
assert.equal(seededFeed.status, 200, `Seeded community feed must load: ${app.errors.join('; ')}`);
assert.deepEqual(seededFeed.data.posts.map(post => post.id), ['joined-tech-post'], 'UFI includes persisted posts from joined communities');
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5209, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
async function openComposer(page, name) {
  const form = page.getByRole('form', { name, exact: true });
  const loading = form.getByRole('status').filter({ hasText: 'Loading connected accounts' });
  // Hold the fixture response until loading renders, so a fast response cannot
  // make a hidden-state wait pass before the effect has committed its layout.
  await page.route('**/api/social/platforms', async route => {
    await loading.waitFor({ state: 'visible' });
    await route.continue();
  }, { times: 1 });
  const [accounts] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/social/platforms'),
    page.getByRole('button', { name: 'Post', exact: true }).click(),
  ]);
  assert.equal(accounts.status(), 200, 'Publishing destinations must load before submitting');
  await form.waitFor();
  // Removing the loading row moves Publish. Submit only after that layout update.
  await loading.waitFor({ state: 'hidden' });
  assert.ok(await form.locator('textarea').evaluate(input => input === document.activeElement),
    'Opening the composer focuses its textarea before further interaction');
  return form;
}
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
      const form = await openComposer(page, `Create ${area} post`);
      assert.equal(await form.getByText('Post to:', { exact: true }).count(), 0);
      const bodyInput = area === 'Shop' ? form.getByLabel('Description', { exact: true }) : form.getByRole('textbox');
      assert.equal(await bodyInput.inputValue(), '');
      const content = `A thoughtful ${area} update from our community at ${width}.`;
      let publishedContent = content;
      if (area === 'Shop') {
        assert.equal(await form.getByLabel('Item title', { exact: true }).inputValue(), '', 'Shop title starts empty in its own posting context');
        assert.equal(await form.getByLabel('Price', { exact: true }).inputValue(), '', 'Shop price starts empty in its own posting context');
        await form.getByLabel('Item title', { exact: true }).fill(`Community item ${width}`);
        await form.getByLabel('Price', { exact: true }).fill('24.50');
        await form.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('EUR');
        publishedContent = `Item: Community item ${width}\nPrice: EUR 24.50\n\n${content}`;
      }
      await bodyInput.fill(content);
      const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/groups/${groupId}/posts`));
      await form.getByRole('button', { name: 'Publish to 1 ready destination', exact: true }).click();
      assert.equal((await response).status(), 201);
      assert.ok(app.queries.some(q => q.sql.includes('INSERT INTO community_posts') && q.params[1] === groupId && q.params[4] === publishedContent));
      const persisted = await pg.query('SELECT group_id, content FROM community_posts WHERE author_id=$1 AND content=$2', ['post-context', publishedContent]);
      assert.deepEqual(persisted.rows, [{ group_id: groupId, content: publishedContent }]);
      await page.getByText(content, { exact: true }).waitFor();
      if (area === 'Shop') {
        assert.equal(await page.getByText('A useful technology update from our joined community.', { exact: true }).count(), 0);
      }
      const draftForm = await openComposer(page, `Create ${area} post`);
      const draftInput = area === 'Shop' ? draftForm.getByLabel('Description', { exact: true }) : draftForm.getByRole('textbox');
      await draftInput.fill('Unsubmitted draft stays in its posting area.');
      if (area === 'Shop') {
        await draftForm.getByLabel('Item title', { exact: true }).fill('Unsubmitted Shop item');
        await draftForm.getByLabel('Price', { exact: true }).fill('10.00');
      }
    }
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/post-context-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Composer must fit the viewport');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'groups/ufi-tech');
    // A lazy route can retain the previous Shop UI while its module loads.
    // Wait for this group's content before using a shared button label.
    const groupName = app.groups.find(group => group.id === 'ufi-tech').name;
    await page.getByRole('heading', { name: groupName, exact: true }).waitFor();
    const groupForm = await openComposer(page, `Create post in ${groupName}`);
    assert.equal(await groupForm.getByRole('textbox').inputValue(), '', 'Group composer must not inherit the Shop draft');
    await groupForm.getByRole('textbox').fill(`Technology community update for ${width}.`);
    const groupResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/groups/ufi-tech/posts'));
    await groupForm.getByRole('button', { name: 'Publish to 1 ready destination', exact: true }).click();
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
} finally { await browser?.close(); await server.close(); await app.close(); await pg.close(); }
