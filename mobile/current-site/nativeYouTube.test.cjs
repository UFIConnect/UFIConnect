const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  APP_BASE_URL, CHANNEL, EMPTY_STATE, MAX_PLAYERS, commands, playerVars, rect, projectRect,
  trustedMessageUrl, allowNavigation, parsePlayerMessage, swipeEvent, createPlayerRegistry, makePlayerHtml,
} = require('./nativeYouTube.cjs');

const ID = 'M7lc1UVf-VE';
const NEXT_ID = 'dQw4w9WgXcQ';
const bounds = (overrides = {}) => ({ x: 10, y: 20, width: 300, height: 200,
  clipX: 10, clipY: 20, clipWidth: 300, clipHeight: 200,
  viewportWidth: 400, viewportHeight: 800, visible: true, ...overrides });
const state = (overrides = {}) => ({ ...EMPTY_STATE, videoId: ID, ...overrides });
const message = (type, overrides = {}) => ({ url: APP_BASE_URL,
  data: JSON.stringify({ channel: CHANNEL, type, state: state(), ...overrides }) });
const command = (name, ...args) => ({ name, args });
function fixture() {
  const sent = [];
  let renders = 0;
  const registry = createPlayerRegistry({ changed: () => { renders += 1; }, send: (entry, payload) => sent.push({ key: entry.key, ...payload }) });
  registry.request({ op: 'mount', key: 'player_1', videoId: ID, rect: bounds() });
  const entry = registry.entries.get('player_1');
  return { registry, sent, entry, renders: () => renders,
    sync: (input = {}) => registry.request({ op: 'sync', key: entry.key, ...input }),
    ready: () => registry.receive(entry, message('ready')) };
}

test('isolated player identity and settings cannot be replaced by caller origins or script payloads', () => {
  const settings = playerVars({ origin: 'https://attacker.example', controls: 1, fs: 1, autoplay: 1, playsinline: 0,
    enablejsapi: 0, playlist: ID, hl: 'en-US', start: 12, callback: '</script><script>bad()</script>' });
  assert.equal(settings.origin, APP_BASE_URL);
  assert.equal(settings.controls, 0);
  assert.equal(settings.fs, 0);
  assert.equal(settings.autoplay, 0);
  assert.equal(settings.playsinline, 1);
  assert.equal(settings.enablejsapi, 1);
  const html = makePlayerHtml(ID, settings);
  assert.match(html, /https:\/\/www\.youtube\.com\/iframe_api/);
  assert.doesNotMatch(html, /attacker|bad\(\)|Authorization|onApiRequest|onPersistSession/);
  assert.throws(() => makePlayerHtml('</script>xx'), /Invalid YouTube/);
  assert.throws(() => playerVars({ playlist: ID + ',evil' }), /Invalid YouTube/);
});

test('commands allow bounded player actions and reject generic method execution or oversized input', () => {
  assert.deepEqual(commands([command('seekTo', 12), command('setVolume', 20), command('setPlaybackRate', 1.5),
    command('loadVideoById', { videoId: NEXT_ID, startSeconds: 3, endSeconds: 20, unsafe: 'discard' })]), [
    command('seekTo', 12, true), command('setVolume', 20), command('setPlaybackRate', 1.5),
    command('loadVideoById', { videoId: NEXT_ID, startSeconds: 3, endSeconds: 20 }),
  ]);
  for (const input of [command('constructor'), command('postMessage', 'secret'), command('playVideo', 1),
    command('seekTo', -1), command('seekTo', 1, 'yes'), command('setVolume', 101), command('setPlaybackRate', Infinity),
    command('loadVideoById', { videoId: ID + '\";evil()' }), command('cueVideoById', ID, NaN)]) {
    assert.throws(() => commands([input]));
  }
  assert.equal(commands(Array.from({ length: 16 }, () => command('mute'))).length, 16);
  assert.throws(() => commands(Array.from({ length: 17 }, () => command('mute'))));
});

test('only the local app identity may send messages; provider child frames cannot navigate the top document', () => {
  assert.equal(trustedMessageUrl(APP_BASE_URL + '/'), true);
  for (const url of ['about:blank', 'file:///player.html', APP_BASE_URL + '.evil/', APP_BASE_URL + '/?token=x',
    'https://www.youtube.com/embed/' + ID, 'http://org.uficonnect.app']) {
    assert.equal(trustedMessageUrl(url), false);
    assert.equal(parsePlayerMessage({ ...message('ready'), url }), null);
  }
  assert.equal(allowNavigation({ url: APP_BASE_URL, isTopFrame: true, navigationType: 'other' }), true);
  assert.equal(allowNavigation({ url: `https://www.youtube.com/embed/${ID}?enablejsapi=1`, isTopFrame: false }), true);
  assert.equal(allowNavigation({ url: 'https://consent.youtube.com/m', isTopFrame: false }), true);
  assert.equal(allowNavigation({ url: 'https://googleads.g.doubleclick.net/pagead/frame', isTopFrame: false }), true);
  for (const request of [
    { url: `https://www.youtube.com/embed/${ID}`, isTopFrame: true },
    { url: 'https://evil.example/embed/' + ID, isTopFrame: true },
    { url: 'file:///private/player.html', isTopFrame: false },
    { url: 'http://www.youtube.com/embed/' + ID, isTopFrame: false },
    { url: 'https://user:pass@www.youtube.com/embed/' + ID, isTopFrame: false },
    { url: 'javascript:alert(1)', isTopFrame: false },
    { url: APP_BASE_URL, isTopFrame: true, navigationType: 'click' },
  ]) assert.equal(allowNavigation(request), false);
});

test('player protocol forwards error 153 and rejects unknown channels, malformed states and oversized messages', () => {
  assert.deepEqual(parsePlayerMessage(message('error', { data: 153 })), { type: 'error', data: 153, state: state() });
  assert.equal(parsePlayerMessage(message('api')).type, 'api');
  assert.equal(parsePlayerMessage(message('snapshot')).type, 'snapshot');
  for (const overrides of [{ channel: 'other' }, { type: 'apiRequest' }, { state: state({ currentTime: -1 }) },
    { state: state({ muted: 'false' }) }, { state: state({ playerState: 4 }) },
    { state: state({ availablePlaybackRates: Array(17).fill(1) }) }]) {
    assert.equal(parsePlayerMessage(message('state', overrides)), null);
  }
  assert.equal(parsePlayerMessage({ url: APP_BASE_URL, data: 'x'.repeat(4097) }), null);
});

test('geometry scales viewport pixels into native points and clips only the visible viewport area', () => {
  const input = rect(bounds({ x: -20, y: 100, width: 300, height: 200, clipX: 0, clipY: 130, clipWidth: 500, clipHeight: 500 }));
  assert.deepEqual(projectRect(input, { width: 200, height: 160 }), {
    left: 0, top: 65, width: 140, height: 85, innerLeft: -10, innerTop: -15,
    innerWidth: 150, innerHeight: 100, scale: 0.5,
  });
  assert.equal(projectRect(bounds(), { width: 400, height: 800 }, false), null);
  assert.equal(projectRect(bounds({ visible: false }), { width: 400, height: 800 }), null);
  assert.equal(projectRect(bounds({ x: 500 }), { width: 400, height: 800 }), null);
  assert.equal(projectRect(bounds(), { width: 0, height: 800 }), null);
  for (const value of [bounds({ x: Infinity }), bounds({ width: -1 }), bounds({ viewportWidth: 0 }), bounds({ visible: 1 })]) {
    assert.throws(() => rect(value));
  }
});

test('swipes preserve taps and reject slow, multi-touch or invalid gestures while returning DOM pixel deltas', () => {
  assert.deepEqual(swipeEvent({ dx: 10, dy: -120, duration: 350 }, 0.5), { type: 'swipe', data: { dx: 20, dy: -240, duration: 350 } });
  for (const input of [{ dx: 3, dy: 5, duration: 100 }, { dx: 100, dy: 0, duration: 901 },
    { dx: 100, dy: 0, duration: 100, fingers: 2 }, { dx: NaN, dy: 100, duration: 100 },
    { dx: 100, dy: 0, duration: -1 }]) assert.equal(swipeEvent(input), null);
});

test('queued commands wait for trusted readiness and polling drains events without rerendering on snapshots', () => {
  const f = fixture();
  f.sync({ commands: [command('playVideo')] });
  assert.equal(f.sent.length, 0);
  f.registry.receive(f.entry, { ...message('ready'), url: 'https://www.youtube.com/' });
  assert.equal(f.sent.length, 0);
  f.ready();
  assert.ok(f.sent.at(-1).commands.some(item => item.name === 'playVideo'));
  assert.deepEqual(f.sync().events, [{ type: 'ready' }]);
  assert.deepEqual(f.sync().events, []);
  const before = f.renders();
  f.registry.receive(f.entry, message('snapshot', { state: state({ currentTime: 12, duration: 200 }) }));
  assert.equal(f.sync().state.currentTime, 12);
  assert.equal(f.renders(), before);
  f.sync({ rect: bounds({ y: 50, clipY: 50 }) });
  assert.equal(f.renders(), before + 1);
});

test('offscreen loads cue the requested video and resume playback intent after brief visibility loss', () => {
  const f = fixture(); f.ready();
  f.sync({ commands: [command('playVideo')] });
  f.sync({ rect: bounds({ visible: false }), commands: [command('loadVideoById', NEXT_ID, 15)] });
  const hidden = f.sent.at(-1);
  assert.equal(hidden.active, false);
  assert.ok(hidden.commands.some(item => item.name === 'cueVideoById' && item.args[0].videoId === NEXT_ID));
  assert.ok(hidden.commands.some(item => item.name === 'pauseVideo'));
  assert.ok(!hidden.commands.some(item => item.name === 'playVideo' || item.name === 'loadVideoById'));
  f.sync({ rect: bounds() });
  assert.equal(f.sent.at(-1).active, true);
  assert.ok(f.sent.at(-1).commands.some(item => item.name === 'playVideo'));
});

test('autoplay remains paused at half visibility and explicit pause cancels automatic resume', () => {
  const f = fixture(); f.ready();
  f.sync({ commands: [command('playVideo')] });
  f.sync({ rect: bounds({ clipHeight: 100 }) });
  assert.equal(f.sent.at(-1).active, false);
  assert.ok(f.sent.at(-1).commands.some(item => item.name === 'pauseVideo'));
  f.sync({ commands: [command('pauseVideo')] });
  f.sync({ rect: bounds() });
  assert.ok(!f.sent.at(-1).commands.some(item => item.name === 'playVideo'));
});

test('backgrounding pauses a ready player and destruction rejects stale player callbacks', () => {
  const f = fixture(); f.ready(); f.sync({ commands: [command('playVideo')] });
  f.registry.setActive(false);
  assert.equal(f.sent.at(-1).active, false);
  assert.ok(f.sent.at(-1).commands.some(item => item.name === 'pauseVideo'));
  f.registry.setActive(true);
  assert.ok(f.sent.at(-1).commands.some(item => item.name === 'playVideo'));
  f.registry.request({ op: 'destroy', key: f.entry.key });
  assert.ok(f.sent.at(-1).commands.some(item => item.name === 'stopVideo'));
  f.registry.request({ op: 'mount', key: f.entry.key, videoId: NEXT_ID, rect: bounds() });
  f.registry.receive(f.entry, message('error', { data: 153 }));
  assert.deepEqual(f.sync().events, []);
  assert.equal(f.sync().state.videoId, NEXT_ID);
  f.registry.dispose();
  assert.equal(f.registry.entries.size, 0);
});

test('native background/foreground transitions preserve an explicit pause before or during inactivity', () => {
  for (const when of ['before', 'during']) {
    const f = fixture(); f.ready(); f.sync({ commands: [command('playVideo')] });
    if (when === 'before') f.sync({ commands: [command('pauseVideo')] });
    f.registry.setActive(false);
    assert.equal(f.sent.at(-1).active, false);
    if (when === 'during') f.sync({ commands: [command('pauseVideo')] });
    f.registry.setActive(true);
    assert.equal(f.sent.at(-1).active, true);
    assert.ok(!f.sent.at(-1).commands.some(item => item.name === 'playVideo'), when + ' inactive pause must not resume');
    f.registry.dispose();
  }
});

test('player registry bounds active instances and events and validates full requests before mutation', () => {
  const f = fixture();
  for (let index = 1; index < MAX_PLAYERS; index += 1) f.registry.request({ op: 'mount', key: `other_${index}`, videoId: ID, rect: bounds() });
  assert.throws(() => f.registry.request({ op: 'mount', key: 'excess', videoId: ID, rect: bounds() }), /Too many/);
  assert.throws(() => f.registry.request({ op: 'mount', key: '../escape', videoId: ID, rect: bounds() }));
  const before = { ...f.entry.rect };
  assert.throws(() => f.sync({ rect: bounds({ y: 200 }), commands: [command('evaluateJavaScript', 'bad()')] }));
  assert.deepEqual(f.entry.rect, before);
  for (let index = 0; index < 100; index += 1) f.registry.enqueue(f.entry, { type: 'error', data: 153 });
  assert.equal(f.sync().events.length, 64);
  assert.equal(f.sync().events.length, 0);
});
