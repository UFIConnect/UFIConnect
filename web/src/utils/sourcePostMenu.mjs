import { postDiscussionUrl, safePostLink, sourceAuthorProfileUrl } from '../../../backend/post-links.mjs';
import { isCareerPost } from './jobSummary.mjs';
import { SOURCE_META } from '../components/sourceMeta.js';

const providerHosts = {
  youtube: ['youtube.com', 'm.youtube.com', 'youtu.be'], reddit: ['reddit.com', 'old.reddit.com'],
  twitter: ['twitter.com', 'x.com'], bluesky: ['bsky.app'], github: ['github.com'], gitlab: ['gitlab.com'],
  twitch: ['twitch.tv', 'clips.twitch.tv'], vimeo: ['vimeo.com', 'player.vimeo.com'],
  hackernews: ['news.ycombinator.com'], stackoverflow: ['stackoverflow.com'], devto: ['dev.to'],
  instagram: ['instagram.com'], facebook: ['facebook.com', 'm.facebook.com'], tiktok: ['tiktok.com'],
  linkedin: ['linkedin.com'], threads: ['threads.net', 'threads.com'], medium: ['medium.com'],
};
const originalLabels = {
  youtube: 'Watch on YouTube', twitch: 'Watch on Twitch', vimeo: 'Watch on Vimeo',
  reddit: 'Open Reddit discussion', hackernews: 'Open Hacker News discussion',
  stackoverflow: 'View question on Stack Overflow', github: 'Open on GitHub', gitlab: 'Open on GitLab',
  wikivoyage: 'Read original city guide',
};
const profileLabels = {
  youtube: 'View YouTube channel', twitch: 'View Twitch channel', vimeo: 'View Vimeo creator',
  github: 'View GitHub profile', gitlab: 'View GitLab profile',
};
const discussionSources = new Set(['youtube', 'reddit', 'hackernews', 'stackoverflow', 'devto', 'twitter', 'bluesky', 'mastodon', 'instagram', 'facebook', 'tiktok', 'linkedin', 'threads', 'vimeo', 'medium', 'tumblr']);

// These commands navigate to real provider pages. Provider writes continue to
// use the existing connected like/comment controls and their capability gates.
export function sourcePostMenuItems(post, { onOpenComments, includeComments = true } = {}) {
  if (!post) return [];
  const source = post.source === 'x' ? 'twitter' : post.source;
  const label = SOURCE_META[source]?.label || (source === 'vimeo' ? 'Vimeo' : post.sourceLabel || source || 'source');
  const profile = sourceAuthorProfileUrl(post);
  const items = [{ key: 'profile', label: 'Go to profile', disabled: !profile,
    detail: profile ? profileLabels[source] || `View profile on ${label}` : 'Author profile unavailable.',
    ...(profile ? { href: profile } : {}) }];
  const original = safePostLink(post.sourceUrl);
  if (!original) return items;
  const url = new URL(original), host = url.hostname.replace(/^www\./, '').toLowerCase();
  const providerMatches = !providerHosts[source] || providerHosts[source].includes(host);
  items.unshift({ key: 'original', label: providerMatches
    ? isCareerPost(post) ? `Open job listing on ${label}` : originalLabels[source] || `Open on ${label}`
    : 'Open original post', href: original });
  if (!providerMatches) return items;
  items.unshift({ key: 'likes', label: `Likes on ${label}`, href: original,
    detail: ['github', 'gitlab'].includes(source) ? 'View stars on the original source.' : 'View likes on the original post.' });
  const parts = url.pathname.split('/').filter(Boolean);
  const repositoryPost = ['github', 'gitlab'].includes(source) && /\/(?:issues|pull|merge_requests)\/\d+(?:[/?#]|$)/.test(original);
  if (includeComments && (discussionSources.has(source) || repositoryPost)) {
    items.push({ key: 'comments', label: source === 'stackoverflow' ? 'View answers on Stack Overflow' : `View comments on ${label}`,
      ...(onOpenComments ? { onSelect: onOpenComments } : { href: postDiscussionUrl(post) }) });
  }
  if (source === 'reddit' && parts[0] === 'r' && /^[A-Za-z0-9_]+$/.test(parts[1] || '') && parts[2] === 'comments') {
    items.push({ key: 'community', label: `View r/${parts[1]}`, href: `${url.origin}/r/${encodeURIComponent(parts[1])}/` });
  }
  if (source === 'youtube') {
    if (profile && /^https:\/\/www\.youtube\.com\/channel\/UC[A-Za-z0-9_-]{22}$/.test(profile)) {
      items.push({ key: 'playlists', label: 'View channel playlists on YouTube', href: `${profile}/playlists` });
    }
    items.push({ key: 'watch-later', label: 'Open Watch later on YouTube', href: 'https://www.youtube.com/playlist?list=WL' });
  }
  if (source === 'github' && parts.length > 2 && parts.slice(0, 2).every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !['.', '..'].includes(part))) {
    items.push({ key: 'repository', label: 'View repository on GitHub', href: `${url.origin}/${parts.slice(0, 2).map(encodeURIComponent).join('/')}` });
  }
  if (source === 'gitlab' && parts.includes('-')) {
    const project = parts.slice(0, parts.indexOf('-'));
    if (project.length >= 2 && project.every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !['.', '..'].includes(part))) {
      items.push({ key: 'project', label: 'View project on GitLab', href: `${url.origin}/${project.map(encodeURIComponent).join('/')}` });
    }
  }
  return items;
}
