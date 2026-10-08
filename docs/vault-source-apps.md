# Vault imported app pages

Each password card opens `/vault?app=<entry-id>` inside the authenticated Vault.
The entry ID identifies an encrypted browser record, and cannot authorize server
access. Unlocking is required after reload. App names, usernames, passwords and
website addresses stay in the browser. The website/app destination is an icon
on the app page. Optional analytics excludes the entire Vault route.
The source name and an icon remain visible as a watermark on the app page and
each source result. Existing brand icons are used for attribution, with a named
initial badge for other apps. This does not alter original provider media.

The page identifies official source domains using the current connected-account
catalog and account directory. An arbitrary imported URL is never sent to a
server fetcher. Unknown apps receive an unavailable state and their saved site
link. Importing passwords does not authorize source APIs, install apps, or log
into them automatically.

## Implemented adapters

| Source | Data | Authorization | Official documentation |
| --- | --- | --- | --- |
| GitHub | Stars and up to 100 recent account events | Member OAuth token; public/private visibility remains limited by its existing grants | [Stars](https://docs.github.com/en/rest/activity/starring), [Events](https://docs.github.com/en/rest/activity/events), [API terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms) |
| Mastodon | Bookmarks | `read:bookmarks` or broad `read`; old connections must reconnect | [Bookmarks](https://docs.joinmastodon.org/methods/bookmarks/) |
| YouTube | Authorized channel identity and own playlists | Existing `youtube.readonly` consent | [Playlists](https://developers.google.com/youtube/v3/docs/playlists/list), [Developer policies](https://developers.google.com/youtube/terms/developer-policies) |
| Twitch | Followed channels | Existing `user:read:follows` consent and configured app client ID | [Followed channels](https://dev.twitch.tv/docs/api/reference/#get-followed-channels), [Developer agreement](https://legal.twitch.com/en/legal/developer-agreement/) |

These endpoints describe supported operations, and are not a blanket legal
permission for every source or user. Existing provider approval, OAuth consent,
source enablement controls, and instance terms still apply. There is no scraping,
password replay, cookie collection, undocumented API, proxying a whole website,
video download, or claim of an affiliation with the source. Source data is shown
only to its authorizing account, with attribution and original destination links.

GitHub action order uses observed events by the authorized account from the
past 30 days. Counts are deduplicated by event ID and do not include another
actor's events. They are a bounded recent sample, not a complete record of
navigation or usage. The section is labeled **Actions**. Other sources have
no usage ranking. YouTube Watch Later and viewing history are unavailable; own
playlists are displayed in the source's order without derived usage metrics.

Reads occur on demand with fixed provider origins, no redirects, request/body
limits and member rate limits. Mastodon uses the existing validated, DNS-pinned
transport. Bookmarks use the actual Link-header cursor; arbitrary next-page URLs
are never followed. Token refresh is tried once on 401 for supported providers.
A fresh account check before returning results prevents a disconnected token
from delivering data that finished loading later. Business token filtering is
provided by `inboxAccount` and preserves the recruiting-only boundary.

Results are not stored in the database, browser storage, or API response cache.
The UI keeps loaded pages in memory, aborts requests on exit/lock, and lets users
clear loaded favorites/activity. Backend responses use `private, no-store`.
Provider errors and account identity are shown explicitly. No source counters
are fabricated, and no external app history is inferred from UFIConnect clicks.

## Practical actions

Imported app pages offer actions from `shared/imported-app-actions.json`, plus
connected social feed, messages, notifications and publishing routes when those
features exist. Business publishing opens its recruiting composer. Native UFI
features are marked “In UFIConnect”; official destinations are marked “On the
source” and open in a new tab/app. Unknown imports retain an Open action using
the saved, validated URL. No separate login credentials are passed in a link.

Netflix imports offer **Watch Netflix** and **My List** through official Netflix
pages. Playback uses Netflix's own player and the member's own membership and
sign-in session. UFIConnect does not host, embed, scrape or copy Netflix content,
and does not bypass its sign-in, DRM or household controls. References:
[supported devices](https://help.netflix.com/en/node/14361),
[My List](https://help.netflix.com/en/node/10523),
[terms](https://help.netflix.com/legal/termsofuse).
