# Review held posts by group

In Office, open **Transfer by Topic → View held posts**. The queue opens with automatic groups, largest first. The API groups the backlog continuously and Office shows its progress when the panel is open.

The status shows how many pending posts were grouped, how many remain, failed posts, and the last progress time. Remaining work includes scheduled retries. A post that fails five attempts moves to the failed count and stays visible in individual review. **Retry grouping** requeues failed posts or resumes a paused worker. A clean completion requires zero remaining and zero failed posts.

Use **Find topics or posts** and **Source** to narrow the queue. Groups use suggested topics, competing topics, hashtags, shared words, or a source bucket when descriptive text is unavailable. These are review aids; a group does not guarantee that all its members belong to the same topic.

Open a group to inspect post text and media. Select individual posts, the current page, or **Select all posts in this group**. Whole-group selection prepares a fixed selection before assignment. You can inspect additional pages and remove individual posts from that selection.

Search **Topic for selected posts** by topic or subtopic, choose an available topic, and press **Assign … selected posts**. Once **Assignment in progress** appears, the API has saved the selected versions and runs them in batches of 100. You can leave Office and see the run when you return. **Stop after this batch** stops the remaining selection and preserves completed assignments. Changed, resolved, or conflicting posts remain available for another review. Each accepted post passes through the usual screening and transfer process.

After assigning topics, use **Distribute all assigned** in the held-post review panel. The button includes staged assignments across all topics and sources, regardless of the review filters. Office reports assignments whose staging copy is missing separately. Their original content remains in the assignment receipt for reconciliation. Scheduled transfers also continue normally.

Distribution saves the exact post IDs and review versions and continues after you leave Office. The run shows live-cache writes, screened posts, posts returned to review, and remaining work. It also shows existing live copies, destination conflicts, missing staging, and row failures when present. A collector refresh keeps the reviewed topic when the content matches. Materially changed content and row-specific storage failures remain available for review. Publication still follows the feed's normal visibility and retention rules. **Stop distribution after this batch** ends the requested run. Scheduled transfers continue handling assigned posts normally.

The **Topics and subtopics** section also has a search field to find topic coverage and prepare a focused transfer.

## Implementation and verification

The API worker runs every five seconds and indexes up to 200 posts per transaction. An indexed keyset scan advances through the held inventory that existed when the catalog run began. A queue trigger captures newly held, edited, and reopened posts, including arrivals that sort before the cursor. Group writes, queue removals, and the cursor commit together. A PostgreSQL transaction advisory lock serializes workers and releases on disconnect. Row locks and the review invalidation trigger keep suggestions current. The worker records five attempts with increasing delays for individual errors and pauses after five consecutive storage errors. Manual assignments continue to use the preserved review versions.

The shared Office and feed taxonomy adds curated subjects from the Discover group catalog. It treats normalized titles, hashtags, body text, source topic labels, and recognized public community subjects as evidence. An existing canonical parent takes precedence. Close parent or subject scores stay in review. General group categories remain available to reviewers who previously assigned them. The routing agents use the same taxonomy and preserve manual subtopic receipts during promotion.

Whole-group member pages return at most 1,000 identifiers and content versions. An indexing watermark excludes members indexed after selection began. Assignment checks each content version and keeps a receipt for the screening and promotion process.

### Database changes and rollout

| Database object | Purpose |
| --- | --- |
| `office_held_group_state` | Stores the active catalog version, scan range and cursor, last progress, and batch retry state. |
| `office_held_group_work` | Stores one queue entry per held post with due time, attempts, and failure status. Deleting a held post deletes its entry. |
| `office_held_group_due` and `office_held_group_failed` | Partial indexes support bounded selection of due work and explicitly retried failures. |
| `office_held_group_enqueue` and `office_held_group_requeue_stale` | Keep the queue current when a review changes or an older API worker writes stale derived metadata during rollout. |

The existing API startup migration creates the tables, indexes, and triggers. The first worker tick checkpoints the historical range and begins the metadata backfill. The routing-rule version also changes, so the existing bounded routing agents revisit live and staged assignments, and the held-post guardian can recover newly eligible posts through existing screening. This rollout requires approval for the production data changes as well as the deployment. A merge to `main` can trigger the existing production deployment workflows.

For an approved rollout, record the Office **Topics and subtopics** inventory and grouping progress before the release and again after the workers settle. Use the same counts for each topic, split by live, staged, and Unclassified, plus grouping indexed, remaining, and failed. Verify Office and public feed releases independently and reconcile receipt outcomes against a sample of recovered posts. Reverting the release is a code rollback. Any already-published or reclassified rows need explicit reconciliation using the saved inventory and receipts.

Relevant checks:

```sh
node --test --test-concurrency=1 backend/unknown-topic-review.test.js backend/held-topic-groups.test.js backend/office-topic-classifier.test.js
node office/tests/topic-review-groups.browser.mjs
node --test --test-concurrency=1 backend/held-post-distribution.test.js backend/unknown-topic-promotion.test.js
node --test backend/held-post-jobs.test.js
node office/tests/held-distribution.browser.mjs
npm run build --prefix office
```

To check connection loss and concurrent workers on PostgreSQL, set `HELD_GROUP_TEST_POSTGRES_URL` to a disposable loopback PostgreSQL database and run `node --test backend/held-topic-group-worker-postgres.test.js`. It uses a temporary schema and terminates only its own test connection.

The browser checks use synthetic posts and cover read-only grouping progress, exact selections, completion after leaving the panel, authentication changes, and desktop/mobile layouts. The backend checks exercise queue recovery and transfer accounting with a synthetic database.

### Issue #271 test results

A local PostgreSQL 18.6 run used the full 203-topic catalog and 38,000 synthetic held posts. The worker went from zero indexed and 38,000 remaining to 38,000 indexed, zero remaining, and zero failed in 191 ticks of up to 200 posts. The grouping run produced 9,500 posts each in Python / Web frameworks, Science & Research / Astronomy, Sports needing subtopic review, and a keyword group with insufficient subject evidence. The 19,000 ambiguous or evidence-poor posts in that fixture stayed available for review.

The promotion fixture started with five held posts and zero live posts. Four eligible posts reached the live cache after screening, including the manual assignment. One ambiguous post stayed held. Replaying the distribution snapshot wrote zero additional posts.
