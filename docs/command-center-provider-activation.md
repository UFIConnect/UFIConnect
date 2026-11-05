# Command Center account activation

OAuth connection buttons follow credential availability. Provider review, allowed redirect URLs, account eligibility, and user consent determine whether authorization and publishing succeed. This release expands the non-Meta destinations below; Facebook, Instagram, and Threads setup is outside this release's scope.

| Provider | Publishing destination and grant | Required credentials or access | Exact production callback |
| --- | --- | --- | --- |
| Bluesky | Connected account; `atproto transition:generic transition:chat.bsky` | Persistent `BLUESKY_SIGNING_KEY`; member OAuth consent | `https://api.uficonnect.org/auth/social/bluesky/callback` |
| Mastodon | Member's instance/account; `read:accounts read:statuses read:search read:bookmarks write:favourites write:statuses` | Dynamic app registration on the member's instance | `https://api.uficonnect.org/auth/social/mastodon/callback` |
| LinkedIn | Member post; `openid profile email w_member_social` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`; OpenID Connect and Share on LinkedIn products | `https://api.uficonnect.org/auth/social/linkedin/callback` |
| X | Member text/link post; `tweet.read tweet.write users.read offline.access` | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` or `X_CLIENT_ID`, `X_CLIENT_SECRET`; API access/credits | `https://api.uficonnect.org/auth/social/twitter/callback` |
| Reddit | Selected subreddit post; `identity read submit privatemessages` | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`; actual provider approval for API/commercial use | `https://api.uficonnect.org/auth/social/reddit/callback` |
| TikTok | Photo Direct Post; `user.info.basic,video.list,video.publish` | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`; Content Posting product, scope approval, creator settings and media-prefix verification | `https://api.uficonnect.org/auth/social/tiktok/callback` |
| GitHub | Release on a selected public repository and existing tag; `read:user public_repo notifications` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`; member repository push permission | `https://api.uficonnect.org/auth/social/github/callback` |
| GitLab | Release on a selected project and existing tag; `read_user api` | `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`; member project write access | `https://api.uficonnect.org/auth/social/gitlab/callback` |
| Discord | Message through the authorized server-channel webhook; `identify webhook.incoming` | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`; member selects an eligible channel during OAuth | `https://api.uficonnect.org/auth/social/discord/callback` |
| Twitch | Chat message in the member's own channel; `user:read:follows user:write:chat` | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`; member chat authorization | `https://api.uficonnect.org/auth/social/twitch/callback` |
| Figma | Comment on an accessible file; `current_user:read file_comments:read file_comments:write` | `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`; PKCE and file access | `https://api.uficonnect.org/auth/social/figma/callback` |
| YouTube | Video upload to the selected channel; `https://www.googleapis.com/auth/youtube.readonly` and `https://www.googleapis.com/auth/youtube.upload` | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`; Google OAuth/API review and channel eligibility | `https://api.uficonnect.org/auth/social/youtube/callback` |
| Pinterest | Image Pin on a selected public board; `user_accounts:read,boards:read,pins:read,pins:write` | `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`; verified Standard access recorded with `PINTEREST_STANDARD_ACCESS_APPROVED=true` | `https://api.uficonnect.org/auth/social/pinterest/callback` |
| Tumblr | Published NPF post on a selected public blog; `basic write offline_access` | `TUMBLR_CLIENT_ID`, `TUMBLR_CLIENT_SECRET`; registered OAuth2 redirect | `https://api.uficonnect.org/auth/social/tumblr/callback` |
| WordPress.com | Published article on a public site with `publish_posts`; `users sites posts media` | `WORDPRESS_CLIENT_ID`, `WORDPRESS_CLIENT_SECRET`; member site publication capability | `https://api.uficonnect.org/auth/social/wordpress/callback` |
| DEV Community | Published article on the API-key owner's profile | Member personal API key, verified through `/api/users/me`, encrypted in their account; no shared operator key | None; API-key connection |
| Hashnode | Article in an eligible Pro publication the token owner can publish to | Member personal access token, verified account and publication role; encrypted in their account | None; API-key connection |
| Medium | Public article on the legacy integration owner's profile; `basicProfile,publishPost` | Existing `MEDIUM_CLIENT_ID`, `MEDIUM_CLIENT_SECRET` and verified legacy access recorded with `MEDIUM_LEGACY_ACCESS_APPROVED=true` | `https://api.uficonnect.org/auth/social/medium/callback` |
| Dribbble | Image shot on the connected eligible profile; `public upload` | `DRIBBBLE_CLIENT_ID`, `DRIBBBLE_CLIENT_SECRET`; written permission for this use recorded with `DRIBBBLE_USE_APPROVED=true`, account eligible to upload | `https://api.uficonnect.org/auth/social/dribbble/callback` |

Register each complete callback above in its provider dashboard. Credentials belong to the same app as the registered callback; they are secrets, not account permissions. OAuth writes are requested in context through `/auth/social/<provider>/start?publishing=1`. Ordinary Discord/Figma/GitLab/YouTube/Twitch/Medium/Dribbble connections retain their existing read/profile scopes. New ordinary connections request Pinterest `user_accounts:read,boards:read,pins:read`, Tumblr `basic offline_access`, and WordPress.com `users sites`; publishing adds the write scopes listed in the table. Existing profile-only connections must reconnect from the publishing settings to authorize writes. Signed state and a browser-bound cookie carry the publishing intent through the callback.

The composer requires the destination and provider-specific fields before submission. The server rechecks that destination immediately before writing. GitHub/GitLab release publishing uses an existing tag and creates no code or tags. Discord disables mentions and uses only the webhook granted during authorization. Twitch sends chat, Figma creates a file comment, and YouTube uploads video; these actions do not create Twitch streams or Figma Community resources. WordPress.com sets `publicize:false` so the provider's separate sharing connections do not duplicate this cross-post. Dribbble images are padded to 800 × 600 without cropping and limited to 8 MB. YouTube uploads are limited to 64 MB in this implementation.

Keep provider approvals truthful. Pinterest Trial Pins are visible only to their creator as Sandbox entities; Standard access is required for production/public Pins, and a denied or locked app must be restored by Pinterest. Medium accepts no new integrations or tokens; this adapter supports only verified existing legacy integrations. No deployment or approval flag creates these provider-issued rights. These providers stay unavailable until the actual access and credentials exist.

Delivery is `posted` only with a created provider receipt and confirmed published state. Accepted uploads remain `processing`; created drafts, private posts, and editorial-pending results remain `handoff` with their receipt. These outcomes are retained so submitting again does not duplicate an already-created object. The application does not automatically retry provider writes with uncertain delivery.

TikTok Direct Post requires enabling the Content Posting API product and its Direct Post configuration, approval for `video.publish`, and a fresh member connection granting that scope. Older `video.upload` connections can still read their existing inbox-handoff history but must reconnect before creating direct posts. The composer fetches current creator information, shows the destination account, requires an audience choice with no default, and asks for interaction, commercial-content and consent settings before sending. The server repeats the creator check and validates these choices immediately before publishing. An accepted request is `processing`, then becomes `posted` only when TikTok reports `PUBLISH_COMPLETE`; history also tracks existing inbox handoffs.

TikTok pulls photos from `https://res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>/image/upload/`. That exact URL prefix must pass TikTok's ownership verification; if it cannot be verified with the hosting provider, a verified owned media host is required before this photo route can succeed. The OAuth callback's domain does not establish media-URL ownership. Unaudited clients retain TikTok's private-account/private-viewing restrictions. No local credential or configuration flag grants provider approval. See the official [photo API](https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post), [creator-info API](https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info), and [required publishing controls](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

API keys for public feeds, such as USAJobs search, do not authorize a user's private account. Providers without a complete adapter or required credentials remain unavailable. Business accounts keep their career-only catalog and cannot call the social Cross Post API with retained tokens.

AI Content uses `backend/content-platforms.json` for its 23 targets, imported by both the server and web app. Drafting and copying a platform-specific result does not require connecting that platform. Direct publishing stays tied to the server's capability catalog.

Generic OAuth callbacks require the browser cookie bound to the signed state. A failed profile check cannot replace a stored connection. Tests use synthetic credentials and mocked generation/publishing.

X also accepts the existing `X_CLIENT_KEY` setting as an OAuth 2.0 client ID; it never substitutes `X_API_KEY` or an app bearer token. Canonical `TWITTER_*` settings take precedence. Authorization and refresh use X's current endpoints and PKCE. X's state uses authenticated encryption with a ten-minute expiry so it fits the provider's 500-character limit. The browser cookie remains required, and in-flight legacy JWT states remain valid until expiry. Register `https://api.uficonnect.org/auth/social/twitter/callback` on the same X app as the client credentials. Users must approve the connection; Following access is subject to the app's X API access and available credits.

LinkedIn verifies the member identity through OpenID Connect before saving an account connection. LinkedIn feed import stays unavailable; these permissions authorize basic profile access and sharing.

## Provider references

- [LinkedIn sharing permissions](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- [X OAuth 2.0 and PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [TikTok scopes](https://developers.tiktok.com/doc/tiktok-api-scopes)
- [Discord OAuth](https://docs.discord.com/developers/topics/oauth2)
- [Figma OAuth apps](https://developers.figma.com/docs/rest-api/oauth-apps/)
- [GitHub releases](https://docs.github.com/en/rest/releases/releases#create-a-release)
- [GitLab releases](https://docs.gitlab.com/api/releases/#create-a-release)
- [Twitch send chat message](https://dev.twitch.tv/docs/api/reference/#send-chat-message)
- [Figma file comments](https://developers.figma.com/docs/rest-api/comments-endpoints/)
- [YouTube uploads](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Pinterest authentication](https://developer.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/), [Pin publishing](https://dev.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/), and [access tiers](https://developer.pinterest.com/docs/key-concepts/access-tiers/)
- [Tumblr OAuth2 and NPF post creation](https://github.com/tumblr/docs/blob/master/api.md)
- [WordPress.com OAuth](https://developer.wordpress.com/docs/api/oauth2/) and [post creation](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/posts/new/)
- [DEV Community/Forem API](https://developers.forem.com/api/v1)
- [Medium current API policy](https://help.medium.com/hc/en-us/articles/213480228-API-Importing) and [legacy OAuth](https://github.com/Medium/medium-api-docs#22-browser-based-authentication)
- [Dribbble OAuth](https://developer.dribbble.com/v2/oauth/) and [shot uploads](https://developer.dribbble.com/v2/shots/#create-a-shot)
