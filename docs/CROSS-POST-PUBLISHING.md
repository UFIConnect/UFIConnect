# Cross-Post publishing

Cross-Post uses one draft and attachment, with selected destinations grouped by post format. Articles, releases, photos, videos, posts, and messages/comments share the fields their provider schemas have in common. Account destinations, audiences, privacy, notifications, and publication consent remain specific to each provider.

The composer lists ready destinations and selected destinations that need attention before the user submits. **Publish to N ready destinations** sends only the named ready set. Missing video, permission, account settings, or a shorter platform text limit does not prevent a different ready destination from publishing. Pending and failed destinations keep the draft so they can be completed in a later batch.

Current account names and available channels, repositories, blogs, and publications come from the authenticated provider APIs. A recommendation can select a sole verified destination or a destination from that member's successful UFIConnect publishing history, provided it remains in the current verified choices. No usage history is invented. Explicitly cleared choices stay cleared. Visibility, children's-content declarations, and audience consent are never supplied by a recommendation.

Posted, processing, and handoff receipts remove submitted destinations from the next batch. Missing receipts and interrupted writes require review rather than an immediate duplicate attempt. Draft and review state follow the existing owner-scoped, memory-only session boundary; a full page reload clears that memory. Connection and permission flows open separately so the active composer can stay open.

Backend tests exercise the actual publishing routes and adapters with intercepted provider transport. The browser audit exercises the real form and backend harness, including mixed ready/pending destinations, shared release settings, upload permission rejection, native and external receipt uncertainty, account changes, and subsequent batches. No production provider publication is part of automated verification.
