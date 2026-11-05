# Review held posts by group

In Office, open **Transfer by Topic → View held posts**. The queue opens with automatic groups, largest first. Grouping continues across the backlog while the panel is open, with progress displayed. Closing the panel pauses the work; opening it again resumes unfinished work.

Use **Find topics or posts** and **Source** to narrow the queue. Groups use suggested topics, competing topics, hashtags, shared words, or a source bucket when descriptive text is unavailable. These are review aids; a group does not guarantee that all its members belong to the same topic.

Open a group to inspect post text and media. Select individual posts, the current page, or **Select all posts in this group**. Whole-group selection prepares a fixed selection before assignment. You can inspect additional pages and remove individual posts from that selection.

Search **Topic for selected posts** by topic or subtopic, choose an available topic, and press **Assign … selected posts**. Large selections run in batches of 100 with progress and **Stop after this batch**. Completed batches remain queued if you stop. Changed, resolved, or conflicting posts are reported for another review. Each post keeps its content and passes through the usual screening and transfer process.

The **Topics and subtopics** section also has a search field to find topic coverage and prepare a focused transfer.

## Implementation and verification

Grouping stores derived metadata separately from the preserved posts. Each refresh indexes at most 500 pending records. A content hash and catalog version exclude stale metadata. Whole-group member pages return at most 1,000 identifiers and content versions; a monotonic indexing watermark excludes members indexed after selection began. Assignment checks each content version and retains an idempotent receipt.

Relevant checks:

```sh
node --test --test-concurrency=1 backend/unknown-topic-review.test.js backend/held-topic-groups.test.js backend/office-topic-classifier.test.js
node office/tests/topic-review-groups.browser.mjs
npm run build --prefix office
```

The browser check uses synthetic requests and does not assign production posts. It covers automatic indexing progress, search, exact batch selections, full-group selection, stale conflicts, authentication changes, and desktop/mobile layouts. The Office CI job runs it with the other browser checks.
