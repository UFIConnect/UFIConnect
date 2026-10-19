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
  { source: 'uficonnect', isExternal: false, author: { id: 'menu-reader', name: 'Menu reader' }, own: true,
    links: { 'Open post': '/p/menu-audit' }, profile: '/profile', forbidden: ['Watch on YouTube', 'Open Watch later on YouTube'] },
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
  for (const { width, height } of [{ width: 320, height: 568 }, { width: 390, height: 560 }, { width: 1440, height: 850 }]) {
    const context = await browser.newContext({ viewport: { width, height } });
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
      for (const [name, href] of Object.entries(fixture.links)) {
        const direct = href === fixture.sourceUrl || name === 'Open post';
        if (!direct) continue; // Source-specific commands are checked on every page below.
        const item = page.locator('.post-chrome-source-link');
        assert.equal(await item.getAttribute('href'), href, `${name} keeps its real destination`);
        if (href.startsWith('https:')) {
          assert.equal(await item.getAttribute('target'), '_blank');
          assert.match(await item.getAttribute('rel'), /noopener/);
        }
      }
      const seen = new Set(), checkedLinks = new Set(), pageCommands = [];
      let checkedProfile = false;
      const commands = menu.locator(':scope > [role="menuitem"]');
      const labels = () => commands.evaluateAll(items => items.map(item => item.getAttribute('aria-label') ||
        [...item.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()));
      for (let pageIndex = 0; ; pageIndex++) {
        assert.ok(pageIndex < 12, 'Pagination terminates within the bounded menu');
        await page.waitForFunction(() => {
          const openMenu = document.querySelector('[role="menu"]:not([hidden])');
          return openMenu?.querySelector('[role="menuitem"]:not(:disabled)') === document.activeElement;
        });
        const bounds = await menu.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1,
          `${fixture.source} options page ${pageIndex + 1} fits ${width}x${height}`);
        const currentLabels = await labels();
        assert.ok(currentLabels.length > 0 && currentLabels.length <= 4, 'Every page has at most four commands, excluding navigation');
        for (const label of currentLabels) {
          assert.ok(!seen.has(label), `Command appears once across all pages: ${label}`);
          seen.add(label);
        }
        pageCommands.push(currentLabels);
        assert.equal(await menu.getByRole('menuitem', { name: /^(?:Open post|Open on |Open original post|Open Reddit discussion|Watch on |Read original city guide)/ }).count(), 0,
          'Original post navigation stays outside every options page');
        for (const [name, href] of Object.entries(fixture.links)) {
          if (href === fixture.sourceUrl || name === 'Open post') continue;
          const item = menu.getByRole('menuitem', { name, exact: true });
          if (!await item.count()) continue;
          assert.equal(await item.getAttribute('href'), href, `${name} keeps its real destination`);
          assert.equal(await item.getAttribute('target'), '_blank');
          assert.match(await item.getAttribute('rel'), /noopener/);
          checkedLinks.add(name);
        }
        const profile = menu.getByRole('menuitem', { name: /^Go to profile/ });
        if (await profile.count()) {
          checkedProfile = true;
          if (fixture.profile) assert.equal(await profile.getAttribute('href'), fixture.profile, 'Profile keeps the actual author destination');
          else assert.equal(await profile.isDisabled(), true, 'Unavailable profiles never invent a destination');
        }
        for (const name of fixture.forbidden) assert.equal(await menu.getByRole('menuitem', { name, exact: true }).count(), 0,
          `${fixture.source} omits unrelated or unavailable command on every page: ${name}`);
        if (!fixture.own) {
          assert.equal(await menu.getByRole('menuitem', { name: 'Edit post', exact: true }).count(), 0);
          assert.equal(await menu.getByRole('menuitem', { name: 'Delete post', exact: true }).count(), 0);
        } else assert.equal(await menu.getByRole('menuitem', { name: 'Report post', exact: true }).count(), 0);
        assert.ok(await menu.locator('a').evaluateAll(links => links.every(link => {
          const url = new URL(link.href);
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
        })), 'Every page rejects executable schemes and credential-bearing destinations');
        if (fixture.unsafe) assert.equal(await menu.locator('a').count(), 0, 'Unsafe source data creates no menu links');
        const enabled = menu.locator('[role="menuitem"]:not(:disabled)');
        await page.keyboard.press('End');
        assert.equal(await enabled.last().evaluate(el => document.activeElement === el), true);
        await page.keyboard.press('ArrowDown');
        assert.equal(await enabled.first().evaluate(el => document.activeElement === el), true, 'ArrowDown wraps to the first enabled item');
        await page.keyboard.press('ArrowUp');
        assert.equal(await enabled.last().evaluate(el => document.activeElement === el), true, 'ArrowUp wraps to the last enabled item');
        await page.keyboard.press('Home');
        assert.equal(await enabled.first().evaluate(el => document.activeElement === el), true);
        const next = menu.getByRole('menuitem', { name: 'Next options', exact: true });
        if (!await next.count()) { assert.equal(pageIndex, 0); break; }
        assert.equal(await menu.getByRole('menuitem', { name: 'Previous options', exact: true }).isDisabled(), pageIndex === 0);
        assert.match(await menu.locator('.post-chrome-menu-pages').innerText(), new RegExp(`${pageIndex + 1} / \\d+`));
        if (await next.isDisabled()) break;
        assert.equal(currentLabels.length, 4, 'Every non-final page contains four commands');
        await next.focus();
        await page.keyboard.press('Enter');
      }
      assert.equal(checkedProfile, true, 'Profile availability is checked even when it is on a later page');
      for (const [name, href] of Object.entries(fixture.links)) {
        if (href !== fixture.sourceUrl && name !== 'Open post') assert.ok(checkedLinks.has(name), `Later source action remains reachable: ${name}`);
      }
      assert.equal(seen.has('Report post'), !fixture.own, 'Reporting remains reachable only for another author');
      assert.equal(seen.has('Edit post'), Boolean(fixture.own), 'Edit remains reachable only for the post owner');
      assert.equal(seen.has('Delete post'), Boolean(fixture.own), 'Delete remains reachable only for the post owner');
      for (let previous = pageCommands.length - 2; previous >= 0; previous--) {
        await menu.getByRole('menuitem', { name: 'Previous options', exact: true }).click();
        assert.deepEqual(await labels(), pageCommands[previous], 'Previous restores the same command page');
      }
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      assert.equal(await more.evaluate(el => document.activeElement === el), true);
      assert.equal(page.url(), currentUrl, 'Escape closes only the menu');
      await page.keyboard.press('ArrowUp');
      await menu.waitFor({ state: 'visible' });
      const enabled = menu.locator('[role="menuitem"]:not(:disabled)');
      await page.waitForFunction(() => {
        const items = document.querySelector('[role="menu"]:not([hidden])')?.querySelectorAll('[role="menuitem"]:not(:disabled)');
        return items?.length && items[items.length - 1] === document.activeElement;
      });
      assert.deepEqual(await labels(), pageCommands[0], 'Reopening resets to the first options page');
      assert.equal(await enabled.last().evaluate(el => document.activeElement === el), true, 'ArrowUp opens at the last enabled item');
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: every four-command options page, source destinations, safe URLs, keyboard navigation and ownership at ${width}x${height}`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
