# Feed region and proxy configuration

Regular feeds use the current request's verified Cloudflare country as a ranking signal. The signed-in member ID remains the identity for preferences, seen posts, connected accounts, and personalized snapshots. IP addresses are not stored in feed keys, feed responses, or member location preferences. Shared public candidate pages are ranked separately for each request.

Travel, Restaurants, and Bars retain the member's saved destination. If a network country cannot be verified, ordinary feeds fall back to that member's location choices. City and region headers are ignored unless `CF_VISITOR_LOCATION_HEADERS=true` explicitly confirms an enabled Cloudflare visitor-location transform. Leave it unset for the present country-only setup.

## Verified Render boundary

An authorized, read-only `/health/details` check on 2026-10-05 identified the nearest-first chain as: private IPv4 proxy, Cloudflare IPv4 edge, public IPv6 hop, public IPv6 hop. The diagnostic records address classes and header presence only, without raw addresses or user identifiers. Invalid supplied country headers were overwritten at the edge; a forged forwarded/client-IP request was rejected with HTTP 403.

Both API and pipeline use the `TRUST_PROXY` value in `render.yaml`: loopback/private proxies plus the published Cloudflare IPv4 and IPv6 ranges. Express can therefore resolve the public client for its existing request limits. The feed country checker walks the raw nearest-first chain and accepts Cloudflare headers only after reaching a Cloudflare address through configured trusted preceding proxies. An intervening untrusted hop prevents that trust, even if the client inserts a Cloudflare-looking address earlier in its forwarded header.

Before migrating hosting or changing this value, repeat the address-free chain and spoof checks. Never use `TRUST_PROXY=true` or accept arbitrary forwarded country headers. Keep the Cloudflare ranges in `backend/feed-location.js` and `render.yaml` synchronized with the [published ranges](https://www.cloudflare.com/ips/). Render documents its Cloudflare and load-balancer path in [How Render handles DDoS attacks](https://render.com/articles/how-render-handles-ddos-attacks); Cloudflare describes its country and location headers in [HTTP request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

## Regression checks

- `node --test backend/feed-location.test.js backend/feed-source-selection.test.js backend/member-feed-scope.test.js backend/travel.test.js`
- `node scripts/audit-global-member-feed.mjs`
- `npm --prefix web run build`

The tests cover proxy spoofing, shared-network account separation, changing country, saved travel choices, new-member Home/Videos availability, and Global pages whose newest source posts are short videos. The browser audit covers failed guest requests and retry, sign-in, delayed session restoration, and switching accounts. Signed-in `/global` visits move to the member's Home feed after session restoration instead of retaining the guest feed.
