'use strict';

// Author checks use the persisted row; a stale feed cache cannot grant a write.
function registerNativePostManagement(app, {
  authenticate, limiter, db, screenMemberContent, fromRow, serialize,
  onUpdated = () => {}, onDeleted = () => {}, logger = console,
}) {
  const native = row => row && (row.source || 'uficonnect') === 'uficonnect';
  const unavailable = res => res.status(503).json({ message: 'Post changes are temporarily unavailable. Please try again.' });
  async function findOwned(req, res, query) {
    const { rows } = await query('SELECT * FROM community_posts WHERE id=$1', [req.params.postId]);
    const row = rows[0];
    if (!native(row)) { res.status(404).json({ message: 'Post not found.' }); return null; }
    if (row.author_id !== req.user.id) { res.status(403).json({ message: 'You can only change your own posts.' }); return null; }
    return row;
  }

  app.patch('/posts/:postId', authenticate, limiter, async (req, res) => {
    try {
      if (!db.isConnected()) return unavailable(res);
      const row = await findOwned(req, res, db.query.bind(db));
      if (!row) return;
      // Editing text never changes ownership, audience, attachments or counters.
      if (typeof req.body?.content !== 'string' || Object.keys(req.body).some(key => key !== 'content')) {
        return res.status(400).json({ message: 'Provide only the updated post text.' });
      }
      const content = req.body.content.trim();
      if (content.length > 2000 || (!content && (!row.media_url || row.media_type === 'video'))) {
        return res.status(400).json({ message: 'Use up to 2,000 characters and include text for posts without a photo.' });
      }
      const screening = await screenMemberContent({ content, mediaUrl: row.media_url, mediaType: row.media_type, kind: 'post_edit', maxLength: 2000 });
      if (!screening.allowed) return res.status(screening.reason === 'screening_unavailable' ? 503 : 422).json({
        message: screening.reason === 'screening_unavailable' ? 'Post screening is temporarily unavailable. Please try again.' : 'This post cannot be published.',
      });
      const { rows } = await db.query(
        "UPDATE community_posts SET content=$3 WHERE id=$1 AND author_id=$2 AND COALESCE(source,'uficonnect')='uficonnect' RETURNING *",
        [row.id, req.user.id, screening.content],
      );
      if (!rows[0]) return res.status(404).json({ message: 'Post not found.' });
      const post = fromRow(rows[0]);
      onUpdated(post);
      return res.json({ post: serialize(post, req.user.id) });
    } catch (error) {
      logger.error('PATCH /posts/:postId:', error.message);
      return res.status(500).json({ message: 'Could not save this post. Your previous post is unchanged.' });
    }
  });

  app.delete('/posts/:postId', authenticate, limiter, async (req, res) => {
    try {
      if (!db.isConnected()) return unavailable(res);
      const removed = await db.withClient(async client => {
        await client.query('BEGIN');
        try {
          // Lock the parent while deleting its discussion so a failed delete
          // rolls back the comments as well.
          const row = await findOwned(req, res, (sql, params) => client.query(sql + ' FOR UPDATE', params));
          if (!row) { await client.query('ROLLBACK'); return null; }
          await client.query('DELETE FROM post_comments WHERE post_id=$1', [row.id]);
          await client.query("DELETE FROM community_posts WHERE id=$1 AND author_id=$2 AND COALESCE(source,'uficonnect')='uficonnect'", [row.id, req.user.id]);
          await client.query('COMMIT');
          return row.id;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      if (!removed) return;
      onDeleted(removed);
      return res.json({ deleted: true });
    } catch (error) {
      logger.error('DELETE /posts/:postId:', error.message);
      return res.status(500).json({ message: 'Could not delete this post. Please try again.' });
    }
  });
}

module.exports = { registerNativePostManagement };
