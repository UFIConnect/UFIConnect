# Public HTML and search visibility

`npm run build --prefix web` builds the interactive application, then pre-renders the public React page components into individual HTML documents. Titles, descriptions, canonical URLs, navigation, headings, and explanatory content are available before JavaScript runs. The build does not request feed data, account data, or private APIs. Live results and authenticated actions still require JavaScript.

`web/src/seo-routes.mjs` is the route inventory. Public indexable pages enter the sitemap; sign-in/reset utilities and member shells carry `noindex, follow`. Search has a useful public guide and continues to show the full search experience for signed-in users. Content is the same for browsers and crawlers; there is no user-agent rendering switch.

Pre-rendered forms are disabled until the application mounts. This prevents a browser without JavaScript from submitting account credentials through an unhandled default GET request. Explanatory text and real links remain usable. React takes over the page and metadata when it loads, keeping forms interactive and titles unique during navigation.

## Routing and deployment

Run `node scripts/sync-web-routes.mjs` after changing the inventory. It updates the sitemap, Render blueprint, and `web/render-routes.json`. Known paths are explicit; dynamic member/post route shapes use `app.html`. Arbitrary unknown paths and missing assets must return HTTP 404 with `404.html`, not the homepage. The Nginx configuration and `node web/scripts/serve-built.mjs` follow the same approach.

On an existing Render static site, removing a rule from the blueprint does not delete the live rule. Deploy the generated HTML first, then replace the site's routing rules with the reviewed `web/render-routes.json`, preserving any unrelated intentional rules. In particular, remove `/* -> /index.html` only after confirming the new assets exist. Render uses the root `404.html` for unmatched paths. Verify both the public domain and direct Render origin, including HTTP-to-HTTPS redirection.

The old synchronous maintenance/path-redirect scripts and duplicated generic structured data were removed. The main script remains a deferred ES module, routes remain split, and optional analytics controls load independently. Essential first-party analytics and consent behavior are unchanged.

## Security and verification

The restrictive Content Security Policy blocks unapproved inline scripts, event handlers, and `eval`. `X-XSS-Protection: 0` explicitly disables the deprecated legacy filter; a scanner demanding `1` is using obsolete advice. Do not weaken CSP or enable that filter to improve an audit score. Regenerate header hashes with `node scripts/sync-security-headers.mjs` after changing shared HTML.

Run `node scripts/audit-public-seo.mjs` after building. It checks raw HTML, metadata uniqueness, sitemap links, real status codes, no-JavaScript desktop/mobile pages, secure form fallbacks, and interactive navigation. Existing CSP and authentication checks remain in the release workflow. After deployment, re-run the original external assessment; its score and future search-engine indexing cannot be guaranteed by these checks.

Sources: [Google JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [Render routing](https://render.com/docs/redirects-rewrites), [Render custom 404 support](https://community.render.com/t/custom-404-error-page/746/2), [OWASP response headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html#x-xss-protection).
