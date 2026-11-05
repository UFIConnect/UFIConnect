# Source publishing setup — November 4, 2026

Cross-Post publishes to supported connected accounts from UFIConnect. The composer uses one source button style, orders connected accounts first, and locks disconnected or unsupported destinations. Copying a draft is a separate utility and never counts as publication. Public discovery sources remain readable without connecting an account.

## Verified server settings

The API and pipeline were inspected on November 4, 2026 (America/Los_Angeles). Both already have these values:

```dotenv
API_BASE_URL=https://api.uficonnect.org
PUBLIC_API_URL=https://api.uficonnect.org
OAUTH_CALLBACK_BASE_URL=https://api.uficonnect.org
```

Their effective OAuth pairs match for Discord, Figma, LinkedIn, X, GitHub, GitLab, YouTube, Dribbble, Twitch and TikTok; the persistent Bluesky signing key also matches. Mastodon registers an app on the member's chosen server. No existing keys were rotated or replaced. A presence check does not establish provider approval or a completed member authorization. The value-free audit is in `.cache/crosspost-provider-key-audit-2026-11-04.json`.

## Missing provider-issued keys

These five pairs are absent from both services and the available local credential source. Obtain actual issued credentials in the provider dashboard, then save the matching pair to the API and pipeline server environments. Empty template values are in [deploy/source-publishing.env.example](../deploy/source-publishing.env.example); do not upload empty values over existing settings.

| Provider dashboard | Settings to fill | Exact redirect URI |
| --- | --- | --- |
| [Meta apps — Facebook Login](https://developers.facebook.com/apps/) | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | `https://api.uficonnect.org/auth/social/facebook/callback` |
| [Meta apps — Instagram with Facebook Login](https://developers.facebook.com/apps/) | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | `https://api.uficonnect.org/auth/social/instagram/callback` |
| [Meta apps — Threads](https://developers.facebook.com/apps/) | `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET` | `https://api.uficonnect.org/auth/social/threads/callback` |
| [Reddit apps](https://www.reddit.com/prefs/apps) | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | `https://api.uficonnect.org/auth/social/reddit/callback` |
| [Medium integrations](https://medium.com/me/settings/security) | `MEDIUM_CLIENT_ID`, `MEDIUM_CLIENT_SECRET` | `https://api.uficonnect.org/auth/social/medium/callback` |

Meta, Reddit and Medium do not have a verified sign-in in the available browser profile. The owner chose to prepare this setup and list remaining dashboards; no new sign-in was started. Medium requires an existing approved legacy integration. Use app name `UFIConnect`, homepage `https://uficonnect.org/`, privacy policy `https://uficonnect.org/privacy`, terms `https://uficonnect.org/terms`, and deletion instructions `https://uficonnect.org/policies#retention` when registering the existing website integration. Facebook's installed adapter connects a profile; it does not implement Facebook Page publishing. Adding its keys alone cannot enable Page publishing. Instagram's adapter requires a professional account linked to a Facebook Page. Reddit access and Dribbble/Medium approval gates remain separate from key presence.

## Existing apps and redirects

The 17 installed account adapters are `discord`, `figma`, `linkedin`, `twitter`, `facebook`, `instagram`, `github`, `gitlab`, `youtube`, `reddit`, `medium`, `dribbble`, `twitch`, `threads`, `tiktok`, `bluesky` and `mastodon`. Every source callback uses the same pattern, with the exact installed provider ID: `https://api.uficonnect.org/auth/social/<provider>/callback` (`twitter` for X).

The saved Google browser profile opened the `uficonnect` project and confirmed the existing `uficonnect` web client already registers `https://api.uficonnect.org/auth/social/youtube/callback`. Its client ID matches the live API's YouTube client. The API has no dedicated `GOOGLE_*` pair, so Google sign-in currently reuses that same callback. Adding `/auth/providers/google/callback` is unnecessary for the current configuration; attempts to edit the existing client were read-only and no redirect change was saved. If a dedicated Google pair is introduced later, use a client that registers `https://api.uficonnect.org/auth/providers/google/callback` and an account allowed to edit it. [Google client dashboard](https://console.cloud.google.com/auth/clients?project=uficonnect).

The GitHub browser check found no organization-owned OAuth apps. It reached the authorized-app view for UFIConnect, owned by `yosufkaka99-alt`, which exposes revoke controls rather than the callback configuration. No app was edited and its registered callback was not verified. Open the app owner's [OAuth developer settings](https://github.com/settings/developers) and verify `https://api.uficonnect.org/auth/social/github/callback`; the authorized-app page is not the developer configuration. This does not establish that the signed-in account lacks developer permission.

Other existing app dashboards still need sign-in to inspect their registrations: [Discord](https://discord.com/developers/applications), [Figma](https://www.figma.com/developers/apps), [LinkedIn](https://www.linkedin.com/developers/apps), [X](https://console.x.com/), [GitLab](https://gitlab.com/-/profile/applications), [Dribbble](https://dribbble.com/account/applications), [Twitch](https://dev.twitch.tv/console/apps), and [TikTok](https://developers.tiktok.com/apps/). They already have backend credentials; their dashboard redirects have not been verified in this task. Bluesky's metadata/JWKS and Mastodon's dynamic registration do not use a central app dashboard.

## TikTok direct publishing

The implementation now requests `user.info.basic,video.list,video.publish` and sends photos using `DIRECT_POST`. Existing `video.upload` inbox grants must be reconnected to obtain direct publishing permission. The member reviews the connected creator, chooses an available audience, configures comments/music/content disclosures, and authorizes the post before sending. No audience is chosen automatically.

In [TikTok Manage apps](https://developers.tiktok.com/apps/), register `https://api.uficonnect.org/auth/social/tiktok/callback`, enable the approved Content Posting API Direct Post capability and `video.publish` scope, and verify ownership of the uploaded-photo URL prefix used by this app: `https://res.cloudinary.com/d7pakrhp/image/upload/`. If TikTok cannot verify that hosted prefix, an owned media-host integration is needed before photo posting can succeed. Keys cannot substitute for app review or domain verification.

TikTok accepts the request asynchronously. New deliveries remain `processing` until provider status confirms publication. Existing inbox drafts stay `handoff` and require completion inside TikTok. History refresh checks each delivery; a draft or accepted request is never labeled posted. Other sources without an installed publishing adapter stay locked, even if their public articles or website links appear in the source directory.

## Validation and release

The original workspace passed 66 targeted backend/source tests, including retries of two files affected by cold Windows fixture startup timeouts. The isolated release was then rechecked against current main with 42 targeted tests. These cover direct posting, scope upgrade failures, creator/audience/consent checks, pending status, legacy draft tracking, callbacks, stable connected-first ordering and authorization locks. The isolated release JavaScript reference check passed for 835 files, and the production web build/prerender passed. The browser audit passed 98 publishing checks at 1440, 390 and 320 pixels for Pro and Business, with no runtime errors; screenshots are in `.cache/audit-ui/publishing-*.png`. A focused browser audit also passed TikTok creator/visibility/consent controls, consent reset, processing status, retention of failed drafts and retrying only the failed destination without duplicating TikTok. Its screenshot is `.cache/audit-ui/crosspost-tiktok-consent-390.png`. Browser tests use fixtures and mocked publishing. These are prepared release checks. No live member publication was performed; production rollout status is recorded separately.
