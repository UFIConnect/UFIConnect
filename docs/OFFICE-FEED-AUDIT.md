# Office feed and activity controls

Open the existing authenticated Office at `https://office.uficonnect.org`.

- **Feed Audit** (`#feed-audit`): search retained approved, rejected and held imported posts; open each record for its text and screening reason. History is bounded to seven days and 10,000 records. Retained text is shortened for large posts. Historical decisions that were never retained cannot be reconstructed.
- **Topic Transfer** (`#topic-transfer`): select a topic and optional subtopic, then transfer up to three batches through existing screening. Optimize Unknown checks up to 500 staged and 500 cached posts per run, assigning evidence-backed topics/subtopics. Ambiguous posts remain Unknown.
- **Users** (`#users`): click an account name for recorded usage, monthly generation allowance, learned interests, and per-user optimization commands. Delivered posts are not verified views or time spent.

## Commands

The Feed Audit protection bundle enables the default anti flooding policy, reviews up to 2,000 current posts on each owning service, and expires temporary delivery snapshots. Each step is visible in the result. It does not refresh every external source or change approval decisions.

| Command | Effect |
| --- | --- |
| `feed.audit-review` | Review a bounded current feed sample. |
| `feed.audit-protect` | Apply the protection bundle. |
| `feed.flood-configure` | Save source/author burst limits, duplicate window, approval target, sample size and cooldown. |
| `source.block.<source>` | Persist a source block with an incident reason. |
| `source.unblock.<source>` | Remove a source block. |
| `feed.optimize-unknown` | Run bounded topic and subtopic classification. |
| `refresh-feed` (user usage) | Invalidate that user's temporary feed state across API workers. |
| `balance-interests` (user usage) | Reduce extreme learned weights while retaining explicit preferences. |

Approval is approved / evaluated. Flood holds are separate, and a target does not guarantee that percentage. Source policy is shared through the database and refreshed across workers every five seconds. Stale or unavailable policy must not publish imported posts. A temporary policy failure during staging transfer retains staged rows for retry.

## Suspicious device activity

The sixth distinct detected violation blocks further authenticated writes from the registered device. Supported detections are repetitive content, link spam, spam/solicitation, and explicit credential-harvesting attempts. Ordinary usage, invalid form lengths, and service failures do not add strikes. Identical activity/content retries count once; counts persist until an Office review resets them.

Devices use a signed HttpOnly browser cookie linked to verified account sessions. Clients without cookies fall back to their authenticated session. No IP address ban or hardware fingerprint is used. Clearing identity and creating a new session can evade this identifier; it is not a permanent hardware ban. Existing activity before this release is not backfilled into strikes.

Feed Audit and each user's usage view show device strike counts and recent reasons. **Review and unblock device** requires a review reason, resets the count and preserves previous events and the review record. Event records contain rule names and activity paths, not the submitted content; deduplication uses keyed hashes.

Office data and all mutation routes retain existing Office-token authentication. Publishing the Office frontend does not expose private user usage or admin actions without authentication.
