# Office analytics, accounts and report actions

Office requires the administrative access token. Account records, report details,
email tools and cache actions use private responses with `Cache-Control: no-store`.

## Analytics

The dashboard is organized into Overview, Pages & tabs, Geography, Diagnostics
and Users. The tab bar stays available while scrolling on desktop and scrolls
horizontally on small screens. Use Left/Right arrows or Home/End to navigate it by keyboard.
Activity filters and searches are preserved when switching tabs; Users retains
its own registration filters.

The shared category catalog covers website pages, internal tabs and native app
screens. A view is an open, not a unique person. Page and screen views are counted
separately from tab opens. Repeated visits count again; clicking an already open
tab does not add another view. Fixed categories never contain account IDs, full
URLs, query strings, credentials, searches or message text. Private Vault, VPN
and authorization callback activity remain excluded.

The database retains recorded UTC counts from May 1, 2026 onward. Office shows
all categories, including zeros, date/platform/category/view-type filters, daily
trends, optional diagnostic counts and collector storage status. Dates before
the first retained event are shown as unavailable rather than zero. Historical
recovery restores only counts backed by retained records. New categories collect
from their release;
earlier tab history cannot be reconstructed. Native screen changes require the
updated mobile app. A successful collector response follows a committed database
write. Optional Google Analytics and Google Ads remain separate services.

Country and city tables show approximate network location for opens, not user or
account location. They follow the selected activity filters and include unknown
counts so the breakdown reconciles with total opens. City rows include their
country and region, keeping same-named cities separate. A searchable, paginated
city table limits rendering costs. `GET /office/analytics/geography` uses
parameterized date/platform/category/view-type filters and one database
snapshot. It returns complete country counts and the 1,000 busiest cities, with
exact additional-city counts kept separate from unknown location. Geographic
history is aggregated in PostgreSQL rather than loaded into the API process.
The tables refresh independently from the general activity report. Older views
have no geographic backfill.
Only verified Cloudflare network location is used; city data additionally needs
the visitor-location transform and `CF_VISITOR_LOCATION_HEADERS=true`. No IP
address, device coordinate, account or visitor identifier is retained.

`performance.details` and the Diagnostic history table show recorded UTC day,
category, fixed error type and occurrence count. Historical counts remain after
code is fixed. The table helps locate a recurring issue without treating past
occurrences as a current list of unresolved problems or retaining raw errors.

## Registered accounts and cache checks

`GET /office/users` reads the primary database with counts and a paginated list
from one statement snapshot. Search accepts a name, email or exact account ID.
Hidden profiles remain registered accounts. Incomplete onboarding also remains a
registered account. Today, seven-day and thirty-day totals use UTC calendar days.
Office includes a Since May 2026 registration window, a 120-day window and an
incomplete-onboarding count; select All registrations to include older accounts.
Account reports open their
verified account directly, even when that account is older than 120 days. This
lookback reads existing account records and does not extend analytics retention.

Cache checks compare this API worker's transient user entries with the database.
An uncached database account loads when needed. A cache-only entry is not evidence
of a successful registration. Clearing the cache publishes a shared revision;
workers clear their caches within five seconds. This does not create, delete or
change database accounts or sessions. Office never promotes unverified cached
records into registrations. A database outage refuses signup rather than creating
a temporary account that disappears after deployment.

Signup request diagnostics count fixed response outcomes from this release:
created, invalid, duplicate, rate limited, unavailable and failed. These counts
contain no submitted personal fields and retain recorded days from May 2026. A rejected request
does not become an account. Historical attempts cannot be recovered from these
new counters.

## Email users

Select Email beside a registered account. Compose plain text, review the stored
recipient and confirm sending. Office uses the existing SMTP configuration and
does not allow a supplied alternative recipient. Each submission has a durable
request ID to prevent duplicate sends on retries. History keeps the subject and
provider status for 90 days, excluding message contents and recipient addresses.

Accepted means the SMTP provider accepted that recipient; it does not prove inbox
delivery. An uncertain status requires checking the provider before composing a
new submission. Office never automatically resends uncertain messages. Account
deletion clears the identity reference in the submission history.

## Report actions

Review the stored target and report evidence, select an action, add a review note
and confirm. A report is an allegation; submitting one never automatically removes
content. Status changes and action history identify the shared Office credential
as `office`.

Remove from UFIConnect deletes a verified native post/comment or removes a verified
external post from UFIConnect. A durable suppression prevents reappearance through
source refresh, feed caches, staging transfers, other API workers or the same
original URL under a different post ID. Visibility checks use primary storage;
unchecked cached content is withheld during a moderation-storage outage. External
provider content remains controlled by its provider.

Report on source prepares the verified original post and provider reporting
instructions. Finish the report on that provider; Office records a prepared
handoff rather than claiming external submission. Contact support opens an email
draft with the report reference. Send that draft in your email application to
contact support. Account reports link to the verified account in Analytics for
account management. Office account deletion has its own confirmation and stops
recurring memberships through the existing account deletion flow.
