import { getNativeRuntime } from './nativeRuntime.mjs';

const bindings = new WeakMap();
let sequence = 0;
const VIDEO_ID = /^[\w-]{11}$/;
const OVERLAY_SELECTOR = 'dialog[open], [role="dialog"], [role="menu"], .post-chrome-menu, [role="alert"], [role="status"], [aria-live], [popover]';
export function hasNativeYouTubePlayer() { return typeof getNativeRuntime()?.onYouTubePlayer === 'function'; }

export function createNativeYouTubeFrame(host, videoId, playerVars, title) {
  if (!VIDEO_ID.test(String(videoId || ''))) throw new Error('Invalid video.');
  const frame = host.ownerDocument.createElement('div');
  frame.className = 'native-youtube-surface';
  frame.setAttribute('aria-label', title || 'YouTube video');
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000';
  bindings.set(frame, { videoId, playerVars });
  host.replaceChildren(frame);
  return frame;
}

// Native views sit in the same safe-area content box as this DOM viewport.
// Clip only to real scrolling ancestors; never crop the provider's artwork/UI.
export function nativePlayerRect(frame, win = window) {
  const doc = frame.ownerDocument;
  const viewportWidth = win.innerWidth, viewportHeight = win.innerHeight;
  const r = frame.getBoundingClientRect();
  let left = Math.max(0, r.left), top = Math.max(0, r.top);
  let right = Math.min(viewportWidth, r.right), bottom = Math.min(viewportHeight, r.bottom);
  let visible = frame.isConnected && !doc.hidden && r.width > 0 && r.height > 0;
  for (let node = frame; node && node !== doc.documentElement; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) visible = false;
    if (node === frame) continue;
    const parent = node.getBoundingClientRect();
    if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, parent.left); right = Math.min(right, parent.right); }
    if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, parent.top); bottom = Math.min(bottom, parent.bottom); }
  }
  const clipWidth = Math.max(0, right - left), clipHeight = Math.max(0, bottom - top);
  visible = visible && clipWidth > 1 && clipHeight > 1;
  if (visible && typeof doc.elementFromPoint === 'function') {
    // A DOM dialog/menu must stay above the native video. Hide the native
    // surface as soon as any sampled point is covered, including transitions.
    for (const [x, y] of [[.5, .5], [.05, .05], [.95, .05], [.05, .95], [.95, .95]]) {
      const hit = doc.elementFromPoint(left + clipWidth * x, top + clipHeight * y);
      if (hit && hit !== frame && !frame.contains(hit)) { visible = false; break; }
    }
    // A small menu/toast can fit between every sample above. Check its actual
    // intersection too, then hit-test the paint order: panels underneath the
    // video, outside its bounds, or containing this player do not hide it.
    if (visible) for (const overlay of doc.querySelectorAll?.(OVERLAY_SELECTOR) || []) {
      if (overlay === frame || overlay.contains(frame) || frame.contains(overlay)) continue;
      const bounds = overlay.getBoundingClientRect();
      const x1 = Math.max(left, bounds.left), y1 = Math.max(top, bounds.top);
      const x2 = Math.min(right, bounds.right), y2 = Math.min(bottom, bounds.bottom);
      if (x2 - x1 <= 0 || y2 - y1 <= 0) continue;
      const hit = doc.elementFromPoint((x1 + x2) / 2, (y1 + y2) / 2);
      if (hit && (hit === overlay || overlay.contains(hit))) { visible = false; break; }
    }
  }
  const round = n => Math.round(n * 2) / 2;
  return { x: round(r.left), y: round(r.top), width: round(r.width), height: round(r.height),
    clipX: round(left), clipY: round(top), clipWidth: round(clipWidth), clipHeight: round(clipHeight),
    viewportWidth, viewportHeight, visible: Boolean(visible) };
}

function forwardSwipe(frame, data) {
  if (!data || ![data.dx, data.dy, data.duration].every(Number.isFinite) || data.duration > 900
    || Math.max(Math.abs(data.dx), Math.abs(data.dy)) < 55) return;
  const doc = frame.ownerDocument, win = doc.defaultView;
  const rect = frame.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  // Existing Videos and Snaps gesture handlers receive the same touch shape
  // as touches on their HTML5 video. No click or link activation is invented.
  const emit = (name, touches, changedTouches) => {
    const event = new win.Event(name, { bubbles: true });
    Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
    frame.dispatchEvent(event);
  };
  const start = { identifier: 1, clientX: x, clientY: y };
  emit('touchstart', [start], [start]);
  emit('touchend', [], [{ identifier: 1, clientX: x + data.dx, clientY: y + data.dy }]);
  // Ordinary feed cards use normal page scrolling, not swipe navigation.
  if (!frame.closest('.video-feed-container, .video-feed-view, .snap-viewer, .video-shared-youtube-layer')
    && Math.abs(data.dy) > Math.abs(data.dx)) {
    let node = frame.parentElement;
    while (node && !(node.scrollHeight > node.clientHeight && /auto|scroll/.test(win.getComputedStyle(node).overflowY))) node = node.parentElement;
    (node || doc.scrollingElement)?.scrollBy({ top: -data.dy, behavior: 'instant' });
  }
}

export class NativeYouTubePlayer {
  constructor(target, options = {}) {
    const host = getNativeRuntime();
    if (typeof host?.onYouTubePlayer !== 'function') throw new Error('Native video is unavailable.');
    this.frame = typeof target === 'string' ? document.getElementById(target) : target;
    if (!this.frame) throw new Error('Video surface is unavailable.');
    const source = bindings.get(this.frame) || {};
    const videoId = options.videoId || source.videoId;
    if (!VIDEO_ID.test(String(videoId || ''))) throw new Error('Invalid video.');
    this.host = host;
    this.key = `youtube_${Date.now().toString(36)}_${++sequence}`;
    this.events = options.events || {};
    this.state = { playerState: -1, currentTime: 0, duration: 0, muted: true, volume: 100,
      playbackRate: 1, availablePlaybackRates: [1], videoId };
    this.commands = [];
    this.disposed = false;
    this.busy = false;
    this.mounted = false;
    this.hiddenSince = 0;
    this.resume = null;
    this.readyReported = false;
    this.surfaceReady = false;
    this.wantsPlayback = false;
    this.win = this.frame.ownerDocument.defaultView;
    this.playerVars = { ...source.playerVars, ...options.playerVars };
    this.lastRect = '';
    this.lastSync = 0;
    this.tick = () => {
      if (this.disposed) return;
      if (!this.frame.isConnected) { this.destroy(); return; }
      const rect = nativePlayerRect(this.frame, this.win), serialized = JSON.stringify(rect);
      if (rect.visible) this.hiddenSince = 0;
      else if (!this.hiddenSince) this.hiddenSince = Date.now();
      if (!this.busy && this.mounted && !rect.visible && Date.now() - this.hiddenSince > 1000) {
        void this.suspend();
      } else if (!this.busy && (this.mounted || rect.visible) && (serialized !== this.lastRect || this.commands.length || Date.now() - this.lastSync >= 250)) {
        this.lastRect = serialized;
        void this.sync(rect);
      }
      this.raf = this.win.requestAnimationFrame(this.tick);
    };
    this.visibility = () => { if (this.frame.ownerDocument.hidden) this.pauseVideo(); };
    this.frame.ownerDocument.addEventListener('visibilitychange', this.visibility);
    // Native action resolution is asynchronous, including the onReady event.
    this.raf = this.win.requestAnimationFrame(this.tick);
  }
  async sync(rect) {
    if (this.disposed || this.busy) return;
    this.busy = true;
    this.lastSync = Date.now();
    try {
      const op = this.mounted ? 'sync' : 'mount';
      const request = { op, key: this.key, rect };
      if (op === 'mount') Object.assign(request, { videoId: this.state.videoId, playerVars: this.playerVars });
      else request.commands = this.surfaceReady ? this.commands.splice(0, 16) : [];
      const result = await this.host.onYouTubePlayer(request);
      if (this.disposed) { await this.host.onYouTubePlayer({ op: 'destroy', key: this.key }); return; }
      this.mounted = true;
      if (result?.state) this.state = { ...this.state, ...result.state };
      for (const event of result?.events || []) {
        if (this.disposed) break;
        if (event.type === 'swipe') { forwardSwipe(this.frame, event.data); continue; }
        const name = { ready: 'onReady', state: 'onStateChange', error: 'onError', rate: 'onPlaybackRateChange', api: 'onApiChange' }[event.type];
        if (event.type === 'ready') {
          this.surfaceReady = true;
          if (this.resume) {
            const previous = this.resume;
            this.resume = null;
            const restore = [
              { name: 'cueVideoById', args: [{ videoId: previous.videoId, startSeconds: previous.currentTime }] },
              { name: 'setVolume', args: [previous.volume] },
              { name: previous.muted ? 'mute' : 'unMute', args: [] },
              { name: 'setPlaybackRate', args: [previous.playbackRate] },
            ];
            if (this.wantsPlayback) restore.push({ name: 'playVideo', args: [] });
            this.commands.unshift(...restore);
          }
          // Remounting an offscreen native surface is internal. Repeating
          // onReady would let application startup callbacks undo a pause.
          if (this.readyReported) continue;
          this.readyReported = true;
        }
        if (name) this.events[name]?.({ target: this, data: event.data });
      }
    } catch {
      if (!this.disposed) {
        this.events.onError?.({ target: this, data: 5 });
        this.destroy();
      }
    } finally { this.busy = false; }
  }
  async suspend() {
    this.busy = true;
    try {
      await this.host.onYouTubePlayer({ op: 'destroy', key: this.key });
      this.mounted = false;
      this.surfaceReady = false;
      this.resume = { ...this.state };
      this.lastRect = '';
    } catch { /* The native view may already have been released. */ }
    finally { this.busy = false; }
  }
  command(name, ...args) {
    if (this.disposed) return;
    if (name === 'playVideo' || name === 'loadVideoById') this.wantsPlayback = true;
    if (['pauseVideo', 'stopVideo', 'cueVideoById'].includes(name)) this.wantsPlayback = false;
    if (this.commands.length >= 32) this.commands.shift();
    this.commands.push({ name, args });
  }
  playVideo() { this.command('playVideo'); }
  pauseVideo() { this.command('pauseVideo'); }
  stopVideo() { this.command('stopVideo'); }
  seekTo(seconds, allowSeekAhead = true) { this.command('seekTo', seconds, allowSeekAhead); }
  mute() { this.command('mute'); }
  unMute() { this.command('unMute'); }
  setVolume(volume) { this.command('setVolume', volume); }
  setPlaybackRate(rate) { this.command('setPlaybackRate', rate); }
  loadVideoById(value) { this.command('loadVideoById', value); }
  cueVideoById(value) { this.command('cueVideoById', value); }
  getPlayerState() { return this.state.playerState; }
  getCurrentTime() { return this.state.currentTime; }
  getDuration() { return this.state.duration; }
  isMuted() { return this.state.muted; }
  getVolume() { return this.state.volume; }
  getPlaybackRate() { return this.state.playbackRate; }
  getAvailablePlaybackRates() { return [...this.state.availablePlaybackRates]; }
  getVideoData() { return { video_id: this.state.videoId }; }
  getIframe() { return this.frame; }
  getOptions() { return []; }
  getOption() { return undefined; }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.win.cancelAnimationFrame(this.raf);
    this.frame.ownerDocument.removeEventListener('visibilitychange', this.visibility);
    this.commands = [];
    void this.host.onYouTubePlayer({ op: 'destroy', key: this.key }).catch(() => {});
  }
}

export const nativeYouTubeApi = { Player: NativeYouTubePlayer,
  PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
