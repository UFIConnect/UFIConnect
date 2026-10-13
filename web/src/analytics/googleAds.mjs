export const ADS_ID = 'AW-18490754953';
export const ADS_CONVERSION = `${ADS_ID}/s7sWCK_AsI4dEImPivFE`;
export const ADS_CONSENT_KEY = 'uficonnect.ads.consent.v1';
export const TAG_MANAGER_ID = 'GTM-PXQR5386';

// Keep only Google's attribution identifiers. Never give the SDK arbitrary
// query parameters, account links, or fragments from a shared homepage URL.
export function advertisingHomepageUrl(value) {
  const url = new URL(value);
  const safe = new URL('/', url.origin);
  for (const key of ['gclid', 'gbraid', 'wbraid', 'gclsrc']) {
    const values = url.searchParams.getAll(key);
    if (values.length === 1 && /^[a-zA-Z0-9_.-]{1,512}$/.test(values[0])) safe.searchParams.set(key, values[0]);
  }
  if (url.hash === '#analytics') safe.hash = '#analytics';
  return safe.href;
}

export function createAdsController({ window, document }) {
  const listeners = new Set();
  const initialPath = window.location.pathname;
  const nativePush = window.history.pushState.bind(window.history);
  const nativeReplace = window.history.replaceState.bind(window.history);
  let eligible = false;
  let loaded = false;
  let leaving = false;
  let error = null;
  let consent = null;
  const signal = () => window.navigator.globalPrivacyControl === true;
  const read = () => {
    try {
      const value = window.localStorage.getItem(ADS_CONSENT_KEY);
      return ['granted', 'denied'].includes(value) ? value : null;
    } catch { return null; }
  };
  consent = signal() ? 'denied' : read();
  const emit = () => listeners.forEach(listener => listener());
  function clearCookies() {
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.trim().split('=')[0];
      if (!/^_gcl_/.test(name)) continue;
      for (const domain of ['', window.location.hostname, '.uficonnect.org']) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ''}`;
      }
    }
    try { window.localStorage.removeItem('_gcl_ls'); } catch { /* Storage can be disabled. */ }
  }
  function leave(url = window.location.href) {
    if (leaving) return;
    leaving = true;
    // Removing a script does not unload its SDK. A new document does.
    const next = new URL(url, window.location.href);
    if (next.origin === window.location.origin && next.pathname === window.location.pathname && next.search === window.location.search) {
      nativeReplace(window.history.state, '', next.href);
      window.location.reload();
    } else window.location.replace(next.href);
  }
  function stop() {
    if (loaded) window.gtag?.('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    clearCookies();
    if (loaded) leave(window.location.origin + '/#analytics');
  }
  function start() {
    if (!eligible || loaded || leaving || consent !== 'granted' || signal() || window.location.pathname !== '/') return;
    // Other routes have a stricter CSP. Enter the public homepage in its own
    // document before allowing an advertising SDK to execute.
    if (initialPath !== '/') { leave(advertisingHomepageUrl(window.location.href)); return; }
    try {
      window.localStorage.setItem(ADS_CONSENT_KEY, 'granted');
      if (read() !== 'granted') throw new Error();
    } catch { error = 'Advertising measurement stays off because this browser could not save your choice.'; emit(); return; }
    nativeReplace(window.history.state, '', advertisingHomepageUrl(window.location.href));
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    const gtag = window.gtag;
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', analytics_storage: 'denied' });
    gtag('set', 'ads_data_redaction', true);
    gtag('set', 'url_passthrough', false);
    gtag('js', new Date());
    gtag('config', ADS_ID, { send_page_view: false, page_location: 'https://uficonnect.org/', page_referrer: '',
      allow_ad_personalization_signals: false, allow_google_signals: false, allow_enhanced_conversions: false });
    gtag('event', 'conversion', { send_to: ADS_CONVERSION, page_location: 'https://uficonnect.org/', page_referrer: '' });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`;
    script.referrerPolicy = 'no-referrer';
    document.head.appendChild(script);
    // Tag Manager shares the existing consented homepage boundary. Starting
    // it here keeps private URLs and unverified sessions out of the container.
    // The loaded guard also prevents duplicate containers during React mounts.
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const container = document.createElement('script');
    container.async = true;
    container.src = `https://www.googletagmanager.com/gtm.js?id=${TAG_MANAGER_ID}`;
    container.referrerPolicy = 'no-referrer';
    document.head.appendChild(container);
  }
  function navigate(method, state, title, value) {
    if (!loaded || value == null) return method(state, title, value);
    const next = new URL(value, window.location.href);
    if (next.origin !== window.location.origin || next.pathname !== '/' || next.search !== window.location.search) {
      leave(next.href);
      return;
    }
    return method(state, title, value);
  }
  window.history.pushState = (state, title, value) => navigate(nativePush, state, title, value);
  window.history.replaceState = (state, title, value) => navigate(nativeReplace, state, title, value);
  window.addEventListener('popstate', event => {
    if (loaded && window.location.pathname !== '/') { event.stopImmediatePropagation(); leave(); }
  });
  window.addEventListener('pageshow', event => { if (loaded && event.persisted) leave(); });
  const refresh = () => {
    const next = signal() ? 'denied' : read();
    if (next !== consent) { consent = next; if (next !== 'granted') stop(); emit(); }
    start();
  };
  window.addEventListener('storage', event => { if (!event.key || event.key === ADS_CONSENT_KEY) refresh(); });
  window.addEventListener('focus', refresh);
  return Object.freeze({
    available: true,
    getConsent: () => signal() ? 'denied' : consent,
    getPrivacySignal: signal,
    getPersistenceError: () => error,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setConsent(value) {
      if (!['granted', 'denied'].includes(value)) return;
      consent = signal() ? 'denied' : value;
      error = null;
      try { window.localStorage.setItem(ADS_CONSENT_KEY, consent); if (read() !== consent) throw new Error(); }
      catch { consent = 'denied'; error = 'Your advertising choice could not be saved. Advertising measurement stays off.'; }
      if (consent !== 'granted') stop();
      emit(); start();
    },
    setHomepageEligible(value) { eligible = Boolean(value); if (loaded && !eligible) leave(); else start(); },
    mustLeave: value => loaded && !value,
  });
}
