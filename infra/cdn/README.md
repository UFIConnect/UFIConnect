# UFIConnect public CDN

Cloudflare handles the public edge for `uficonnect.org`. Render builds and serves the public web files. The [Cloudflare rules](cloudflare-cache-rules.yaml) and the `uficonnect-web` headers in [render.yaml](../../render.yaml) define the cache policy together.

| Traffic | Browser freshness | Cloudflare freshness |
| --- | --- | --- |
| Anonymous `/` and `/index.html` with an empty query | Revalidates on navigation | 30 seconds |
| Successful fingerprinted bundles under `/assets/` | One year | One year |
| Theme JavaScript and CSS | Five minutes | One hour |
| Published brand and homepage art and preparation media | One hour for files with explicit Render headers | One day for files with explicit Render headers |
| Sign-in, reset, onboarding, account shells, installed-app metadata, and mutable VPN downloads | `no-store` on the listed Render paths | Bypass |
| API requests, other web navigation, and unrecognized query variants | Origin policy | Bypass |
| Redirects, errors, and HTML returned under `/assets/` | `no-store` | `no-store` |

The allowed asset types and public file paths are in the request rule. The current brand query version is explicitly allowed on its published files. The default cache key retains the query string. Authorization and Cloudflare Access assertion headers make a request ineligible. Cookies disqualify HTML from the allowlist. Published files are identical across sessions. Render's shorter bundle TTL limits the effect of a path-level header on an error response. The edge attaches the one-year TTL only to successful non-HTML bundle responses that allow public caching and carry no `Set-Cookie`.

The API continues to receive authentication, location, event streams, and write requests. Office and `uficonnect.ai` have their own hostnames and cache configuration. Embedded third-party media stays on its source delivery path.

## Verify and roll out

1. Run `node --test scripts/web-security.test.mjs` and `npm run build --prefix web`. Run the baseline probe with `node scripts/audit-cdn.mjs --baseline` before changing edge settings. If the network uses an HTTP proxy, start Node with `NODE_USE_ENV_PROXY=1`.
2. In the existing `uficonnect.org` Cloudflare zone, save the current cache rules and review overlapping Cache Rules, Page Rules, Workers, and Origin Rules. Cache Response Rules see the origin hostname after any Host rewrite. Confirm the rule matches the hostname the origin receives. The existing HTTPS and compression settings supply transport and encoding.
3. Install the entries in `http_response_cache_settings` and then `http_request_cache_settings`, in file order at the end of their respective existing phase. Update an existing rule with the same `ref` on subsequent rollouts. Add individual rules in the dashboard or with the [Rulesets API](https://developers.cloudflare.com/api/resources/rulesets/subresources/rules/). Keep unrelated rules in their current order. If a phase has no ruleset, create its zone entry point with the corresponding phase and entries. Use the [Cloudflare rules simulator](https://developers.cloudflare.com/rules/simulator/) to check the final request settings for the homepage, a versioned asset, a query variant, sign-in, and the API.
4. Sync the public web headers to the existing Render static site and publish through the [verified Render release](../../docs/RENDER-SYNC.md). Confirm that the homepage points to bundles from the new release. If a previous response is still in the edge cache, purge the affected file URLs, including any known cached missing-bundle URLs.
5. Run `node scripts/audit-cdn.mjs`. It checks static-asset hits, compressed JS or CSS, request bypasses, PWA and account headers, uncached 404s, and byte-range playback. Also check sign-in and password reset, an installed-app refresh, video seeking, and feed updates in a normal browser session. Use the same locations and traffic window for before-and-after measurements.

Convert the manifest to API payloads from the repository root after `npm ci`.

```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {parse} from "yaml"; console.log(JSON.stringify(parse(readFileSync("infra/cdn/cloudflare-cache-rules.yaml", "utf8")), null, 2));'
```

## Measure and roll back

Use Cloudflare Cache Analytics to track eligible asset hit rate and bytes served from cache, grouped by hostname and content type. Compare Render ingress separately to see whether the origin receives fewer requests. Use first-party analytics for page and app activity. The same request can appear in Cloudflare and Render measurements, so compare the series individually. See [Office request analytics](../../docs/office-analytics-requests.md).

To roll back, restore the previous versions of the four Cloudflare rules or disable the new rules, then restore the previous Render web headers if needed. Purge affected mutable URLs individually and run the baseline probe. Fingerprinted bundle URLs change when published bytes change, giving browsers a fresh URL even when they retain an earlier copy.
