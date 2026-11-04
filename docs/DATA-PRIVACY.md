# Data and privacy controls

## Vault storage

Vault encrypts contents on the device before saving an account copy in the
primary database. Passphrases, plaintext entries and unwrapped keys are not
uploaded. Local device/Face ID wrappers remain local. Encrypted account copies
are included in account exports and deleted with the account; downloaded and
cached device copies remain until removed locally. Vault contents stay outside
analytics and learning. See [Vault account storage](VAULT-ACCOUNT-STORAGE.md)
for migration, conflict handling and deployment details.

## Collection choices

| Control | Default | Behavior |
| --- | --- | --- |
| Core service metrics and aggregate usage counts | Always active | Counts fixed page/screen/tab categories, approximate network country/city, request outcomes and response-time buckets. No account or visitor identifier is attached to a counter. |
| Google Analytics | Off until accepted | Existing isolated, consent-based integration with G-F68DRQ6CC5. Withdrawal stops future Google collection. Native Firebase collection remains unavailable. |
| Performance insights | Off | Optional fixed-code diagnostic counts. No raw messages, stacks, route parameters or account identifiers. |
| Data Saver | Off | Reduces automatic media loading or unselected feed requests, according to platform support. Explicitly opened content can still use data. |
| Autoplay feed previews (website) | On | Controls feed preview playback; Data Saver takes priority. Explicitly opened players are separate. |

Preferences are local to a browser or app installation. They are not a carrier
roaming switch and cannot override operating-system cellular permissions. The
native app currently has no video preview player; it does not present a pretend
autoplay setting. Its Data Saver avoids prefetching unselected feed sections.

Account operations and requested features, including saved/read history and feed
personalization, remain separate from aggregate metrics. Hosting and security
systems still process network addresses to deliver and protect requests.

## Aggregate storage and reports

New events use `analytics_daily_counts`: UTC day, fixed category, event kind,
reviewed diagnostic code and count. The endpoint accepts only the exact approved
fields, rejects arbitrary categories and applies small-body and abuse limits.
It does not use authentication to associate a view with a person. Identified
legacy event collectors no longer ingest events; existing historical tables are
preserved rather than silently erased.

Page/screen/tab and optional diagnostic counters retain recorded UTC days from
May 1, 2026 onward. A bounded memory buffer batches concurrent increments, and a
successful collector response is sent only after the database commits them.
Unacknowledged writes retry every 30 seconds and before an Office report; a
restart can lose pending events that were never acknowledged. A storage failure
returns 503 instead of a successful receipt. These counts are operational
estimates, not billing or unique-visitor measurements.
Request outcome/duration counters describe only the current API process and
reset when it restarts; they are not combined across replicas.

`analytics_geography_daily_counts` contains UTC day, fixed category, ISO country,
city, region and count. It starts collecting with this release and uses the
existing verified Cloudflare proxy chain. City and region require the enabled
visitor-location transform and `CF_VISITOR_LOCATION_HEADERS=true`. Raw headers,
IP addresses, device coordinates and identifiers are not stored. Geography and
the corresponding view total commit atomically and are read in one statement
snapshot. Unverified locations and older views remain unknown; historical
locations are never inferred from account profiles or travel destinations.

`GET /office/analytics/pageviews` remains protected by the Office token. It
returns aggregate totals, fixed categories, daily counts, optional diagnostics
with day/category/type breakdowns and process-local service metrics. The protected
`GET /office/analytics/geography` endpoint aggregates its selected dates,
platform, category and view type in the database. Country totals include all
recorded locations; the 1,000 busiest cities are returned with exact counts for
additional cities, separate from unknown locations. No raw geographic history
is loaded into the API process. Geographic and diagnostic tables follow the same date, platform,
category and view-type filters as the activity chart. Diagnostic totals describe
historical occurrences and are retained after a fix. Account administration is
shown separately. No unique-visitor or signed-in-view count is inferred from
page totals.

## Release verification

Deploy the matching backend, website, Office build and mobile app/export after
the required checks pass. Validate required first-party category counts with
Google declined, no Google requests before consent or after withdrawal, optional
diagnostics off by default, and real network reductions from Data Saver. Use
synthetic values and local interception for privacy tests.

Confirm the protected Office aggregate report is available after the schema
migration. A successful build or a green primary-database indicator does not
prove report persistence, backup synchronization, Google property receipt or
native store delivery. Preserve the existing encryption key and verified TLS
configuration during rollout. Signed native builds and device validation are
separate from Expo bundle exports.
