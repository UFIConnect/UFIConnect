# Review held posts by group

In Office, open **Transfer by Topic → View held posts**. The queue opens with automatic groups, largest first. Grouping continues across the backlog while the panel is open, with progress displayed. Closing the panel pauses the work; opening it again resumes unfinished work.

Use **Find topics or posts** and **Source** to narrow the queue. Groups use suggested topics, competing topics, hashtags, shared words, or a source bucket when descriptive text is unavailable. These are review aids; a group does not guarantee that all its members belong to the same topic.

Open a group to inspect post text and media. Select individual posts, the current page, or **Select all posts in this group**. Whole-group selection prepares a fixed selection before assignment. You can inspect additional pages and remove individual posts from that selection.

Search **Topic for selected posts** by topic or subtopic, choose an available topic, and press **Assign … selected posts**. Large selections run in batches of 100 with progress and **Stop after this batch**. Completed batches remain queued if you stop. Changed, resolved, or conflicting posts are reported for another review. Each post keeps its content and passes through the usual screening and transfer process.

After assigning topics, use **Distribute all assigned** in the held-post review panel to publish the assigned backlog. The button shows how many assigned posts are waiting and works across all topics and sources, regardless of the current review filters. Each post keeps its original content and passes through the existing screening and feed publishing process. Scheduled transfers also continue normally.

Distribution runs in batches and displays the number published, screened out, returned for review, and still waiting. **Stop after this batch** keeps completed work and leaves the rest available for another run. Posts assigned after the run's snapshot can be handled by the next run. If another transfer is active or a request fails, refresh the assigned count before retrying; already processed posts are not created again.

The **Topics and subtopics** section also has a search field to find topic coverage and prepare a focused transfer.

## Implementation and verification

Grouping stores derived metadata separately from the preserved posts. Each refresh indexes at most 500 pending records. A content hash and catalog version exclude stale metadata. Whole-group member pages return at most 1,000 identifiers and content versions; a monotonic indexing watermark excludes members indexed after selection began. Assignment checks each content version and retains an idempotent receipt.

Relevant checks:

```sh
node --test --test-concurrency=1 backend/unknown-topic-review.test.js backend/held-topic-groups.test.js backend/office-topic-classifier.test.js
node office/tests/topic-review-groups.browser.mjs
node --test --test-concurrency=1 backend/held-post-distribution.test.js backend/unknown-topic-promotion.test.js
node office/tests/held-distribution.browser.mjs
npm run build --prefix office
```

The browser check uses synthetic requests and does not assign production posts. It covers automatic indexing progress, search, exact batch selections, full-group selection, stale conflicts, authentication changes, and desktop/mobile layouts. The Office CI job runs it with the other browser checks.
