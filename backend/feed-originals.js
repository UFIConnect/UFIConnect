'use strict';

// A provider's stored post ID is the first identity. For legacy aliases with
// different IDs, only collapse equivalent originals in the same route.
function distinctFeedOriginalSql(alias) {
  return `(${alias}.source_url IS NULL OR ${alias}.source_url !~* '^https?://' OR ${alias}.source='uficonnect'
    OR NOT EXISTS (
      SELECT 1 FROM feed_posts_cache original
      WHERE original.source=${alias}.source AND original.source_url IS NOT NULL
        AND md5(original.source_url)=md5(${alias}.source_url) AND original.source_url=${alias}.source_url
        AND original.id !~* '(_fallback$|_social$|^social_|^indeed_j[0-9]+$|^govt_g[0-9]+$)'
        AND LOWER(original.topic) IS NOT DISTINCT FROM LOWER(${alias}.topic)
        AND original.group_id IS NOT DISTINCT FROM ${alias}.group_id
        AND original.title IS NOT DISTINCT FROM ${alias}.title AND original.content IS NOT DISTINCT FROM ${alias}.content
        AND original.media_url IS NOT DISTINCT FROM ${alias}.media_url
        AND original.media_type IS NOT DISTINCT FROM ${alias}.media_type
        AND original.media_poster IS NOT DISTINCT FROM ${alias}.media_poster
        AND original.video_duration_seconds IS NOT DISTINCT FROM ${alias}.video_duration_seconds
        AND (COALESCE(original.post_created_at,'-infinity'),original.id) >
            (COALESCE(${alias}.post_created_at,'-infinity'),${alias}.id)
    ))`;
}

function distinctFeedOriginals(posts) {
  const ids = new Set(), originals = new Map();
  return posts.filter(post => {
    if (!post) return false;
    if (post.id && ids.has(post.id)) return false;
    if (post.id) ids.add(post.id);
    if (post.isExternal !== true || post.source === 'uficonnect' || !/^https?:\/\//i.test(post.sourceUrl || '')) return true;
    const topic = typeof post.topic === 'string' ? post.topic.toLowerCase() : null;
    const key = JSON.stringify([post.source, post.sourceUrl, topic, post.groupId]);
    const copies = originals.get(key) || [];
    if (copies.some(copy => copy.title === post.title && copy.content === post.content
      && copy.mediaUrl === post.mediaUrl && copy.mediaType === post.mediaType && copy.mediaPoster === post.mediaPoster
      && copy.videoDurationSeconds === post.videoDurationSeconds)) return false;
    copies.push(post);
    originals.set(key, copies);
    return true;
  });
}

module.exports = { distinctFeedOriginalSql, distinctFeedOriginals };
