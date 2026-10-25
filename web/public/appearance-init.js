/* The render-blocking head script applies appearance before the app paints. */
(() => {
  'use strict';
  const key = 'ufi:appearance';
  // Keep the stored "system" value compatible with existing Auto preferences.
  // The current device clock supplies its timezone; a feed destination never
  // changes appearance and location permission is not needed for this schedule.
  const valid = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system', timer = null, appliedPreference, appliedTheme;
  try { preference = valid(window.localStorage.getItem(key)); } catch { /* Appearance still works without storage. */ }
  function apply() {
    const hour = new Date().getHours();
    const resolved = preference === 'system' ? (hour < 6 || hour >= 20 ? 'dark' : 'light') : preference;
    if (appliedPreference === preference && appliedTheme === resolved) return;
    appliedPreference = preference; appliedTheme = resolved;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.appearance = preference;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'dark' ? '#0d1422' : '#102A6B';
    window.dispatchEvent(new Event('ufi:appearance'));
  }
  function schedule() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (preference !== 'system' || document.hidden) return;
    // Re-read local time each minute, including timezone or clock changes while
    // the app stays open. No work is scheduled while the page is hidden.
    const now = Date.now();
    timer = window.setTimeout(() => { timer = null; apply(); schedule(); }, Number.isFinite(now) ? 60000 - (now % 60000) : 60000);
  }
  function refresh() {
    if (!document.hidden) apply();
    schedule();
  }
  window.__ufiAppearance = Object.freeze({
    get preference() { return preference; },
    setPreference(value) {
      preference = valid(value);
      try { window.localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
      apply(); schedule();
    },
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); schedule(); }
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', refresh);
  apply(); schedule();
})();
