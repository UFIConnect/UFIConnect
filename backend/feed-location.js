'use strict';
const proxyaddr = require('proxy-addr');
const { createHash } = require('node:crypto');

// Cloudflare's published origin-facing ranges, reviewed 2026-10-05:
// https://www.cloudflare.com/ips/ . Never trust a client-supplied CF header
// unless a Cloudflare hop is reached through configured trusted proxies.
const isCloudflare = proxyaddr.compile([
  '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '104.16.0.0/13',
  '104.24.0.0/14', '108.162.192.0/18', '131.0.72.0/22', '141.101.64.0/18',
  '162.158.0.0/15', '172.64.0.0/13', '173.245.48.0/20', '188.114.96.0/20',
  '190.93.240.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]);

function trustedFeedNetworkLocation(req, { visitorLocationHeaders = false } = {}) {
  try {
    const trust = req.app?.get('trust proxy fn');
    const hops = proxyaddr.all(req);
    let verifiedEdge = false;
    for (let index = 0; index < hops.length; index += 1) {
      if (isCloudflare(hops[index])) { verifiedEdge = true; break; }
      if (typeof trust !== 'function' || !trust(hops[index], index)) break;
    }
    if (!verifiedEdge) return {};
    const country = String(req.headers?.['cf-ipcountry'] || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country) || ['XX', 'T1'].includes(country)) return {};
    const clean = value => {
      if (typeof value !== 'string') return null;
      try { return decodeURIComponent(value.replace(/\+/g, ' ')).replace(/[<>]/g, '').trim().slice(0, 80) || null; }
      catch { return null; }
    };
    // Country is set by Cloudflare geolocation. City/region are accepted only
    // when the account's visitor-location transform is explicitly enabled.
    return { country,
      city: visitorLocationHeaders ? clean(req.headers?.['cf-ipcity']) : null,
      region: visitorLocationHeaders ? clean(req.headers?.['cf-region']) : null };
  } catch { return {}; }
}

function memberFeedSnapshotKey(userId, sortMode, timeRange, location = {}) {
  // Coarse location affects recommendations; the member remains the identity.
  // No IP address is retained in the key or serialized in a response.
  const context = createHash('sha256').update(JSON.stringify([
    location.country || '', location.city || '', location.region || '',
    location.source || '', location.declared || [],
  ])).digest('hex').slice(0, 20);
  return `${userId}::${sortMode}::${timeRange || 'all'}::${context}`;
}

module.exports = { trustedFeedNetworkLocation, memberFeedSnapshotKey };
