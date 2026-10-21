// Browser integration for source-specific destinations and menu accessibility.
// All posts and responses are synthetic; external pages are never contacted.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('menu-reader'));
const channel = 'UCabcdefghijklmnopqrstuv';
const fixtures = [
  { source: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=audittest01',
    author: { id: `youtube_${channel}`, name: 'Audit channel', channelId: channel },
    links: { 'Watch on YouTube': 'https://www.youtube.com/watch?v=audittest01',
      'View channel playlists on YouTube': `https://www.youtube.com/channel/${channel}/playlists`,
      'Open Watch later on YouTube': 'https://www.youtube.com/playlist?list=WL' },
    profile: `https://www.youtube.com/channel/${channel}`, forbidden: ['Open Reddit discussion', 'View r/audit'] },
  { source: 'reddit', sourceUrl: 'https://www.reddit.com/r/audit/comments/abcd/synthetic_post/',
    author: { id: 'reddit_menu_author', name: 'menu_author' },
    links: { 'Open Reddit discussion': 'https://www.reddit.com/r/audit/comments/abcd/synthetic_post/', 'View r/audit': 'https://www.reddit.com/r/audit/' },
    profile: 'https://www.reddit.com/user/menu_author/', forbidden: ['Watch on YouTube', 'Open Watch later on YouTube'] },
  { source: 'mastodon', sourceUrl: 'https://mastodon.example/@author/12345',
    author: { name: 'Mastodon author', profileUrl: 'https://mastodon.example/@author' },
    links: { 'Open on Mastodon': 'https://mastodon.example/@author/12345' },
    profile: 'https://mastodon.example/@author', forbidden: ['Watch on YouTube', 'View r/audit'] },
  { source: 'github', sourceUrl: 'https://github.com/audit/project/issues/12',
    author: { id: 'github_audit', name: 'Audit maintainer' },
    links: { 'Open on GitHub': 'https://github.com/audit/project/issues/12', 'View repository on GitHub': 'https://github.com/audit/project' },
    profile: 'https://github.com/audit', forbidden: ['Watch on YouTube', 'View r/audit'] },
  { source: 'uficonnect', isExternal: false, author: { id: 'community-member', name: 'Community member' },
    links: { 'Open post': '/p/menu-audit' }, profile: '/u/community-member', forbidden: ['Watch on YouTube', 'Open Watch later on YouTube'] },
  ...[
    ['wikivoyage', 'https://en.wikivoyage.org/wiki/Tokyo', 'Read original city guide', 'plane'],
    ['restaurants', 'https://www.openstreetmap.org/node/123', 'Open on Restaurants', 'utensils'],
    ['bars', 'https://www.openstreetmap.org/node/456', 'Open on Bars and clubs', 'martini'],
  ].map(([source, sourceUrl, label, icon]) => ({ source, sourceUrl, links: { [label]: sourceUrl }, icon,
    author: { name: 'Local discovery' }, profile: null, forbidden: ['Watch on YouTube', 'Open Watch later on YouTube'] })),
  { source: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=audittest01',
    author: { name: 'A display name is not a channel' },
    links: { 'Watch on YouTube': 'https://www.youtube.com/watch?v=audittest01' }, profile: null,
    forbidden: ['View channel playlists on YouTube', 'View YouTube channel'] },
  { source: 'youtube', sourceUrl: 'https://example.invalid/article', author: { name: 'Unknown publisher' },
    links: { 'Open original post': 'https://example.invalid/article' }, profile: null,
    forbidden: ['Watch on YouTube', 'Open Watch later on YouTube', 'View channel playlists on YouTube'] },
  ...['javascript:alert(1)', 'https://user:secret@www.youtube.com/watch?v=audittest01'].map(sourceUrl => ({
    source: 'youtube', sourceUrl, author: { name: 'Unavailable author', profileUrl: 'javascript:alert(2)' }, links: {}, profile: null,
    forbidden: ['Watch on YouTube', 'Open original post', 'Copy original link', 'Open Watch later on YouTube', 'View channel playlists on YouTube'], unsafe: true,
  })),
];
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5258, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let fixture = fixtures[0];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(origin).origin) return route.abort();
      const endpoint = url.pathname.replace(/^\/api/, '');
      if (endpoint === '/feed/menu-audit') return route.fulfill({ json: { post: {
        id: 'menu-audit', title: 'Source menu audit', content: 'Synthetic source menu fixture.',
        isExternal: true, likesCount: 4, commentsCount: 0, createdAt: '2026-10-08T10:00:00Z', ...fixture,
      } } });
      if (endpoint === '/feed/menu-audit/comments') return route.fulfill({ json: { comments: [], hasMore: false } });
      if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: {} } });
      if (/(?:events|stream)/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'menu-reader');
    await auditNavigate(page, origin + 'p/menu-audit');
    for (fixture of fixtures) {
      await page.goto(origin + 'p/menu-audit', { waitUntil: 'domcontentloaded' });
      const more = page.getByRole('button', { name: 'More options', exact: true });
      await more.waitFor();
      await more.scrollIntoViewIfNeeded();
      const currentUrl = page.url();
      if (fixture.icon) assert.equal(await page.locator(`.post-chrome-source-link .lucide-${fixture.icon}`).count(), 1,
        `${fixture.source} has its category icon on the direct link`);
      await more.focus();
      await page.keyboard.press('ArrowDown');
      const menu = page.getByRole('menu');
      await menu.waitFor({ state: 'visible' });
      assert.equal(await menu.evaluate(el => el.parentElement === document.body), true, 'Menu is portaled outside clipping containers');
      const bounds = await menu.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 851,
        `${fixture.source} menu fits ${width}px viewport`);
      assert.equal(await menu.locator('[role="menuitem"]:not(:disabled)').first().evaluate(el => document.activeElement === el), true,
        'ArrowDown opens at the first menu item');
      async function checkDestination(item, name, href) {
        assert.equal(await item.getAttribute('href'), href, `${name} keeps its real destination`);
        if (href.startsWith('https:')) {
          assert.equal(await item.getAttribute('target'), '_blank');
          assert.match(await item.getAttribute('rel'), /noopener/);
        }
      }
      const sourceCommands = Object.entries(fixture.links).filter(([name, href]) => href !== fixture.sourceUrl && name !== 'Open post');
      for (const [name, href] of Object.entries(fixture.links).filter(([name, href]) => href === fixture.sourceUrl || name === 'Open post')) {
        await checkDestination(page.locator('.post-chrome-source-link'), name, href);
      }
      const reached = new Set(), firstPageLabels = await menu.locator(':scope > [role="menuitem"]').allTextContents();
      const nextPage = menu.getByRole('menuitem', { name: 'Next options', exact: true });
      const previousPage = menu.getByRole('menuitem', { name: 'Previous options', exact: true });
      const pages = menu.getByRole('group', { name: 'Post options pages', exact: true });
      const paginated = await nextPage.count() > 0;
      const pageCount = paginated ? Number((await pages.locator('[role="presentation"]').innerText()).split('/')[1].trim()) : 1;
      assert.ok(Number.isInteger(pageCount) && pageCount > 0 && pageCount <= 10, 'The actual menu has a bounded number of command pages');
      let profiles = 0, reports = 0;
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const commands = menu.locator(':scope > [role="menuitem"]');
        const commandCount = await commands.count();
        assert.ok(commandCount > 0 && commandCount <= 4, 'Each page contains at most four commands');
        if (pageIndex + 1 < pageCount) assert.equal(commandCount, 4, 'Non-final pages contain four commands');
        if (paginated) {
          assert.equal(await previousPage.isDisabled(), pageIndex === 0, 'Previous is disabled only at the first page');
          assert.equal(await nextPage.isDisabled(), pageIndex + 1 === pageCount, 'Next is disabled only at the last page');
          assert.equal(await pages.locator('[role="presentation"]').innerText(), `${pageIndex + 1} / ${pageCount}`);
        }
        const pageBounds = await menu.boundingBox();
        assert.ok(pageBounds.x >= 0 && pageBounds.y >= 0 && pageBounds.x + pageBounds.width <= width + 1 && pageBounds.y + pageBounds.height <= 851,
          'Every command page fits the viewport');
        for (const [name, href] of sourceCommands) {
          const item = menu.getByRole('menuitem', { name, exact: true });
          if (!(await item.count())) continue;
          assert.equal(await item.count(), 1);assert.equal(reached.has(name), false, 'Commands are not duplicated between pages');
          await checkDestination(item, name, href);reached.add(name);
        }
        assert.equal(await menu.getByRole('menuitem', { name: /^(?:Open post|Open on |Open original post|Open Reddit discussion|Watch on |Read original city guide)/ }).count(), 0,
          'Original post navigation stays outside every options page');
        const profile = menu.getByRole('menuitem', { name: /^Go to profile/ });
        profiles += await profile.count();
        if (await profile.count()) {
          if (fixture.profile) assert.equal(await profile.getAttribute('href'), fixture.profile, 'Existing profile action retains the author destination');
          else assert.equal(await profile.isDisabled(), true, 'No profile action invents a channel or links to the post');
        }
        reports += await menu.getByRole('menuitem', { name: 'Report post', exact: true }).count();
        for (const name of fixture.forbidden) assert.equal(await menu.getByRole('menuitem', { name, exact: true }).count(), 0,
          `${fixture.source} omits unrelated or unavailable commands on every page: ${name}`);
        assert.equal(await menu.getByRole('menuitem', { name: 'Edit post', exact: true }).count(), 0);
        assert.equal(await menu.getByRole('menuitem', { name: 'Delete post', exact: true }).count(), 0);
        assert.ok(await menu.locator('a').evaluateAll(links => links.every(link => {
          const url = new URL(link.href);
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
        })), 'Every page rejects executable schemes and credential-bearing URLs');
        if (fixture.unsafe) assert.equal(await menu.locator('a').count(), 0, 'Unsafe source data creates no menu links on any page');
        if (pageIndex + 1 < pageCount) {
          await nextPage.click();
          await pages.getByText(`${pageIndex + 2} / ${pageCount}`, { exact: true }).waitFor();
        }
      }
      assert.deepEqual([...reached].sort(), sourceCommands.map(([name]) => name).sort(), 'Every source command remains reachable through actual page controls');
      assert.equal(profiles, 1, 'The profile command occurs exactly once');
      assert.equal(reports, 1, 'Report remains reachable exactly once');
      for (let pageIndex = pageCount - 1; pageIndex > 0; pageIndex--) {
        await previousPage.click();
        await pages.getByText(`${pageIndex} / ${pageCount}`, { exact: true }).waitFor();
      }
      assert.deepEqual(await menu.locator(':scope > [role="menuitem"]').allTextContents(), firstPageLabels, 'Previous returns to the original commands');
      const enabled = menu.locator('[role="menuitem"]:not(:disabled)');
      assert.equal(await enabled.first().evaluate(el => document.activeElement === el), true, 'Returning to the first page focuses its first command');
      await page.keyboard.press('End');
      assert.equal(await enabled.last().evaluate(el => document.activeElement === el), true);
      await page.keyboard.press('Home');
      assert.equal(await enabled.first().evaluate(el => document.activeElement === el), true);
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      assert.equal(await more.evaluate(el => document.activeElement === el), true);
      assert.equal(page.url(), currentUrl, 'Escape closes only the menu');
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: source-specific menus, canonical destinations, safe URLs, keyboard navigation and ownership at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
