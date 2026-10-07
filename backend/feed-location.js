'use strict';
const proxyaddr = require('proxy-addr');
const { createHash } = require('node:crypto');

const ISO_COUNTRY_CODES = `
  AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ
  BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR
  CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
  GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU
  ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ
  LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ
  MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF
  PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI
  SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR
  TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/);
const validCountries = new Set(ISO_COUNTRY_CODES);

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
    if (!validCountries.has(country)) return {};
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
    location.source || '', location.declared || [], location.mode || '', location.feedMode || '',
  ])).digest('hex').slice(0, 20);
  return `${userId}::${sortMode}::${timeRange || 'all'}::${context}`;
}

module.exports = { ISO_COUNTRY_CODES, trustedFeedNetworkLocation, memberFeedSnapshotKey };
