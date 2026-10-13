import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import PostLikes from '/src/components/PostLikes.jsx';
import PostList from '/src/components/PostList.jsx';
import ConnectedPostActions from '/src/components/ConnectedPostActions.jsx';
import { POST_ENGAGEMENT_EVENT } from '/src/api/postEngagement.mjs';
window.engagementEvents = []; window.likeUpdates = [];
window.addEventListener(POST_ENGAGEMENT_EVENT, event => window.engagementEvents.push(event.detail));
function App() {
  const [post, setPost] = useState({id:'native-audit',source:'uficonnect',author:{id:'engagement-reader',name:'Reader'},authorId:'engagement-reader',content:'Native engagement fixture',likedByMe:false,likesCount:0,commentsCount:0});
  window.patchNative = patch => setPost(current => ({...current,...patch}));
  const sourcePost = {id:'mastodon-audit',source:'mastodon',isExternal:true,sourceUrl:'https://social.example/@reader/123',sourceLikesCount:4,sourceLikedByMe:false};
  return React.createElement(React.Fragment,null,
    React.createElement('section',{'data-testid':'native-like'},React.createElement(PostLikes,{post,onPostUpdated:patch=>{window.likeUpdates.push(patch);setPost(current=>({...current,...patch}));}})),
    React.createElement('section',{'data-testid':'native-list'},React.createElement(PostList,{posts:[post],currentUserId:'engagement-reader',onPostUpdated:patch=>setPost(current=>({...current,...patch}))})),
    React.createElement('section',{'data-testid':'source'},React.createElement(PostLikes,{post:sourcePost}),React.createElement(ConnectedPostActions,{post:sourcePost})));
}
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(App)));
`;
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/vite-engagement-freshness'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api') },
  plugins: [{ name: 'engagement-fixture', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:engagement-fixture') return '\0engagement-fixture'; },
    load(id) { if (id === '\0engagement-fixture') return fixture; },
    transform(code, id) {
      if (/[/\\]contexts[/\\]AuthContext\.jsx$/.test(id)) return "export function useAuth(){return {profile:{id:'engagement-reader'},token:'audit'};}";
      if (/[/\\]contexts[/\\]ToastContext\.jsx$/.test(id)) return 'export function useToast(){return {showToast:()=>{}};}';
      if (/[/\\]contexts[/\\]SavedItemsContext\.jsx$/.test(id)) return 'export function useSavedItems(){return {isPostSaved:()=>false,postBusyIds:new Set(),togglePost:async()=>{}};}';
    },
    configureServer(instance) {
      instance.middlewares.use('/engagement-freshness', async (req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await instance.transformIndexHtml('/engagement-freshness', '<!doctype html><html><body><div id="root"></div><script type="module" src="/@id/__x00__engagement-fixture"></script></body></html>'));
      });
    },
  }], server: { host: '127.0.0.1', port: 5297, strictPort: false } });
let browser;
async function waitForHeldRequest(getRelease) {
  for (let attempt = 0; attempt < 200 && !getRelease(); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(typeof getRelease(), 'function', 'The expected held API request started');
}
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message); });
    page.on('requestfailed', request => console.error('FAILED REQUEST', request.url(), request.failure()));
    let releaseLike, holdLike = true, failLike = false;
    let releaseRead, holdRead = false, commentReads = 0, likeWrites = 0;
    let comments = [], commentsCount = 0;
    await context.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith('/api/')) return route.continue();
      const endpoint = pathname.replace(/^\/api/, '');
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: { mastodon: { connected: true, like: true, comment: true, label: 'Mastodon', maxLength: 500 } } } });
      if (endpoint === '/feed/native-audit/like') {
        likeWrites++;
        if (holdLike) await new Promise(resolve => { releaseLike = resolve; });
        if (failLike) return route.fulfill({ status: 400, json: { message: 'Like failed' } });
        return route.fulfill({ json: { likedByMe: body.liked, likesCount: Number(body.liked), post: { id: 'native-audit', commentsCount: 0 } } });
      }
      if (endpoint === '/posts/native-audit/comments' && route.request().method() === 'GET') {
        commentReads++;
        const snapshot = { comments: [...comments], commentsCount, hasMore: false };
        if (holdRead) await new Promise(resolve => { releaseRead = resolve; });
        return route.fulfill({ json: snapshot });
      }
      if (endpoint === '/posts/native-audit/comments') {
        const comment = { id: 'new-comment', content: body.content, author: { id: 'engagement-reader', name: 'Reader' }, createdAt: new Date().toISOString() };
        comments = [...comments, comment]; commentsCount++;
        return route.fulfill({ json: { comment, commentsCount, post: { id: 'native-audit', likesCount: 0 } } });
      }
      if (endpoint === '/social/interactions') return route.fulfill({ json: { published: true, commentId: 'source-confirmed' } });
      return route.fulfill({ json: {} });
    });
    await page.goto(server.resolvedUrls.local[0] + 'engagement-freshness', { waitUntil: 'domcontentloaded' });
    const likes = page.getByTestId('native-like');
    await likes.getByRole('button', { name: 'Like, 0 likes', exact: true }).waitFor({ timeout: 60000 });
    await likes.getByRole('button', { name: 'Like, 0 likes', exact: true }).click();
    const optimistic = likes.getByRole('button', { name: 'Unlike, 1 likes', exact: true });
    await optimistic.waitFor();
    assert.equal(await optimistic.isDisabled(), true, 'Native feedback appears before the held write completes');
    await page.waitForFunction(() => window.likeUpdates.length === 0);
    await waitForHeldRequest(() => releaseLike);
    holdLike = false; releaseLike();
    await page.waitForFunction(() => window.likeUpdates.length === 1);
    assert.deepEqual(await page.evaluate(() => Object.keys(window.likeUpdates[0]).sort()), ['id', 'likedByMe', 'likesCount']);
    await page.evaluate(() => window.patchNative({ likesCount: 8, likedByMe: true, commentsCount: 2 }));
    await likes.getByRole('button', { name: 'Unlike, 8 likes', exact: true }).waitFor();
    failLike = true;
    const failedWrite = page.waitForResponse(response => response.url().endsWith('/feed/native-audit/like') && response.status() === 400);
    await likes.getByRole('button', { name: 'Unlike, 8 likes', exact: true }).click();
    await failedWrite;
    await page.waitForFunction(() => !document.querySelector('[data-testid="native-like"] button')?.disabled);
    await likes.getByRole('button', { name: 'Unlike, 8 likes', exact: true }).waitFor();
    assert.equal(likeWrites, 2, 'Pending clicks are not duplicated');

    const list = page.getByTestId('native-list');
    holdRead = true;
    await list.getByRole('button', { name: 'Comment 2', exact: true }).click();
    await waitForHeldRequest(() => releaseRead);
    await list.getByPlaceholder('Write a comment...').fill('Freshly published comment');
    await list.getByRole('button', { name: 'Send', exact: true }).click();
    await list.getByText('Freshly published comment', { exact: true }).waitFor();
    holdRead = false; releaseRead();
    await page.waitForTimeout(100);
    assert.equal(await list.getByText('Freshly published comment', { exact: true }).count(), 1, 'An older read cannot erase a confirmed comment');
    await likes.getByRole('button', { name: 'Unlike, 8 likes', exact: true }).waitFor();
    await list.getByRole('button', { name: 'Hide 1', exact: true }).click();
    comments.push({ id: 'remote-comment', content: 'A comment from another viewer', author: { name: 'Another viewer' }, createdAt: new Date().toISOString() }); commentsCount++;
    await list.getByRole('button', { name: 'Comment 1', exact: true }).click();
    await list.getByText('A comment from another viewer', { exact: true }).waitFor();
    const beforeFocus = commentReads;
    holdRead = true; releaseRead = null;
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await waitForHeldRequest(() => releaseRead);
    assert.equal(commentReads, beforeFocus + 1, 'Focus and visibility reads coalesce while pending');
    holdRead = false; releaseRead();
    const source = page.getByTestId('source');
    await source.getByLabel('Write a comment on Mastodon').fill('Source reply');
    await source.getByRole('button', { name: 'Publish on Mastodon' }).click();
    await page.waitForFunction(() => window.engagementEvents.some(event => event.commentId === 'source-confirmed'));
    assert.deepEqual(await page.evaluate(() => window.engagementEvents.find(event => event.commentId === 'source-confirmed')), {
      postId: 'mastodon-audit', source: 'mastodon', sourceUrl: 'https://social.example/@reader/123', action: 'comment', commentId: 'source-confirmed',
    });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: immediate native likes, rollback, refreshed counts, stale-comment read protection, reopening/focus refresh, deduplication and confirmed provider events`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
