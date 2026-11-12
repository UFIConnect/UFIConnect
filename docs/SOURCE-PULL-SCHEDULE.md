# Source pull schedule

The Pipeline uses the updated pull windows and shard counts to schedule each
source between 12 and 25 seconds under normal conditions. Collectors rotate
distinct inventory keys with one job in flight per source. A collector with
fewer keys than shards gets more time between repeat checks.

| Sources | Default pull ceiling | Base collection interval |
| --- | --- | --- |
| Reddit | 8 / 15s | 12s |
| Bluesky | 12 / 20s | 15s |
| Medium, YouTube | 14 / 20s | 15s |
| GitHub, arXiv, USAJobs, Stack Overflow, OpenAlex, Crossref, DataCite, Zenodo, X, LinkedIn, Facebook, Remotive, The Muse | 1 / 20s | 20s |
| Hacker News, Mastodon | 10 / 20s | 22.25s |
| DEV Community, Indeed, TechCrunch, The Verge, CN Traveler | 12 / 20s | 22.75s |
| freeCodeCamp/Hashnode, Product Hunt, Ars Technica, WIRED, VentureBeat, Phoronix, Twitch | 14 / 20s | 23.25s |
| Lobsters | 16 / 20s | 23.75s |
| The Register, Remote OK, Behance, We Work Remotely | 18 / 20s | 24.25s |
| Indie Hackers, Smashing Magazine, InfoQ, MIT Tech Review, GitLab, Y Combinator, Crunchbase, Design Web | 20 / 20s | 24.75s |

When the posts-per-source limit is enabled, the latest successful batch can
increase the interval up to 25 seconds. At the default 300 posts per minute, a
batch of 100 candidates sets a 20-second minimum between starts. The Equalizer
enforces the saved per-source and per-author limits and pauses sources with a
full backlog.

Automatic collection and manual refreshes share these intervals and the same
global concurrency limit. Starts are spaced at least 250ms apart with four slots
or one second apart in pressure mode. Stricter saved pull ceilings, provider
Retry-After, intake backlog, and runtime protection can defer a pull beyond its
normal interval. Missing credentials produce a skipped setup check. LinkedIn
access is member-only. Office reports the effective interval alongside the saved ceiling.

Saved-policy version 3 upgrades only exact version-2 defaults. Startup does not
rewrite existing settings during a rolling deployment. After both API and
Pipeline accept the new ceilings, `migratePhotoSourcePullLimits` upgrades the
shared policy once, preserving administrator overrides and other intake limits.
