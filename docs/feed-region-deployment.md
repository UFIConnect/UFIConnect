# Feed region and proxy configuration

Signed-in regular feeds use automatic location. After onboarding, the browser requests device-location permission and acquires a fresh, high-accuracy position. Coordinates are rounded to about 100 metres, kept in memory for the current authenticated session, and sent only with that session's feed GET requests. Nearby posts with reliable coordinates or an unambiguous city are prioritized within 100 miles, including the reported accuracy margin. Posts without reliable location data remain available through ordinary personalization. Country or region evidence alone never establishes a nearby match.

Device denial, failure, expiry or revocation falls back to trusted Cloudflare city/country information. The owner enabled the Add visitor location headers transform on 2026-10-08; the API enables `CF_VISITOR_LOCATION_HEADERS=true`. City, region and IP-coordinate headers still require a verified edge. Device location takes precedence over a VPN's exit IP. GeoNames city lookup runs locally; device coordinates are not sent to a geocoder. Attribution and rebuild instructions are in [backend/geo/README.md](../backend/geo/README.md).

The member ID remains the identity for preferences, seen posts, connected accounts and snapshots. Snapshot keys hash a coarse location cell with the member context. Coordinates and IPs are absent from response context, profile storage and browser storage. Logout and account changes invalidate pending location callbacks. Regular feed pages have no location picker and ignore legacy manual/off preferences. Travel, Restaurants and Bars retain their independent saved destinations. Signed-out visitors may use Global; authenticated `/global` visits redirect to the member's Home feed.

Production must serve `Permissions-Policy: camera=(), microphone=(), geolocation=(self)` for the web app. Render's existing header rules are preserved when updating this setting. Cross-origin embedded sources receive no geolocation permission. Office and the isolated analytics bridge continue to disable geolocation.

## Verified Render boundary

An authorized, read-only `/health/details` check on 2026-10-05 identified the nearest-first chain as: private IPv4 proxy, Cloudflare IPv4 edge, public IPv6 hop, public IPv6 hop. The diagnostic records address classes and header presence only, without raw addresses or user identifiers. Invalid supplied country headers were overwritten at the edge; a forged forwarded/client-IP request was rejected with HTTP 403.

Both API and pipeline use the `TRUST_PROXY` value in `render.yaml`: loopback/private proxies plus the published Cloudflare IPv4 and IPv6 ranges. Express can therefore resolve the public client for its existing request limits. The feed country checker walks the raw nearest-first chain and accepts Cloudflare headers only after reaching a Cloudflare address through configured trusted preceding proxies. An intervening untrusted hop prevents that trust, even if the client inserts a Cloudflare-looking address earlier in its forwarded header.

Before migrating hosting or changing this value, repeat the address-free chain and spoof checks. Never use `TRUST_PROXY=true` or accept arbitrary forwarded country headers. Keep the Cloudflare ranges in `backend/feed-location.js` and `render.yaml` synchronized with the [published ranges](https://www.cloudflare.com/ips/). Render documents its Cloudflare and load-balancer path in [How Render handles DDoS attacks](https://render.com/articles/how-render-handles-ddos-attacks); Cloudflare describes its country and location headers in [HTTP request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

## Regression checks

- `node --test backend/feed-device-location.test.js backend/device-feed-session.test.js backend/feed-location.test.js backend/location-personalization.test.js backend/feed-source-selection.test.js backend/member-feed-scope.test.js backend/travel.test.js`
- `node scripts/audit-global-member-feed.mjs`
- `npm --prefix web run build`

Tests cover proxy spoofing, the 100-mile boundary, uncertainty, expired headers, permission revocation, changing location, account separation and independent destinations. The Global browser audit also runs the device-location audit at desktop and mobile widths, including movement, stale response protection and denied-permission fallback.
