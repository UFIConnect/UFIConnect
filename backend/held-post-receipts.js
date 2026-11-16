'use strict';

// One staged copy can belong to one review version. Older staging rows have no
// version marker, so use the most recent pending receipt for that ID.
function pendingStagedReceipts(where = 'TRUE') {
  return `SELECT DISTINCT ON (a.post_id) a.post_id,a.review_version,a.topic,a.subtopic,a.original_post
    FROM office_unknown_topic_manual_assignments a JOIN feed_posts_staging s ON s.id=a.post_id
    WHERE a.processed_at IS NULL AND (s.held_review_version IS NULL OR s.held_review_version=a.review_version)
      AND (${where})
    ORDER BY a.post_id,a.assigned_at DESC,a.review_version DESC`;
}

async function pendingReceiptsForStage(client, ids) {
  if (!ids.length) return [];
  const { rows } = await client.query("SELECT to_regclass('office_unknown_topic_manual_assignments') AS relation");
  if (!rows[0]?.relation) return [];
  return (await client.query(pendingStagedReceipts('s.id=ANY($1::text[])'), [ids])).rows;
}

async function pendingReceiptsForRemoval(client, removed) {
  if (!removed.length) return [];
  const { rows } = await client.query("SELECT to_regclass('office_unknown_topic_manual_assignments') AS relation");
  if (!rows[0]?.relation) return [];
  return (await client.query(`SELECT DISTINCT ON (a.post_id) a.post_id,a.review_version
    FROM jsonb_to_recordset($1::jsonb) AS s(id TEXT,held_review_version TEXT)
    JOIN office_unknown_topic_manual_assignments a ON a.post_id=s.id
    WHERE a.processed_at IS NULL AND (s.held_review_version IS NULL OR s.held_review_version=a.review_version)
    ORDER BY a.post_id,a.assigned_at DESC,a.review_version DESC`, [JSON.stringify(removed)])).rows;
}

function materialReviewChange(row, receipt) {
  return ['source', 'source_url', 'title', 'content', 'media_url', 'media_type', 'media_poster', 'group_id']
    .some(field => (row[field] ?? null) !== (receipt.original_post[field] ?? null));
}

async function preserveStagedPostsForReview(client, rows, reason) {
  if (!rows.length) return;
  const posts = rows.map(({ held_review_version, ...row }) => row);
  await client.query(`INSERT INTO office_unknown_topic_review AS review(post_id,post,reason)
    SELECT post->>'id',post,$2
    FROM jsonb_array_elements($1::jsonb) AS x(post) ORDER BY post->>'id'
    ON CONFLICT(post_id) DO UPDATE SET post=EXCLUDED.post,reason=EXCLUDED.reason,
      resolved_at=NULL,last_held_at=NOW(),checked_at=NULL,retry_at=NOW()
    WHERE review.resolved_at IS NOT NULL OR
      COALESCE((review.post->>'fetched_at')::timestamptz,'epoch')<=
      COALESCE((EXCLUDED.post->>'fetched_at')::timestamptz,'epoch')`, [JSON.stringify(posts), reason]);
}

module.exports = { pendingStagedReceipts, pendingReceiptsForStage, pendingReceiptsForRemoval, materialReviewChange, preserveStagedPostsForReview };
