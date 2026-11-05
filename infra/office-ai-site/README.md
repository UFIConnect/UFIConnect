# uficonnect.ai Office frontend

This small Worker adds the UFIConnect API to the owner's `uficonnect.ai` domain. The root `wrangler.jsonc` combines its script with the Office build in `office/dist`. Static assets are served directly; `/api/v1/*` runs the Worker first. The Office application selects its AI tab by default on this hostname.

If a request reaches the script rather than a deployed asset, GET/HEAD for known static pages and `/assets/*` fall back to the fixed `https://uficonnect-office-708r.onrender.com` origin. These static requests never forward browser cookies, authorization headers, Office credentials, or query parameters.

The Worker forwards a narrow set of `/api/v1` routes to the fixed `https://api.uficonnect.org` origin: GET/HEAD for topics, feed, and UUID post/video status or video content; POST for posts, chat completions, photos, videos, and written content; and PATCH for UUID posts. Requests forward only `Accept` and `Authorization` headers, plus `Content-Type` for writes. Only feed requests forward query parameters, using the first `limit` and `cursor` values. Writes require a valid JSON object of at most 64 KB, checked against actual streamed bytes as well as any declared length. API subrequests allow up to four minutes; static fallback requests allow 15 seconds.

The API validates bearer keys, selected permissions, expiry, shared per-key request and daily generation budgets, and ownership for posts and videos. API responses are `private, no-store`, and redirects are rejected. Cookies, Office credentials, unsupported methods, and other API paths are never forwarded. See [UFIConnect API keys](../../docs/UFI-API-KEYS.md) for key creation and usage.

The Worker has no stored secrets or AI credentials. Office management requests, including key generation and revocation, go directly to the existing authenticated API and pipeline endpoints. Add only `https://uficonnect.ai` to those services' existing `ALLOWED_ORIGINS` lists and redeploy them. Existing Office authentication is required on the new domain.

Run `node --test infra/office-ai-site/index.test.mjs`. Build Office, then deploy from the repository root with `npx wrangler deploy`. The existing Cloudflare build command with `--name uficonnect-office-ai-site --assets ./office/dist --compatibility-date 2026-11-03` also discovers the root configuration and includes its script and API routing. The configuration disables SPA fallback, so an API failure never becomes Office HTML. The older `infra/office-ai-site/wrangler.jsonc` is a proxy-only configuration; production uses the root configuration to preserve directly hosted Office assets.

The custom-domain route lets Cloudflare manage the DNS record and HTTPS certificate. Do not repurpose unrelated Workers or overwrite existing DNS routes. The Worker intentionally has no workers.dev or preview address. Selective routing follows Cloudflare's [Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) configuration.

References: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [attach domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/).
