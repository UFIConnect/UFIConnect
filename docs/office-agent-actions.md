# Office agent conversations and actions

Each agent exposes tasks from the authenticated Office Controls catalog. Type a request or choose an action. Source refreshes run on Pipeline; public web edits and release controls run on API. Shared tasks call both services and report each result separately. Results include the durable Office run ID; queued refreshes are reported as queued work.

Conversation history has no message count cap while the page is open. Earlier messages remain available through **Show earlier messages**. History stays in memory and is cleared on leaving or clearing the page. Requests contain a bounded recent context. Rate limits still protect service capacity.

## Public website edits

Every registered agent can open **Edit public web**. Select and load an existing file in `web/src`, `web/public` or `web/index.html`, then describe the change. AI prepares exact text edits to that selected file, with a preview. Manual editing is also available. The editor does not read private backend files, execute commands, add dependencies, or create files.

Generation uses OpenAI Responses with a strict JSON schema, `store: false`, and no tools. [Structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Requests are made only when the operator chooses **Prepare web change**. Generation is limited to one request at a time, six per minute, and an 80 KiB public file. Failed generation is not retried automatically.

Review and commit writes the chosen file through the existing `commit.web-frontend` Office control. It requires Office access, GitHub write configuration, a connected audit database, and the current file SHA. A newer revision stops the write. The control records the commit and run ID. The existing release workflow verifies the commit before deployment. A successful commit is distinct from a live deployment.

Backend keys remain on the service. Snapshots and task IDs are sanitized; model output cannot select arbitrary commands or action IDs. Web drafting sends only the selected public file and the operator's change request. No customer records or raw runtime logs are included.

Tests use mocked provider responses and synthetic Office credentials, with no paid generation or production writes.
