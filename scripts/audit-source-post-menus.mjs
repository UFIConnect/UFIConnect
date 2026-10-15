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
      const allCommands = [];
      const nextPage = menu.getByRole('menuitem', { name: 'Next options', exact: true });
      do {
        const commands = menu.locator(':scope > [role="menuitem"]');
        assert.ok(await commands.count() <= 4, 'Options show at most four commands per page');
        allCommands.push(...await commands.evaluateAll(items => items.map(item => ({
          name: item.textContent.trim(), href: item.getAttribute('href'), target: item.getAttribute('target'),
          rel: item.getAttribute('rel'), disabled: item.disabled === true,
        }))));
        if (!(await nextPage.count()) || await nextPage.isDisabled()) break;
        await nextPage.click();
      } while (true);
      const previousPage = menu.getByRole('menuitem', { name: 'Previous options', exact: true });
      while (await previousPage.count() && !(await previousPage.isDisabled())) await previousPage.click();
      for (const [name, href] of Object.entries(fixture.links)) {
        const direct = href === fixture.sourceUrl || name === 'Open post';
        const item = direct ? await page.locator('.post-chrome-source-link').evaluate(link => ({ href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel') })) : allCommands.find(item => item.name === name);
        assert.ok(item, `${name} remains reachable through the options pages`);
        assert.equal(item.href, href, `${name} keeps its real destination`);
        if (href.startsWith('https:')) {
          assert.equal(item.target, '_blank');
          assert.match(item.rel, /noopener/);
        }
      }
      assert.equal(await menu.getByRole('menuitem', { name: /^(?:Open post|Open on |Open original post|Open Reddit discussion|Watch on |Read original city guide)/ }).count(), 0,
        'Original post navigation stays outside the options menu');
      assert.equal(allCommands.filter(item => item.name === 'Report post').length, 1, 'Report remains reachable on the options pages');
      if (fixture.profile) {
        assert.equal(await menu.getByRole('menuitem', { name: /^Go to profile/ }).getAttribute('href'), fixture.profile,
          'Existing profile action retains the author destination');
      } else {
        const profile = menu.getByRole('menuitem', { name: /^Go to profile/ });
        if (await profile.count()) assert.equal(await profile.isDisabled(), true, 'No profile action invents a channel or links to the post');
      }
      for (const name of fixture.forbidden) assert.equal(allCommands.filter(item => item.name === name).length, 0,
        `${fixture.source} omits unrelated or unavailable command: ${name}`);
      assert.equal(allCommands.filter(item => item.name === 'Edit post').length, 0);
      assert.equal(allCommands.filter(item => item.name === 'Delete post').length, 0);
      if (!(await nextPage.count())) assert.equal(await menu.getByRole('menuitem', { name: 'Report post', exact: true }).count(), 1);
      assert.ok(allCommands.filter(item => item.href).every(item => {
        const url = new URL(item.href, origin);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
      }), 'All menu pages reject executable schemes and credential-bearing URLs');
      if (fixture.unsafe) assert.equal(allCommands.filter(item => item.href).length, 0, 'Unsafe source data creates no menu links');
      const enabled = menu.locator('[role="menuitem"]:not(:disabled)');
      assert.equal(await enabled.first().evaluate(el => document.activeElement === el), true, 'ArrowDown opens at the first menu item');
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
