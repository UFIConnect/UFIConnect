# Office Live City

Open **Office → Live City** (`#city`) to inspect the running post pipeline as an
interactive city. Buildings represent operating stages, and the agent directory
contains agents returned by the authenticated services. Select a building or
agent for its measurements, role, recent activity and explanation.

## Reading the city

- Source collection, balancing and ingestion belong to the pipeline process.
- Staging promotion, the live feed and feed recovery are observed at the API.
- A shared guard can have a separate observation in both processes. Source
  workers use the process that owns the work, even if another process has a
  newer presence heartbeat.
- The API and pipeline are polled independently. Failed or stale observations
  are shown as unavailable; a successful request to one does not prove the
  other is healthy. A heartbeat does not prove that any posts were fetched.
- Moving markers illustrate recently observed activity. They are not a packet
  capture or a one-to-one animation of individual posts. Pause motion or use
  the operating system's reduced-motion setting for a static view.
- Use **Post Pipeline** for retained histories of individual posts. **Controls**
  remains the place to run operational actions. The city does not turn a chat
  message into a command.

Counts have their original scope: some belong to the current process and reset
on restart; queue depths and stored row counts describe different stages and
need not match. A connected feed recovery database is not proof of a successful
sync, and the current feed recovery mechanism is not a full account database
replica. Live City displays these states separately.

## Agent conversations

Conversations use `POST /office/agents/:id/chat` on the selected agent's service.
The existing Office token is required in a request header; it is never placed
in a URL or persistent browser storage. Chat histories remain in the current
browser view and can be cleared.

Replies explain the agent's observed state, purpose, cadence, errors and
dependencies. When AI explanations are available, the backend sends only
reviewed operational fields and locally classified question topics. It does
not send raw operator messages, conversation history, logs, posts, account
details or credentials to the model. AI requests disable response storage and
have no tools or command execution capability.

Without a configured provider, or if it cannot answer, the interface identifies
the response as local diagnostics. Missing measurements remain unknown. Chat
does not repair a database, deploy a service, or promise that a suggested fix
has happened. It cannot diagnose state the service has not measured.

Each process uses its own server-side `OPENAI_API_KEY` when present. Set
`OFFICE_CHAT_OPENAI_MODEL` to override the model; otherwise the existing
`AI_CONTENT_OPENAI_MODEL`, then `gpt-5-mini`, is used. The pipeline needs its
own configured key for AI replies from pipeline agents. Never put that key
in an Office frontend environment variable. Local diagnostics need no key.

## Release and validation

Deploy the matching API, pipeline and Office code. Existing privacy preference
changes also require the website release. Keep the existing OAuth encryption
key and database TLS configuration unchanged.

The release workflow requires all four Render deploy hooks and stops before
deploying anything when one is missing. A successful hook request starts a
Render deployment; it does not establish that the deployment is live. Check
the service's live commit and health afterward.

Verification covers service routing, freshness, partial outages, conversation
failures and cancellation, protected requests, motion controls, and narrow
mobile layouts. Synthetic test fixtures are used only in the automated audits;
the production city has no demo activity generator.
