// Two independent, best-effort trackers: a first-party log (own DB, visible
// in the office dashboard, no external account needed) and GA4. The gtag.js
// snippet itself is embedded directly in index.html (Measurement ID
// G-43NFBSC7CL), not loaded from here — trackPageview() below just fires the
// page_view event on every SPA route change, since gtag's own automatic
// page_view only fires once, on initial script load.

export function getVisitorId() {
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
