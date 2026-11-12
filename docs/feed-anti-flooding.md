# Feed collection and admission limits

Office → Feed Audit → Anti flooding saves `sourcePullLimits` alongside the existing post, author, duplicate, and approval settings. Both Configure anti flooding buttons open this form. Partial updates preserve unrelated settings and source blocks. Older stored policies receive the default pull map without a migration.

The [source pull schedule](SOURCE-PULL-SCHEDULE.md) lists the pull-job ceiling and base collection interval for each source. Automatic collection, refresh requests, and nudges share the gate. A pull job can contain multiple provider requests. Office accepts saved rates at or below the listed ceilings. Pull ceilings remain active when post flood protection is disabled. OpenAlex requires a server API key.

The saved policy is also the source of rate metadata in Office agents, source inventory, city inspectors and agent answers, and in the public Sources page. Responses include `pullLimit` and `pullLimitLabel`; `collectionIntervalMs` describes the scheduler interval separately. A query-cycle duration or cache lifetime must not be displayed as a pull limit. Metadata is calculated for each response so a saved change appears without restarting a service. Office includes all 44 configured sources; the public catalog includes 43 and excludes LinkedIn. Inventory counts include configured sources even when no posts have been observed, while observed-post counts retain their original meaning.

Fetched candidates enter the bounded Equalizer queue before admission. Known or queued IDs do not spend post quota. Only screened, admitted posts enter delivery caches and persistence. A source pauses collection when its remaining admission budget is already represented in the queue. Source/author quotas, approval cooldowns, and temporarily unavailable policy retain pending posts; explicit source blocks discard that source's queued supply. Existing queue capacity limits remain observable in backpressure counters.

RSS author identities use the supplied author rather than a shared source-wide placeholder. Unknown RSS authors still obey source and duplicate limits but do not share an invented author bucket. Cached legacy RSS identities receive the same treatment.

The collector runs in the single Pipeline process. Post counters and active pull timing are process-local; adding parallel Pipeline replicas would require a shared reservation store. API feed reads and job catalog reads consume admitted shared supply instead of fetching a second inventory.

Bluesky's [rate-limit documentation](https://bsky.network/docs/rate-limits/) distinguishes hosted PDS quotas from public AppView access and recommends the cached public AppView for public reads. Medium's [RSS documentation](https://help.medium.com/hc/en-us/articles/214874118-Using-RSS-feeds-of-profiles-publications-and-topics) supports profile, publication, and topic feeds without specifying a numerical polling quota. The table above represents UFIConnect settings.

Deploy API and Pipeline with this policy schema before saving the new map. An older reader rejects unknown policy keys. Verify both services report the same persisted map and `policyReady: true`, and verify Pipeline collection status reports effective spacing and pause reasons. Keep existing post/author settings and manual source blocks unless the operator explicitly changes them.
