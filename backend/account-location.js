'use strict';

const WINDOW_DAYS = 7;
const MAX_ACTIVITY_POSTS = 5000;
// Local-purpose discovery order, not measured adoption or city population.
const LOCAL_PURPOSE_ORDER = [
  'nextdoor', 'tripadvisor', 'wikivoyage', 'facebook', 'reddit',
  'getyourguide', 'viator', 'lonelyplanet', 'airbnb', 'booking',
];
const CAREER_PURPOSE_ORDER = [
  'indeed', 'linkedin', 'linkedin_jobs', 'glassdoor', 'ziprecruiter',
  'usajobs', 'handshake', 'wellfound', 'dice', 'monster',
];

function rankLocationAccounts({ platforms, location = {}, publicPosts = [], matchPost,
  isPublicPost = () => false, careerOnly = false, now = Date.now() }) {
  const allowed = new Set(Object.keys(platforms || {}).filter(key => !careerOnly
    || key === 'linkedin' || platforms[key]?.category === 'career'));
  const activityCounts = Object.create(null);
  const seen = new Set();
  // A country or a headline mentioning a city cannot establish local activity.
  // Scan only the bounded public working set; never fetch providers or inspect
  // member-specific connected/following caches for account recommendations.
  if (location.available && location.city && location.country && location.mode !== 'off') {
    for (let index = 0; index < Math.min(publicPosts.length, MAX_ACTIVITY_POSTS); index++) {
      const post = publicPosts[index];
      if (!post?.id || !allowed.has(post.source) || post.isPrivate
        || (post.visibility && post.visibility !== 'public')
        || post.userId || post.user_id || post.viewerId || post.memberId || post.memberScoped
        || post.isFollowing || post.following
        || (post.scope && !['public', 'global'].includes(post.scope))
        || ((post.groupId || post.group_id) && !String(post.groupId || post.group_id).startsWith('ext_'))) continue;
      const timestamp = Date.parse(post.createdAt);
      if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp > WINDOW_DAYS * 86400000) continue;
      const identity = `${post.source}:${post.id}`;
      if (seen.has(identity)) continue;
      const match = matchPost?.(post, location);
      if (!['local', 'nearby'].includes(match?.type) || !isPublicPost(post)) continue;
      seen.add(identity);
      activityCounts[post.source] = (activityCounts[post.source] || 0) + 1;
    }
  }
  const fallback = (careerOnly ? CAREER_PURPOSE_ORDER : LOCAL_PURPOSE_ORDER).filter(key => allowed.has(key));
  // Future career providers remain discoverable without inventing a local score.
  if (careerOnly) fallback.push(...[...allowed].filter(key => !fallback.includes(key))
    .sort((a, b) => String(platforms[a]?.name || a).localeCompare(String(platforms[b]?.name || b))));
  const priority = key => { const index = fallback.indexOf(key); return index < 0 ? fallback.length : index; };
  const observed = Object.keys(activityCounts).sort((a, b) => activityCounts[b] - activityCounts[a]
    || priority(a) - priority(b) || String(platforms[a]?.name || a).localeCompare(String(platforms[b]?.name || b)));
  return {
    platformIds: [...observed, ...fallback.filter(key => !Object.hasOwn(activityCounts, key))],
    basis: observed.length ? 'recent_local_activity' : 'local_relevance',
    windowDays: WINDOW_DAYS,
    activityCounts: { ...activityCounts },
    careerOnly,
  };
}

module.exports = { rankLocationAccounts, WINDOW_DAYS, MAX_ACTIVITY_POSTS };
