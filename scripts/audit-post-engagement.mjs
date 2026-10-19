// Real UFI and Snap components, isolated API fixtures, no live account or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, transformWithOxc } from '../web/node_modules/vite/dist/node/index.js';
const root = path.resolve(process.env.ENGAGEMENT_QA_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = path.resolve(process.env.ENGAGEMENT_QA_OUTPUT || path.join(root, '.cache/engagement-polish-qa'));
const sourceFiles = ['web/src/components/PostEngagement.css', 'web/src/components/PostCardChrome.jsx', 'web/src/components/PostCardChrome.css', 'web/src/components/PostLikes.jsx', 'web/src/components/PostList.jsx', 'web/src/components/SnapInteractions.jsx', 'web/src/components/SnapViewer.jsx', 'web/src/components/SnapRail.css', 'web/src/pages/Feed.jsx', 'web/src/index.css', 'web/src/PublicTheme.css', 'web/public/appearance.css', 'scripts/audit-post-engagement.mjs'];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])));
const media = await fs.readFile(path.join(root, 'web/public/media/preparation/professional-introduction.png'));
const fixture = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
import{ToastProvider}from'/src/contexts/ToastContext';import{SavedItemsProvider}from'/src/contexts/SavedItemsContext';
import PostList from'/src/components/PostList.jsx';import{PostCard}from'/src/pages/Feed.jsx';import SnapViewer from'/src/components/SnapViewer.jsx';
import'/src/index.css';import'/src/PublicTheme.css';import'/src/components/SnapRail.css';
window.__profile={id:'member-a',name:'Alex Morgan',roleSettings:{}};
const base={source:'uficonnect',authorId:'member-b',author:{id:'member-b',name:'Jamie Chen',title:'Community member'},content:'A little progress today. What are you working on?',createdAt:new Date().toISOString(),likesCount:12,likedByMe:false,commentsCount:1};
function Fixture(){const[post,setPost]=useState({...base,id:'post-feed'}),[ufiPosts,setUfiPosts]=useState([{...base,id:'post-ufi'}]),[snapOpen,setSnapOpen]=useState(false);
const snap={id:'snap_00000000-0000-4000-8000-000000000001',source:'uficonnect',mediaType:'image',mediaUrl:'https://media.fixture.invalid/photo.png',author:base.author,caption:'A moment from today',createdAt:base.createdAt,expiresAt:new Date(Date.now()+86400000).toISOString()};
return <ToastProvider><SavedItemsProvider><main style={{maxWidth:660,margin:'24px auto',padding:12}}><h1 style={{fontSize:'1.1rem',marginBottom:16}}>Community</h1><section aria-label="UFI posts"><PostList posts={ufiPosts} currentUserId="member-a" onPostUpdated={patch=>setUfiPosts(values=>values.map(value=>value.id===patch.id?{...value,...patch}:value))}/></section><section aria-label="Home feed post"><PostCard post={post} onPostUpdated={patch=>setPost(value=>({...value,...patch}))}/></section><button className="btn btn-outline" onClick={()=>setSnapOpen(true)}>Open test Snap</button>{snapOpen&&<SnapViewer items={[snap]} index={0} now={Date.now()} profile={window.__profile} onClose={()=>setSnapOpen(false)}/>}</main></SavedItemsProvider></ToastProvider>}
createRoot(document.getElementById('root')).render(<BrowserRouter><Fixture/></BrowserRouter>);`;
const server = await createServer({ root: path.join(root, 'web'), envDir: false, cacheDir: path.join(output, 'vite'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  plugins: [{ name: 'engagement-fixture', enforce: 'pre', resolveId(id) {
    if (/contexts\/AuthContext(?:\.jsx)?$/.test(id) || id === './AuthContext') return '\0fixture-auth';
    if (id === 'virtual:engagement.jsx') return '\0virtual:engagement.jsx';
  }, async load(id) {
    if (id === '\0fixture-auth') return `export function useAuth(){return{profile:window.__profile,token:'fixture',updateProfileLocally:()=>{}}}`;
    if (id === '\0virtual:engagement.jsx') return (await transformWithOxc(fixture, 'engagement.jsx', { jsx: { runtime: 'automatic' } })).code;
  }, configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (new URL(req.url, 'http://fixture.invalid').pathname !== '/') return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/appearance.css"></head><body class="guest-shell"><div id="root"></div><script type="module" src="/@id/virtual:engagement.jsx"></script></body></html>'));
  }); } }], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
const checks = [], screenshots = [], failures = [];
const check = (value, message) => { assert.ok(value, message); checks.push(message); };
let browser;
try {
  await fs.mkdir(output, { recursive: true }); await server.listen(); const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch();
  for (const width of [320, 1024]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors = [], blocked = [], writes = [], liked = new Map();
    const comments = [{ id: 'comment-1', author: { id: 'member-c', name: 'Morgan Smith' }, content: 'A thoughtful update. Thanks for sharing it with the community.', createdAt: new Date().toISOString() }];
    const snapComments = [{ ...comments[0] }];
    await page.addInitScript(theme => { window.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = theme; }); }, theme);
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      if (url.hostname === 'media.fixture.invalid') return route.fulfill({ contentType: 'image/png', body: media });
      if (url.origin === new URL(origin).origin && url.pathname.startsWith('/api/')) {
        const endpoint = url.pathname.slice(4), body = method === 'POST' ? request.postDataJSON() : null;
        if (!['GET', 'HEAD'].includes(method)) writes.push({ endpoint, method, body });
        if (endpoint.endsWith('/like')) { liked.set(endpoint, body.liked); return json({ likesCount: 12 + Number(body.liked), likedByMe: body.liked, commentsCount: snapComments.length }); }
        if (endpoint.endsWith('/engagement')) return json({ likesCount: 12, likedByMe: false, commentsCount: snapComments.length });
        if (endpoint.endsWith('/comments')) {
          const rows = endpoint.startsWith('/snaps/') ? snapComments : comments;
          if (method === 'POST') {
            const comment = { id: body.requestId || 'comment-' + Date.now(), author: { id: 'member-a', name: 'Alex Morgan' }, content: body.content, createdAt: new Date().toISOString() };
            rows.push(comment); return json({ published: true, comment, commentsCount: rows.length });
          }
          return json({ comments: endpoint.startsWith('/feed/') ? rows.map(item => ({ ...item, author: item.author.name, body: item.content, created: item.createdAt })) : rows, commentsCount: rows.length, live: true, hasMore: false });
        }
        if (endpoint === '/saved/posts') return json({ postIds: [] });
        if (endpoint === '/jobs/tracking') return json({ jobs: [] });
        if (endpoint === '/posts/engaged') return json({ ok: true });
        if (endpoint === '/social/interaction-capabilities') return json({ sources: {} });
        if (endpoint === '/feed/engagement' || endpoint.startsWith('/engagement') || endpoint.includes('playback-status')) return json({});
        blocked.push(method + ' ' + endpoint); return json({});
      }
      if (url.origin === new URL(origin).origin) return route.continue();
      blocked.push(url.href); return route.fulfill({ status: 403, body: 'External traffic blocked' });
    });
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const posts = page.getByRole('region', { name: 'UFI posts' }), feed = page.getByRole('region', { name: 'Home feed post' });
      await posts.getByRole('button', { name: 'Like, 12 likes', exact: true }).waitFor();
      await posts.getByRole('button', { name: 'Like, 12 likes', exact: true }).click();
      await posts.getByRole('button', { name: 'Unlike, 13 likes', exact: true }).waitFor();
      check(writes.filter(item => item.endpoint === '/feed/post-ufi/like').length === 1, `${width}/${theme}: UFI like sends one confirmed request`);
      check(await posts.getByRole('button', { name: 'Unlike, 13 likes', exact: true }).textContent() === '13', `${width}/${theme}: compact like count retains full accessible label`);
      await posts.getByRole('button', { name: 'Show comments (1)', exact: true }).click();
      await posts.getByText(comments[0].content, { exact: true }).waitFor();
      await posts.getByLabel('Write a comment', { exact: true }).fill('A new comment from the UFI composer.');
      await posts.getByRole('button', { name: 'Send', exact: true }).click();
      await posts.getByText('A new comment from the UFI composer.', { exact: true }).waitFor();
      check(writes.filter(item => item.endpoint === '/posts/post-ufi/comments').length === 1, `${width}/${theme}: UFI comment publishes once`);
      check(await posts.getByLabel('Write a comment', { exact: true }).inputValue() === '', `${width}/${theme}: confirmed comment clears draft`);
      await feed.getByRole('button', { name: /^Show Comments/ }).click(); await feed.locator('.post-comment-body').first().waitFor();
      check(await posts.getByRole('button', { name: 'Unlike, 13 likes', exact: true }).count() === 1, `${width}/${theme}: like state survives comment publishing and parent updates`);
      for (const section of [posts, feed]) {
        const controls = await section.locator('.post-chrome-actions .post-chrome-action').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, width: r.width, height: r.height }; }));
        check(controls.every(rect => rect.width >= 43 && rect.height >= 43 && rect.x >= 0 && rect.right <= width + 1), `${width}/${theme}: post controls fit with 44px targets`);
        check(controls.every(rect => Math.abs(rect.y - controls[0].y) < 1), `${width}/${theme}: compact post controls remain on one row`);
        check(await section.locator('.post-comment-form input').evaluate(element => element.getBoundingClientRect().width > 80), `${width}/${theme}: comment input remains usable`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${theme}: posts/comments do not overflow the viewport`);
      let file = `posts-${width}-${theme}.png`; await page.screenshot({ path: path.join(output, file), fullPage: true }); screenshots.push(file);
      await page.getByRole('button', { name: 'Open test Snap', exact: true }).click();
      const viewer = page.locator('dialog.snap-viewer');
      await viewer.getByRole('button', { name: 'Like, 12 likes', exact: true }).click();
      await viewer.getByRole('button', { name: 'Unlike, 13 likes', exact: true }).waitFor();
      await viewer.getByRole('button', { name: 'Comments 1', exact: true }).click();
      await viewer.getByText(comments[0].content, { exact: true }).waitFor();
      await viewer.getByLabel('Write a comment on UFIConnect', { exact: true }).fill('A new comment on this Snap.');
      await viewer.getByRole('button', { name: 'Publish comment', exact: true }).click();
      await viewer.getByText('A new comment on this Snap.', { exact: true }).waitFor();
      check(writes.filter(item => item.endpoint.startsWith('/snaps/') && item.endpoint.endsWith('/like')).length === 1, `${width}/${theme}: Snap like sends one confirmed request`);
      check(writes.filter(item => item.endpoint.startsWith('/snaps/') && item.endpoint.endsWith('/comments')).length === 1, `${width}/${theme}: Snap comment publishes once`);
      const targets = await viewer.locator('.snap-viewer-post-actions .post-chrome-action').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height }; }));
      check(targets.every(rect => rect.width >= 43 && rect.height >= 43 && rect.x >= 0 && rect.right <= width + 1), `${width}/${theme}: Snap controls fit with 44px targets`);
      check(await viewer.locator('.snap-comments').evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${width}/${theme}: Snap comments have no horizontal clipping`);
      check(await viewer.evaluate(element => getComputedStyle(element).fontFamily === getComputedStyle(document.body).fontFamily && getComputedStyle(element).fontFamily.includes('sans-serif')), `${width}/${theme}: Snap viewer inherits the app font`);
      await viewer.locator('.snap-viewer-details').evaluate(element => { element.scrollTop = 0; });
      check(await viewer.locator('.snap-viewer-author').evaluate(element => {
        const name = element.getBoundingClientRect(), pane = element.closest('.snap-viewer-details').getBoundingClientRect();
        return name.top >= pane.top && name.bottom <= pane.bottom;
      }), `${width}/${theme}: author is fully visible at the top of Snap details`);
      file = `snap-comments-${width}-${theme}.png`; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file);
      if (width === 320) {
        await page.setViewportSize({ width, height: 500 });
        await viewer.getByLabel('Write a comment on UFIConnect', { exact: true }).focus();
        await viewer.getByRole('button', { name: 'Publish comment', exact: true }).scrollIntoViewIfNeeded();
        check(await viewer.locator('.post-comment-form').evaluate(element => {
          const textarea = element.querySelector('textarea').getBoundingClientRect(), button = element.querySelector('button').getBoundingClientRect();
          const pane = element.closest('.snap-viewer-details').getBoundingClientRect(), actions = document.querySelector('.snap-viewer-post-actions').getBoundingClientRect();
          return textarea.top >= pane.top && button.bottom <= pane.bottom + 1 && button.bottom <= actions.top + 1 && actions.bottom <= innerHeight + 1;
        }), `${width}/${theme}: reduced-height comment composer and publish button remain reachable above anchored actions`);
        file = `snap-composer-${width}-500-${theme}.png`; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file);
        await page.setViewportSize({ width, height: 900 });
      }
      await viewer.getByRole('button', { name: 'Close comments', exact: true }).click();
      check(await viewer.getByRole('button', { name: 'Comments 2', exact: true }).evaluate(element => element === document.activeElement), `${width}/${theme}: closing Snap comments restores focus`);
      check(errors.length === 0, `${width}/${theme}: no uncaught errors (${errors.join('; ')})`);
      check(blocked.length === 0, `${width}/${theme}: no unexpected network requests (${blocked.join('; ')})`);
      console.log(`PASS ${width}/${theme}`);
    } catch (error) {
      failures.push({ width, theme, error: error.stack, browserErrors: errors, blocked });
      console.error(error.stack); await page.screenshot({ path: path.join(output, `failure-${width}-${theme}.png`), fullPage: true });
    } finally { await context.close(); }
  }
} finally {
  await browser?.close(); await server.close();
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: failures.length === 0, checkedAt: new Date().toISOString(), sourceRoot: root, sourceHashes, checks, screenshots, failures }, null, 2));
}
console.log(JSON.stringify({ passed: failures.length === 0, checks: checks.length, failures: failures.length, output }));
if (failures.length) process.exitCode = 1;
