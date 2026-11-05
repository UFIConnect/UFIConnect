# uficonnect.ai Office frontend

Production `uficonnect.ai` uses Cloudflare Workers Builds with static assets built from the Office frontend. Verified GitHub publication triggers that connected build. The Office application selects its AI tab by default on this hostname. Existing Office authentication is required.

The `index.mjs` proxy and `wrangler.jsonc` in this directory describe the earlier Render proxy setup and are retained for historical reference and its tests. They are obsolete for production. Uploading that proxy would replace the current static site rather than publish the new Office asset build.

Do not run a manual production deployment from this directory. Prepare and verify Office changes, obtain final source and destination approval, then publish through the existing GitHub and Workers Builds path. The backend blocks manual `cloudflare_deploy` uploads to `uficonnect-office-ai-site` while preserving read-only deployment status for it. The separate AI relay can still use its verified, explicitly approved deployment adapter with existing bindings preserved.

Historical proxy tests remain available with `node --test infra/office-ai-site/index.test.mjs`; they do not establish the production static build or authorize replacing its hosting configuration. Confirm the exact Office build and production deployment receipts after publication.
