# uficonnect.ai Office frontend

This small Worker serves the existing production Office static build at the owner's `uficonnect.ai` domain. The Office application selects its AI tab by default on this hostname. Keeping one static build makes later Office deployments update both addresses together.

Only GET/HEAD for known static pages and `/assets/*` are forwarded to the fixed `https://uficonnect-office-708r.onrender.com` origin. Browser cookies, authorization headers, Office credentials, and query parameters are not forwarded. The Worker has no secrets or AI credentials. Office API requests go directly to the existing authenticated API and pipeline endpoints. Add only `https://uficonnect.ai` to those services' existing `ALLOWED_ORIGINS` lists and redeploy them. Existing Office authentication is required on the new domain.

Run `node --test infra/office-ai-site/index.test.mjs`. Deploy with `wrangler deploy --config infra/office-ai-site/wrangler.jsonc`. Its custom-domain route lets Cloudflare manage the DNS record and HTTPS certificate. Do not repurpose unrelated Workers or overwrite existing DNS routes. The Worker intentionally has no workers.dev or preview address.

References: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [attach domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/).
