// No analytics of any kind was installed on this site — no way to tell
// whether it was getting any traffic, separate from search-engine indexing.
// Two independent, best-effort trackers: a first-party log (own DB, visible
// in the office dashboard, no external account needed) and GA4 (only loads
// if VITE_GA_MEASUREMENT_ID is set in the deploy environment — safe no-op
// otherwise, so this ships without requiring a Measurement ID up front).

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

let gaLoaded = false;
function loadGA() {
  if (gaLoaded || !GA_ID) return;
  gaLoaded = true;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // send_page_view:false — gtag's default page_view only fires once on
  // initial script load, which would miss every subsequent SPA navigation.
  // trackPageview() below sends it manually on every route change instead.
  window.gtag('config', GA_ID, { send_page_view: false });
}

function getVisitorId() {
  try {
    let id = localStorage.getItem('ufi_visitor_id');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('ufi_visitor_id', id);
    }
    return id;
  } catch {
    return null;
  }
}

export function trackPageview(path) {
  loadGA();
  if (window.gtag) {
    window.gtag('event', 'page_view', { page_path: path });
  }
  const apiBase = import.meta.env.VITE_API_URL || '/api';
  fetch(`${apiBase}/analytics/pageview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, referrer: document.referrer || null, visitorId: getVisitorId() }),
    keepalive: true,
  }).catch(() => {});
}
