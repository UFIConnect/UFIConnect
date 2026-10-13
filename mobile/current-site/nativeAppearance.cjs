// Only these app-owned surfaces can change native chrome. Never accept a CSS
// string or arbitrary style object across the privileged DOM bridge.
const PALETTES = Object.freeze({
  light: Object.freeze({ backgroundColor: '#ffffff', statusBar: 'dark' }),
  dark: Object.freeze({ backgroundColor: '#111d30', statusBar: 'light' }),
  welcome: Object.freeze({ backgroundColor: '#06265f', statusBar: 'light' }),
  video: Object.freeze({ backgroundColor: '#080c12', statusBar: 'light' }),
  snap: Object.freeze({ backgroundColor: '#080c12', statusBar: 'light' }),
  lightbox: Object.freeze({ backgroundColor: '#000000', statusBar: 'light' }),
});

function nativeAppearance(mode) {
  if (typeof mode !== 'string' || !Object.hasOwn(PALETTES, mode)) throw new Error('Invalid app appearance.');
  return PALETTES[mode];
}

function documentAppearance(document) {
  // An open modal dialog occupies the top layer, including above Videos.
  if (document.querySelector('.snap-viewer-feed[open]')) return 'snap';
  if (document.querySelector('.media-lightbox[aria-modal="true"]')) return 'lightbox';
  if (document.querySelector('.video-feed-view')) return 'video';
  if (document.querySelector('.app-welcome')) return 'welcome';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function observeNativeAppearance({ document, window, onChange }) {
  let current = null, pending = null, active = true;
  const update = () => {
    pending = null;
    if (!active) return;
    const next = documentAppearance(document);
    if (next === current) return;
    current = next;
    document.documentElement.dataset.nativeSurface = next;
    // Native can disappear during a WebView replacement. A late appearance
    // update is nonessential and must not create an unhandled rejection.
    Promise.resolve().then(() => { if (active) return onChange(next); }).catch(() => {});
  };
  const schedule = () => { if (active && pending === null) pending = window.requestAnimationFrame(update); };
  const observer = new window.MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-theme', 'open', 'class'] });
  window.addEventListener('ufi:appearance', schedule);
  update();
  return () => {
    active = false;
    observer.disconnect();
    window.removeEventListener('ufi:appearance', schedule);
    if (pending !== null) window.cancelAnimationFrame(pending);
    delete document.documentElement.dataset.nativeSurface;
  };
}

module.exports = { nativeAppearance, documentAppearance, observeNativeAppearance };
