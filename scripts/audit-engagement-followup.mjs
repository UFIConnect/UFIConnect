import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, transformWithOxc } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/engagement-followup-qa');
const replyId = 'at://did:plc:member/app.bsky.feed.post/reply123';
const posts = [
  { id: 'bluesky-fixture', source: 'bluesky', sourceUrl: 'https://bsky.app/profile/author.example/post/abc', sourceLikesCount: 7, sourceLikedByMe: false },
  { id: 'youtube-fixture', source: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', sourceLikesCount: 10 },
].map(post => ({ ...post, isExternal: true, content: 'Readable source post', author: { name: 'Author' }, commentsCount: 0, createdAt: new Date().toISOString() }));
const fixture = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
import{PostCard}from'/src/pages/Feed.jsx';import NativePostCommentComposer from'/src/components/NativePostCommentComposer.jsx';
import VideoFeedView from'/src/components/VideoFeedView.jsx';import{ToastProvider}from'/src/contexts/ToastContext.jsx';
import{SavedItemsProvider}from'/src/contexts/SavedItemsContext.jsx';import'/src/index.css';
function Fixture(){const[rows,setRows]=useState(${JSON.stringify(posts)});const[video,setVideo]=useState(false);window.openVideoFixture=()=>setVideo(true);window.staleSourceFeed=()=>setRows(rows=>rows.map(row=>row.source==='bluesky'?{...row,sourceLikedByMe:false,sourceLikesCount:7}:row));return <ToastProvider><SavedItemsProvider><main style={{maxWidth:720,margin:'auto',padding:16}}>{video?<VideoFeedView/>:<>
{rows.map(post=><section key={post.id} aria-label={post.source+' fixture'} data-source-liked={post.sourceLikedByMe}><PostCard post={post} onPostUpdated={patch=>setRows(rows=>rows.map(row=>row.id===patch.id?{...row,...patch}:row))}/></section>)}
<section aria-label="native composer"><NativePostCommentComposer post={{id:'native-fixture',source:'uficonnect'}}/></section>
</>}</main></SavedItemsProvider></ToastProvider>}
createRoot(document.getElementById('root')).render(<BrowserRouter><Fixture/></BrowserRouter>);`;
const server = await createServer({ root: path.join(root, 'web'), envDir: false, cacheDir: path.join(output, 'vite'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  plugins: [{ name: 'engagement-followup-fixture', enforce: 'pre', resolveId(id) {
    if (/contexts\/AuthContext(?:\.jsx)?$/.test(id) || id === './AuthContext') return '\0fixture-auth';
    if (id === 'virtual:engagement-followup.jsx') return '\0engagement-followup';
  }, async load(id) {
    if (id === '\0fixture-auth') return `export function useAuth(){return{profile:{id:'fixture-member',plan:'pro',preferences:{}},token:'fixture'}}`;
    if (id === '\0engagement-followup') return (await transformWithOxc(fixture, 'fixture.jsx', { jsx: { runtime: 'automatic' } })).code;
  }, configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (new URL(req.url, 'http://fixture.invalid').pathname !== '/') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/appearance.css"></head><body><div id="root"></div><script type="module" src="/@id/virtual:engagement-followup.jsx"></script></body></html>'));
  }); } }], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });

async function readable(locator, label) {
  await locator.waitFor({ state: 'visible' });
  assert.ok(await locator.isVisible(), `${label} is visible`);
  const ratio = await locator.evaluate(element => {
    const parse = value => (value.match(/[\d.]+/g) || []).map(Number);
    const luminance = rgb => rgb.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    let background = [255, 255, 255];
    for (let parent = element; parent; parent = parent.parentElement) {
      const candidate = parse(getComputedStyle(parent).backgroundColor);
      if (candidate.length >= 3 && (candidate.length < 4 || candidate[3] === 1)) { background = candidate; break; }
    }
    const foreground = parse(getComputedStyle(element).color);
    return (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05);
  });
  assert.ok(ratio >= 4.5, `${label} contrast is ${ratio.toFixed(2)} (minimum 4.5)`);
}

let browser;
try {
  await fs.mkdir(output, { recursive: true }); await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 950 } }); const page = await context.newPage();
    page.setDefaultTimeout(15000); const errors = []; page.on('pageerror', error => errors.push(error.message));
    let liked = false, engagementReads = 0, sourceReply = false, nativeFailure = true;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.fulfill({ status: 200, contentType: 'video/mp4', body: '' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4);
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: Object.fromEntries(['youtube', 'bluesky', 'reddit'].map(source => [source, { connected: true, like: true, comment: true, label: source === 'youtube' ? 'YouTube' : source === 'bluesky' ? 'Bluesky' : 'Reddit', maxLength: 1000 }])) } });
      if (endpoint === '/social/post-engagement') {
        engagementReads++; const indexed = liked && engagementReads >= 3;
        return route.fulfill({ json: { sourceLikedByMe: indexed, sourceLikesCount: indexed ? 8 : 7, commentsCount: Number(sourceReply) } });
      }
      if (endpoint === '/social/interactions') {
        if (body.source === 'youtube') return route.fulfill({ status: 403, json: { message: 'Reconnect YouTube and allow all five permissions.' } });
        if (body.action === 'like') { liked = body.liked; return route.fulfill({ json: { published: true, liked } }); }
        sourceReply = true; return route.fulfill({ json: { published: true, commentId: replyId, commentUrl: 'https://bsky.app/profile/did:plc:member/post/reply123' } });
      }
      if (endpoint === '/posts/native-fixture/comments') {
        if (nativeFailure) return route.fulfill({ status: 503, json: { message: 'Comments are temporarily unavailable. Your draft is saved.' } });
        return route.fulfill({ json: { comment: { id: 'native-comment', content: body.content }, commentsCount: 1 } });
      }
      if (endpoint.endsWith('/comments')) return route.fulfill({ json: { comments: endpoint.includes('video-fixture') ? [{ id: 'video-reply', author: 'Author', body: 'Readable video comment', created: new Date().toISOString() }] : sourceReply ? [{ id: replyId, author: 'You', body: 'Readable Bluesky reply', created: new Date().toISOString() }] : [], live: true, hasMore: false } });
      if (endpoint === '/social/platforms' || endpoint === '/profile/social') return route.fulfill({ json: { platforms: {}, connected: { youtube: true, bluesky: true } } });
      if (/\/feed\/(?:videos|music)/.test(endpoint)) return route.fulfill({ json: { posts: [{ id: 'video-fixture', source: 'reddit', sourceUrl: 'https://www.reddit.com/r/fixture/comments/abc/title/', content: 'Video fixture', author: { name: 'Author' }, mediaType: 'video', mediaUrl: 'https://v.redd.it/fixture/DASH_720.mp4', directPlaybackAuthorized: true, videoDurationSeconds: 30, createdAt: new Date().toISOString(), isExternal: true }], hasMore: false } });
      if (endpoint === '/saved/posts') return route.fulfill({ json: { posts: [], postIds: [] } });
      return route.fulfill({ json: { posts: [], sources: [], groups: [] } });
    });
    await page.goto(origin);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const native = page.getByRole('region', { name: 'native composer', exact: true });
    const nativeInput = native.getByRole('textbox', { name: 'Write a comment on UFIConnect' });
    await nativeInput.fill('Readable native draft');
    await readable(nativeInput, 'Native comment input');
    await native.getByRole('button', { name: 'Publish comment' }).click();
    await readable(native.getByRole('alert'), 'Native comment error');
    assert.equal(await nativeInput.inputValue(), 'Readable native draft');
    nativeFailure = false; await native.getByRole('button', { name: 'Publish comment' }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="native composer"] textarea').value === '');
    const youtube = page.getByRole('region', { name: 'youtube fixture', exact: true });
    await youtube.getByRole('button', { name: /Like on YouTube/ }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Reconnect YouTube' }).last();
    await readable(toast.locator('span').nth(1), 'YouTube error toast');
    await youtube.getByRole('button', { name: /Show Comments/ }).click();
    await youtube.getByRole('textbox').fill('Readable YouTube draft');
    await youtube.getByRole('button', { name: 'Comment on YouTube' }).click();
    await readable(youtube.getByRole('alert'), 'YouTube comment error');
    assert.equal(await youtube.getByRole('textbox').inputValue(), 'Readable YouTube draft');
    const bluesky = page.getByRole('region', { name: 'bluesky fixture', exact: true });
    await bluesky.getByRole('button', { name: /Like on Bluesky/ }).click();
    await bluesky.getByRole('button', { name: /Unlike on Bluesky, 8 likes/ }).waitFor();
    assert.ok(engagementReads >= 3, 'The count refresh waits for the source to index the confirmed like');
    await page.evaluate(() => window.staleSourceFeed());
    await page.locator('[aria-label="bluesky fixture"][data-source-liked="false"]').waitFor();
    await bluesky.getByRole('button', { name: /Unlike on Bluesky, 8 likes/ }).waitFor();
    await bluesky.getByRole('button', { name: /Show Replies/ }).click();
    await bluesky.getByRole('textbox').fill('Readable Bluesky reply');
    await bluesky.getByRole('button', { name: 'Reply on Bluesky' }).click();
    await bluesky.getByText('Readable Bluesky reply', { exact: true }).waitFor();
    await readable(bluesky.getByText('Readable Bluesky reply', { exact: true }), 'Bluesky reply');
    await page.evaluate(() => window.openVideoFixture());
    const video = page.locator('.video-feed-view');
    await video.locator('.video-feed-slide').first().waitFor();
    assert.equal(await video.locator('.media-playback-controls').getByRole('button', { name: /full screen/i }).count(), 0);
    assert.equal(await video.locator('.video-feed-top-controls').getByRole('button', { name: 'Full screen', exact: true }).count(), 1);
    await video.getByRole('button', { name: /^Comments/ }).first().click();
    const sheet = page.getByRole('dialog', { name: /Comments/ });
    await readable(sheet.getByText('Readable video comment', { exact: true }), 'Video sheet comment');
    await sheet.getByRole('textbox').fill('Readable video reply draft');
    await readable(sheet.getByRole('textbox'), 'Video reply input');
    await readable(sheet.getByRole('button', { name: 'Comment on Reddit' }), 'Video reply submit button');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: false });
    console.log(`PASS ${theme}/${width}: readable comments, drafts, errors and toast; indexed Bluesky likes/replies; one header fullscreen control`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
