# Review held posts by group

In Office, open **Transfer by Topic → View held posts**. The queue opens with automatic groups, largest first. The API groups the backlog continuously and Office shows its progress when the panel is open.

Use **Find topics or posts** and **Source** to narrow the queue. Groups use suggested topics, competing topics, hashtags, shared words, or a source bucket when descriptive text is unavailable. These are review aids; a group does not guarantee that all its members belong to the same topic.

Open a group to inspect post text and media. Select individual posts, the current page, or **Select all posts in this group**. Whole-group selection prepares a fixed selection before assignment. You can inspect additional pages and remove individual posts from that selection.

Search **Topic for selected posts** by topic or subtopic, choose an available topic, and press **Assign … selected posts**. Once **Assignment in progress** appears, the API has saved the selected versions and runs them in batches of 100. You can leave Office and see the run when you return. **Stop after this batch** stops the remaining selection and preserves completed assignments. Changed, resolved, or conflicting posts remain available for another review. Each accepted post passes through the usual screening and transfer process.

After assigning topics, use **Distribute all assigned** in the held-post review panel. The button includes staged assignments across all topics and sources, regardless of the review filters. Office reports assignments whose staging copy is missing separately. Their original content remains in the assignment receipt for reconciliation. Scheduled transfers also continue normally.

Distribution saves the exact post IDs and review versions and continues after you leave Office. The run shows live-cache writes, screened posts, posts returned to review, and remaining work. It also shows existing live copies, destination conflicts, missing staging, and row failures when present. A collector refresh keeps the reviewed topic when the content matches. Materially changed content and row-specific storage failures remain available for review. Publication still follows the feed's normal visibility and retention rules. **Stop distribution after this batch** ends the requested run. Scheduled transfers continue handling assigned posts normally.

The **Topics and subtopics** section also has a search field to find topic coverage and prepare a focused transfer.

## Implementation and verification

Grouping stores derived metadata separately from the preserved posts. Each refresh indexes at most 500 pending records. A content hash and catalog version exclude stale metadata. Whole-group member pages return at most 1,000 identifiers and content versions; a monotonic indexing watermark excludes members indexed after selection began. Assignment checks each content version and retains an idempotent receipt.

Relevant checks:

```sh
node --test --test-concurrency=1 backend/unknown-topic-review.test.js backend/held-topic-groups.test.js backend/office-topic-classifier.test.js
node office/tests/topic-review-groups.browser.mjs
node --test --test-concurrency=1 backend/held-post-distribution.test.js backend/unknown-topic-promotion.test.js
node --test backend/held-post-jobs.test.js
node office/tests/held-distribution.browser.mjs
npm run build --prefix office
```

The browser checks use synthetic posts and cover read-only grouping progress, exact selections, completion after leaving the panel, authentication changes, and desktop/mobile layouts. The backend checks exercise queue recovery and transfer accounting with a synthetic database.
