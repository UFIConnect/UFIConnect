// Production assets and synthetic member/media responses; provider calls are blocked.
// Optional hosted origin: UFI_MEDIA_CONTROLS_AUDIT_ORIGIN=https://uficonnect.org
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
const server = process.env.UFI_MEDIA_CONTROLS_AUDIT_ORIGIN
  ? { origin: new URL(process.env.UFI_MEDIA_CONTROLS_AUDIT_ORIGIN).origin, close: async () => {} }
  : await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const output = '.cache/audit-ui/visible-media-controls';
const results = [];
const mediaHost = 'media.controls.invalid';
const mediaUrl = `https://${mediaHost}/fixture.mp4`;
const avatarUrl = `https://${mediaHost}/avatar.svg`;
const description = `${'Full caption details explain the recording, its context and the source. '.repeat(7)}ENDING_DETAILS_MARKER`;
const snapDescription = `${'The clip caption explains its context and original source. '.repeat(7)}ENDING_DETAILS_MARKER`;
const channelId = 'UCabcdefghijklmnopqrstuv';
const native = id => ({ id, source: 'uficonnect', isExternal: false, title: `Native ${id}`, content: description,
  authorId: 'other-member', author: { id: 'other-member', name: 'Fixture member', avatarUrl },
  mediaType: 'video', mediaUrl, sourceUrl: null, videoDurationSeconds: 30, likesCount: 0, commentsCount: 0,
  createdAt: new Date(Date.now() - 60000).toISOString() });
const external = (id, source = 'reddit') => ({ ...native(id), source, isExternal: true, title: `External ${id}`,
  directPlaybackAuthorized: true, author: { id: `${source}_fixture`, name: 'Fixture creator', avatarUrl },
  sourceUrl: `https://www.reddit.com/r/videos/comments/${id.replaceAll('-', '')}/fixture/` });
const youtube = id => ({ ...external(id, 'youtube'), embedId: 'controls001',
  author: { id: `youtube_${channelId}`, name: 'Fixture channel', channelId, avatarUrl },
  mediaUrl: 'https://www.youtube.com/watch?v=controls001', sourceUrl: 'https://www.youtube.com/watch?v=controls001' });
const snap = (id, source, extra = {}) => ({ id, source, caption: snapDescription, mediaType: 'video', mediaKind: 'file',
  mediaUrl, thumbnailUrl: avatarUrl, directPlaybackAuthorized: true, sourceUrl: null, visibility: 'public',
  author: { id: `author-${id}`, name: `Creator ${id}`, avatarUrl }, videoDurationSeconds: 30,
  createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 23 * 3600000).toISOString(), ...extra });

async function sourceAfterMenu(actions, label = 'More options') {
  const more = actions.getByRole('button', { name: label, exact: true });
  const link = actions.locator(':scope > .post-chrome-source-link');
  await more.waitFor({ state: 'visible' }); await link.waitFor({ state: 'visible' });
  await more.scrollIntoViewIfNeeded();
  assert.ok(await actions.evaluate(element => {
    const menu = element.querySelector(':scope > .post-chrome-more');
    const source = element.querySelector(':scope > .post-chrome-source-link');
    return menu && source && menu.nextElementSibling === source;
  }), 'The original-post source link follows overflow in DOM and keyboard order');
  const menuBox = await more.boundingBox(), linkBox = await link.boundingBox();
  assert.ok(linkBox.x >= menuBox.x + menuBox.width - 1 && Math.abs(menuBox.y - linkBox.y) <= 2,
    `The source link sits immediately right of overflow: ${JSON.stringify({ menuBox, linkBox })}`);
  await more.focus(); await more.page().keyboard.press('Tab');
  assert.ok(await link.evaluate(element => document.activeElement === element), 'Tab moves from overflow to the source link');
  return more;
}

async function captionControls(scope, expandedSelector) {
  const readMore = scope.getByRole('button', { name: 'Read more', exact: true });
  await readMore.waitFor({ state: 'visible' });
  assert.equal(await readMore.getAttribute('aria-expanded'), 'false');
  const route = scope.page().url();
  await readMore.click();
  const less = scope.getByRole('button', { name: 'Show less', exact: true });
  assert.equal(await less.getAttribute('aria-expanded'), 'true');
  const controls = await less.getAttribute('aria-controls');
  assert.ok(controls, 'Caption expansion identifies the content it controls');
  assert.equal(await scope.locator(`[id="${controls}"]`).count(), 1);
  assert.match(await scope.locator(expandedSelector).innerText(), /ENDING_DETAILS_MARKER/,
    'Expanded captions include the full ending instead of truncating the post details');
  await less.click();
  assert.equal(await scope.getByRole('button', { name: 'Read more', exact: true }).getAttribute('aria-expanded'), 'false');
  assert.equal(scope.page().url(), route, 'Caption expansion preserves the current route');
}

const noHiddenControls = async menu => assert.equal(await menu.getByText(
  /^(?:Read more|Show less|(?:Show|Hide) player controls|(?:Show|Hide) video controls)$/i, { exact: true }).count(), 0,
  'Caption and player controls are absent from overflow');

async function horizontalSwipe(context, page, box, direction, y = box.y + box.height / 2) {
  const start = box.x + box.width * (direction > 0 ? .65 : .15), end = box.x + box.width * (direction > 0 ? .15 : .65);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
  for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: start + (end - start) * step / 5, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
}

async function nativePlayerOptions(context, player) {
  const flags = await player.evaluate(video => ({ controls: video.controls,
    options: [...video.controlsList], pictureInPictureDisabled: video.disablePictureInPicture,
    remotePlaybackDisabled: video.disableRemotePlayback }));
  assert.equal(flags.controls, true, 'Native play/seek/volume controls remain enabled');
  for (const option of ['nodownload', 'noplaybackrate', 'noremoteplayback']) assert.ok(flags.options.includes(option));
  assert.equal(flags.pictureInPictureDisabled, true); assert.equal(flags.remotePlaybackDisabled, true);
  assert.equal(flags.options.includes('nofullscreen'), false, 'Fullscreen remains available');
  await player.hover({ position: { x: 12, y: 12 } });
  const cdp = await context.newCDPSession(player.page());
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const shadows = [];
    const visit = node => {
      if (node.nodeName === 'VIDEO') shadows.push(...(node.shadowRoots || []).filter(shadow => shadow.shadowRootType === 'user-agent'));
      for (const child of [...(node.children || []), ...(node.shadowRoots || []), ...(node.contentDocument ? [node.contentDocument] : [])]) visit(child);
    };
    visit(root);
    const overflow = [];
    const inspect = node => {
      const values = [];
      for (let index = 0; index < (node.attributes || []).length; index += 2) {
        if (['pseudo', 'id', 'aria-label', 'class'].includes(node.attributes[index])) values.push(node.attributes[index + 1]);
      }
      if (['INPUT', 'BUTTON'].includes(node.nodeName) && /overflow[- ](?:menu[- ]?)?button|more.*(?:media|control)/i.test(values.join(' '))) overflow.push(node);
      for (const child of node.children || []) inspect(child);
    };
    shadows.forEach(inspect);
    const styles = [];
    for (const node of overflow) {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId });
      const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
        functionDeclaration: 'function(){ const style=getComputedStyle(this), rect=this.getBoundingClientRect(); return {display:style.display,visibility:style.visibility,width:rect.width,height:rect.height}; }' });
      styles.push(result.value);
    }
    assert.ok(styles.every(style => style.display === 'none' || style.visibility === 'hidden' || style.width === 0 || style.height === 0),
      `Native overflow is removed from the actual Chromium controls: ${JSON.stringify(styles)}`);
    return { nativeOptions: flags.options, userAgentShadowInspected: shadows.length > 0,
      overflowNodesInspected: styles.length, nativeOverflowVisible: false };
  } finally { await cdp.detach(); }
}

async function changeNativePlayerSettings(page, menu, player, more, role = 'menuitem') {
  const route = page.url(), source = await player.getAttribute('src');
  await menu.getByRole(role, { name: /^Player settings\b/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Player settings', exact: true });
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('radiogroup', { name: 'Playback speed', exact: true })
    .getByRole('radio', { name: '1.5\u00d7', exact: true }).click();
  assert.equal(await player.evaluate(video => video.playbackRate), 1.5, 'The UFIConnect overflow settings change the actual native player');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  assert.ok(await more.evaluate(element => document.activeElement === element), 'Escape restores the existing post overflow trigger');
  assert.equal(page.url(), route); assert.equal(await player.getAttribute('src'), source, 'Settings preserve the selected media');
  assert.equal(await player.evaluate(video => video.playbackRate), 1.5);
}

try {
  await fs.mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    const id = `visible-controls-${width}`, user = member(id, { plan: 'pro' }); app.seedUser(user);
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block',
      reducedMotion: 'reduce', hasTouch: width < 600, isMobile: width < 600 });
    const page = await context.newPage(); page.setDefaultTimeout(18000);
    const errors = [], writes = [], providerCalls = [], embeds = [];
    let videoRows = [], feedRows = [], snapRows = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 }, Player: class {
        constructor(frame, config) { this.frame = frame; this.state = 2; this.rate = 1;
          this.id = new URL(frame.src).pathname.split('/').pop();
          setTimeout(() => config.events?.onReady?.({ target: this }), 20); }
        getIframe() { return this.frame; } getVideoData() { return { video_id: this.id }; }
        getDuration() { return 30; } getCurrentTime() { return 0; } getPlayerState() { return this.state; }
        getAvailablePlaybackRates() { return [1]; } getPlaybackRate() { return this.rate; } getOptions() { return []; }
        loadVideoById(id) { this.id = id; } playVideo() { this.state = 1; } pauseVideo() { this.state = 2; }
        mute() {} unMute() {} seekTo() {} destroy() { this.frame.remove(); }
      } };
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname === mediaHost && /\.(?:mp4|ts)$/.test(url.pathname)) return; // Pending synthetic media, never a provider fetch.
      if (url.hostname === mediaHost && /\.m3u8$/.test(url.pathname)) return route.fulfill({
        contentType: 'application/vnd.apple.mpegurl', body: `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:30\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:30.0,\nhttps://${mediaHost}/segment.ts\n#EXT-X-ENDLIST\n` });
      if (url.hostname === 'vimeo.com' && url.pathname === '/api/oembed.json') return route.fulfill({ json: { duration: 30 } });
      if (url.hostname === mediaHost || url.origin !== server.origin && request.resourceType() === 'image') {
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#1e3a8a"/></svg>' });
      }
      if (['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'].includes(url.hostname) && request.resourceType() === 'document') {
        embeds.push(url.href); return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#172554;color:white"><button>Provider controls</button></body></html>' });
      }
      const api = /^(?:\/api\/|\/fallback\/)/.test(url.pathname)
        || ['fetch', 'xhr', 'eventsource'].includes(request.resourceType()) && !url.pathname.startsWith('/assets/');
      if (!api) {
        if (url.origin === server.origin && ['GET', 'HEAD'].includes(request.method())) return route.continue();
        if (!['GET', 'HEAD'].includes(request.method()) || request.resourceType() === 'document') providerCalls.push(url.origin + url.pathname);
        return route.abort();
      }
      const endpoint = url.pathname.replace(/^\/(?:api|fallback)(?=\/)/, '');
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-UFI-Device-Location',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Cache-Control': 'private, no-store' };
      const send = json => route.fulfill({ headers, json });
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/profile') return send(app.fullProfile(user));
      if (endpoint === '/billing/status') return send({ plan: 'pro', hasBillingAccount: true, subscriptions: [{ kind: 'plan', tier: 'pro', status: 'active' }] });
      if (endpoint === '/billing/config') return send({ paymentsReady: false, tiers: {}, pricing: {} });
      if (/^\/(?:office\/)?feed\/(?:videos|music)(?:\/following)?$/.test(endpoint)) return send({ posts: videoRows, hasMore: false, waitingForNew: true });
      if (['/office/feed', '/feed', '/posts'].includes(endpoint)) return send({ posts: feedRows, hasMore: false, nativeUficonnectIncluded: true });
      if (endpoint === '/snaps') {
        const mode = url.searchParams.get('mode'), source = url.searchParams.get('source');
        return send({ snaps: snapRows.filter(snap => (mode !== 'ufi' || snap.source === 'uficonnect') && (!source || snap.source === source)), sourceErrors: {} });
      }
      if (request.method() !== 'GET' && !/analytics|telemetry|metrics|engaged|engagement-signal/.test(endpoint)) {
        writes.push(endpoint); return send({ message: 'Writes disabled in synthetic audit.' });
      }
      return send({ sources: [], posts: [], groups: [], connected: {}, jobs: [], opportunities: [], users: [], items: [], methods: [],
        providers: {}, platforms: {}, notifications: [], unreadCount: 0, messages: [], conversations: [], requests: [], attachments: [],
        snaps: [], postIds: [], nativeUficonnectIncluded: true, hasMore: false,
        locationContext: { country: 'US', countryName: 'United States', city: 'Los Angeles', region: 'California', available: true, source: 'network', mode: 'auto' } });
    });
    await installAuditMember(page, app, id);
    const visit = async (path, rows = []) => {
      await auditNavigate(page, server.origin + '/saved');
      videoRows = rows;
      await auditNavigate(page, server.origin + path);
    };
    for (const surface of ['videos', 'music']) {
      for (const kind of ['native', 'external', 'hls', 'youtube', 'vimeo']) {
        const post = kind === 'native' ? native(`${surface}-native`) : kind === 'youtube' ? youtube(`${surface}-youtube`)
          : { ...external(`${surface}-${kind}`), ...(kind === 'hls' ? { mediaUrl: `https://${mediaHost}/fixture.m3u8` }
            : kind === 'vimeo' ? { mediaUrl: 'https://vimeo.com/123456789' } : {}) };
        await visit(`/${surface}`, [post]);
        const slide = page.locator(`[data-post-id="${post.id}"]`); await slide.waitFor();
        const player = kind === 'youtube' ? page.locator('.video-feed-youtube-player iframe') : slide.locator(kind === 'vimeo' ? 'iframe' : 'video');
        await player.waitFor({ state: 'visible' });
        let nativeOptions = null;
        if (kind === 'youtube' || kind === 'vimeo') {
          assert.equal(new URL(await player.getAttribute('src')).searchParams.get('controls'), '1', 'Official provider controls start enabled');
          const frame = kind === 'youtube' ? page.frameLocator('.video-feed-youtube-player iframe') : slide.frameLocator('iframe');
          await frame.getByRole('button', { name: 'Provider controls', exact: true }).click();
        } else {
          assert.equal(await player.evaluate(element => element.controls), true, 'Direct media native controls are enabled without overflow');
          assert.equal(await player.getAttribute('controls'), '');
          nativeOptions = await nativePlayerOptions(context, player);
        }
        const playback = slide.locator('.video-feed-playback-status');
        assert.ok(await playback.isVisible());
        assert.equal(await slide.locator('.video-feed-play-button, .video-feed-sound-button').count(), 0,
          'Native or official controls are not duplicated by app play and mute buttons');
        assert.equal(await slide.getByRole('button', { name: /^(?:Play|Pause|Mute|Unmute) video$/ }).count(), 0);
        assert.ok(await playback.locator('.video-feed-playback-time').isVisible(), 'Playback time remains available');
        if (kind === 'native') {
          await slide.locator('[data-video-media]').hover({ position: { x: 12, y: 12 } });
          await page.waitForFunction(() => document.querySelector('.video-feed-slide')?.dataset.cursorIdle === 'true');
          assert.equal(await playback.evaluate(element => getComputedStyle(element).opacity), '1', 'Playback time remains visible after pointer idle');
        }
        await captionControls(slide, '.video-feed-caption-expanded');
        const more = await sourceAfterMenu(slide.getByRole('group', { name: 'Post actions', exact: true }));
        await more.click(); const menu = page.getByRole('menu'); await menu.waitFor();
        await noHiddenControls(menu);
        if (nativeOptions) await changeNativePlayerSettings(page, menu, player, more);
        else {
          assert.equal(await menu.getByRole('menuitem', { name: /^Player settings\b/ }).count(), 0, 'Provider iframes do not advertise native player settings');
          await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
        }
        assert.ok(await more.evaluate(element => document.activeElement === element));
        if (kind === 'external') await page.screenshot({ path: `${output}/${surface}-${width}.png`, fullPage: true });
        results.push({ width, surface, kind, providerControlsVisible: true, noDuplicateAppButtons: true,
          captionExpansion: true, sourceRightOfOverflow: true, nativeSettingsChangeActualRate: Boolean(nativeOptions), ...nativeOptions });
        console.log(`PASS ${surface} ${kind}: visible controls/caption/source order ${width}px`);
      }
      await visit(`/${surface}`, [native(`${surface}-swipe-one`), native(`${surface}-swipe-two`), native(`${surface}-swipe-three`)]);
      const scroll = page.locator('[data-video-feed-scroll]'), first = page.locator(`[data-post-id="${surface}-swipe-one"]`);
      await first.locator('video').waitFor({ state: 'visible' });
      await captionControls(first, '.video-feed-caption-expanded');
      assert.equal(await scroll.evaluate(element => Math.round(element.scrollTop)), 0, 'Caption buttons do not change the active video');
      let bounds = await first.locator('video').boundingBox();
      await horizontalSwipe(context, page, bounds, 1, bounds.y + bounds.height - 20);
      assert.equal(await scroll.evaluate(element => Math.round(element.scrollTop)), 0, 'Swiping native player controls does not navigate the feed');
      await horizontalSwipe(context, page, bounds, 1, bounds.y + bounds.height * .2);
      await page.waitForFunction(() => { const scroll = document.querySelector('[data-video-feed-scroll]'); return scroll && Math.abs(scroll.scrollTop - scroll.clientHeight) <= 2; });
      await page.waitForTimeout(550);
      bounds = await page.locator(`[data-post-id="${surface}-swipe-two"] video`).boundingBox();
      await horizontalSwipe(context, page, bounds, -1, bounds.y + bounds.height * .2);
      await page.waitForFunction(() => document.querySelector('[data-video-feed-scroll]')?.scrollTop <= 2);
      results.push({ width, surface, kind: 'horizontal-swipe', advancesAndRestores: true, nativeControlsPreserved: true });
      console.log(`PASS ${surface}: horizontal swipes and player-control guard ${width}px`);
    }
    feedRows = [{ ...external('generic-external', 'devto'), mediaType: null, mediaUrl: null, sourceUrl: 'https://dev.to/fixture/controls-layout' }];
    await visit('/?feed=feed&all=1');
    const card = page.locator('.post-card').filter({ hasText: 'External generic-external' });
    await card.waitFor();
    await sourceAfterMenu(card.locator('.post-chrome-actions'));
    results.push({ width, surface: 'generic-feed', kind: 'external', sourceRightOfOverflow: true });
    feedRows = [{ ...native('generic-native'), mediaType: null, mediaUrl: null, content: 'Native generic post remains in UFI.' }];
    await visit('/?feed=ufi');
    const nativeCard = page.locator('.post-card').filter({ has: page.getByText('Native generic post remains in UFI.', { exact: true }) });
    await nativeCard.waitFor();
    assert.equal(await nativeCard.locator('.post-chrome-source-link').count(), 0, 'Native posts do not invent a third-party source link');
    assert.equal(await nativeCard.getByRole('button', { name: 'More options', exact: true }).count(), 1, 'Native post options remain available');
    results.push({ width, surface: 'generic-feed', kind: 'native', nativePostPreserved: true });

    snapRows = [snap('external-snap', 'mastodon', { sourceUrl: 'https://mastodon.social/@fixture/98766', isExternal: true }),
      snap('external-snap-two', 'mastodon', { sourceUrl: 'https://mastodon.social/@fixture/98767', isExternal: true,
        author: { id: 'author-external-snap', name: 'Creator external-snap', avatarUrl }, createdAt: new Date(Date.now() - 5000).toISOString(), caption: 'Second source clip caption.' }),
      snap('youtube-snap', 'youtube', { mediaKind: 'youtube', embedId: 'controls001', mediaUrl: 'https://www.youtube.com/shorts/controls001', sourceUrl: 'https://www.youtube.com/shorts/controls001', isExternal: true }),
      snap('youtube-snap-two', 'youtube', { mediaKind: 'youtube', embedId: 'controls002', mediaUrl: 'https://www.youtube.com/shorts/controls002', sourceUrl: 'https://www.youtube.com/shorts/controls002', isExternal: true,
        author: { id: 'author-youtube-snap', name: 'Creator youtube-snap', avatarUrl }, createdAt: new Date(Date.now() - 5000).toISOString(), caption: 'Second YouTube clip caption.' }),
      snap('native-snap', 'uficonnect'),
      snap('native-snap-two', 'uficonnect', { author: { id: 'author-native-snap', name: 'Creator native-snap', avatarUrl },
        createdAt: new Date(Date.now() - 5000).toISOString(), caption: 'Second native clip caption.' })];
    feedRows = [];
    for (const kind of ['external', 'youtube', 'native']) {
      const id = `${kind}-snap`;
      await visit(kind === 'native' ? '/?feed=ufi' : '/?feed=feed&all=1');
      const profile = page.locator(`.snap-profile-button[data-snap-ids*='"${id}"']`); await profile.waitFor(); await profile.click();
      const viewer = page.locator('dialog.snap-viewer'); await viewer.waitFor();
      const player = viewer.locator(kind === 'youtube' ? 'iframe' : 'video'); await player.waitFor({ state: 'visible' });
      let nativeOptions = null;
      if (kind === 'youtube') assert.equal(new URL(await player.getAttribute('src')).searchParams.get('controls'), '1');
      else nativeOptions = await nativePlayerOptions(context, player);
      assert.equal(await viewer.getByRole('slider').count(), 0, 'Snap navigation uses screen swipes without a slider');
      const selection = await viewer.locator('.snap-viewer-caption').innerText();
      await captionControls(viewer, '.snap-viewer-caption');
      assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selection, 'Caption controls do not advance the clip');
      const commands = viewer.getByRole('group', { name: 'Snap commands', exact: true });
      assert.equal(await commands.evaluate(element => Boolean(element.closest('.snap-viewer-topbar'))), false,
        'Snap overflow and source navigation use the bottom post actions instead of a second top menu');
      if (kind !== 'native') await sourceAfterMenu(commands, 'Snap options');
      else assert.equal(await commands.locator('.post-chrome-source-link').count(), 0, 'Native Snaps do not invent an external source');
      if (kind === 'external') {
        const swipe = async direction => {
          const bounds = await viewer.locator('.snap-viewer-topbar').boundingBox();
          const topActions = viewer.locator('.snap-viewer-topbar .snap-viewer-top-actions');
          const safe = await topActions.count() ? { ...bounds, width: (await topActions.boundingBox()).x - bounds.x - 8 } : bounds;
          assert.ok(safe.width * .5 >= 55, 'The swipe starts and ends in plain topbar space outside interactive source/menu controls');
          return horizontalSwipe(context, page, safe, direction);
        };
        await swipe(1);
        await viewer.locator('.snap-viewer-caption').getByText('Second source clip caption.', { exact: true }).waitFor();
        assert.equal(await commands.locator('.post-chrome-source-link').getAttribute('href'), 'https://mastodon.social/@fixture/98767');
        // Let the gesture cooldown elapse while checking the newly selected source identity.
        await page.waitForTimeout(550);
        await swipe(-1);
        await page.waitForFunction(expected => document.querySelector('.snap-viewer-caption')?.textContent === expected, selection);
        await viewer.locator('video').focus(); await page.keyboard.press('ArrowRight');
        assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selection, 'Native video-control keys do not move to the next Snap');
      } else if (kind === 'youtube') {
        await viewer.frameLocator('iframe').getByRole('button', { name: 'Provider controls', exact: true }).click();
        await page.keyboard.press('ArrowRight');
        assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selection, 'Provider iframe keys do not move to the next Snap');
      } else {
        await player.focus(); await page.keyboard.press('ArrowRight');
        assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selection, 'Native Snap player keys do not advance its author group');
      }
      await commands.getByRole('button', { name: 'Snap options', exact: true }).click();
      const menu = viewer.getByRole('group', { name: 'Snap options', exact: true }); await menu.waitFor();
      await noHiddenControls(menu);
      assert.equal(await menu.getByRole('slider').count(), 0, 'The removed position slider is absent from overflow');
      if (nativeOptions) {
        const selectedCaption = await viewer.locator('.snap-viewer-caption').innerText();
        await changeNativePlayerSettings(page, menu, player, commands.getByRole('button', { name: 'Snap options', exact: true }), 'button');
        assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selectedCaption, 'Native settings do not advance the selected Snap');
      } else {
        assert.equal(await menu.getByRole('button', { name: /^Player settings\b/ }).count(), 0);
        await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
      }
      if (kind === 'external') await page.screenshot({ path: `${output}/snaps-${width}.png`, fullPage: true });
      await viewer.getByRole('button', { name: 'Close snap', exact: true }).click();
      results.push({ width, surface: 'snaps', kind, providerControlsVisible: true, captionExpansion: true,
        sourceRightOfOverflow: kind !== 'native', nativeSettingsChangeActualRate: Boolean(nativeOptions), ...nativeOptions });
      console.log(`PASS snaps ${kind}: visible controls/caption/source order ${width}px`);
    }
    assert.deepEqual(errors, [], 'No browser exceptions'); assert.deepEqual(writes, [], 'No provider or account writes');
    assert.deepEqual(providerCalls, [], 'All remote provider requests are blocked or synthetic player/media responses');
    assert.ok(embeds.length >= 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal page overflow');
    await context.close(); console.log(`PASS visible media controls and source/menu order at ${width}px`);
  }
  await fs.writeFile(`${output}/summary.json`, JSON.stringify({ origin: server.origin, results }, null, 2) + '\n');
} finally { await browser.close(); await server.close(); await app.close(); }
