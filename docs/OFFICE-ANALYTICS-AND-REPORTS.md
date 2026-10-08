# Office analytics, accounts and report actions

Office requires the administrative access token. Account records, report details,
email tools and cache actions use private responses with `Cache-Control: no-store`.

## Analytics

The shared category catalog covers website pages, internal tabs and native app
screens. A view is an open, not a unique person. Page and screen views are counted
separately from tab opens. Repeated visits count again; clicking an already open
tab does not add another view. Fixed categories never contain account IDs, full
URLs, query strings, credentials, searches or message text. Private Vault, VPN
and authorization callback activity remain excluded.

The database retains 30 UTC calendar days of counts. Office shows all categories,
including zeros, date/platform/category filters, daily trends, optional diagnostic
counts and collector storage status. New categories collect from this release;
earlier tab history cannot be reconstructed. Native screen changes require the
updated mobile app. A successful collector response follows a committed database
write. Optional Google Analytics and Google Ads remain separate services.

## Registered accounts and cache checks

`GET /office/users` reads the primary database with counts and a paginated list
from one statement snapshot. Search accepts a name, email or exact account ID.
Hidden profiles remain registered accounts. Incomplete onboarding also remains a
registered account. Today, seven-day and thirty-day totals use UTC calendar days.
Office includes a 120-day registration window and incomplete-onboarding count;
select All registrations to include older accounts. Account reports open their
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
contain no submitted personal fields and expire after 30 days. A rejected request
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
