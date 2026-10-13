'use strict';

const { withActiveMembers } = require('./member-write');
const NATIVE_SOURCES = new Set(['uficonnect', 'livecamera']);
const LIKE_TABLES = new Set(['external_post_likes', 'restaurant_post_likes']);
const isRestaurantPost = post => post.source === 'restaurants' || /^osm:(?:node|way|relation):\d+$/i.test(post.id || '');

function desiredLike(body) {
  if (body?.liked !== undefined && typeof body.liked !== 'boolean') {
    throw Object.assign(new Error('Choose whether to like this post.'), { status: 400 });
  }
  return body?.liked;
}

async function readTableLikes(db, table, ids, viewerId) {
  if (!LIKE_TABLES.has(table)) throw new Error('Invalid likes table.');
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT post_id, COUNT(*)::integer AS likes_count,
            COALESCE(BOOL_OR(user_id = $2::text), FALSE) AS liked_by_me
     FROM ${table} WHERE post_id = ANY($1::text[]) GROUP BY post_id`,
    [ids, viewerId || null],
  );
  return new Map(rows.map(row => [row.post_id, {
    likesCount: Number(row.likes_count || 0), likedByMe: Boolean(row.liked_by_me),
  }]));
}

async function setTableLike(db, table, postId, userId, desired) {
  if (!LIKE_TABLES.has(table)) throw new Error('Invalid likes table.');
  return withActiveMembers(db, [userId], async client => {
    let likedByMe = desired;
    if (likedByMe === undefined) {
      const { rows } = await client.query(`SELECT user_id FROM ${table} WHERE post_id=$1 AND user_id=$2`, [postId, userId]);
      likedByMe = rows.length === 0;
    }
    if (likedByMe) {
      await client.query(`INSERT INTO ${table} (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [postId, userId]);
    } else {
      await client.query(`DELETE FROM ${table} WHERE post_id=$1 AND user_id=$2`, [postId, userId]);
    }
    const { rows } = await client.query(`SELECT COUNT(*)::integer AS likes_count FROM ${table} WHERE post_id=$1`, [postId]);
    return { likedByMe, likesCount: Number(rows[0]?.likes_count || 0) };
  });
}

async function setCommunityLike(db, postId, userId, desired) {
  return withActiveMembers(db, [userId], async client => {
    const { rows: [post] } = await client.query('SELECT likes FROM community_posts WHERE id=$1 FOR UPDATE', [postId]);
    if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
    const before = Array.isArray(post.likes) ? post.likes : [];
    const wasLiked = before.includes(userId);
    const likedByMe = desired === undefined ? !wasLiked : desired;
    const likes = likedByMe ? [...new Set([...before, userId])] : before.filter(id => id !== userId);
    await client.query('UPDATE community_posts SET likes=$1 WHERE id=$2', [likes, postId]);
    return { likes, likedByMe, likesCount: likes.length, added: likedByMe && !wasLiked };
  });
}

// Apply after paging/ranking so shared feed caches retain provider metrics and
// never store another viewer's like state. Source metrics remain separately named.
async function hydratePostLikes(db, posts, viewerId = null) {
  if (!Array.isArray(posts) || !posts.length) return posts;
  const idsFor = predicate => [...new Set(posts.filter(post => post?.id && predicate(post)).map(post => post.id))];
  const nativeIds = idsFor(post => NATIVE_SOURCES.has(post.source || 'uficonnect'));
  const restaurantIds = idsFor(isRestaurantPost);
  const externalIds = idsFor(post => post.source && !NATIVE_SOURCES.has(post.source) && !isRestaurantPost(post));
  const stats = new Map();
  let available = db.isConnected();
  if (available) {
    try {
      const [external, restaurants, native] = await Promise.all([
        readTableLikes(db, 'external_post_likes', externalIds, viewerId),
        readTableLikes(db, 'restaurant_post_likes', restaurantIds, viewerId),
        nativeIds.length ? db.query(
          `SELECT id AS post_id, COALESCE(cardinality(likes),0) AS likes_count,
                  COALESCE($2::text = ANY(likes),FALSE) AS liked_by_me
           FROM community_posts WHERE id = ANY($1::text[])`, [nativeIds, viewerId],
        ) : Promise.resolve({ rows: [] }),
      ]);
      for (const [id, value] of [...external, ...restaurants]) stats.set(id, value);
      for (const row of native.rows) stats.set(row.post_id, { likesCount: Number(row.likes_count || 0), likedByMe: Boolean(row.liked_by_me) });
    } catch (error) {
      available = false;
      console.warn('Post likes lookup unavailable:', error.code || 'database_error');
    }
  }
  return posts.map(post => {
    if (!post?.id) return post;
    const native = NATIVE_SOURCES.has(post.source || 'uficonnect');
    const external = Boolean(!native && !isRestaurantPost(post));
    const counts = stats.get(post.id) || (!native
      ? { likesCount: 0, likedByMe: false }
      : { likesCount: Number(post.likesCount || 0), likedByMe: Boolean(viewerId && post.likedByMe) });
    return { ...post, ...counts, likesScope: 'uficonnect', likesAvailable: available,
      ...(external ? { sourceLikesCount: Number(post.sourceLikesCount ?? post.likesCount) || 0 } : {}) };
  });
}

module.exports = { desiredLike, readTableLikes, setTableLike, setCommunityLike, hydratePostLikes };
