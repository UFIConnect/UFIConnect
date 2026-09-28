'use strict';

const { searchTermGroups } = require('./search');
const publicProfile = `u.profile_hidden IS NOT TRUE AND COALESCE(u.role_settings ->> 'privacy_publicProfile', 'true') <> 'false'`;
const escapeLike = value => String(value).replace(/[\\%_]/g, '\\$&');
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Older databases store interests as JSONB, newer ones as TEXT[]; read either as text values.
const interestValues = column => `jsonb_array_elements_text(CASE WHEN jsonb_typeof(to_jsonb(${column})) = 'array' THEN to_jsonb(${column}) ELSE '[]'::jsonb END)`;

// Page in PostgreSQL so account discovery never stops at an in-memory ceiling.
async function searchMemberDirectory(db, { myId, q = '', role = '', sort = 'relevance', limit = 24, offset = 0 }) {
  const params = [myId];
  const bind = value => { params.push(value); return `$${params.length}`; };
  // Account IDs are UUIDs, while relationship tables store text IDs.
  const where = [`((${publicProfile}) OR u.id::text = $1)`];
  if (sort === 'interests') where.push('u.id::text <> $1');
  where.push(`NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id = $1 AND b.blocked_id = u.id::text) OR (b.blocked_id = $1 AND b.blocker_id = u.id::text))`);
  let nameRank = '(0::integer)';
  if (q.includes('@')) {
    where.push(`(u.id::text = $1 OR u.role_settings ->> 'privacy_showEmail' = 'true')`);
    where.push(`LOWER(COALESCE(u.email, '')) = ${bind(q)}`);
  } else if (q) {
    const groups = searchTermGroups(q, { preserveStopWords: !q.trim().includes(' ') });
    // Word-boundary regex handles initials, Unicode names and long biographies
    // without PostgreSQL tsvector's lexeme/document length restrictions.
    const text = `LOWER(CONCAT_WS(' ', u.name, u.title, u.organization, u.bio, CASE WHEN u.id::text = $1 OR COALESCE(u.role_settings ->> 'privacy_showSkills', 'true') <> 'false' THEN u.skills::text ELSE '' END, u.role, u.interests::text))`;
    where.push(groups.length ? groups.map(terms => `(${terms.map(term => `${text} ~ ${bind('(^|[^[:alnum:]])' + escapeRegex(term) + (term.length < 3 ? '([^[:alnum:]+#]|$)' : ''))}`).join(' OR ')})`).join(' AND ') : 'FALSE');
  }
  if (role) where.push(`LOWER(COALESCE(u.role, '')) LIKE ${bind('%' + escapeLike(role) + '%')} ESCAPE E'\\\\'`);
  const baseParams = [...params];
  if (q && !q.includes('@')) nameRank = `CASE WHEN LOWER(u.name) = ${bind(q)} THEN 2 WHEN LOWER(u.name) LIKE ${bind(escapeLike(q) + '%')} ESCAPE E'\\\\' THEN 1 ELSE 0 END`;
  const followerCount = `(SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id::text)`;
  const order = sort === 'interests'
    ? `CARDINALITY(shared.interests) DESC, ${nameRank} DESC`
    : sort === 'followers' ? `followers_count DESC, ${nameRank} DESC` : `${nameRank} DESC, (u.id::text = $1) DESC`;
  const [page, counts] = await Promise.all([
    db.query(`SELECT u.id, u.name, u.title, u.bio, u.organization,
      CASE WHEN u.id::text = $1 OR COALESCE(u.role_settings ->> 'privacy_showSkills', 'true') <> 'false' THEN u.skills ELSE NULL END AS skills,
      u.role, u.interests, u.avatar_url, shared.interests AS shared_interests,
      ${followerCount} AS followers_count,
      EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id::text) AS is_following,
      (SELECT CASE WHEN c.status = 'accepted' THEN 'connected'
        WHEN c.from_id = $1 THEN 'pending_sent' ELSE 'pending_received' END
        FROM connections c WHERE (c.from_id = $1 AND c.to_id = u.id::text) OR (c.to_id = $1 AND c.from_id = u.id::text)
        ORDER BY c.created_at DESC LIMIT 1) AS connection_status
      FROM users u
      CROSS JOIN LATERAL (
        SELECT ARRAY(
          SELECT DISTINCT LOWER(BTRIM(topic))
          FROM ${interestValues('u.interests')} AS candidate(topic)
          WHERE BTRIM(topic) <> '' AND LOWER(BTRIM(topic)) IN (
            SELECT LOWER(BTRIM(interest))
            FROM users viewer, ${interestValues('viewer.interests')} AS own(interest)
            WHERE viewer.id::text = $1
          )
          ORDER BY 1
        ) AS interests
      ) shared
      WHERE ${where.join(' AND ')} ORDER BY ${order}, u.created_at DESC, u.id
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, params),
    db.query(`SELECT (SELECT COUNT(*) FROM users) AS registered,
      (SELECT COUNT(*) FROM users u WHERE ${publicProfile}) AS discoverable,
      (SELECT COUNT(*) FROM users u WHERE ${where.join(' AND ')}) AS matching`, baseParams),
  ]);
  const count = counts.rows[0];
  return {
    countSource: 'database', registeredCount: Number(count.registered), discoverableCount: Number(count.discoverable),
    totalCount: Number(count.matching), hasMore: offset + page.rows.length < Number(count.matching),
    users: page.rows.map(u => ({
      id: u.id, name: u.name, title: u.title || '', bio: u.bio || '', organization: u.organization || '',
      skills: Array.isArray(u.skills) ? u.skills : [], role: u.role || '',
      interests: Array.isArray(u.interests) ? u.interests.slice(0, 6) : [], avatarUrl: u.avatar_url || '',
      followersCount: Number(u.followers_count), isFollowing: u.is_following,
      connectionStatus: u.id === myId ? 'self' : (u.connection_status || 'none'),
      sharedInterests: Array.isArray(u.shared_interests) ? u.shared_interests.slice(0, 6) : [],
      sharedInterestCount: Array.isArray(u.shared_interests) ? u.shared_interests.length : 0,
      isSelf: u.id === myId,
    })),
  };
}

module.exports = { searchMemberDirectory };
