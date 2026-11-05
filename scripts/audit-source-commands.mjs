import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, transformWithOxc } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/source-command-qa');
const samples = [
  ['mastodon', 'https://mastodon.social/@fixture/123456789', 'Favourite', 'favourites', 'star'],
  ['reddit', 'https://www.reddit.com/r/test/comments/abc123/test/', 'Upvote', 'points', 'arrow-big-up'],
  ['github', 'https://github.com/example/project/issues/1', 'Star repository', 'stars', 'star'],
  ['gitlab', 'https://gitlab.com/example/project/-/issues/1', 'Star project', 'stars', 'star'],
  ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Like', 'likes', 'thumbs-up'],
  ['twitter', 'https://x.com/fixture/status/123456', 'Like', 'likes', 'heart'],
  ['medium', 'https://medium.com/@fixture/article', 'Clap', 'claps', 'hand'],
  ['arxiv', 'https://arxiv.org/abs/1234.56789', null, null, null],
];
const posts = samples.map(([source, sourceUrl]) => ({ id: `command-${source}`, source, sourceUrl, isExternal: true,
  title: `${source} command fixture`, content: 'A source post for checking the available commands.',
  author: { name: 'Fixture author' }, sourceLikesCount: 12, sourceLikedByMe: false, commentsCount: 0, createdAt: new Date().toISOString() }));
const fixture = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
import{ToastProvider}from'/src/contexts/ToastContext';import{SavedItemsProvider}from'/src/contexts/SavedItemsContext';import{PostCard}from'/src/pages/Feed.jsx';
import'/src/index.css';window.__profile={id:'fixture-member',name:'Fixture member',roleSettings:{}};
function Fixture(){const[posts,setPosts]=useState(${JSON.stringify(posts)});return <ToastProvider><SavedItemsProvider><main style={{maxWidth:640,margin:'20px auto',padding:12}}>{posts.map(post=><section key={post.id} aria-label={post.source+' fixture'}><PostCard post={post} onPostUpdated={patch=>setPosts(rows=>rows.map(row=>row.id===patch.id?{...row,...patch}:row))}/></section>)}</main></SavedItemsProvider></ToastProvider>}
createRoot(document.getElementById('root')).render(<BrowserRouter><Fixture/></BrowserRouter>);`;
const server = await createServer({ root: path.join(root, 'web'), envDir: false, cacheDir: path.join(output, 'vite'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  plugins: [{ name: 'source-command-fixture', enforce: 'pre', resolveId(id) {
    if (/contexts\/AuthContext(?:\.jsx)?$/.test(id) || id === './AuthContext') return '\0fixture-auth';
    if (id === 'virtual:source-commands.jsx') return '\0source-commands';
  }, async load(id) {
    if (id === '\0fixture-auth') return `export function useAuth(){return{profile:window.__profile,token:'fixture'}}`;
    if (id === '\0source-commands') return (await transformWithOxc(fixture, 'fixture.jsx', { jsx: { runtime: 'automatic' } })).code;
  }, configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (new URL(req.url, 'http://fixture.invalid').pathname !== '/') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:source-commands.jsx"></script></body></html>'));
  }); } }], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
let browser;
const results = [];
try {
  await fs.mkdir(output, { recursive: true }); await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const send = data => route.fulfill({ json: data });
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        const endpoint = url.pathname.slice(4);
        if (endpoint === '/social/interaction-capabilities') return send({ sources: Object.fromEntries(samples.map(([source]) => [source,
          { connected: true, like: !['medium', 'arxiv'].includes(source), comment: !['medium', 'arxiv'].includes(source), label: { mastodon: 'Mastodon', reddit: 'Reddit', github: 'GitHub', gitlab: 'GitLab', youtube: 'YouTube', twitter: 'X', medium: 'Medium' }[source] || source }])) });
        if (endpoint === '/social/interactions') {
          const body = route.request().postDataJSON(); writes.push(body);
          return send(body.action === 'like' ? { published: true, liked: body.liked, likesCount: 13 }
            : { published: true, commentId: 'confirmed-reply', commentsCount: 1 });
        }
        if (endpoint.endsWith('/comments')) return send({ comments: [], commentsCount: 0, live: true, hasMore: false });
        return send({ postIds: [], jobs: [], sources: [] });
      }
      if (url.origin === origin) return route.continue();
      return route.fulfill({ status: 403, body: 'Live providers are disabled in this audit.' });
    });
    await page.goto(origin);
    for (const [source, , action, metric, icon] of samples) {
      const region = page.getByRole('region', { name: `${source} fixture`, exact: true });
      await region.waitFor();
      const reaction = region.locator('.post-chrome-like');
      if (!action) { assert.equal(await reaction.count(), 0); continue; }
      const control = reaction.locator('button, a').first();
      await control.waitFor();
      assert.match(await control.getAttribute('aria-label'), new RegExp(`${action === 'Clap' ? 'clap' : action}.*12 ${metric}`, 'i'));
      if (icon !== 'heart') assert.equal(await control.locator(`svg.lucide-${icon}`).count(), 1);
    }
    const mastodon = page.getByRole('region', { name: 'mastodon fixture', exact: true });
    await mastodon.getByRole('button', { name: 'Favourite on Mastodon, 12 favourites', exact: true }).click();
    await mastodon.getByRole('button', { name: 'Remove favourite on Mastodon, 13 favourites', exact: true }).waitFor();
    await mastodon.getByRole('button', { name: /^Show Replies/ }).click();
    await mastodon.getByLabel('Write a reply on Mastodon', { exact: true }).fill('A reply using the Mastodon command.');
    await mastodon.getByRole('button', { name: 'Reply on Mastodon', exact: true }).click();
    await mastodon.locator('.post-comment-body p').filter({ hasText: 'A reply using the Mastodon command.' }).waitFor();
    await mastodon.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Favourites on Mastodon/ }).waitFor();
    assert.equal(await page.getByRole('menuitem', { name: /^Likes on Mastodon/ }).count(), 0);
    for (const name of [/^Open Mastodon to boost/, /^Open Mastodon to bookmark/]) {
      for (let turn = 0; turn < 5 && !await page.getByRole('menuitem', { name }).count(); turn++) await page.getByRole('menuitem', { name: 'Next options', exact: true }).click();
      assert.equal(await page.getByRole('menuitem', { name }).getAttribute('href'), samples[0][1]);
    }
    assert.deepEqual(writes.map(({ source, action }) => ({ source, action })), [{ source: 'mastodon', action: 'like' }, { source: 'mastodon', action: 'comment' }]);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `commands-${width}.png`) });
    results.push({ width, passed: true, sources: samples.length });
    console.log(`PASS source commands, icons, favourites, replies and provider navigation at ${width}px`);
    await context.close();
  }
} finally {
  await browser?.close(); await server.close();
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(results, null, 2));
}
