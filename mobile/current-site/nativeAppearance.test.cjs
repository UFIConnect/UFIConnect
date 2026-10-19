const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nativeAppearance, documentAppearance, observeNativeAppearance, localTimeAppearance } = require('./nativeAppearance.cjs');

test('native startup follows local daytime boundaries before the DOM supplies the saved choice', () => {
  for (const [hour, minute, second, expected] of [
    [0, 0, 0, 'dark'], [5, 59, 59, 'dark'], [6, 0, 0, 'light'], [12, 0, 0, 'light'],
    [19, 59, 59, 'light'], [20, 0, 0, 'dark'], [23, 59, 59, 'dark'],
  ]) assert.equal(localTimeAppearance(new Date(2026, 9, 18, hour, minute, second)), expected);
  assert.equal(localTimeAppearance(new Date(NaN)), 'light', 'An invalid clock must not force a dark fallback');
});

function fixture() {
  const surfaces = new Set(), listeners = new Map(), frames = new Map();
  let sequence = 0, observer, disconnected = false;
  const document = { documentElement: { dataset: { theme: 'light' } }, querySelector: selector => surfaces.has(selector) ? {} : null };
  const window = {
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() { disconnected = true; } },
    requestAnimationFrame: fn => { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
  };
  return { document, window, surfaces, listeners, frames, disconnected: () => disconnected,
    mutate: () => observer(), flush: async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); await Promise.resolve(); } };
}

test('only app-owned native surface modes are accepted', () => {
  for (const mode of ['light', 'dark', 'welcome', 'video', 'snap', 'lightbox']) {
    const palette = nativeAppearance(mode);
    assert.match(palette.backgroundColor, /^#[0-9a-f]{6}$/);
    assert.ok(Object.isFrozen(palette));
  }
  for (const value of ['__proto__', 'constructor', 'red', '', null, {}, ['video']]) assert.throws(() => nativeAppearance(value), /Invalid app appearance/);
});

test('welcome matches native safe areas, respects modal priority and restores the member theme', async () => {
  const f = fixture(), changes = [];
  f.surfaces.add('.app-welcome');
  const cleanup = observeNativeAppearance({ ...f, onChange: mode => changes.push(mode) });
  await Promise.resolve();
  assert.deepEqual(nativeAppearance('welcome'), { backgroundColor: '#06265f', statusBar: 'light' });
  assert.equal(f.document.documentElement.dataset.nativeSurface, 'welcome');
  assert.deepEqual(changes, ['welcome']);
  f.surfaces.add('.media-lightbox[aria-modal="true"]'); f.mutate(); await f.flush();
  assert.equal(documentAppearance(f.document), 'lightbox');
  f.surfaces.delete('.media-lightbox[aria-modal="true"]'); f.mutate(); await f.flush();
  assert.equal(documentAppearance(f.document), 'welcome');
  f.document.documentElement.dataset.theme = 'dark';
  f.surfaces.delete('.app-welcome'); f.mutate(); await f.flush();
  assert.deepEqual(changes, ['welcome', 'lightbox', 'welcome', 'dark']);
  assert.equal(f.document.documentElement.dataset.nativeSurface, 'dark');
  cleanup();
});

test('appearance follows open media surfaces then restores the current theme', () => {
  const f = fixture();
  assert.equal(documentAppearance(f.document), 'light');
  f.document.documentElement.dataset.theme = 'dark';
  assert.equal(documentAppearance(f.document), 'dark');
  f.surfaces.add('.media-lightbox[aria-modal="true"]');
  assert.equal(documentAppearance(f.document), 'lightbox');
  f.surfaces.add('.video-feed-view');
  assert.equal(documentAppearance(f.document), 'lightbox', 'modal takes priority over its underlying video feed');
  f.surfaces.add('.snap-viewer-feed'); // A mounted but closed dialog must not affect chrome.
  assert.equal(documentAppearance(f.document), 'lightbox');
  f.surfaces.add('.snap-viewer-feed[open]');
  assert.equal(documentAppearance(f.document), 'snap');
  f.surfaces.delete('.snap-viewer-feed[open]');
  f.surfaces.delete('.media-lightbox[aria-modal="true"]');
  assert.equal(documentAppearance(f.document), 'video', 'closing overlays restores the underlying feed');
  f.surfaces.clear();
  assert.equal(documentAppearance(f.document), 'dark');
});

test('native observer coalesces UI mutations, reports only transitions and cleans up pending callbacks', async () => {
  const f = fixture(), changes = [];
  const cleanup = observeNativeAppearance({ ...f, onChange: mode => changes.push(mode) });
  await Promise.resolve();
  assert.deepEqual(changes, ['light']);
  f.surfaces.add('.video-feed-view');
  f.mutate(); f.mutate(); f.mutate();
  assert.equal(f.frames.size, 1);
  await f.flush();
  assert.deepEqual(changes, ['light', 'video']);
  assert.equal(f.document.documentElement.dataset.nativeSurface, 'video');
  f.document.documentElement.dataset.theme = 'dark';
  f.listeners.get('ufi:appearance')();
  await f.flush();
  assert.deepEqual(changes, ['light', 'video']);
  f.surfaces.clear(); f.mutate(); await f.flush();
  assert.deepEqual(changes, ['light', 'video', 'dark']);
  f.surfaces.add('.video-feed-view'); f.mutate(); cleanup();
  await f.flush();
  assert.equal(f.frames.size, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.disconnected(), true);
  assert.equal(f.document.documentElement.dataset.nativeSurface, undefined);
  assert.deepEqual(changes, ['light', 'video', 'dark']);
});

test('observer teardown prevents a queued bridge call after WebView replacement', async () => {
  const f = fixture(), changes = [];
  const cleanup = observeNativeAppearance({ ...f, onChange: mode => changes.push(mode) });
  cleanup();
  await Promise.resolve();
  assert.deepEqual(changes, []);
});

test('native chrome keeps the explicit DOM appearance across foreground events and restores it after media', async () => {
  const f = fixture(), changes = [];
  f.document.documentElement.dataset.theme = 'dark';
  const cleanup = observeNativeAppearance({ ...f, onChange: mode => changes.push(mode) });
  await Promise.resolve();
  f.listeners.get('ufi:appearance')(); await f.flush();
  assert.deepEqual(changes, ['dark'], 'A manual dark choice must not follow the startup clock');
  f.surfaces.add('.snap-viewer-feed[open]'); f.mutate(); await f.flush();
  assert.equal(changes.at(-1), 'snap');
  f.document.documentElement.dataset.theme = 'light'; f.listeners.get('ufi:appearance')(); await f.flush();
  assert.equal(changes.at(-1), 'snap', 'Open media keeps its own native palette');
  f.surfaces.clear(); f.mutate(); await f.flush();
  assert.equal(changes.at(-1), 'light', 'Closing media restores the newly selected manual appearance');
  cleanup();
});
