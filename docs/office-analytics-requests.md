# Analytics comparisons and request observability

Office Analytics includes Traffic history, Compare, API requests, page/tab
activity, geography, diagnostics and member registrations.

## Compare

`GET /office/analytics/comparison` is Office authenticated. It combines compact
anonymous daily snapshots from existing traffic and app reports with anonymous
registration-day totals. It never selects member names, emails or profiles.

Office can compare UTC days or months and filter dates locally. The default
comparison includes dates observed for both selected series. Other metrics
retain their own coverage. Missing mobile or older page data cannot remove
valid traffic/website comparisons. An optional all-dates view shows each
source's partial coverage.

Edge requests, HTML views, website opens, app screens, tabs, diagnostics and
registrations have different definitions. They must not be summed as visitors
or interpreted as a signup conversion rate. Missing measurements remain null.
Registration dates include retained earlier-date corrections and recovered-only
counts, preserving existing reconciliation.

## Incoming requests

`GET /office/analytics/requests` reports durable anonymous API and pipeline
response counts. It groups by UTC day, service, fixed endpoint family, response
status and time-to-headers bucket. User responses do not wait for analytics
writes. A bounded buffer flushes every 30 seconds; process-instance checkpoints
and aggregate increments commit atomically so retrying an uncertain database
acknowledgement cannot duplicate counts.

Collection begins with this release. Historical requests cannot be reconstructed
from app opens or Cloudflare totals. Unflushed requests may be lost on a process
restart; pending, dropped, persistence and coverage states remain explicit.
Latency measures server time until headers, not download time or a percentile.
Bodies, raw URLs, query strings, IP addresses and account identifiers are not
retained. Private Vault, VPN and authorization callback families are excluded.

Office separates selected-date daily totals from clearly labeled all-retained
family/status/latency breakdowns. These metrics describe incoming requests;
Cloudflare traffic has a different network scope.

## Office request costs

Reviewed GET reads use an authentication-scoped, bounded memory cache and
single-flight requests. Subscribers have independent cancellation. An
authentication change clears cached responses and diagnostics; writes invalidate
reads and are never replayed automatically. Private member searches and work
receipts are not response-cached. Nothing enters browser persistent storage.

Polling follows the active view and page visibility. Status and agent data are
requested only by views that display them. Hidden polls and telemetry streams
stop and resume once visible. Task, activity, terminal and local-preview status
reads use completion-based scheduling; inactive terminal sessions use a slower
cadence. Existing work continues on the server.

API requests also shows this Office client's fixed-family timings, statuses,
known response sizes, shared reads and memory hits. Sizes without a declared
measurement remain unknown. Static assets and local-preview traffic belong to
different scopes and are not administrative API client measurements.

Approved cross-origin preflights are reusable for ten minutes, avoiding a new
OPTIONS round trip for every polling interval. Actual requests still check
the configured origin and Office authorization normally.
