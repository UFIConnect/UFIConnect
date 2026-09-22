# Videos and Music capacity

The API serves feed metadata. Embedded video bytes stream from their original
providers; they do not pass through these feed endpoints.

This release bounds expensive video/music reads per API process. All Videos,
Following Videos and Music route aliases share a maximum of 16 active handlers
and 64 queued requests. Requests wait at most two seconds for admission, then
receive HTTP 503 with `Retry-After: 2` and `code: FEED_BUSY`. Clients should retain
the current video and retry with jitter rather than starting simultaneous retries.
Disconnected queued requests are removed. Active requests retain their permit
until their handler finishes, even after a disconnect, so abandoned database work
cannot escape the concurrency limit.

`VIDEO_READ_MAX_ACTIVE`, `VIDEO_READ_MAX_QUEUED`, and
`VIDEO_READ_QUEUE_TIMEOUT_MS` tune these process-local limits. Increasing them
does not increase database or CPU capacity. The existing dedicated database read
pool is 10 connections per process, and the general pool is 40; API replicas and
pipeline workers must fit within the database's total connection budget.

Video-source discovery now coalesces concurrent cache misses into one SQL query
and preserves the existing 15-minute TTL. Personalized responses are not shared
between viewers. Cursor queries already use one indexed LATERAL query rather
than a SQL query per source; member engagement exclusions remain in that query.

## Reproducible local checks

Run `node --test feed-read-admission.test.js video-feed-concurrency.test.js` from
`backend`. These checks include a synthetic burst of 10,000 handler intents at
a configured four-active/eight-queued limit: four run immediately, eight wait,
and 9,988 receive explicit retryable responses. A separate test makes 12 real
loopback HTTP requests across the actual Videos/Music routes with fixture SQL,
checking shared admission, recovery and one discovery query. These tests establish
bounded overload behavior; they do not establish production throughput or prove
that 10,000 concurrent viewers will have uninterrupted playback.

## Production sizing still required

The production Render API was confirmed on September 22, 2026 to use one Starter
instance. The checked-in Blueprint sets a 320 MB Node heap. Confirm the database
plan and connection budget before capacity testing. No paid tier changes are made
by this release.

For 10,000 simultaneous viewers, measure actual feed-page requests per viewer,
page size, viewing time and provider limits. At one page request every 20 seconds,
10,000 viewers generate roughly 500 metadata requests/second before reconnects,
search, profile reads and other features. More aggressive prefetch changes that
number. Test a production-like staging database and several API replicas, ramping
load rather than sending an uncontrolled production burst. Record p50/p95/p99
latency, error/503 rate, queue depth, database active/waiting connections, CPU,
event-loop delay and RSS during a sustained soak and an instance restart.

Use measured results to size replicas, database capacity and connection pooling.
Share abuse-rate-limit state across replicas when enabling rate limits. Verify
source-provider playback/rate limits separately. Do not advertise 10,000-viewer
capacity until this staging test meets an agreed latency and availability target.

Render supports manual horizontal scaling and CPU/memory-based autoscaling;
each added instance has its own compute charge. See the official
[Render scaling guide](https://render.com/docs/scaling).
Render's integrated PgBouncer uses transaction pooling; session-level locks,
`LISTEN/NOTIFY`, and session variables require direct connections. Enabling it
restarts the database or triggers HA failover, so schedule that configuration
change separately. See [Render Postgres connection pooling](https://render.com/docs/postgresql-connection-pooling).

## Staging load runner

`scripts/load-video-staging.mjs` runs real authenticated HTTP cursor requests
against an explicitly identified staging host. It refuses known production
UFIconnect hosts. It does not generate tokens, create accounts, or change plans.
Prepare a private JSON file containing test-account records in this form:

```json
[{ "token": "STAGING_SESSION_TOKEN", "surface": "videos" },
 { "token": "ANOTHER_STAGING_SESSION_TOKEN", "surface": "music" }]
```

Use enough distinct staging accounts, each with interests and appropriate source
connections, to represent the audience. Keep the token file outside source control.
Set these environment variables, then run `node scripts/load-video-staging.mjs`:

| Variable | Initial staging run |
| --- | --- |
| `VIDEO_LOAD_STAGING` | `1` |
| `VIDEO_LOAD_BASE_URL` | Staging API HTTPS origin |
| `VIDEO_LOAD_HOST_CONFIRMATION` | Exact staging hostname |
| `VIDEO_LOAD_USERS_FILE` | Private JSON file path |
| `VIDEO_LOAD_RPS` | `5` |
| `VIDEO_LOAD_SECONDS` | `60` |
| `VIDEO_LOAD_RAMP_SECONDS` | `10` |
| `VIDEO_LOAD_CONCURRENCY` | `16` |

`--dry-run` validates the configuration and account file without network requests.
Increase rates in separate reviewed staging runs (for example 5, 25, 100, then
500 requests/second), keeping enough accounts and load-generator concurrency to
avoid client-side saturation. The runner reports attempted/completed throughput,
HTTP status counts, successful empty pages, latency percentiles and generator
drops. A nonzero drop count means the generator did not sustain the requested
arrival rate. Correlate these results with Render and database metrics; the runner
alone does not measure server CPU, playback-provider performance or 10,000 active
browser sessions. Do not use fixture SQL for a production capacity claim.
