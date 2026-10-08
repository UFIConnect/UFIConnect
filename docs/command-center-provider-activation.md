# Command Center account activation

OAuth connection buttons follow credential availability. Provider review, allowed redirect URLs, account eligibility, and user consent still determine whether a provider completes authorization.

| Provider | Implemented capability | Required credentials | Callback path |
| --- | --- | --- | --- |
| LinkedIn | Profile authorization and Cross Post with a confirmed created post ID | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `/auth/social/linkedin/callback` |
| X | Authorized Following timeline and text/link Cross Post | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` or `X_CLIENT_ID`, `X_CLIENT_SECRET` | `/auth/social/twitter/callback` |
| TikTok | Own public videos and photo handoff to the TikTok inbox | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `/auth/social/tiktok/callback` |
| Discord | Profile authorization | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | `/auth/social/discord/callback` |
| Figma | Profile authorization with PKCE | `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET` | `/auth/social/figma/callback` |

Production callbacks use `https://api.uficonnect.org`. Register the exact callback in each provider dashboard. Figma requests `current_user:read`; Discord requests `identify`. These profile connections do not import messages, create a personal feed, or publish content. TikTok requests `video.upload` for its existing inbox handoff rather than direct publishing access. LinkedIn requires the OpenID Connect and Share on LinkedIn products.

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
