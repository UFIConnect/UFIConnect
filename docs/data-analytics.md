# Feed inventory and analytics history

The API serves imported posts from PostgreSQL. Its in-memory collector cache is
normally empty because collection runs on the pipeline service. Office feed
totals and the Sources page therefore use a shared stored inventory snapshot.
`cachedInMemory` remains a separate working-set measurement.

Inventory refreshes are coalesced and cached for one minute. Source previews
read at most ten indexed rows per source and project short title/content
previews. Sources and feed statistics exclude synthetic fallback records and
respect provider access. Storage inventory includes every stored row.

A successful empty database read reports zero. An unobserved or failed initial
read reports unavailable/null; a failed refresh preserves the last known counts
and marks them stale. Counts include their observation timestamp.

## First-party analytics

Anonymous daily aggregates retain recorded history from May 2026 onward.
Category opens, app screens, internal tabs, diagnostics, registrations, network
requests and unique people are separate measurements. Repeated opens are not
deduplicated visitors. Missing historical collection cannot be reconstructed as
zero traffic.

`GET /office/analytics/pageviews` retains the full response contract. Office uses
`detail=compact` for sparse category/day rows, while the pipeline summary uses
`detail=summary`. Both preserve the same verified totals. A bounded 15-second
single-flight snapshot avoids repeated database reads and allocation; committed
events and UTC date changes invalidate it. Failed reads remain unavailable.
Geography and user panels fetch when opened and pause polling while hidden.

## Launch-era traffic

The protected `GET /office/analytics/traffic` report reads Cloudflare zone
analytics for the configured uficonnect.org zone and saved account. It accepts
no client-supplied domain or provider credential. Provider requests have fixed
destinations, time and response-size bounds, and a five-minute cache/backoff.

The report separates edge requests, HTML page views, daily unique IP addresses
and first-party opens. Edge traffic includes automated requests and proxied
subdomains. Daily unique IP counts must never be summed as all-time unique
visitors or combined with first-party opens. Missing dates remain unavailable.
The current UTC day may be incomplete.

Successful provider observations are stored as anonymous daily aggregates.
Re-fetching a day replaces its counters rather than adding them a second time;
days no longer returned by the provider remain available from stored history.
Persistence failures are reported separately from a successful provider read.
The report can serve a marked stale stored observation during a provider outage.

Cloudflare's [analytics definitions](https://developers.cloudflare.com/analytics/faq/about-analytics/)
and [GraphQL dataset documentation](https://developers.cloudflare.com/analytics/graphql-api/features/data-sets/)
describe these provider metrics. A provider observation time remains distinct
from the time an Office client requests a cached or stale report.

No historical event count is fabricated to match an expected visitor total.
Data changes preserve existing aggregate history and customer records.
