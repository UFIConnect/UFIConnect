# Office AI

Open `https://office.uficonnect.org/#office-ai`. The dedicated domain `https://uficonnect.ai` opens Office AI by default once its Cloudflare domain binding is active. Both use the existing Office access token and provide Cloudflare conversations, live research, reusable tools, provider connections, and the complete Office control catalog.

## Conversation and research

Live research is enabled by default. The server retrieves up to six web search results for the message before asking the model to answer. Sources and the lookup time accompany the answer. Search results are snippets; the system does not independently read every linked page or guarantee exhaustive topic coverage. When research fails or is disabled, the interface and model instructions explicitly say current information was not verified.

For AI announcement questions when broad search is unavailable, a bounded fallback reads recent official announcements from Cloudflare, OpenAI, Google AI, and the Hugging Face editorial blog. Sources show publisher and publication date. These first-party announcements are a limited set of provider claims, not independent comparisons or a complete search of the web. The interface distinguishes this fallback from broad web research.

Balanced, concise, and deep answer styles cover relevant evidence, alternatives, tradeoffs, uncertainties, and practical implications. The default model is `@cf/google/gemma-4-26b-a4b-it`; it can be changed in a direct Cloudflare connection. There is no claim that a model automatically knows every new release.

Messages and selected tool instructions are sent to Cloudflare. With research enabled, the message (up to 1,024 characters) is also used as a search query. Office credentials never enter model context. Only allowlisted aggregate agent observations and command metadata are included. Chat stays in page memory and clears when Office access changes or the tab unmounts; recent context sent with a request is bounded. Provider logging is disabled in the AI Gateway requests.

## Tools and commands

My tools saves reusable prompt instructions and named shortcuts to existing Office commands in PostgreSQL. Tools persist across deployments. Up to 50 tools can be saved and eight selected per message. External URLs, executable scripts, and arbitrary model-supplied endpoints are not accepted as tools.

The model can propose a command ID. The server resolves it against the current catalog, and the interface opens the existing command workflow with that ID selected. Chat itself does not execute commands. The existing review, input validation, service routing, availability checks, and audit history remain authoritative. Web, mobile, and Office code edits use the existing reviewed frontend editor and GitHub commit flow. Deployments use the existing Office deployment controls.

## Connections

Office AI → Connections supports GitHub, Render, and Cloudflare. It reuses configured server credentials or allows the operator to enter replacements in password fields. Verification checks provider access before saving; it does not infer GitHub write permissions from repository metadata. Actual operations still enforce provider permissions.

Saved credentials are encrypted using the existing `OAUTH_TOKEN_ENCRYPTION_KEY` with AES-256-GCM and provider-bound additional authenticated data. The shared `office_provider_connections` table stores ciphertext, enabled state, and timestamps. Values are never returned to the browser, logged by these modules, or sent to the model. Saved settings apply only to Office's environment view; background agents keep their original credentials. Instances refresh the connection cache within 15 seconds. An unavailable database fails closed for connection-dependent requests.

Disconnecting records a disabled state that also disables inherited server credentials for Office. It does not revoke the credential at its provider. Connecting again requires a valid credential. Cloudflare connects AI and web research; infrastructure management remains in the Cloudflare dashboard.

GitHub needs a token scoped to `UFIConnect/UFIConnect` (or the configured Autofix repository), with Contents and Actions write access for edits and workflow dispatch. Render uses an API key and the existing API, pipeline, web, and Office service IDs. Credentials must be entered in Connections, never in a chat message.

## Cloudflare transport

Two server-side configurations are supported:

- Direct: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The token needs Workers AI Read, plus AI Gateway Read for web search.
- Worker binding: `OFFICE_AI_RELAY_URL` and `OFFICE_AI_RELAY_SECRET`, using the isolated Worker in `infra/office-ai-worker`. The URL must be an HTTPS `workers.dev` origin. The secret is stored in the Worker and the Render API service only, with a local Windows DPAPI recovery copy in the ignored deployment-secret directory.

`OFFICE_AI_GATEWAY` defaults to `default`. Research requires AI Gateway credits or a supported provider key configured on the gateway. Search has a 12-second deadline, announcement feeds have five seconds each in parallel, and inference has 70 seconds within a 90-second server request deadline. The browser waits up to 100 seconds and supports cancellation. These budgets accommodate the complete Office context and deep answers; they do not change answer token limits. Inference is capped at two concurrent requests and 20 requests per minute per backend process. These are process-level limits, not an account-wide spending cap.

All `/office/ai` and `/office/connections` endpoints require the existing `x-office-token`. Tables are created lazily on the first authenticated use. Failed database writes are reported as failures, without an in-memory persistence fallback.

## Validation

Run the backend Office AI and connection tests, the Worker tests, and `node scripts/audit-office-ai.mjs`; then build Office. The browser audit covers desktop/mobile layouts, research sources, tools, command handoff, connections, request failure/cancellation, and access changes. The release should be assembled from the current production source plus this feature's reviewed changes so unrelated local work is excluded.

Cloudflare's current [AI REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/), [Web Search API](https://developers.cloudflare.com/web-search/how-to-use/), [GitHub repository API](https://docs.github.com/en/rest/repos/repos), and [Render authentication](https://api-docs.render.com/reference/authentication) document the provider contracts used here.
