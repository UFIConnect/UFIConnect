# Command Center Content History

AI Content Hub and Media Studio now save generated results to the primary database,
scoped by member ID. Each request retains its prompt, settings, timestamp, complete
caption/hashtag sets or media reference, and completion status.

## Access

- Previous content supports search, type filters, newest-first cursor pagination,
  expanded previews, copy/download, prompt reuse, and media reuse in Cross-Post.
- Previously saved work remains readable after a membership expires. New generation
  still requires a paid plan. Guests and other members cannot access a member's history.
- History endpoints are private/no-store and never fall back to another member's data
  or return a successful empty list during a database outage.
- Account data export includes history; account deletion removes history records.
  Media reused in existing public posts is not destroyed by history-record cleanup.

## Storage And Recovery

- `generated-content.js` owns the additive `generated_content` migration. Startup runs
  it through the existing database migration path. No existing account rows are changed.
- Images and custom-provider video results are copied into existing Cloudinary storage
  before success is returned. The database stores metadata/URLs, not media blobs.
- OpenAI video job IDs are saved for their member. A bounded API-role worker checks two
  pending jobs per 15-second sweep and streams completed video into Cloudinary, even
  after the initiating browser closes. Database leases prevent concurrent uploads.
- Reopening a saved video does not need the old browser ticket or generate another video.
- Storage uses deterministic per-owner, per-history-item IDs with overwrite disabled.
  There is no feed-cache age/count pruning of generated history or its media.
- The existing `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
  `CLOUDINARY_API_SECRET` must be configured. Generation is refused before a paid
  provider call when storage or the database is unavailable.
- Images and videos use the same Cloudinary public delivery convention as existing
  Cross-Post uploads. History is member-private; a copied media URL can be shared.

## Boundaries

This saves newly generated work. Older AI results existed only in browser state;
there is no trustworthy ownership/history record from which to reconstruct them.
Old unindexed uploads cannot be silently assigned to a member. No recovery of those
previously lost drafts is claimed.

Generation or storage can still fail. Failed records retain their prompt. A failed
draft write returns its generated text with an explicit save error, not a false
saved status. The browser can still copy it. Video recovery stops when the provider
reports an expired/missing job or retries exceed 24 hours; the history is not deleted.

## Verification

- `npm test --prefix backend`: real PostgreSQL (PGlite) history migration, ownership,
  restart/revisit, expiration, pagination, failures, video leases, and mocked provider/storage flows.
- `node scripts/audit-content-history.mjs`: desktop/tablet/mobile generation, tab
  navigation, reload, history previews, copy/download, reuse, Cross-Post handoff,
  expired-plan access, and error/retry. Provider generation is mocked, not billed.
- `node scripts/audit-ui.mjs`: existing responsive workflow regression coverage.
- `node scripts/preview-content-history.mjs`: isolated local preview on port 5195
  (or the next free port), using template drafts and sample media. Its PostgreSQL
  data is kept under `.cache/content-history-preview`; it cannot access production.

Provider behavior checked against the official [Cloudinary upload documentation](https://cloudinary.com/documentation/node_image_and_video_upload)
and [OpenAI video reference](https://developers.openai.com/api/reference/resources/videos).
