'use strict';
const proxyaddr = require('proxy-addr');
const ipaddr = require('ipaddr.js');
// Published Cloudflare origin ranges: https://www.cloudflare.com/ips/ .
const cloudflare = proxyaddr.compile([
  '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '104.16.0.0/13',
  '104.24.0.0/14', '108.162.192.0/18', '131.0.72.0/22', '141.101.64.0/18',
  '162.158.0.0/15', '172.64.0.0/13', '173.245.48.0/20', '188.114.96.0/20',
  '190.93.240.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]);

function proxyDiagnostics(req) {
  // Operational shape only: never return or retain addresses, fingerprints,
  // tokens or raw headers. Hops are ordered from the socket toward the client.
  const classify = value => {
    try { return { family: ipaddr.process(value).kind(), range: ipaddr.process(value).range(), cloudflare: cloudflare(value) }; }
    catch { return { invalid: true }; }
  };
  let hops = [];
  try { hops = proxyaddr.all(req).slice(0, 12).map(classify); } catch { hops = [{ invalid: true }]; }
  let resolvedClientMatchesCloudflare = false;
  try {
    const resolved = ipaddr.process(req.ip);
    const connecting = ipaddr.process(req.headers?.['cf-connecting-ip']);
    resolvedClientMatchesCloudflare = resolved.kind() === connecting.kind()
      && resolved.toString() === connecting.toString();
  } catch { /* Missing or malformed addresses cannot establish a match. */ }
  return {
    hops,
    trustConfigured: Boolean(req.app?.get('trust proxy')),
    countryHeaderPresent: /^[A-Z]{2}$/.test(String(req.headers?.['cf-ipcountry'] || '')),
    cloudflareRayPresent: Boolean(req.headers?.['cf-ray']),
    connectingIpPresent: Boolean(req.headers?.['cf-connecting-ip']),
    resolvedClientMatchesCloudflare,
  };
}
module.exports = { proxyDiagnostics };
