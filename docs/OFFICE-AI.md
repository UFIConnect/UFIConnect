# Office AI

Open `https://uficonnect.ai` or `https://office.uficonnect.org/#office-ai`. Both use the existing Office access token and provide Cloudflare conversations, saved history, public web reading, coding tasks, an isolated terminal, reusable tools, provider connections, and the Office control catalog. This is a private Office application; internet access does not enable public visitors or public administration.

## Conversation and research

Live research is enabled by default. The server retrieves up to six web search results for the message before asking the model to answer. Sources and the lookup time accompany the answer. Search results are snippets; the system does not independently read every linked page or guarantee exhaustive topic coverage. When research fails or is disabled, the interface and model instructions explicitly say current information was not verified.

For AI announcement questions when broad search is unavailable, a bounded fallback reads recent official announcements from Cloudflare, OpenAI, Google AI, and the Hugging Face editorial blog. Sources show publisher and publication date. These first-party announcements are a limited set of provider claims, not independent comparisons or a complete search of the web. The interface distinguishes this fallback from broad web research.

Include a public HTTPS URL with research enabled to read its page text. Up to two supplied pages are retrieved with a 15-second limit, a 1 MiB transfer limit, and 6,000 characters of extracted text per page. Requests use validated, pinned public IPv4 addresses, validate each redirect, and forward no Office or provider credentials. Private addresses, embedded credentials, downloads, unsupported content types, sign-in walls, and JavaScript-only pages are not supported. Task mode also offers `web_read` and `web_search`. Broad search still requires Cloudflare AI Gateway search credits; a successful page read is not described as a complete web search.

Balanced, concise, and deep answer styles cover relevant evidence, alternatives, tradeoffs, uncertainties, and practical implications. The default model is `@cf/google/gemma-4-26b-a4b-it`; it can be changed in a direct Cloudflare connection. There is no claim that a model automatically knows every new release.

Messages and selected tool instructions are sent to Cloudflare. With research enabled, the message (up to 1,024 characters) is also used as a search query unless supplied URLs are being read directly. Office credentials never enter model context. Only allowlisted aggregate agent observations and command metadata are included. Recent context sent with a request is bounded. Provider logging is disabled in the AI Gateway requests. Markdown and code are rendered without raw HTML, and bounded text attachments can be included as message content. This feature set does not imply identical models or complete feature parity with ChatGPT or Claude.

## Saved conversations

The interface saves submitted messages and replies to the Office PostgreSQL database and displays saving, saved, or unsaved status. Titles and message payloads use the existing AES-256-GCM token vault with conversation-specific authenticated context. Saved chats survive refreshes and deployments and can be loaded, renamed, or deleted from history. The existing Office login controls access to this shared owner workspace; there are no public guest conversations.

There are at most 200 active saved chats, 200 messages per chat, and 300 KB of message data per save. Creates use a stable client request ID; updates require the saved version so another window cannot silently overwrite newer messages. An interrupted save can be retried, and conflicts keep unsaved text visible. Confirmed deletion removes encrypted content while retaining a small tombstone to prevent an ambiguous create retry from restoring deleted messages. Database or encryption failures are never reported as successful saves. Keep `OAUTH_TOKEN_ENCRYPTION_KEY` stable across deployments.

## Tools and commands

My tools saves reusable prompt instructions and named shortcuts to existing Office commands in PostgreSQL. Tools persist across deployments. Up to 50 tools can be saved and eight selected per message. External URLs, executable scripts, and arbitrary model-supplied endpoints are not accepted as tools.

In Ask mode, the model can propose a command ID and open its existing command workflow. In Run a task mode, the operator selects separate permissions for editing code, publishing, deploying, and running Office commands. The task submission authorizes that scope. Canonical command validation, availability, service routing, and audit history still apply, and commands with an existing confirmation requirement pause for confirmation of the exact pending action.

## Coding tasks and terminal

Tasks persist in PostgreSQL with progress, file changes, check receipts, and external operation results. A leased background runner executes one bounded step at a time and recovers after restarts. It uses Cloudflare only. Repository and web content are untrusted data; permissions come from the authenticated task request rather than model output. Cancellation stops remaining work and preserves receipts for actions already performed. An uncertain mutation is not blindly retried.

Repository tools list, search, read, and stage exact edits against pinned file hashes. Credentials, environment files, Git internals, caches, binaries, and the workflow approving the task's own publication cannot be edited through these tools. A task can stage up to 12 source files. An immutable `office-ai/<task-id>` validation tag identifies its candidate commit without changing production. Real `verify.yml` checks run against that exact commit. Publication requires successful checks and a normal non-forced continuation of unchanged main. Concurrent main changes cause publication to stop. Repository protections remain in force.

The existing main push workflow starts production deployment jobs, so publishing requires both editing and deployment permission. Render jobs wait for the exact commit's Verify workflow to pass, recheck that main has not moved, and pin each service to that commit. Office deployment commands also validate and pin the checked commit. A queued deployment is shown as queued until a provider receipt confirms more. Available model tools do not guarantee a particular task will succeed: provider permissions, CI results, repository rules, and external availability remain authoritative.

The terminal runs commands in a disposable Node 24 container on a GitHub Actions Ubuntu runner. The container receives the checked-out repository, an unprivileged user, a temporary home directory, and CPU, memory, process, output, and time limits. It has no production credentials, Docker socket, or host process namespace. Commands have 30–300 second limits; at most two sessions are active and 20 are created per hour. Each command starts a new workspace. This is a command terminal with job output and exit receipts, not an interactive SSH session or a persistent production shell.

The repository is public, so GitHub terminal workflow logs are public even though Office access is private. Do not put credentials or private member data in commands or output. Terminal write tools require the task's code-editing permission; ordinary read-only tasks cannot start commands.

## Connections

Office AI → Connections supports GitHub, Render, and Cloudflare. It reuses configured server credentials or allows the operator to enter replacements in password fields. Verification checks provider access before saving; it does not infer GitHub write permissions from repository metadata. Actual operations still enforce provider permissions.

Saved credentials are encrypted using the existing `OAUTH_TOKEN_ENCRYPTION_KEY` with AES-256-GCM and provider-bound additional authenticated data. The shared `office_provider_connections` table stores ciphertext, enabled state, and timestamps. Values are never returned to the browser, logged by these modules, or sent to the model. Saved settings apply only to Office's environment view; background agents keep their original credentials. Instances refresh the connection cache within 15 seconds. An unavailable database fails closed for connection-dependent requests.

Disconnecting records a disabled state that also disables inherited server credentials for Office. It does not revoke the credential at its provider. Connecting again requires a valid credential. Cloudflare AI and web research continue to support the protected Worker binding. Optional Worker deployment uses a separate scoped `CLOUDFLARE_DEPLOY_API_TOKEN`, saved encrypted in Connections; a deployment-only credential preserves the existing AI connection.

Cloudflare deployment tools support only the two existing Office Workers, `uficonnect-office-ai` and `uficonnect-office-ai-site`, from a verified current main commit. They retain domain settings and existing secret bindings. Without the scoped deployment credential, these tools report that setup is required; the inference relay is never repurposed as a management proxy. A confirmed script upload does not itself prove application behavior passed a live smoke test.

GitHub needs a token scoped to `UFIConnect/UFIConnect` (or the configured Autofix repository), with Contents and Actions write access for edits and workflow dispatch. Render uses an API key and the existing API, pipeline, web, and Office service IDs. Credentials must be entered in Connections, never in a chat message.

## Cloudflare transport

Two server-side configurations are supported:

- Direct: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The token needs Workers AI Read, plus AI Gateway Read for web search.
- Worker binding: `OFFICE_AI_RELAY_URL` and `OFFICE_AI_RELAY_SECRET`, using the isolated Worker in `infra/office-ai-worker`. The URL must be an HTTPS `workers.dev` origin. The secret is stored in the Worker and the Render API service only, with a local Windows DPAPI recovery copy in the ignored deployment-secret directory.

`OFFICE_AI_GATEWAY` defaults to `default`. Research requires AI Gateway credits or a supported provider key configured on the gateway. Search has a 12-second deadline, announcement feeds have five seconds each in parallel, and inference has 70 seconds within a 90-second server request deadline. The browser waits up to 100 seconds and supports cancellation. These budgets accommodate the complete Office context and deep answers; they do not change answer token limits. Inference is capped at two concurrent requests and 20 requests per minute per backend process. These are process-level limits, not an account-wide spending cap.

All `/office/ai` and `/office/connections` endpoints require the existing `x-office-token`. Conversations, tasks and terminal sessions run on the API role. Tables are created lazily on authenticated use or by the private task runner. Failed database writes are reported as failures, without an in-memory persistence fallback.

## Validation

Run the backend Office AI and connection tests, the Worker tests, and `node scripts/audit-office-ai.mjs`; then build Office. The browser audit covers desktop/mobile layouts, research sources, tools, command handoff, connections, request failure/cancellation, and access changes. The release should be assembled from the current production source plus this feature's reviewed changes so unrelated local work is excluded.

Cloudflare's current [AI REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/), [Web Search API](https://developers.cloudflare.com/web-search/how-to-use/), [GitHub repository API](https://docs.github.com/en/rest/repos/repos), and [Render authentication](https://api-docs.render.com/reference/authentication) document the provider contracts used here.
