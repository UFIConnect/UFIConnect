import test from 'node:test';
import assert from 'node:assert/strict';
import { configureNativeRuntime } from './nativeRuntime.mjs';
import { NativeYouTubePlayer, hasNativeYouTubePlayer } from './nativeYouTubePlayer.mjs';

function fixture(request) {
  const listeners = new Map(), scheduled = new Map();
  let next = 1;
  const win = { innerWidth: 390, innerHeight: 760,
    getComputedStyle: () => ({ opacity: '1', display: 'block', visibility: 'visible', overflowX: 'visible', overflowY: 'visible' }),
    requestAnimationFrame(fn) { const id = next++; scheduled.set(id, fn); return id; },
    cancelAnimationFrame(id) { scheduled.delete(id); } };
  const doc = { defaultView: win, hidden: false, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  const frame = { ownerDocument: doc, isConnected: true, parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 100, right: 390, bottom: 320, width: 390, height: 220 }) };
  configureNativeRuntime({ nativePlatform: 'ios', onApiRequest: async () => {}, onYouTubePlayer: request });
  return { frame, listeners, scheduled };
}

test('ordinary browser runtime never selects the native player', () => {
  configureNativeRuntime(null);
  assert.equal(hasNativeYouTubePlayer(), false);
});

test('native player reports actual state, preserves command order and unregisters on destroy', async () => {
  const calls = [], events = [];
  const f = fixture(async input => {
    calls.push(input);
    return { state: { videoId: 'dQw4w9WgXcQ', playerState: 1, duration: 120, currentTime: 18, muted: false },
      events: input.op === 'mount' ? [{ type: 'ready' }] : [] };
  });
  const player = new NativeYouTubePlayer(f.frame, { videoId: 'dQw4w9WgXcQ', playerVars: { controls: 0 }, events: { onReady: e => events.push(e.target) } });
  await player.sync({ visible: true });
  assert.equal(calls[0].op, 'mount');
  assert.equal(calls[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(events[0], player);
  assert.equal(player.getCurrentTime(), 18);
  assert.equal(player.getPlayerState(), 1);
  assert.equal(player.getVideoData().video_id, 'dQw4w9WgXcQ');
  player.pauseVideo(); player.seekTo(40, true); player.unMute();
  assert.equal(player.getCurrentTime(), 18, 'No optimistic playback claims');
  await player.sync({ visible: true });
  assert.deepEqual(calls[1].commands.map(c => c.name), ['pauseVideo', 'seekTo', 'unMute']);
  player.destroy();
  await Promise.resolve();
  assert.equal(calls.at(-1).op, 'destroy');
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.listeners.size, 0);
  player.playVideo(); assert.equal(player.commands.length, 0);
  configureNativeRuntime(null);
});

test('a mount resolving after cleanup cannot resurrect or call the previous player', async () => {
  const calls = []; let resolveMount, ready = 0;
  const f = fixture(input => {
    calls.push(input);
    return input.op === 'mount' ? new Promise(resolve => { resolveMount = resolve; }) : Promise.resolve({});
  });
  const player = new NativeYouTubePlayer(f.frame, { videoId: 'dQw4w9WgXcQ', events: { onReady: () => ready++ } });
  const pending = player.sync({ visible: true });
  player.destroy();
  resolveMount({ events: [{ type: 'ready' }] });
  await pending;
  assert.equal(ready, 0);
  assert.equal(calls.at(-1).op, 'destroy');
  assert.equal(f.scheduled.size, 0);
  configureNativeRuntime(null);
});

test('native bridge failure reports one playable error and stops the polling loop', async () => {
  let errors = 0;
  const f = fixture(async () => { throw new Error('Sensitive host detail'); });
  const player = new NativeYouTubePlayer(f.frame, { videoId: 'dQw4w9WgXcQ', events: { onError: event => {
    errors++; assert.equal(event.data, 5); assert.equal(event.target, player);
  } } });
  await player.sync({ visible: true });
  assert.equal(errors, 1);
  assert.equal(player.disposed, true);
  assert.equal(f.scheduled.size, 0);
  configureNativeRuntime(null);
});

test('offscreen remount restores settings without replaying onReady or undoing a pause', async () => {
  const calls = []; let ready = 0;
  const f = fixture(async input => {
    calls.push(input);
    return { state: { videoId: 'dQw4w9WgXcQ', playerState: 2, currentTime: 42, duration: 200,
      volume: 35, muted: false, playbackRate: 1.5, availablePlaybackRates: [1, 1.5] },
      events: input.op === 'mount' ? [{ type: 'ready' }] : [] };
  });
  const player = new NativeYouTubePlayer(f.frame, { videoId: 'dQw4w9WgXcQ', events: { onReady: () => ready++ } });
  await player.sync({ visible: true });
  player.pauseVideo(); await player.sync({ visible: false });
  await player.suspend();
  player.seekTo(61, true);
  await player.sync({ visible: true });
  await player.sync({ visible: true });
  assert.equal(ready, 1, 'Internal remount does not trigger application autoplay callbacks');
  const commands = calls.at(-1).commands;
  assert.deepEqual(commands[0], { name: 'cueVideoById', args: [{ videoId: 'dQw4w9WgXcQ', startSeconds: 42 }] });
  assert.deepEqual(commands.find(c => c.name === 'setVolume').args, [35]);
  assert.deepEqual(commands.find(c => c.name === 'setPlaybackRate').args, [1.5]);
  assert.equal(commands.some(c => c.name === 'playVideo'), false);
  assert.deepEqual(commands.at(-1), { name: 'seekTo', args: [61, true] }, 'Latest user command follows saved settings');
  player.destroy(); configureNativeRuntime(null);
});
