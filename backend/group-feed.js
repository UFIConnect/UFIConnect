const PUBLIC_GROUP_SOURCE_FALLBACKS = Object.freeze({
  hackernews: 'ext_hn',
  devto: 'ext_devto',
  github: 'ext_gh_oss',
  lobsters: 'ext_lobsters',
  producthunt: 'ext_devhunt',
  indiehackers: 'ext_indiehackers',
});

const PUBLIC_GROUP_ID_ALIASES = Object.freeze({
  ext_github: 'ext_gh_oss',
  ext_producthunt: 'ext_devhunt',
});

const PUBLIC_GROUP_LEGACY_SOURCES = Object.freeze([
  'reddit',
  ...Object.keys(PUBLIC_GROUP_SOURCE_FALLBACKS),
]);

function redditCommunityName(sourceUrl) {
  try {
    const url = new URL(String(sourceUrl || ''));
    if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const groupIndex = parts.findIndex(part => part.toLowerCase() === 'r');
    return groupIndex >= 0 ? decodeURIComponent(parts[groupIndex + 1] || '').toLowerCase() : '';
  } catch {
    return '';
  }
}

function inferPublicGroupId(post, publicGroups = []) {
  const explicit = post?.groupId || post?.group_id || post?.group?.id;
  if (explicit) {
    const normalized = PUBLIC_GROUP_ID_ALIASES[String(explicit)] || String(explicit);
    return publicGroups.some(group => group?.id === normalized && !group?.isPrivate)
      ? normalized
      : String(explicit);
  }

  const source = String(post?.source || '').trim().toLowerCase();
  let candidate = PUBLIC_GROUP_SOURCE_FALLBACKS[source] || '';
  if (source === 'reddit') {
    const subreddit = redditCommunityName(post?.sourceUrl || post?.source_url);
    if (subreddit) {
      candidate = publicGroups.find(group => (
        String(group?.subreddit || '').trim().toLowerCase() === subreddit
      ))?.id || '';
    }
  }

  if (!candidate) return null;
  return publicGroups.some(group => group?.id === candidate && !group?.isPrivate)
    ? candidate
    : null;
}

module.exports = {
  PUBLIC_GROUP_LEGACY_SOURCES,
  PUBLIC_GROUP_SOURCE_FALLBACKS,
  inferPublicGroupId,
};
