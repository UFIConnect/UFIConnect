'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { FEED_STREAM_EVENT_MAX_BYTES, feedUpdateFrames } = require('./feed-stream-events');
const { createAppHarness } = require('./test-support/app-harness');
const decode = frame => JSON.parse(frame.slice(6).trim());

test('feed notifications bound serialized UTF-8 bytes and retain exact escaped/Unicode identities without source bodies', () => {
  const writing = '\u0001"\\\n🧭'.repeat(20000);
  const posts = Array.from({ length: 200 }, (_, index) => ({ id: `${index}-東京-"\\`.repeat(200), source: 'hackernews', content: writing,
    author: { privateField: 'not part of the stream' }, mediaUrl: 'https://example.org/large.mp4' }));
  const frames = [...feedUpdateFrames(posts, { init: true })];
  assert.ok(frames.length > 1, 'Serialized identities split when their UTF-8 bytes reach the ceiling');
  for (const frame of frames) {
    assert.ok(Buffer.byteLength(frame) <= FEED_STREAM_EVENT_MAX_BYTES);
    assert.equal(decode(frame).init, true);
    assert.doesNotMatch(frame, /content|author|privateField|mediaUrl/);
  }
  assert.deepEqual(frames.flatMap(frame => decode(frame).posts), posts.map(({ id, source }) => ({ id, source })));
  const invalidIdentity = { id: '\\'.repeat(FEED_STREAM_EVENT_MAX_BYTES), source: 'hackernews' };
  const safe = [...feedUpdateFrames([invalidIdentity, { id: 'valid', source: 'hackernews', content: writing }])];
  assert.deepEqual(decode(safe[0]).posts, [{ id: 'valid', source: 'hackernews' }]);
});

test('actual batch and initial stream routes send bounded notifications after visibility checks', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  const posts = Array.from({ length: 200 }, (_, index) => ({ id: `hn_stream_${index}`, source: 'hackernews',
    sourceUrl: `https://news.ycombinator.com/item?id=${100000 + index}`, content: 'A source-authored paragraph about the project. '.repeat(2200),
    title: `Source story ${index}`, isExternal: true, createdAt: new Date().toISOString() }));
  const frames = [];
  app.sseClients.set('stream-review', { feedViewerId: null, write: frame => frames.push(frame) });
  app.broadcastSSE(posts.slice(0, 10)); await app.flushSSEBatch();
  assert.equal(frames.flatMap(frame => decode(frame).posts).length, 10);
  assert.ok(frames.every(frame => Buffer.byteLength(frame) <= FEED_STREAM_EVENT_MAX_BYTES));
  assert.ok(frames.every(frame => !frame.includes('source-authored paragraph')));

  app.globalFeedCache.posts = posts;
  const router = app.app._router || app.app.router;
  const layer = router.stack.find(layer => layer.route?.path === '/feed/stream');
  const response = { feedViewerId: null, setHeader() {}, flushHeaders() {}, write: frame => frames.push(frame) };
  const before = frames.length;
  await layer.route.stack.at(-1).handle({ user: { id: 'viewer' }, on() {}, headers: {} }, response);
  const initial = frames.slice(before);
  assert.ok(initial.length); assert.ok(initial.every(frame => decode(frame).init));
  assert.equal(initial.flatMap(frame => decode(frame).posts).length, 200);
  assert.ok(initial.every(frame => Buffer.byteLength(frame) <= FEED_STREAM_EVENT_MAX_BYTES));
});

test('real browser stream parser and current Feed handler accept large-source notifications and refresh quietly', async () => {
  const { createAuthenticatedStream } = await import(pathToFileURL(path.join(__dirname, '../web/src/api/authenticatedStream.js')));
  const source = fs.readFileSync(path.join(__dirname, '../web/src/pages/Feed.jsx'), 'utf8');
  const start = source.indexOf('es.onmessage = (e) => {'), end = source.indexOf('\n        };', start);
  assert.ok(start >= 0 && end > start);
  const scheduled = [], refreshed = [], banners = [], nativeCache = new Map([['viewer', true]]);
  const context = vm.createContext({ es: {}, profile: { id: 'viewer' }, viewModeRef: { current: 'feed' },
    knownIds: { current: new Set(['known-native']) }, followingNativeCompatCache: nativeCache,
    liveRefreshTimeoutRef: { current: null }, loadStateRef: { current: {} }, activeTabsRef: { current: ['all'] },
    document: { hidden: false }, window: { setTimeout(fn) { scheduled.push(fn); return 1; } },
    setNewPostsAvailable: value => banners.push(value), loadFeed: (...args) => refreshed.push(args),
    console: { error: (...args) => assert.fail(args.join(' ')) } });
  vm.runInContext(source.slice(start, end + '\n        };'.length), context);
  const posts = [{ id: 'known-native', source: 'uficonnect', content: 'Large native metadata'.repeat(10000) },
    ...Array.from({ length: 200 }, (_, index) => ({ id: `new-${index}`, source: 'hackernews', content: '"\\\n🧭'.repeat(20000) }))];
  const frames = [...feedUpdateFrames(posts, { init: true })];
  const encoded = new TextEncoder().encode(frames.join(''));
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(encoded); } }),
    { headers: { 'Content-Type': 'text/event-stream' } });
  let stream;
  try {
    await new Promise((resolve, reject) => {
      let count = 0;
      const timer = setTimeout(() => reject(new Error('Stream notification timeout')), 3000);
      stream = createAuthenticatedStream('https://api.uficonnect.org/feed/stream', 'fixture-token');
      stream.onerror = error => { clearTimeout(timer); reject(error); };
      stream.onmessage = event => {
        context.es.onmessage(event); count += JSON.parse(event.data).posts.length;
        if (count === posts.length) { clearTimeout(timer); stream.close(); resolve(); }
      };
    });
    assert.deepEqual(banners, [true]); assert.equal(nativeCache.has('viewer'), false);
    assert.equal(scheduled.length, 1, 'A burst coalesces into one authorized refresh');
    scheduled[0](); assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0][2].silent, true); assert.equal(refreshed[0][2].preserveScroll, true); assert.equal(refreshed[0][2].live, true);
  } finally { stream?.close(); global.fetch = originalFetch; }
});
