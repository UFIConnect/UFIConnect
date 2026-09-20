# Likes and comments on connected sources

Feed cards and video comments can publish through a member's connected account.
The buttons name the destination. A successful response is shown only after
the provider confirms the action. These are not local UFIconnect reactions.

| Source | Reaction | Comment target |
| --- | --- | --- |
| Reddit | Upvote / remove upvote | Original submission |
| X | Like / unlike | Reply to the original post |
| Bluesky | Like / unlike | Reply preserving the thread root |
| YouTube | Like / remove rating | Top-level comment on the video |
| GitHub | Star / unstar repository | Issue or pull request conversation |
| GitLab.com | Star / unstar project | Issue or merge request notes |

Other sources continue to link to their original pages. Provider policies,
account access, disabled comments, app configuration, and API limits can prevent
a particular action. Errors do not claim that an action was published.

Read-only connections can be upgraded at `/connected-accounts?interactions=1`.
The provider's authorization screen explicitly requests the added permissions:
YouTube `youtube.force-ssl`, X `like.write`, Reddit `vote`, and GitLab `api`.
Normal connection flows keep their existing scopes. GitHub's existing
`public_repo` scope supports public repository actions; private access is not
requested by this feature. Bluesky uses the existing DPoP session transport.

No tokens or provider response bodies are returned to clients or written to
logs. Requests use fixed provider API origins and reject redirects. A bounded
per-member request cache deduplicates retries for ten minutes within a process;
after an uncertain network failure, check the original post before trying again.
Comments pass the same content screening as UFIconnect submissions. Tests use
mock providers and do not publish real interactions.

Provider references: [Reddit](https://www.reddit.com/dev/api/),
[X likes](https://docs.x.com/x-api/posts/likes/introduction),
[Bluesky records](https://github.com/bluesky-social/atproto/tree/main/lexicons/app/bsky/feed),
[YouTube ratings](https://developers.google.com/youtube/v3/docs/videos/rate),
[YouTube comments](https://developers.google.com/youtube/v3/docs/commentThreads/insert),
[GitHub stars](https://docs.github.com/en/rest/activity/starring),
[GitHub comments](https://docs.github.com/en/rest/issues/comments),
[GitLab stars](https://docs.gitlab.com/api/projects/),
[GitLab notes](https://docs.gitlab.com/api/notes/).
