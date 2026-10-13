'use strict';
const { reportSuppressionPredicate } = require('./content-reports');

// This queue repairs only existing bodies. It never inserts posts or updates
// source identity, engagement, media, timestamps or another writer's edits.
function createSourceContentRecoveryQueue({ db, tables = ['feed_posts_cache'], schedule = setTimeout }) {
  if (!tables.length || tables.some(table => !['feed_posts_cache', 'feed_posts_staging'].includes(table))) throw new Error('Invalid content recovery table');
  const pending = new Map();
  const maxEntries = 100, maxChars = 2_000_000, batchSize = 25;
  let chars = 0, timer = null, inFlight = false;
  const weight = value => value.content.length + value.previous_content.length;
  const remove = id => { const value = pending.get(id); if (value) chars -= weight(value); return pending.delete(id); };
  function scheduleFlush(delay = 150) {
    if (pending.size && !timer && !inFlight) timer = schedule(() => { timer = null; void flush(); }, delay);
  }
  function enqueue(recovery, authorProfileUrl) {
    const { post, previousContent, cachedPost } = recovery;
    const entry = { id: post.id, source: post.source, source_url: post.sourceUrl, previous_content: previousContent,
      content: post.content, author_name: post.author?.name || null, author_profile_url: authorProfileUrl || null, cachedPost };
    if (!entry.id || entry.source === 'uficonnect' || entry.content.length <= entry.previous_content.length) return false;
    remove(entry.id); pending.set(entry.id, entry); chars += weight(entry);
    while (pending.size > maxEntries || chars > maxChars) remove(pending.keys().next().value);
    scheduleFlush(); return pending.has(entry.id);
  }
  async function flush() {
    if (inFlight || !pending.size) return;
    timer = null; inFlight = true;
    const batch = [...pending.values()].slice(0, batchSize);
    for (const entry of batch) remove(entry.id);
    let retry = false;
    try {
      if (!db.isConnected()) throw new Error('Database unavailable');
      const rows = batch.map(({ cachedPost, ...row }) => row);
      for (const table of tables) {
        const result = await db.query(`WITH candidate AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id TEXT, source TEXT, source_url TEXT,
            previous_content TEXT, content TEXT, author_name TEXT, author_profile_url TEXT)
        ) UPDATE ${table} AS existing SET content = candidate.content FROM candidate
          WHERE existing.id = candidate.id AND existing.source = candidate.source
            AND existing.source_url = candidate.source_url
            AND existing.content IS NOT DISTINCT FROM candidate.previous_content
            AND length(candidate.content) > length(COALESCE(existing.content, ''))
            AND existing.author_name IS NOT DISTINCT FROM candidate.author_name
            AND existing.author_profile_url IS NOT DISTINCT FROM candidate.author_profile_url
            AND ${reportSuppressionPredicate('existing')}
          RETURNING existing.id`, [JSON.stringify(rows)]);
        const applied = new Set((result.rows || []).map(row => row.id));
        for (const entry of batch) {
          if (applied.has(entry.id) && entry.cachedPost.content === entry.previous_content) entry.cachedPost.content = entry.content;
        }
      }
    } catch {
      retry = true;
      for (const entry of batch) {
        if (pending.has(entry.id)) continue;
        pending.set(entry.id, entry); chars += weight(entry);
      }
      while (pending.size > maxEntries || chars > maxChars) remove(pending.keys().next().value);
    } finally {
      inFlight = false; scheduleFlush(retry ? 1500 : 150);
    }
  }
  return { enqueue, flush, get size() { return pending.size; }, get textChars() { return chars; } };
}
module.exports = { createSourceContentRecoveryQueue };
