## One conversation for questions and changes

The main Pip conversation now recognizes concrete change requests, creates an idempotent background task, and shows its progress and receipts in the same chat. Questions and small talk remain ordinary replies. Enter sends; Shift+Enter inserts a line break. Settings, history, connections, and specialist workspaces are available under **Settings & history**. Task settings apply to typed and voice requests.

Change requests use the existing default edit, publish, deploy, and operation permissions. The server narrows those permissions by destination; hosted drafts stay private and explicit requests not to deploy disable publication and deployment. Website, mobile, Pip, and repository fixes infer their scope from the request. A generic content request cannot publish repository changes. Destructive operations retain their existing confirmation.

After a candidate passes checks and is published, the task observes the existing release without dispatching another deployment. It remains working until all four Render services confirm that exact commit is live. Office changes also require the exact Cloudflare site build receipt. Queued releases are not reported as deployed. Failures, missing observation credentials, and a 45-minute deployment timeout retain the commit and deployment receipts with an actionable error.

# Pip

Conversation is the default. Tasks, Upgrade AI, Office controls, Memory, Activity, and Terminal have separate tabs. Generated files and drafts are saved in encrypted memory on uficonnect.ai. See [memory, hosted drafts, and upgrades](OFFICE-AI-MEMORY.md) for the current routing, storage, learned knowledge, and monitoring behavior.

Open `https://uficonnect.ai` or `https://office.uficonnect.org/#office-ai`. Both use the existing Office access token and provide Cloudflare conversations, saved history, public web reading, coding tasks, an isolated terminal, reusable tools, provider connections, and the Office control catalog. This is a private Office application; internet access does not enable public visitors or public administration.

## Voice, camera, and attachments

After unlocking Office, a call popup reads current service observations and the latest Work task state, then asks whether you need anything. It listens for five seconds after the microphone starts. Silence closes the call and releases the camera. Spoken questions and greetings receive conversational replies; concrete work requests use the selected task permissions and keep the voice conversation open. Use End call to stop the microphone, camera, and speech. Leaving Pip or hiding the tab also stops the sensors. Browser permission prompts and audio playback restrictions can require pressing Start call first.

The call shows your live camera preview and an animated Pip avatar. Camera context is a snapshot captured when you speak or send a message; it is not continuous video analysis. Attach photo or file accepts images, text files, and PDFs within the limits shown in the composer. Camera snapshots and attachments go to the authenticated Pip backend and configured Cloudflare model as context. Unsupported formats and extraction failures are reported. Work keeps the existing task execution permissions, approval steps, and result receipts.

## Conversation and research

Tasks and **Upgrade Pip** open chat agents. Type a question to discuss the work, or use **Work** with a concrete request to start a run. **Ask** always requests a conversational reply. Greetings, capability questions, and explanations also stay conversational while Work is selected. Follow-up requests include bounded discussion and the selected run's summary. Upgrade Pip keeps its self-update destination. Agent discussions stay in the current tab; run receipts remain in Office and can be reopened from history. Failed submissions retain the draft and reuse their request identity when retried unchanged.

Repository editing records each successful file read on the server. The edit tool uses that exact revision automatically, so the model does not need to copy a SHA. Explicit stale revisions and edits without a prior read still fail validation. An unresolved rejected edit leaves a resumable checkpoint instead of marking the run successful without changes.

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

Conversation excludes Office command tools and ignores unsolicited command proposals. Tasks and Upgrade AI use the selected editing, publication, deployment, and operation permissions, narrowed by the request's destination. Canonical command validation, availability, service routing, and audit history still apply, and commands with an existing confirmation requirement pause for confirmation of the exact pending action.

## Coding tasks and terminal

Tasks persist in PostgreSQL with progress, file changes, check receipts, and external operation results. A leased background runner executes one bounded step at a time and recovers after restarts. It uses Cloudflare only. Repository and web content are untrusted data; permissions come from the authenticated task request rather than model output. Cancellation stops remaining work and preserves receipts for actions already performed. An uncertain mutation is not blindly retried.

Repository tools list, search, read, and stage exact edits against pinned file hashes. Credentials, environment files, Git internals, caches, binaries, and the workflow approving the task's own publication cannot be edited through these tools. A task can stage up to 12 source files. An immutable `office-ai/<task-id>` validation tag identifies its candidate commit without changing production. Real `verify.yml` checks run against that exact commit. Publication requires successful checks and a normal non-forced continuation of unchanged main. Concurrent main changes cause publication to stop. Repository protections remain in force.

The existing main push workflow starts production deployment jobs, so publishing requires both editing and deployment permission. Render jobs wait for the exact commit's Verify workflow to pass, recheck that main has not moved, and pin each service to that commit. Office deployment commands also validate and pin the checked commit. A queued deployment is shown as queued until a provider receipt confirms more. Available model tools do not guarantee a particular task will succeed: provider permissions, CI results, repository rules, and external availability remain authoritative.

The terminal runs commands in a disposable Node 24 container on a GitHub Actions Ubuntu runner. The container receives the checked-out repository, an unprivileged user, a temporary home directory, and CPU, memory, process, output, and time limits. It has no production credentials, Docker socket, or host process namespace. Commands have 30–300 second limits; at most two sessions are active and 20 are created per hour. Each command starts a new workspace. This is a command terminal with job output and exit receipts, not an interactive SSH session or a persistent production shell.

The repository is public, so GitHub terminal workflow logs are public even though Office access is private. Do not put credentials or private member data in commands or output. Terminal write tools require the task's code-editing permission; ordinary read-only tasks cannot start commands.

Office commands opens a connected control map. Controls are grouped by purpose, and labeled links help navigate related work such as collecting content, checking safety, investigating health, and releasing changes. These are navigation relationships, not a claim that commands run automatically in that order. Every registered control, including generated source controls and unavailable controls, remains reachable. Search by action, category, service, or command ID; switch to the directory for a list. Returning from a command review preserves the map selection and search. Keyboard navigation and system reduced-motion preferences are supported.

## Connections

Pip → Connections supports Notion, Slack, Linear, GitHub, Render, and Cloudflare, with provider search and knowledge/service filters. It reuses configured server credentials or allows the operator to enter replacements in password fields. Verification checks provider access before saving; it does not infer GitHub write permissions from repository metadata. Actual operations still enforce provider permissions.

In Conversation → Ask, explicitly select connected knowledge sources under **Sources for this reply**. Selected sources are searched even when public web research is off. Queries go to their providers, and retrieved excerpts go to Cloudflare with the message. Replies show provider-specific retrieval status and source links; failed or empty lookups are reported. Excerpts are bounded and do not represent a complete workspace search.

| Source | Credential and access | Retrieved context |
| --- | --- | --- |
| Notion | Internal connection token with Read content; share the intended pages with the connection | Page title search and top-level text excerpts from up to three pages |
| Slack | User OAuth token beginning `xoxp-`, with `search:read.public` and access to Slack real-time search | Up to four public-channel message excerpts; no private channels or direct messages |
| Linear | Personal API key with Read access, limited to intended teams | Up to four matching issue titles, descriptions, and statuses |

Connections are shared with authorized Office operators. Choose source accounts and scopes appropriate for everyone who can access this Office. Credentials belong in Connections, never in the chat. Optional server settings are `OFFICE_NOTION_TOKEN`, `OFFICE_SLACK_TOKEN`, and `OFFICE_LINEAR_TOKEN`; a saved connection overrides its corresponding server credential. The connection-table constraint migrates automatically to allow the added providers without deleting existing records.

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

Run `node --test scripts/office-command-city.test.mjs`, the backend Pip, connected-source, conversation, and connection tests, the Worker tests, and `node scripts/audit-office-ai.mjs`; then build Office. The browser audit covers desktop/mobile layouts, research sources, tools, command handoff, connections, request failure/cancellation, and access changes. The release should be assembled from the current production source plus this feature's reviewed changes so unrelated local work is excluded.

Cloudflare's current [AI REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/), [Web Search API](https://developers.cloudflare.com/web-search/how-to-use/), [GitHub repository API](https://docs.github.com/en/rest/repos/repos), and [Render authentication](https://api-docs.render.com/reference/authentication) document the provider contracts used here.

## First conversation

1. Open Pip in Conversation, enter a question, and select Send.
2. Wait for the reply and the Saved indicator before leaving the page.
3. Reload Office, then select the conversation in saved history to continue.

Enter provider credentials only in Pip Connections. Never paste credentials into a message, attachment, or terminal command.


## Cloudflare extensions and double recovery

Pip uses Cloudflare for inference and isolated JavaScript execution. The AI relay needs its existing AI and secret bindings plus a Worker Loader binding named LOADER (worker_loaders in wrangler.jsonc). The code runtime grants no application bindings or network access, caps CPU at 100 ms, returns within a two-second response deadline, and bounds input, logs, and output. Code runs on Cloudflare, never by eval on the API host.

The task executor can calculate with code_execute, analyze CSV/JSON with data_analyze, inspect multiple public sources with research, and list/read/run/save reusable JavaScript functions. Function saving requires editing permission and enabled task memory. The Functions tab supports inspection, execution, JSON result downloads, and revision-checked restores. Functions are pure computations; existing authenticated adapters handle external operations.

A transient, retry-safe failed step gets at most two automatic retries using the same invocation identifier. A persistent failure pauses with its task state intact. Logical failures get two opportunities to inspect and correct the approach. Interrupted external writes with an unknown outcome are never automatically replayed. Continuing a paused task renews its bounded recovery budget without changing permissions.

Encrypted version storage retains the current function or repository draft and two earlier versions. Draft snapshots are captured before and after edits. Restoring requires the task to be paused, its exact continuation identifier, an unchanged repository base, and no published candidate or running external action. Restores replace staged files only and preserve completed external receipts. Function restores require the current revision and append a new version. These checkpoints do not rewind deployed services or replace database backups.

The executor keeps concise plan_update progress and checks recorded verification/deployment receipts before its final answer. A visible plan is progress metadata, not proof that work executed. Run backend/office-ai-extensions.test.js, the task integration tests, relay tests, and scripts/audit-office-ai-functions.mjs to validate these capabilities.
