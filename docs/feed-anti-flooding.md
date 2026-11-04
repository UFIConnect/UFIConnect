# Feed collection and admission limits

Office → Feed Audit → Anti flooding saves `sourcePullLimits` alongside the existing post, author, duplicate, and approval settings. Both Configure anti flooding buttons open this form. Partial updates preserve unrelated settings and source blocks. Older stored policies receive the default pull map without a migration.

These are application pull-job ceilings from the requested schedule, aggregated across the former shards. Jobs are evenly spaced and never overlap for the same source. Automatic collection, refresh requests, and nudges share the gate. Existing slower collection intervals, caches, provider quotas, and `Retry-After` can reduce the actual rate. A pull job can contain multiple HTTP requests; these numbers are not provider API quotas.

| Sources | Maximum pull jobs |
| --- | --- |
| Reddit | 8 / 15 seconds |
| Hacker News, Mastodon | 10 / 20 seconds |
| Bluesky | 12 / 30 seconds |
| DEV Community, Indeed, TechCrunch, The Verge | 12 / 60 seconds |
| Medium, YouTube, freeCodeCamp/Hashnode, Product Hunt, Ars Technica, WIRED, VentureBeat, Phoronix | 14 / 90 seconds |
| The Register, Remote OK, Behance | 18 / 120 seconds |
| Indie Hackers, Smashing Magazine, InfoQ, MIT Technology Review, GitLab, Y Combinator, Crunchbase, Design Web | 20 / 180 seconds |
| Lobsters | 16 / 240 seconds |
| GitHub, arXiv, USAJobs | 1 / 240 seconds |
| Stack Overflow, X, LinkedIn, Facebook | 1 / 300 seconds |
| Remotive, The Muse | 1 / 20 seconds |
| Condé Nast Traveler, We Work Remotely, Twitch | 1 / 60 seconds |
| Crossref, DataCite, Zenodo | 1 / 60 seconds |
| OpenAlex | 1 / 300 seconds |

Sources absent from the requested schedule use conservative budgets. Unknown future sources default to one pull per 300 seconds. Office can tighten ceilings but cannot increase them above this map. Pull ceilings remain active when post flood protection is disabled. Credential and display switches still control whether a source can collect; OpenAlex requires a server API key.

The saved policy is also the source of rate metadata in Office agents, source inventory, city inspectors and agent answers, and in the public Sources page. Responses include `pullLimit` and `pullLimitLabel`; `collectionIntervalMs` describes the scheduler interval separately. A query-cycle duration or cache lifetime must not be displayed as a pull limit. Metadata is calculated for each response so a saved change appears without restarting a service. Office includes all 44 configured sources; the public catalog includes 43 and excludes LinkedIn. Inventory counts include configured sources even when no posts have been observed, while observed-post counts retain their original meaning.

Fetched candidates enter the bounded Equalizer queue before admission. Known or queued IDs do not spend post quota. Only screened, admitted posts enter delivery caches and persistence. A source pauses collection when its remaining admission budget is already represented in the queue. Source/author quotas, approval cooldowns, and temporarily unavailable policy retain pending posts; explicit source blocks discard that source's queued supply. Existing queue capacity limits remain observable in backpressure counters.

RSS author identities use the supplied author rather than a shared source-wide placeholder. Unknown RSS authors still obey source and duplicate limits but do not share an invented author bucket. Cached legacy RSS identities receive the same treatment.

The collector runs in the single Pipeline process. Post counters and active pull timing are process-local; adding parallel Pipeline replicas would require a shared reservation store. API feed reads and job catalog reads consume admitted shared supply instead of fetching a second inventory.

Bluesky's [rate-limit documentation](https://bsky.network/docs/rate-limits/) distinguishes hosted PDS quotas from public AppView access and recommends the cached public AppView for public reads. Medium's [RSS documentation](https://help.medium.com/hc/en-us/articles/214874118-Using-RSS-feeds-of-profiles-publications-and-topics) supports profile, publication, and topic feeds without specifying a numerical polling quota. The table above represents UFIConnect settings.

Deploy API and Pipeline with this policy schema before saving the new map. An older reader rejects unknown policy keys. Verify both services report the same persisted map and `policyReady: true`, and verify Pipeline collection status reports effective spacing and pause reasons. Keep existing post/author settings and manual source blocks unless the operator explicitly changes them.
