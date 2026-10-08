# Office agent conversations and actions

Each agent exposes tasks from the authenticated Office Controls catalog. Type a request or choose an action. Source refreshes run on Pipeline; public web edits and release controls run on API. Shared tasks call both services and report each result separately. Results include the durable Office run ID; queued refreshes are reported as queued work.

**Activate configured agents** in Live City and **Connect configured setups** in Setup use the same audited control on API and Pipeline. Existing healthy workers are checked without starting another refresh. Eligible inactive workers enter the paced queue; provider cooldowns, missing app credentials, member account connections, and separate automatic-code-change controls keep their own requirements. Status reflects actual checks and worker observations, independently of registry heartbeats.

The message editor has no character limit, and conversation history has no message count cap while the page is open. Earlier messages remain available through **Show earlier messages**. History stays in memory and is cleared on leaving or clearing the page. The full current message is submitted without truncation; requests carry only the four most recent user messages that fit alongside it. A 1 MiB transport safeguard rejects exceptionally large requests, restores the message in the editor, and asks the operator to send smaller parts.

Local diagnostics and task suggestions have no per-minute conversation budget. Paid AI explanations allow 18 provider requests per minute and two in flight per service process. When that capacity is occupied, the message is accepted and receives a clearly labeled local diagnostics summary without another provider call. Failures count toward the provider budget and are not automatically retried. Large inputs are classified from a bounded beginning and ending. Provider context contains at most four fixed topic labels plus the sanitized observation, never the message text or transcript.

## AI action setup

The **Office AI agent** offers a curated set of existing Office tasks: queue and feed inspection, configured-agent activation, security and website checks, source optimization, topic auditing, and reviewed public website editing. Availability and prerequisites come from the authenticated catalog on each required service.

In **Action setup**, choose one task and select **Save setup**. This remembers only its task ID for the current Office page session, including when switching inspectors. It does not execute work or schedule an unattended task. **Run action** uses the current catalog and the existing task review; changes that require confirmation still require **Confirm and run task**. Missing credentials, service configuration, or audit storage keep the corresponding task unavailable. Public web editing opens its separate file review workflow.

Messages can propose supported tasks, but neither model output nor saved preferences can execute arbitrary commands. Operator execution runs through Office Controls and records its result and run ID. A disabled AI provider does not disable supported local task controls.

## Public website edits

Every registered agent can open **Edit public web**. Select and load an existing file in `web/src`, `web/public` or `web/index.html`, then describe the change. AI prepares exact text edits to that selected file, with a preview. Manual editing is also available. The editor does not read private backend files, execute commands, add dependencies, or create files.

Generation uses OpenAI Responses with a strict JSON schema, `store: false`, and no tools. [Structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Requests are made only when the operator chooses **Prepare web change**. Generation is limited to one request at a time, six per minute, and an 80 KiB public file. Failed generation is not retried automatically.

Review and commit writes the chosen file through the existing `commit.web-frontend` Office control. It requires Office access, GitHub write configuration, a connected audit database, and the current file SHA. A newer revision stops the write. The control records the commit and run ID. The existing release workflow verifies the commit before deployment. A successful commit is distinct from a live deployment.

Backend keys remain on the service. Snapshots and task IDs are sanitized; model output cannot select arbitrary commands or action IDs. Web drafting sends only the selected public file and the operator's change request. No customer records or raw runtime logs are included.

Tests use mocked provider responses and synthetic Office credentials, with no paid generation or production writes.
