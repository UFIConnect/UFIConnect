# Source pull schedule

The supplied reference photo described one scheduled pull per shard. Preserve
those counts, cap each shard interval at 20 seconds, and express the total as
`maxPulls / windowSeconds`. The scheduler spreads those slots across the window:
`ceil(windowSeconds * 1000 / maxPulls)` milliseconds between starts. It rotates
the existing inventory or query keys and permits only one in-flight job per source.
Shard counts describe the reference capacity; they do not create duplicate workers.

| Sources | Photo interval × shards | Integrated budget | Paced start interval |
| --- | --- | --- | --- |
| Reddit | 15s × 8 | 8 / 15s | 1.875s |
| Hacker News, Mastodon | 20s × 10 | 10 / 20s | 2s |
| Bluesky | 30s × 12 | 12 / 20s | 1.667s |
| DEV Community, Indeed, TechCrunch, The Verge | 60s × 12 | 12 / 20s | 1.667s |
| Medium, YouTube, freeCodeCamp/Hashnode, Product Hunt, Ars Technica, WIRED, VentureBeat, Phoronix | 90s × 14 | 14 / 20s | 1.429s |
| The Register, Remote OK, Behance | 120s × 18 | 18 / 20s | 1.112s |
| Indie Hackers, Smashing Magazine, InfoQ, MIT Tech Review, GitLab, Y Combinator, Crunchbase, Design Web | 180s × 20 | 20 / 20s | 1s |
| Lobsters | 240s × 16 | 16 / 20s | 1.25s |
| GitHub, arXiv, USAJobs | 240s × 1 | 1 / 20s | 20s |
| Stack Overflow | 300s × 1 | 1 / 20s | 20s |
| Remotive, The Muse | 20s, rotating categories | 1 / 20s | 20s |
| X, LinkedIn, Facebook | 300s × 1, credentials required | 1 / 20s when eligible | 20s |

Sites absent from the photo use comparable source groups:

| Added source | Comparable group | Integrated budget |
| --- | --- | --- |
| CN Traveler | News sites such as TechCrunch and The Verge | 12 / 20s |
| Twitch | Video, like YouTube | 14 / 20s |
| We Work Remotely | Job boards, like Remote OK | 18 / 20s |
| Crossref, DataCite, Zenodo, OpenAlex | Scholarly APIs, like arXiv | 1 / 20s |

These are scheduled capacities, not guarantees of network traffic or new posts.
Timer resolution, the global concurrency cap, caching, provider quotas,
Retry-After, quality cooldowns, intake backpressure and stricter saved settings
can slow collection. Sources missing required collector credentials remain
degraded (`setup_required`) and make no pulls. Existing member-only visibility
rules still apply. Feed equalizer weights remain independent of these budgets.

Saved-policy version 3 upgrades only exact version-2 defaults. Startup does not
rewrite existing settings during a rolling deployment. After both API and
Pipeline accept the new ceilings, `migratePhotoSourcePullLimits` upgrades the
shared policy once, preserving administrator overrides and other intake limits.
