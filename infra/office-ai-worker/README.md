# Office AI relay

This Worker gives the authenticated Office backend access to the owner's Cloudflare AI binding without placing a Cloudflare account token in the backend or browser. Every endpoint requires a separate, random `OFFICE_AI_RELAY_SECRET` bearer credential. Requests are capped at 4 MiB, including up to four uploaded images of 512 KiB each; text context remains capped at 256 KiB. The relay only runs model inference and web search; Office command authorization remains in the backend.

- `POST /chat`: `model`, `messages` containing text or user content arrays with text and uploaded JPEG/PNG/WebP data URLs, optional OpenAI-format `tools`, `max_tokens` (1–8192), `temperature`, `gatewayId` (default `default`). Remote image URLs are rejected. Returns OpenAI chat-completion format, including normalized native Workers AI tool calls. The default Gemma 4 model supports image input.
- `POST /search`: `query`, optional `limit` (1–10), `provider` (`exa` or `ceramic`), `gatewayId`. Returns Cloudflare Web Search JSON. Requires AI Gateway credits or a search provider key on that gateway.
- `GET /health`: authenticated binding-presence check. Does not incur inference charges or prove model/search billing readiness.

Set the same generated secret using `wrangler secret put OFFICE_AI_RELAY_SECRET` and the backend's protected environment. Set backend `OFFICE_AI_RELAY_URL` to the deployed Worker's HTTPS origin. Never put the secret in this directory, client Vite variables, or source control. Preserve the existing secret on redeploy. Request logging is disabled and inference requests disable gateway content logging and caching.

Run `node --test infra/office-ai-worker/index.test.mjs` before deployment. Deploy with `wrangler deploy --config infra/office-ai-worker/wrangler.jsonc`; test unauthenticated rejection, authenticated health, a small inference, and a current-source search before enabling the backend environment.

Cloudflare references: [AI binding](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/), [web search](https://developers.cloudflare.com/web-search/how-to-use/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
