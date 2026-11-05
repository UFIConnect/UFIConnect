# Command Center account activation

OAuth connection buttons follow credential availability. Provider review, allowed redirect URLs, account eligibility, and user consent still determine whether a provider completes authorization.

| Provider | Implemented capability | Required credentials | Callback path |
| --- | --- | --- | --- |
| LinkedIn | Profile authorization and Cross Post with a confirmed created post ID | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `/auth/social/linkedin/callback` |
| X | Authorized Following timeline and text/link Cross Post | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` or `X_CLIENT_ID`, `X_CLIENT_SECRET` | `/auth/social/twitter/callback` |
| TikTok | Own public videos and direct photo publishing with creator-selected privacy | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `/auth/social/tiktok/callback` |
| Discord | Profile authorization | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | `/auth/social/discord/callback` |
| Figma | Profile authorization with PKCE | `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET` | `/auth/social/figma/callback` |

Production callbacks use `https://api.uficonnect.org`. Register the exact callback in each provider dashboard. Figma requests `current_user:read`; Discord requests `identify`. These profile connections do not import messages, create a personal feed, or publish content. TikTok requests `video.publish` for direct photo publishing. LinkedIn requires the OpenID Connect and Share on LinkedIn products.

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
