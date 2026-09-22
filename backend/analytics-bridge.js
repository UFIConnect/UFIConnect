'use strict';

const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_PARENTS = ['https://uficonnect.org', 'https://www.uficonnect.org',
  'https://uficonnect.pro', 'https://www.uficonnect.pro', 'https://uficonnect-web.onrender.com',
  'https://yosufkaka99-alt.github.io'];

function analyticsParentOrigins(env = process.env) {
  const configured = env.ANALYTICS_PARENT_ORIGINS || env.ALLOWED_ORIGINS;
  const values = configured ? configured.split(',') : [...DEFAULT_PARENTS];
  if (env.FRONTEND_URL) values.push(env.FRONTEND_URL);
  return [...new Set(values.map(value => {
    try {
      const url = new URL(value.trim());
      const local = env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
      if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) return null;
      return url.origin;
    } catch { return null; }
  }).filter(Boolean))];
}

function createAnalyticsBridgeHandler({ env = process.env } = {}) {
  const html = fs.readFileSync(path.join(__dirname, 'public/analytics-bridge.html'), 'utf8');
  const policy = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
  if (!policy || /unsafe-inline|unsafe-eval/.test(policy)) throw new Error('Analytics bridge must have a generated restrictive CSP');
  const parents = analyticsParentOrigins(env);
  return function analyticsBridge(req, res) {
    // No query parameters belong on this fixed document, even if somebody
    // constructs a URL outside the validated frontend controller.
    if ((req.originalUrl || req.url || '').includes('?')) return res.status(400).send('Analytics bridge does not accept query parameters.');
    // Honor header-only privacy signals too, without serving any analytics script.
    if (req.headers?.['sec-gpc'] === '1') {
      res.set({ 'Cache-Control': 'no-store', 'Vary': 'Sec-GPC', 'X-Robots-Tag': 'noindex, nofollow' });
      return res.status(204).end();
    }
    res.removeHeader('X-Frame-Options');
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `${policy}; frame-ancestors ${parents.join(' ') || "'none'"}`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    return res.status(200).send(html);
  };
}

module.exports = { analyticsParentOrigins, createAnalyticsBridgeHandler };
