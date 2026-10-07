# Command Center account activation

OAuth connection buttons follow credential availability. Provider review, allowed redirect URLs, account eligibility, and user consent still determine whether a provider completes authorization.

| Provider | Implemented capability | Required credentials | Callback path |
| --- | --- | --- | --- |
| LinkedIn | Profile authorization and Cross Post with a confirmed created post ID | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `/auth/social/linkedin/callback` |
| TikTok | Own public videos and photo handoff to the TikTok inbox | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `/auth/social/tiktok/callback` |
| Discord | Profile authorization | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | `/auth/social/discord/callback` |
| Figma | Profile authorization with PKCE | `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET` | `/auth/social/figma/callback` |

Production callbacks use `https://api.uficonnect.org`. Register the exact callback in each provider dashboard. Figma requests `current_user:read`; Discord requests `identify`. These profile connections do not import messages, create a personal feed, or publish content. TikTok requests `video.upload` for its existing inbox handoff rather than direct publishing access. LinkedIn requires the OpenID Connect and Share on LinkedIn products.

API keys for public feeds, such as USAJobs search, do not authorize a user's private account. Providers without a complete adapter or required credentials remain unavailable. Business accounts keep their career-only catalog and cannot call the social Cross Post API with retained tokens.

AI Content uses `backend/content-platforms.json` for its 23 targets, imported by both the server and web app. Drafting and copying a platform-specific result does not require connecting that platform. Direct publishing stays tied to the server's capability catalog.

Generic OAuth callbacks require the browser cookie bound to the signed state. A failed profile check cannot replace a stored connection. Tests use synthetic credentials and mocked generation/publishing.

## Provider references

- [LinkedIn sharing permissions](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- [TikTok scopes](https://developers.tiktok.com/doc/tiktok-api-scopes)
- [Discord OAuth](https://docs.discord.com/developers/topics/oauth2)
- [Figma OAuth apps](https://developers.figma.com/docs/rest-api/oauth-apps/)
