// Built assets and synthetic member/media responses; provider calls are blocked.
// Optional hosted origin: UFI_MEDIA_CONTROLS_AUDIT_ORIGIN=https://uficonnect.org
// Optional focused viewport: UFI_MEDIA_CONTROLS_AUDIT_WIDTH=1440|390|320
// Local source assets: UFI_MEDIA_CONTROLS_AUDIT_DEV=1 (no hot reload)
// Focused post/lightbox check: UFI_MEDIA_CONTROLS_AUDIT_SCOPE=details
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const detailsOnly = process.env.UFI_MEDIA_CONTROLS_AUDIT_SCOPE === 'details';
const widths = process.env.UFI_MEDIA_CONTROLS_AUDIT_WIDTH ? [Number(process.env.UFI_MEDIA_CONTROLS_AUDIT_WIDTH)] : [1440, 390, 320];
assert.ok(widths.every(width => [1440, 390, 320].includes(width)), 'The focused media viewport must be 1440, 390, or 320');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
const devServer = process.env.UFI_MEDIA_CONTROLS_AUDIT_DEV === '1' ? await createServer({
  root: fileURLToPath(new URL('../web', import.meta.url)),
  envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
}) : null;
if (devServer) await devServer.listen();
const server = devServer ? { origin: devServer.resolvedUrls.local[0].replace(/\/$/, ''), close: () => devServer.close() } : process.env.UFI_MEDIA_CONTROLS_AUDIT_ORIGIN
  ? { origin: new URL(process.env.UFI_MEDIA_CONTROLS_AUDIT_ORIGIN).origin, close: async () => {} }
  : await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const output = '.cache/audit-ui/visible-media-controls';
const results = [];
const mediaHost = 'media.controls.invalid';
const mediaUrl = `https://${mediaHost}/fixture.mp4`;
const avatarUrl = `https://${mediaHost}/avatar.svg`;
const nativeMedia = await fs.readFile(new URL('../web/public/media/preparation/closing-questions.mp4', import.meta.url));
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
  const bar = scope.locator('.media-playback-controls');
  if (await bar.count()) {
    const captions = scope.locator('.video-feed-details, .snap-viewer-details').first();
    assert.equal(await bar.evaluate(element => Boolean(element.closest('.video-feed-details, .snap-viewer-details'))), false,
      'Playback controls remain outside the scrolling caption');
    const before = await bar.boundingBox();
    await captions.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const after = await bar.boundingBox();
    assert.ok(before && after && Math.abs(before.y - after.y) <= 1 && Math.abs(before.x - after.x) <= 1,
      'Scrolling expanded caption details does not move playback controls');
    await visiblePlaybackBar(scope);
    await captions.evaluate(element => { element.scrollTop = 0; });
  }
  await less.click();
  assert.equal(await scope.getByRole('button', { name: 'Read more', exact: true }).getAttribute('aria-expanded'), 'false');
  assert.equal(scope.page().url(), route, 'Caption expansion preserves the current route');
}

const noHiddenControls = async menu => assert.equal(await menu.getByText(
  /^(?:Read more|Show less|(?:Show|Hide) player controls|(?:Show|Hide) video controls)$/i, { exact: true }).count(), 0,
  'Caption and player controls are absent from overflow');

async function visiblePlaybackBar(scope) {
  const bar = scope.locator('.media-playback-controls');
  assert.equal(await bar.count(), 1, 'One app playback row belongs to the current media');
  await bar.waitFor({ state: 'visible' });
  const media = scope.locator('[data-video-media], .snap-viewer-media, .media-lightbox-stage').first();
  if (await media.count()) {
    const { mediaBounds, barBounds } = await scope.evaluate(element => ({
      mediaBounds: element.querySelector('[data-video-media], .snap-viewer-media, .media-lightbox-stage').getBoundingClientRect().toJSON(),
      barBounds: element.querySelector('.media-playback-controls').getBoundingClientRect().toJSON(),
    }));
    assert.ok(mediaBounds && barBounds && barBounds.y >= mediaBounds.y + mediaBounds.height - 1,
      `Playback controls are below the video viewport: ${JSON.stringify({ mediaBounds, barBounds })}`);
  }
  const play = bar.getByRole('button', { name: /^(?:Play|Pause) video$/ });
  const mute = bar.getByRole('button', { name: /^(?:Mute|Unmute) video$/ });
  const progress = bar.getByRole('slider', { name: 'Video progress', exact: true });
  assert.equal(await play.count(), 1); assert.equal(await mute.count(), 1); assert.equal(await progress.count(), 1);
  assert.ok(await bar.locator('.media-playback-time').isVisible(), 'Playback time stays visible with the commands');
  assert.ok(await bar.evaluate(element => {
    const [play, mute] = element.querySelectorAll('button'), progress = element.querySelector('input[type="range"]');
    return play && mute && progress && play.nextElementSibling === mute && mute.nextElementSibling === progress;
  }), 'Play/Pause then Mute/Unmute precede the progress cursor in DOM and keyboard order');
  const [playBox, muteBox, progressBox] = await bar.evaluate(element => [
    ...element.querySelectorAll('button'), element.querySelector('input[type="range"]'),
  ].map(control => control.getBoundingClientRect().toJSON()));
  assert.ok(playBox && muteBox && progressBox
    && playBox.x + playBox.width <= muteBox.x + 1 && muteBox.x + muteBox.width <= progressBox.x + 1
    && Math.abs(playBox.y - muteBox.y) <= 1 && Math.abs(playBox.y - progressBox.y) <= 1,
  `Playback commands remain left of the cursor on one row: ${JSON.stringify({ playBox, muteBox, progressBox })}`);
  for (const [label, bounds] of [['Play/Pause', playBox], ['Mute/Unmute', muteBox], ['Video progress', progressBox]]) {
    assert.ok(bounds.width >= (label === 'Video progress' ? 36 : 44) && bounds.height >= 44,
      `${label} retains a usable touch target: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= scope.page().viewportSize().width + 1,
      `${label} fits the viewport`);
  }
  assert.ok(await bar.evaluate(element => {
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < .99) return false;
    }
    return true;
  }), 'Playback controls stay fully visible through their ancestor styles');
  return { bar, play, mute, progress };
}

async function seekProgress(progress, seconds) {
  await progress.evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
}

async function nativePlaybackCommands(scope, player) {
  const { play, mute, progress } = await visiblePlaybackBar(scope);
  const handle = await player.elementHandle();
  await scope.page().waitForFunction(video => video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0, handle);
  // Start from a settled paused state: initial autoplay can otherwise begin
  // between a paused read and Playwright's click, turning that click into Pause.
  await player.evaluate(video => video.pause());
  await scope.getByRole('button', { name: 'Play video', exact: true }).waitFor();
  await play.click();
  try { await scope.page().waitForFunction(video => !video.paused, handle); }
  catch (error) {
    console.log('Native play diagnostic:', await player.evaluate(video => ({ connected: video.isConnected, paused: video.paused, readyState: video.readyState, error: video.error?.message, currentTime: video.currentTime, duration: video.duration, muted: video.muted, src: video.currentSrc })), await play.getAttribute('aria-label'));
    throw error;
  }
  await scope.getByRole('button', { name: 'Pause video', exact: true }).click();
  await scope.page().waitForFunction(video => video.paused, handle);
  await scope.getByRole('button', { name: 'Play video', exact: true }).click();
  await scope.page().waitForFunction(video => !video.paused, handle);
  await scope.getByRole('button', { name: 'Pause video', exact: true }).click();
  await scope.page().waitForFunction(video => video.paused, handle);
  const initiallyMuted = await player.evaluate(video => video.muted);
  await mute.click();
  await scope.page().waitForFunction(({ video, expected }) => video.muted === expected, { video: handle, expected: !initiallyMuted });
  assert.equal(await mute.getAttribute('aria-label'), initiallyMuted ? 'Mute video' : 'Unmute video');
  await mute.click();
  await scope.page().waitForFunction(({ video, expected }) => video.muted === expected, { video: handle, expected: initiallyMuted });
  const duration = await player.evaluate(video => video.duration), target = Math.round(Math.min(5, duration * .35) * 10) / 10;
  await progress.waitFor({ state: 'visible' });
  assert.equal(await progress.isDisabled(), false, 'Decoded native media has a usable progress cursor');
  await seekProgress(progress, target);
  await scope.page().waitForFunction(({ video, target }) => Math.abs(video.currentTime - target) <= .35, { video: handle, target });
  assert.ok(Math.abs(Number(await progress.inputValue()) - target) <= .35, 'The progress cursor reflects the actual native seek');
  return { nativePlayPauseMuteSeek: true };
}

async function youtubePlaybackCommands(scope) {
  const { play, mute, progress } = await visiblePlaybackBar(scope);
  const page = scope.page();
  await page.waitForFunction(() => window.__auditYTPlayers?.some(player => !player.destroyed && player.frame.isConnected));
  await page.waitForFunction(button => !button.disabled, await play.elementHandle());
  const current = () => page.evaluate(() => {
    const player = window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected);
    return { state: player.getPlayerState(), muted: player.isMuted(), time: player.getCurrentTime(), duration: player.getDuration(), seeks: player.calls.seeks };
  });
  if ((await current()).state !== 1) await play.click();
  await page.waitForFunction(() => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected)?.getPlayerState() === 1);
  await page.evaluate(() => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected).bufferVideo());
  await page.waitForTimeout(300); // Include a real 250ms player poll while BUFFERING remains active.
  assert.equal(await play.getAttribute('aria-label'), 'Pause video', 'A buffering YouTube player retains the Pause command');
  await scope.getByRole('button', { name: 'Pause video', exact: true }).click();
  await page.waitForFunction(() => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected)?.getPlayerState() === 2);
  await scope.getByRole('button', { name: 'Play video', exact: true }).click();
  await page.waitForFunction(() => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected)?.getPlayerState() === 1);
  await scope.getByRole('button', { name: 'Pause video', exact: true }).click();
  await page.waitForFunction(() => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected)?.getPlayerState() === 2);
  const initiallyMuted = (await current()).muted;
  await mute.click();
  await page.waitForFunction(expected => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected)?.isMuted() === expected, !initiallyMuted);
  assert.equal(await mute.getAttribute('aria-label'), initiallyMuted ? 'Mute video' : 'Unmute video');
  await mute.click();
  await page.waitForFunction(expected => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected)?.isMuted() === expected, initiallyMuted);
  assert.equal(await progress.isDisabled(), false, 'Ready YouTube media exposes its actual duration to the progress cursor');
  const target = 7.5;
  await seekProgress(progress, target);
  try {
    await page.waitForFunction(target => {
      const player = window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected);
      return player?.calls.seeks.includes(target) && Math.abs(player.getCurrentTime() - target) <= .35;
    }, target, { timeout: 5000 });
  } catch (error) {
    console.log('YouTube seek diagnostic:', JSON.stringify({ target, player: await current(),
      range: await progress.evaluate(element => ({ min: element.min, max: element.max, value: element.value, disabled: element.disabled })) }));
    throw error;
  }
  await page.waitForFunction(({ input, target }) => Math.abs(Number(input.value) - target) <= .35,
    { input: await progress.elementHandle(), target });
  return { youtubePlayPauseMuteSeek: true, youtubeBufferingCanPause: true };
}

async function vimeoPlaybackCommands(scope, player) {
  const { mute, progress } = await visiblePlaybackBar(scope);
  const frame = await (await player.elementHandle()).contentFrame();
  assert.ok(frame, 'The synthetic official Vimeo frame is available');
  await frame.waitForFunction(() => window.__auditVimeo);
  await scope.getByRole('button', { name: 'Pause video', exact: true }).click();
  await frame.waitForFunction(() => window.__auditVimeo.paused === true);
  await scope.getByRole('button', { name: 'Play video', exact: true }).click();
  await frame.waitForFunction(() => window.__auditVimeo.paused === false);
  await scope.getByRole('button', { name: 'Pause video', exact: true }).click();
  await frame.waitForFunction(() => window.__auditVimeo.paused === true);
  const initiallyMuted = await frame.evaluate(() => window.__auditVimeo.muted);
  await mute.click();
  await frame.waitForFunction(expected => window.__auditVimeo.muted === expected, !initiallyMuted);
  await scope.getByRole('button', { name: initiallyMuted ? 'Mute video' : 'Unmute video', exact: true }).waitFor();
  await mute.click();
  await frame.waitForFunction(expected => window.__auditVimeo.muted === expected, initiallyMuted);
  const target = 6.4;
  assert.equal(await progress.isDisabled(), false, 'The trusted Vimeo response enables progress');
  await seekProgress(progress, target);
  await frame.waitForFunction(target => Math.abs(window.__auditVimeo.currentTime - target) <= .1, target);
  assert.ok(Math.abs(Number(await progress.inputValue()) - target) <= .1, 'The app cursor follows the Vimeo seek response');
  return { vimeoPlayPauseMuteSeek: true };
}

async function horizontalSwipe(context, page, box, direction, y = box.y + box.height / 2) {
  const start = box.x + box.width * (direction > 0 ? .65 : .15), end = box.x + box.width * (direction > 0 ? .15 : .65);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
  for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: start + (end - start) * step / 5, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
}

async function nativePlayerOptions(player) {
  const flags = await player.evaluate(video => ({ controls: video.controls,
    options: [...video.controlsList], pictureInPictureDisabled: video.disablePictureInPicture,
    remotePlaybackDisabled: video.disableRemotePlayback }));
  assert.equal(flags.controls, false, 'The reliable app playback row replaces the duplicate native control bar');
  assert.equal(await player.getAttribute('controls'), null);
  for (const option of ['nodownload', 'noplaybackrate', 'noremoteplayback']) assert.ok(flags.options.includes(option));
  assert.equal(flags.pictureInPictureDisabled, true); assert.equal(flags.remotePlaybackDisabled, true);
  assert.equal(flags.options.includes('nofullscreen'), false, 'The media element does not disable supported fullscreen');
  return { nativeOptions: flags.options, nativeControlBarReplaced: true };
}

async function changeNativePlayerSettings(page, menu, player, more, role = 'menuitem') {
  const route = page.url(), source = await player.getAttribute('src');
  await player.evaluate(video => {
    const track = video.addTextTrack('subtitles', 'Synthetic English', 'en');
    track.addCue(new VTTCue(0, 30, 'Synthetic caption fixture.'));
    track.mode = 'disabled';
  });
  const settingsOption = menu.getByRole(role, { name: /^[\w ]+ settings\b/ });
  const settingsTitle = (await settingsOption.innerText()).split('\n')[0];
  await settingsOption.click();
  const dialog = page.getByRole('dialog', { name: settingsTitle, exact: true });
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('radiogroup', { name: 'Playback speed', exact: true })
    .getByRole('radio', { name: '1.5\u00d7', exact: true }).click();
  assert.equal(await player.evaluate(video => video.playbackRate), 1.5, 'The UFIConnect overflow settings change the actual native player');
  const captions = dialog.getByRole('radiogroup', { name: 'Captions', exact: true });
  await captions.getByRole('radio', { name: 'Synthetic English', exact: true }).click();
  assert.equal(await player.evaluate(video => [...video.textTracks].find(track => track.label === 'Synthetic English').mode), 'showing',
    'Player settings enable the actual native caption track');
  await captions.getByRole('radio', { name: 'Off', exact: true }).click();
  assert.equal(await player.evaluate(video => [...video.textTracks].find(track => track.label === 'Synthetic English').mode), 'disabled');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  assert.ok(await more.evaluate(element => document.activeElement === element), 'Escape restores the existing post overflow trigger');
  assert.equal(page.url(), route); assert.equal(await player.getAttribute('src'), source, 'Settings preserve the selected media');
  assert.equal(await player.evaluate(video => video.playbackRate), 1.5);
}

try {
  await fs.mkdir(output, { recursive: true });
  for (const width of widths) {
    const id = `visible-controls-${width}`, user = member(id, { plan: 'pro' }); app.seedUser(user);
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block',
      reducedMotion: 'reduce', hasTouch: width < 600, isMobile: width < 600 });
    const page = await context.newPage(); page.setDefaultTimeout(18000);
    if (width === 390) await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }));
    const errors = [], writes = [], providerCalls = [], embeds = [];
    let videoRows = [], feedRows = [], snapRows = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__auditYTPlayers = [];
      window.YT = { PlayerState: { UNSTARTED: -1, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5, ENDED: 0 }, Player: class {
        constructor(frame, config) { this.frame = frame; this.config = config; this.state = -1; this.rate = 1; this.time = 0; this.muted = true; this.volume = 100;
          this.startedAt = performance.now(); this.calls = { plays: 0, pauses: 0, mutes: 0, unmutes: 0, seeks: [], cues: [] };
          this.id = new URL(frame.src).pathname.split('/').pop();
          window.__auditYTPlayers.push(this);
          setTimeout(() => config.events?.onReady?.({ target: this }), 20); }
        getIframe() { return this.frame; } getVideoData() { return { video_id: this.id }; }
        getDuration() { return 30; } getCurrentTime() { return Math.min(30, this.time + (this.state === 1 ? (performance.now() - this.startedAt) / 1000 * this.rate : 0)); }
        getPlayerState() { return this.state; } isMuted() { return this.muted; } getVolume() { return this.volume; }
        getAvailablePlaybackRates() { return [1, 1.5, 2]; } getPlaybackRate() { return this.rate; } getOptions() { return []; }
        setPlaybackRate(rate) { this.time = this.getCurrentTime(); this.startedAt = performance.now(); this.rate = rate; this.config.events?.onPlaybackRateChange?.({ target: this, data: rate }); }
        loadVideoById(id) { this.id = typeof id === 'object' ? id.videoId : id; this.time = 0; this.playVideo(); }
        cueVideoById(options) { this.id = options.videoId; this.time = options.startSeconds || 0; this.startedAt = performance.now(); this.state = 5; this.calls.seeks.push(this.time); this.calls.cues.push(this.time); this.config.events?.onStateChange?.({ target: this, data: 5 }); }
        bufferVideo() { this.time = this.getCurrentTime(); this.state = 3; this.config.events?.onStateChange?.({ target: this, data: 3 }); }
        playVideo() { this.time = this.getCurrentTime(); this.startedAt = performance.now(); this.state = 1; this.calls.plays++; this.config.events?.onStateChange?.({ target: this, data: 1 }); }
        pauseVideo() { this.time = this.getCurrentTime(); this.state = 2; this.calls.pauses++; this.config.events?.onStateChange?.({ target: this, data: 2 }); }
        mute() { this.muted = true; this.calls.mutes++; } unMute() { this.muted = false; this.calls.unmutes++; }
        setVolume(volume) { this.volume = volume; }
        seekTo(seconds) { this.time = Math.max(0, Math.min(30, seconds)); this.startedAt = performance.now(); this.calls.seeks.push(seconds); }
        destroy() { this.destroyed = true; this.frame.remove(); }
      } };
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname === mediaHost && /\.mp4$/.test(url.pathname)) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || '');
        const start = range ? Number(range[1]) : 0, end = range && range[2] ? Math.min(Number(range[2]), nativeMedia.length - 1) : nativeMedia.length - 1;
        return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', body: nativeMedia.subarray(start, end + 1),
          headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${nativeMedia.length}` } : {}) } });
      }
      if (url.hostname === mediaHost && /\.ts$/.test(url.pathname)) return; // HLS transport stays pending without fetching a provider.
      if (url.hostname === mediaHost && /\.m3u8$/.test(url.pathname)) return route.fulfill({
        contentType: 'application/vnd.apple.mpegurl', body: `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:30\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:30.0,\nhttps://${mediaHost}/segment.ts\n#EXT-X-ENDLIST\n` });
      if (url.hostname === 'vimeo.com' && url.pathname === '/api/oembed.json') return route.fulfill({ json: { duration: 30 } });
      if (url.hostname === mediaHost || url.origin !== server.origin && request.resourceType() === 'image') {
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#1e3a8a"/></svg>' });
      }
      if (['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'].includes(url.hostname) && request.resourceType() === 'document') {
        embeds.push(url.href); return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="margin:0;background:#172554;color:white"><button>Provider branding</button>${url.hostname === 'player.vimeo.com' ? `<script>
          const emit=message=>parent.postMessage(message,'*'),state=window.__auditVimeo={paused:false,muted:true,volume:1,currentTime:0};
          addEventListener('message',event=>{let message;try{message=typeof event.data==='string'?JSON.parse(event.data):event.data}catch{return}
            if(message?.method==='ping')emit({method:'ping'});
            if(message?.method==='getVideoId')emit({method:'getVideoId',value:Number(location.pathname.split('/').at(-1))});
            if(message?.method==='getCurrentTime')emit({method:'getCurrentTime',value:state.currentTime});
            if(message?.method==='getDuration')emit({method:'getDuration',value:30});
            if(message?.method==='getPaused')emit({method:'getPaused',value:state.paused});
            if(message?.method==='getMuted')emit({method:'getMuted',value:state.muted});
            if(message?.method==='getVolume')emit({method:'getVolume',value:state.volume});
            if(message?.method==='play'||message?.method==='pause'){state.paused=message.method==='pause';emit({method:message.method,value:true});emit({event:message.method})}
            if(message?.method==='setMuted'){state.muted=Boolean(message.value);emit({method:'setMuted',value:state.muted});emit({event:'volumechange',data:{muted:state.muted,volume:state.volume}})}
            if(message?.method==='setVolume'){state.volume=Number(message.value);emit({method:'setVolume',value:state.volume});emit({event:'volumechange',data:{muted:state.muted,volume:state.volume}})}
            if(message?.method==='setCurrentTime'){state.currentTime=Number(message.value)||0;emit({method:'setCurrentTime',value:state.currentTime});emit({event:'timeupdate',data:{seconds:state.currentTime,duration:30}})}
          });setTimeout(()=>emit({event:'ready'}),30);
        </script>` : ''}</body></html>` });
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
      if (endpoint.startsWith('/feed/') && !endpoint.endsWith('/comments')) return send({ post: feedRows.find(post => post.id === decodeURIComponent(endpoint.slice('/feed/'.length))) || null });
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
      await auditNavigate(page, server.origin + '/saved/posts');
      await page.locator('.saved-page').waitFor({ state: 'visible' });
      videoRows = rows;
      await auditNavigate(page, server.origin + path);
    };
    for (const surface of detailsOnly ? [] : ['videos', 'music']) {
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
          assert.equal(new URL(await player.getAttribute('src')).searchParams.get('controls'), '0', 'Provider playback controls are disabled by the supported parameter');
          const frame = kind === 'youtube' ? page.frameLocator('.video-feed-youtube-player iframe') : slide.frameLocator('iframe');
          await frame.getByRole('button', { name: 'Provider branding', exact: true }).click();
        } else {
          nativeOptions = await nativePlayerOptions(player);
        }
        const { bar: playback } = await visiblePlaybackBar(slide);
        assert.equal(await slide.getByRole('button', { name: /^(?:Play|Pause|Mute|Unmute) video$/ }).count(), 2,
          'The app exposes one Play/Pause and one Mute/Unmute button for this media');
        let commands = {};
        if (kind === 'native' || kind === 'external') commands = await nativePlaybackCommands(slide, player);
        if (kind === 'youtube') commands = await youtubePlaybackCommands(slide);
        if (kind === 'vimeo') commands = await vimeoPlaybackCommands(slide, player);
        if (kind === 'native') {
          await slide.locator('[data-video-media]').hover({ position: { x: 12, y: 12 } });
          await page.waitForFunction(() => document.querySelector('.video-feed-slide')?.dataset.cursorIdle === 'true');
          await visiblePlaybackBar(slide);
          assert.equal(await playback.evaluate(element => getComputedStyle(element).opacity), '1', 'The entire playback row remains visible after pointer idle');
        }
        await captionControls(slide, '.video-feed-caption-expanded');
        const more = await sourceAfterMenu(slide.getByRole('group', { name: 'Post actions', exact: true }));
        await more.click(); const menu = page.getByRole('menu'); await menu.waitFor();
        await noHiddenControls(menu);
        if (width === 390) assert.equal(await menu.getByRole('menuitem', { name: /^(?:Exit full screen|Full screen)$/ }).count(), 0,
          'A device without full-screen capability is not offered an unsupported command');
        if (nativeOptions) await changeNativePlayerSettings(page, menu, player, more);
        else {
          assert.equal(await menu.getByRole('menuitem', { name: /^Player settings\b/ }).count(), 0, 'Provider iframes do not advertise native player settings');
          await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
        }
        assert.ok(await more.evaluate(element => document.activeElement === element));
        if (kind === 'external') await page.screenshot({ path: `${output}/${surface}-${width}.png`, fullPage: true });
        results.push({ width, surface, kind, providerControlsHidden: ['youtube', 'vimeo'].includes(kind), providerUiUnobscured: ['youtube', 'vimeo'].includes(kind), appControlsBelowMedia: true, appControlsLeftOfProgress: true,
          captionExpansion: true, sourceRightOfOverflow: true, nativeSettingsChangeActualRateAndCaptions: Boolean(nativeOptions), ...commands, ...nativeOptions });
        console.log(`PASS ${surface} ${kind}: visible controls/caption/source order ${width}px`);
      }
      await visit(`/${surface}`, [native(`${surface}-swipe-one`), native(`${surface}-swipe-two`), native(`${surface}-swipe-three`)]);
      const scroll = page.locator('[data-video-feed-scroll]'), first = page.locator(`[data-post-id="${surface}-swipe-one"]`);
      await first.locator('video').waitFor({ state: 'visible' });
      // Pin this isolated swipe case to its first slide after feed restoration.
      await scroll.evaluate(element => { element.scrollTop = 0; });
      await page.waitForFunction(() => document.querySelector('[data-video-feed-scroll]')?.scrollTop <= 2);
      await captionControls(first, '.video-feed-caption-expanded');
      assert.equal(await scroll.evaluate(element => Math.round(element.scrollTop)), 0, 'Caption buttons do not change the active video');
      const progress = first.getByRole('slider', { name: 'Video progress', exact: true });
      const cursorBox = await progress.boundingBox();
      await horizontalSwipe(context, page, cursorBox, 1);
      assert.equal(await scroll.evaluate(element => Math.round(element.scrollTop)), 0, 'Dragging the custom progress cursor does not advance the feed');
      let bounds = await first.locator('video').boundingBox();
      await horizontalSwipe(context, page, bounds, 1, bounds.y + bounds.height * .2);
      await page.waitForFunction(() => { const scroll = document.querySelector('[data-video-feed-scroll]'); return scroll && Math.abs(scroll.scrollTop - scroll.clientHeight) <= 2; });
      await page.waitForTimeout(550);
      bounds = await page.locator(`[data-post-id="${surface}-swipe-two"] video`).boundingBox();
      await horizontalSwipe(context, page, bounds, -1, bounds.y + bounds.height * .2);
      await page.waitForFunction(() => document.querySelector('[data-video-feed-scroll]')?.scrollTop <= 2);
      results.push({ width, surface, kind: 'horizontal-swipe', advancesAndRestores: true, appCursorPreserved: true });
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
    assert.equal(await nativeCard.locator('.post-chrome-source-link').getAttribute('href'), '/p/generic-native', 'Native posts open their internal post route');
    assert.equal(await nativeCard.getByRole('button', { name: 'More options', exact: true }).count(), 1, 'Native post options remain available');
    results.push({ width, surface: 'generic-feed', kind: 'native', nativePostPreserved: true });

    for (const kind of ['native', 'youtube']) {
      const post = kind === 'native' ? native('detail-native') : youtube('detail-youtube');
      feedRows = [post];
      await visit(`/p/${post.id}`);
      const detail = page.locator('.post-card').first();
      const player = detail.locator(kind === 'youtube' ? 'iframe' : 'video');
      await player.waitFor({ state: 'visible' });
      if (kind === 'youtube') assert.equal(new URL(await player.getAttribute('src')).searchParams.get('controls'), '0');
      else assert.equal(await player.evaluate(video => video.controls), false);
      const row = await visiblePlaybackBar(detail);
      const mediaBounds = await player.boundingBox(), rowBounds = await row.bar.boundingBox();
      assert.ok(rowBounds.y >= mediaBounds.y + mediaBounds.height - 1, 'Post detail controls stay below its video');
      const commands = kind === 'youtube' ? await youtubePlaybackCommands(detail) : await nativePlaybackCommands(detail, player);
      results.push({ width, surface: 'post-detail', kind, appControlsBelowMedia: true, ...commands });
      console.log(`PASS post detail ${kind}: controls below media ${width}px`);

      // Open the same post through Home to exercise the full-size viewer.
      await visit(kind === 'native' ? '/?feed=ufi' : '/?feed=feed&all=1');
      const feedCard = kind === 'native' ? page.locator('.post-card').filter({ has: page.locator('video') }).first()
        : page.locator('.post-card').filter({ hasText: post.title }).first();
      await feedCard.waitFor();
      if (kind === 'youtube') await feedCard.getByRole('button', { name: 'View fullscreen', exact: true }).click();
      else await feedCard.locator('video').click();
      const viewer = page.locator('.media-lightbox[aria-modal="true"]');
      await viewer.waitFor();
      const expandedPlayer = viewer.locator(kind === 'youtube' ? 'iframe' : 'video');
      await expandedPlayer.waitFor({ state: 'visible' });
      if (kind === 'youtube') {
        assert.equal(new URL(await expandedPlayer.getAttribute('src')).searchParams.get('controls'), '0');
        await viewer.frameLocator('iframe').getByRole('button', { name: 'Provider branding', exact: true }).click();
      } else assert.equal(await expandedPlayer.evaluate(video => video.controls), false);
      assert.equal(await viewer.locator('.media-lightbox-stage button, .media-lightbox-stage input').count(), 0, 'The video viewport has no app control overlays');
      const header = await viewer.locator('.media-lightbox-video-navigation').boundingBox(), stage = await viewer.locator('.media-lightbox-stage').boundingBox();
      assert.ok(header.y + header.height <= stage.y + 1, 'Viewer navigation is above the video');
      const viewerCommands = kind === 'youtube' ? await youtubePlaybackCommands(viewer) : await nativePlaybackCommands(viewer, expandedPlayer);
      await viewer.getByRole('slider', { name: 'Video progress', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await viewer.getAttribute('aria-label'), post.title, 'Progress keys do not navigate the viewer');
      if (width === 390) await page.screenshot({ path: `${output}/lightbox-${kind}-${width}.png`, fullPage: true });
      await viewer.getByRole('button', { name: 'Close', exact: true }).click();
      await viewer.waitFor({ state: 'detached' });
      results.push({ width, surface: 'lightbox', kind, appControlsBelowMedia: true, noAppVideoOverlays: true, ...viewerCommands });
      console.log(`PASS lightbox ${kind}: controls below media ${width}px`);
    }

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
    for (const kind of detailsOnly ? [] : ['external', 'youtube', 'native']) {
      const id = `${kind}-snap`;
      await visit(kind === 'native' ? '/?feed=ufi' : '/?feed=feed&all=1');
      const profile = page.locator(`.snap-profile-button[data-snap-ids*='"${id}"']`); await profile.waitFor(); await profile.click();
      const viewer = page.locator('dialog.snap-viewer'); await viewer.waitFor();
      const player = viewer.locator(kind === 'youtube' ? 'iframe' : 'video'); await player.waitFor({ state: 'visible' });
      let nativeOptions = null;
      if (kind === 'youtube') assert.equal(new URL(await player.getAttribute('src')).searchParams.get('controls'), '0');
      else nativeOptions = await nativePlayerOptions(player);
      assert.equal(await viewer.getByRole('slider', { name: 'Snap position', exact: true }).count(), 0,
        'The removed snap-position navigation remains absent');
      assert.equal(await viewer.getByRole('slider', { name: 'Video progress', exact: true }).count(), 1,
        'The visible cursor controls video playback rather than snap navigation');
      await visiblePlaybackBar(viewer);
      assert.equal(await viewer.locator('.snap-viewer-cube-outgoing video, .snap-viewer-cube-outgoing iframe').count(), 0,
        'The static outgoing cube face never duplicates a live player');
      let playbackCommands = {};
      if (kind === 'youtube') {
        await page.waitForFunction(() => window.__auditYTPlayers?.some(player => !player.destroyed && player.frame.isConnected));
        assert.equal(await page.evaluate(() => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected).calls.plays), 0,
          'Opening an external YouTube Snap does not start playback');
        const progress = viewer.getByRole('slider', { name: 'Video progress', exact: true });
        await page.waitForFunction(() => !document.querySelector('.snap-viewer-playback input')?.disabled);
        await seekProgress(progress, 4);
        await page.waitForFunction(() => {
          const player = window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected);
          return player?.calls.cues.includes(4) && player.getCurrentTime() === 4;
        });
        assert.equal(await page.evaluate(() => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected).calls.plays), 0,
          'Seeking an unstarted external Snap cues its position without playing');
        assert.equal(await page.evaluate(() => window.__auditYTPlayers.findLast(player => !player.destroyed && player.frame.isConnected).getPlayerState()), 5);
        playbackCommands = await youtubePlaybackCommands(viewer);
        playbackCommands.youtubeUnstartedSeekDoesNotPlay = true;
      } else {
        if (kind === 'external') {
          assert.equal(await player.evaluate(video => video.autoplay), false, 'External native Snaps do not request autoplay');
          assert.equal(await player.evaluate(video => video.paused), true, 'An external native Snap waits for an explicit Play gesture');
        }
        playbackCommands = await nativePlaybackCommands(viewer, player);
      }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(2300);
      await visiblePlaybackBar(viewer);
      const selection = await viewer.locator('.snap-viewer-caption').innerText();
      await captionControls(viewer, '.snap-viewer-caption');
      assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selection, 'Caption controls do not advance the clip');
      const commands = viewer.getByRole('group', { name: 'Snap commands', exact: true });
      assert.equal(await commands.evaluate(element => Boolean(element.closest('.snap-viewer-topbar'))), false,
        'Snap overflow and source navigation use the bottom post actions instead of a second top menu');
      if (kind !== 'native') await sourceAfterMenu(commands, 'Snap options');
      else assert.equal(await commands.locator('.post-chrome-source-link').count(), 0, 'Native Snaps do not invent an external source');
      if (kind === 'external') {
        const cursorBox = await viewer.getByRole('slider', { name: 'Video progress', exact: true }).boundingBox();
        await horizontalSwipe(context, page, cursorBox, 1);
        assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selection,
          'Using the playback cursor does not advance the selected Snap');
        const swipe = async direction => {
          const bounds = await viewer.locator('.snap-viewer-topbar').boundingBox();
          const topActions = viewer.locator('.snap-viewer-topbar .snap-viewer-top-actions');
          const safe = await topActions.count() ? { ...bounds, width: (await topActions.boundingBox()).x - bounds.x - 8 } : bounds;
          assert.ok(safe.width * .5 >= 55, 'The swipe starts and ends in plain topbar space outside interactive source/menu controls');
          return horizontalSwipe(context, page, safe, direction);
        };
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await swipe(1);
        await viewer.locator('.snap-viewer-caption').getByText('Second source clip caption.', { exact: true }).waitFor();
        assert.equal(await viewer.locator('.snap-viewer-cube-outgoing').count(), 1, 'A real cube turn renders its outgoing static face');
        assert.equal(await viewer.locator('.snap-viewer-cube-outgoing video, .snap-viewer-cube-outgoing iframe').count(), 0,
          'A real cube transition keeps the outgoing face free of players');
        assert.equal(await viewer.locator('video, iframe').count(), 1, 'One live player owns the newly selected Snap during the turn');
        assert.equal(await commands.locator('.post-chrome-source-link').getAttribute('href'), 'https://mastodon.social/@fixture/98767');
        // Let the gesture cooldown elapse while checking the newly selected source identity.
        await page.waitForTimeout(550);
        await swipe(-1);
        await page.waitForFunction(expected => document.querySelector('.snap-viewer-caption')?.textContent === expected, selection);
        await viewer.locator('.snap-viewer-cube-outgoing').waitFor({ state: 'detached' });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await viewer.getByRole('slider', { name: 'Video progress', exact: true }).focus(); await page.keyboard.press('ArrowRight');
        assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selection, 'Playback-cursor keys do not move to the next Snap');
      } else if (kind === 'youtube') {
        await viewer.frameLocator('iframe').getByRole('button', { name: 'Provider branding', exact: true }).click();
        await page.keyboard.press('ArrowRight');
        assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selection, 'Provider iframe keys do not move to the next Snap');
      } else {
        await viewer.getByRole('slider', { name: 'Video progress', exact: true }).focus(); await page.keyboard.press('ArrowRight');
        assert.equal(await viewer.locator('.snap-viewer-caption').innerText(), selection, 'Playback-cursor keys do not advance the Snap author group');
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
      results.push({ width, surface: 'snaps', kind, providerControlsHidden: kind === 'youtube', providerUiUnobscured: kind === 'youtube', appControlsBelowMedia: true, captionExpansion: true,
        appControlsLeftOfProgress: true, idleControlsVisible: true, sourceRightOfOverflow: kind !== 'native',
        nativeSettingsChangeActualRateAndCaptions: Boolean(nativeOptions), ...playbackCommands, ...nativeOptions });
      console.log(`PASS snaps ${kind}: visible controls/caption/source order ${width}px`);
    }
    assert.equal(await page.locator('.global-search-open').count(), 0, 'The search bar has no trailing popup arrow');
    if (width < 769) await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
    const nav = page.locator(width < 769 ? '#mobile-account-drawer .mobile-feed-drawer-content' : '.sidebar-nav');
    const searchLink = nav.getByRole('link', { name: 'Search', exact: true });
    await searchLink.waitFor({ state: 'visible' });
    assert.ok(await searchLink.evaluate(element => element.nextElementSibling?.getAttribute('href') === '/people'), 'Search appears immediately above People');
    assert.equal(await searchLink.getAttribute('href'), '/search');
    await searchLink.click(); await page.waitForURL('**/search');
    results.push({ width, surface: 'navigation', searchAbovePeople: true, searchNavigates: true, noTrailingSearchArrow: true });
    assert.deepEqual(errors, [], 'No browser exceptions'); assert.deepEqual(writes, [], 'No provider or account writes');
    assert.deepEqual(providerCalls, [], 'All remote provider requests are blocked or synthetic player/media responses');
    assert.ok(embeds.length >= (detailsOnly ? 2 : 3));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal page overflow');
    await context.close(); console.log(`PASS visible media controls and source/menu order at ${width}px`);
    await fs.writeFile(`${output}/summary.json`, JSON.stringify({ origin: server.origin, results }, null, 2) + '\n');
  }
  await fs.writeFile(`${output}/summary.json`, JSON.stringify({ origin: server.origin, results }, null, 2) + '\n');
} finally { await browser.close(); await server.close(); await app.close(); }
