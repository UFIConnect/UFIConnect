# Source analytics and copyright review

Implementation baseline: 30 September 2026.

The authenticated `/analytics` page covers 18 source capability records, your own UFIconnect activity, source revenue availability, copyright concerns, and security status. **YouTube is the only implemented source analytics collector.** A listed source, connected account, or enabled capability flag does not mean its analytics collector is live.

## Design inputs

The supplied [source-control brief](<C:/Users/Yosuf/.codex/attachments/c4c1d822-68a1-42cb-95a4-c46c24e5ffbf/Pasted text.txt>) requires official APIs and players, original links, source attribution, runtime capability controls, and source-owned engagement counts. Its example numbers are illustrative and are never seeded as live analytics.

The supplied [Security Architecture.pdf](<C:/Users/Yosuf/Downloads/Security Architecture.pdf>), **UFI Vault Security Architecture v0.1**, prepared 27 September 2026, is the device-security design baseline. Those two links identify files on the originating workstation; the files are not redistributed with this release. See [the Vault implementation and remaining hardware work](UFI-VAULT-IMPLEMENTATION.md) for the portable engineering record.

## Counts, playback, and revenue

- External views, likes, and comments come from the original provider. Missing, denied, stale, or unsupported metrics appear as **Unavailable**. A provider-supplied zero remains zero.
- Source totals and period metrics have separate labels. Counts from different networks are not added into a universal reach figure. Source channel totals are not attributed to UFIconnect visitors.
- An interaction verifies the connected account and capability, uses the authorized official API, and records the source response. It does not increment an independent public UFIconnect counter for the external post. Request IDs and bounded audit records support duplicate protection and review.
- If an action is disabled or unavailable, its UI links to the original source. Authorization and the backend capability check still apply when a browser has an older capability response.
- Approved source playback leaves advertising, view qualification, rights enforcement, removal, and playback restrictions with that source. Observing playback in UFIconnect never generates a synthetic source view.
- UFIconnect membership billing is separate from source earnings. The application never estimates creator income from views or engagement.

These controls follow the supplied brief and the source-specific access restrictions. YouTube's [developer policies](https://developers.google.com/youtube/terms/developer-policies) govern use of its API data and playback; the capability registry does not itself grant platform permission.

### YouTube collector and authorization

`backend/creator-analytics.js` makes bounded requests to official Google endpoints:

| Data | Request | Display scope |
| --- | --- | --- |
| Channel views and video count | `channels?part=statistics&mine=true` | Current channel totals |
| Views, likes, comments | Analytics `reports`, `ids=channel==MINE` | Selected 7 or 30 date range, ending yesterday |
| Estimated revenue | Analytics `reports`, `metrics=estimatedRevenue&currency=USD` | Source estimate for the displayed range |

The channel request must return one authorized channel. See the official [channels.list reference](https://developers.google.com/youtube/v3/docs/channels/list). Channel totals can remain available when a period or revenue request is denied; those missing results stay unavailable.

Members can open `/connected-accounts?analytics=1&monetization=1` to review an authorization upgrade. The YouTube OAuth flow requests `youtube.readonly`, `yt-analytics.readonly`, and, with the explicit monetization option, `yt-analytics-monetary.readonly`. Access to monetary reports also depends on YouTube Partner Program eligibility. Provider approval, scopes, account ownership, quota, and reporting availability still apply. See [YouTube channel report authorization](https://developers.google.com/youtube/analytics/channel_reports#authorization).

Revenue is labeled estimated, with currency and date range. It can change with source adjustments and reporting delays. See [YouTube's estimatedRevenue definition](https://developers.google.com/youtube/analytics/metrics#estimatedRevenue). No UFIconnect payout is created by this report.

### Capability coverage

The versioned registry is [`backend/source-policy.js`](../backend/source-policy.js). Its `allowed`, `requires_approval`, and `dont_implement` values describe engineering review status. Runtime flags, implemented adapters, member authorization, and provider acceptance all remain necessary. “API adapter” below identifies code present in this release, not a guarantee that a member or deployment has approval.

| Source | Like/comment API adapter | Creator analytics collector | Revenue collector |
| --- | --- | --- | --- |
| YouTube | Rating and comment, requires authorization | Implemented, requires authorization | Estimated revenue, requires authorization and eligibility |
| TikTok | Not implemented | Not implemented | Not implemented |
| Instagram | Not implemented | Not implemented | Not implemented |
| Facebook | Not implemented | Not implemented | Not implemented |
| Threads | Not implemented | Not implemented | Not implemented |
| X (`twitter`) | Like and reply, requires authorization | Not implemented | Not implemented |
| Bluesky | Like and reply, requires authorization | Not implemented | Not implemented |
| Mastodon | Not implemented | Not implemented | Not implemented |
| Reddit | Vote and comment, requires authorization | Not implemented | Not implemented |
| LinkedIn | Not implemented | Not implemented | Not implemented |
| Pinterest | Not implemented | Not implemented | Not implemented |
| Snapchat | Not implemented | Not implemented | Not implemented |
| Twitch | Not implemented | Not implemented | Not implemented |
| Vimeo | Not implemented | Not implemented | Not implemented |
| Tumblr | Not implemented | Not implemented | Not implemented |
| Discord | Not implemented | Not implemented | Not implemented |
| GitHub | Repository star and supported issue/PR comment | Not implemented | Not implemented |
| GitLab | Project star and supported issue/MR note | Not implemented | Not implemented |

All 18 records require attribution and original links. The registry forbids direct third-party rehosting, video caching, scraping fallbacks, media extraction, and synthetic metrics. Official-player support is separately recorded; a source without an enabled approved player uses its source link. The per-source documentation URLs in the registry are review references. Operators must review changed provider rules before enabling new features.

Runtime switches include:

- `SOURCE_ACCESS_ENABLED=false`: disable the reviewed sources.
- `SOURCE_INTERACTIONS_ENABLED=false`: disable API interactions.
- `SOURCE_<KEY>_ENABLED=false`: disable a particular source.
- `SOURCE_<KEY>_LIKE_ENABLED=false` or `SOURCE_<KEY>_COMMENT_ENABLED=false`: disable individual actions.
- `SOURCE_YOUTUBE_SOURCE_ANALYTICS_ENABLED=false`: disable YouTube metrics collection/display.
- `SOURCE_YOUTUBE_CREATOR_ANALYTICS_ENABLED=false`: disable selected-period reports.
- `SOURCE_YOUTUBE_SOURCE_MONETIZATION_ENABLED=false`: disable monetary reports.

Use `TWITTER` as X's configuration key. Runtime switches cannot enable an adapter absent from the registry.

## Native activity and experimental learning

UFIconnect totals cover the member's own native posts created in the selected UTC period. Likes and comments are **current totals on those posts**, rather than counts of like/comment events that occurred during that period. Daily report rows show posts by creation date. Source action request counts represent audit records.

`ACTIVITY_LEARNING_ENABLED=true` enables `ufi-activity-autoencoder-v1` in [`backend/activity-learning.js`](../backend/activity-learning.js). This experimental per-account neural model reconstructs daily counts of native posts, comments authored, and source action requests. It uses up to 30 complete consecutive days, with at least 22 complete days and at least 7 active training days. The latest completed day is evaluated against earlier days; today's incomplete data is excluded.

The bounded, deterministic model runs on the application's server using account activity counts. It receives no provider engagement metrics, revenue, media, message text, OAuth credentials, browser Vault contents, or device-verification events. Its output is informational and has not been independently validated. It never changes access permissions, makes a copyright decision, or establishes that an account is safe or compromised. Missing history produces an explicit insufficient-data state.

## Storage and retention

Production routes require authentication, rate limiting, and primary database availability. Responses use `Cache-Control: private, no-store`. Source snapshots belong to the member, source, connection, and reporting period; a changed or revoked connection invalidates the old snapshot.

| Record | Display/retention rule |
| --- | --- |
| Source snapshots | Display only while under 15 minutes old; older values become unavailable until refreshed. Delete after 1 day. |
| Source action request/idempotency records and audits | Delete after 30 days. |
| Copyright concern records, including reason and URL | Delete after 90 days. |
| Native posts and comments | Existing account/content retention applies; analytics does not create a new permanent copy. |

`creatorAnalytics.prune()` runs through the application's maintenance integration and report access, at most hourly per service instance. Expired records are removed on the next successful cleanup. Operators must monitor cleanup and database availability; a display expiry is not proof that a database row or backup was deleted. Existing backup handling remains separate.

Source refreshes have a one-minute minimum interval per member/source/period, bounded concurrency, response-size limits, and request timeouts. Failed provider calls do not become zero-valued metrics. The local review launcher uses an isolated synthetic account and in-memory copyright records; its local-preview marker must never be presented as production activity.

## Copyright operations

`POST /creator-analytics/copyright-reports` accepts a recognized source, its original HTTPS URL, and a reason between 10 and 2,000 characters. It validates the source host and stores an account-owned record with status `received`. `GET /creator-analytics/report` returns only the signed-in member's reports.

**There is no automatic takedown, legal-notice submission, provider notification, or copyright classifier.** This release provides storage and member history. It does not include a staff review inbox or a background process that resolves cases. Authorized operators must review received records through restricted database access and use the appropriate source/legal process separately. Do not interpret `received` as a completed investigation.

An operator can inspect the pending queue with a read-only query:

```sql
SELECT id, user_id, source, source_url, reason, status, created_at
FROM creator_copyright_reports
WHERE status = 'received'
ORDER BY created_at;
```

Reasons and original links can contain personal information. Restrict access, avoid copying them into application logs or model inputs, and retain an appropriate operational record of any separate review process.

## Vault boundaries

Connected-account OAuth encryption is an existing server control. The `/vault` browser password manager stores encrypted entries locally and keeps its contents outside telemetry, source analytics, monetization, and learning inputs. General aggregate service counts are described separately in the public privacy policy.

The optional device verifier is a software prototype. It reports its actual disabled/unavailable/configured state. Secure-element integration, attestation, NFC pairing, independent recovery, hardware VPN key custody, and independent review remain release gates. No page or report may imply that the browser Vault currently has hardware-rooted protection. See [UFI Vault implementation](UFI-VAULT-IMPLEMENTATION.md).

## Validation

The staged browser audit `scripts/audit-creator-analytics.mjs` verifies missing versus zero metrics, source filtering, report periods, refresh, copyright recording/history, revenue dates, and mobile overflow. It uses the isolated review launcher and explicit fixtures, with no production credentials or external source writes. Backend source-policy, analytics, learning, and Vault tests cover their respective controls. Passing software tests does not establish provider approval, a live authorized source connection, or hardware integration.
