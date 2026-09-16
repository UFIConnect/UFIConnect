import { PAGE_CATEGORIES, GA_MEASUREMENT_ID } from './src/analytics/googleAnalytics.mjs';
import { analyticsBridgeSecurityPolicy } from './securityPolicy.mjs';

// The API serves this generated document with an embedding allowlist. Its
// inline program is hash-allowlisted by both HTTP and meta CSP.
function bridgeProgram(pages, measurementId) {
  'use strict';
  if (window.parent === window) return;
  const bridgeUrl = new URL(window.location.href);
  // A forged embed must not let even automatic SDK metadata see a query or
  // fragment. The API additionally rejects query-bearing bridge requests.
  if (bridgeUrl.search || bridgeUrl.hash) return;
  const isLoopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const cookiePrefix = 'uficonnect_analytics';
  let configured = false;
  let stopped = false;
  let clientId = null;
  let lastVisit = 0;
  window.dataLayer = [];
  function gtag() { window.dataLayer.push(arguments); }

  window.addEventListener('message', function (event) {
    const data = event.data;
    if (event.source !== window.parent || event.origin === bridgeUrl.origin || !data || typeof data !== 'object') return;
    let parentUrl;
    try { parentUrl = new URL(event.origin); } catch { return; }
    if (parentUrl.protocol !== 'https:' && !(parentUrl.protocol === 'http:' && bridgeUrl.protocol === 'http:'
        && isLoopback(parentUrl) && isLoopback(bridgeUrl))) return;
    // Production's HTTP frame-ancestors policy also restricts embedding to
    // configured UFIconnect frontend origins. No untrusted event fields pass.
    if (data.type === 'ufi-analytics-stop' && data.version === 1
        && Object.keys(data).sort().join(',') === 'type,version') {
      stopped = true;
      window['ga-disable-' + measurementId] = true;
      document.cookie.split(';').forEach(function (cookie) {
        const name = cookie.split('=')[0].trim();
        if (!name.startsWith(cookiePrefix)) return;
        const expired = name + '=; Max-Age=0; Path=/analytics-bridge.html; SameSite=None; Secure; Partitioned';
        document.cookie = expired;
        document.cookie = expired + '; Domain=' + bridgeUrl.hostname;
      });
      window.parent.postMessage({ type: 'ufi-analytics-stopped', version: 1 }, event.origin);
      return;
    }
    if (stopped || Object.keys(data).sort().join(',') !== 'category,clientId,type,version,visit'
        || data.type !== 'ufi-analytics-page' || data.version !== 1
        || !Object.prototype.hasOwnProperty.call(pages, data.category)
        || typeof data.clientId !== 'string' || !/^[a-f0-9]{32}$/.test(data.clientId)
        || !Number.isSafeInteger(data.visit) || data.visit <= lastVisit) return;
    if (clientId && clientId !== data.clientId) return;
    clientId = data.clientId;
    lastVisit = data.visit;
    const page = pages[data.category];
    const fields = {
      page_location: 'https://uficonnect.org' + page.path,
      page_title: 'UFIconnect | ' + page.title,
      page_referrer: '',
    };
    if (!configured) {
      configured = true;
      // Basic consent mode: this document itself exists only after opt-in.
      // Advertising storage, signals, personalization and user data stay off.
      gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied' });
      gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied' });
      gtag('set', 'ads_data_redaction', true);
      gtag('set', 'url_passthrough', false);
      gtag('js', new Date());
      gtag('config', measurementId, {
        ...fields, client_id: clientId, send_page_view: false,
        allow_google_signals: false, allow_ad_personalization_signals: false,
        ignore_referrer: true, cookie_expires: 0, cookie_update: false,
        cookie_domain: bridgeUrl.hostname, cookie_prefix: cookiePrefix,
        cookie_path: '/analytics-bridge.html', cookie_flags: 'SameSite=None;Secure;Partitioned',
      });
      const script = document.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
      document.head.appendChild(script);
    }
    // Defaults remain safe for automatically generated lifecycle events too.
    // Enhanced measurement can see only this empty, separate document; it has no
    // access to the app's history, inputs, content, links, title or credentials.
    gtag('set', fields);
    gtag('event', 'page_view', { ...fields, send_to: measurementId });
  });
  // Readiness contains no measurement data. Subsequent messages use the
  // validated source and exact target origin.
  window.parent.postMessage({ type: 'ufi-analytics-ready', version: 1 }, '*');
}

export function analyticsBridgeHtml() {
  const program = `(${bridgeProgram.toString()})(${JSON.stringify(PAGE_CATEGORIES)},${JSON.stringify(GA_MEASUREMENT_ID)});`;
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="__ANALYTICS_CSP__">
<meta name="robots" content="noindex, nofollow">
<title>UFIconnect analytics</title>
</head><body><script>${program}</script></body></html>
`;
  return html.replace('__ANALYTICS_CSP__', analyticsBridgeSecurityPolicy(html));
}
