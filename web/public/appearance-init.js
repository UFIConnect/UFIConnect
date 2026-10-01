/* Runs before styles and React. This external script is allowed by script-src 'self'. */
(() => {
  'use strict';
  const key = 'ufi:appearance';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = valid(window.localStorage.getItem(key)); } catch { /* Appearance still works without storage. */ }
  function apply() {
    const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.appearance = preference;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'dark' ? '#0d1422' : '#102A6B';
    window.dispatchEvent(new Event('ufi:appearance'));
  }
  window.__ufiAppearance = Object.freeze({
    get preference() { return preference; },
    setPreference(value) {
      preference = valid(value);
      try { window.localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
      apply();
    },
  });
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); }
  });
  apply();
})();
