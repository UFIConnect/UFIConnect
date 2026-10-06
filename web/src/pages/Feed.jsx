import { getAccessToken, privateSessionStorage } from '../auth/session';
import { createAuthenticatedStream } from '../api/authenticatedStream';
﻿import { useState, useEffect, useCallback, useRef, useMemo, Component, memo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, ArrowRight, Martini, Plane, RotateCw, Utensils } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';
import { markApiOriginFailure, resolveApiBaseUrl } from '../api/apiOrigin';
import { extractYouTubeId, extractVimeoId, isDirectVideoUrl, deriveBlueskyPlaylistUrl, loadYouTubeIframeApi, createYouTubePlayerFrame, youTubeEmbedUrl, InlineAutoplayVideo, userWantsSound, useGlobalMuted, usePointerPlaybackGate, useSoloVideoPlayback, SoundIcon } from '../components/videoMedia';
import {
  SOURCE_META,
  HOME_FEED_SOURCE_IDS,
  FOLLOWING_FEED_SOURCE_IDS,
  FOLLOWING_EXCLUDED_SOURCE_IDS,
} from '../components/sourceMeta';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import FollowingConnectionNotice from '../components/FollowingConnectionNotice';
import HomeFeedTools from '../components/HomeFeedTools';
import TopicFilterControl, { TopicChoices } from '../components/TopicFilterControl';
import TravelDestinationPicker from '../components/TravelDestinationPicker';
import DiscoveryCategoryBar from '../components/DiscoveryCategoryBar';
import { DISCOVERY_CATEGORIES, discoveryPostContext, discoveryQuery } from '../components/discoveryCategories';
import { TIERS } from '../components/PricingModal';
import ImageLightbox from '../components/ImageLightbox';
import { useEngagementTracking } from '../hooks/useEngagementTracking';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { normalizeSourceFavorites } from '../components/sourceFavorites';
import { orderNewestFeedCohorts } from '../utils/feedOrdering';
import { reportEngagementSignal } from '../api/engagement';
import { useDataPreferences, previewPlaybackAllowed } from '../preferences';
import { reportClientError } from '../api/errorReporting';
import { ALL_INTERESTS } from './Onboarding';
import ReportModal from '../components/ReportModal';
import { useToast } from '../contexts/ToastContext';
import { UfiFeedContent } from './Post';
import ConnectedPostActions, { originalSourceUrl, useSourceCapability } from '../components/ConnectedPostActions';
import { SavePostButton } from '../components/SaveButtons';
import { CommentIcon, OpenOnSource, PostHeader, PostOptionsMenu, SharePostButton, feedAccountKey } from '../components/PostCardChrome';
import PostLikes from '../components/PostLikes';

const COMMAND_CENTER_PRO_TIER = TIERS.find((tier) => tier.tier === 'pro');
const HOME_VIEW_MODES = new Set(['ufi', 'feed', 'following', 'groups', 'countries', 'restaurants', 'bars']);
const EMBEDDED_HOME_MODES = new Set(['ufi']);
const CONTINUOUS_FEED_MODES = new Set(['feed', 'following', 'groups', 'restaurants', 'bars']);
const FEED_POSITION_PREFETCH_POSTS = 8;

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function SourceMark({ source, label, size = 15, active = false, compact = false }) {
  const meta = SOURCE_META[source] || {};
  if (hasBrandIcon(source)) {
    return (
      <span style={{
        width: compact ? size : size + 8, height: compact ? size : size + 8, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: compact ? 'transparent' : '#fff', border: active || compact ? 'none' : '1px solid var(--border)', flexShrink: 0,
      }}>
        <BrandIcon platform={source} size={size} />
      </span>
    );
  }
  const text = label || meta.icon || meta.label || source || 'UFI';
  return (
    <span style={{
      width: size + 8, height: size + 8, borderRadius: '50%',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: active && !compact ? 'rgba(255,255,255,.22)' : 'transparent',
      color: active && !compact ? '#fff' : (meta.color || 'var(--primary)'),
      fontSize: Math.max(8, size - 7), fontWeight: 800, lineHeight: 1, flexShrink: 0,
    }}>
      {String(text).slice(0, 3).toUpperCase()}
    </span>
  );
}

function MenuIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function FeedSourceOption({ tab, active, onSelect, compact = false, favorite = false }) {
  const meta = SOURCE_META[tab.key];
  const color = tab.key === 'all' ? 'var(--primary)' : (meta?.color || 'var(--primary)');
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={compact || tab.key === 'all' ? tab.label : undefined}
      title={compact ? tab.label : undefined}
      className={`feed-source-option${active ? ' active' : ''}${compact ? ' compact' : ''}`}
      style={{ '--feed-source-color': color }}
      onClick={onSelect}
    >
      <SourceMark source={tab.key} label={tab.icon} size={18} active={active} compact={compact} />
      <span className="feed-source-option-label">{tab.label}</span>
      {compact && favorite && <span className="feed-source-compact-favorite" aria-hidden="true">★</span>}
    </button>
  );
}

function SourceFavoriteButton({ tab, favorite, disabled, onToggle }) {
  const action = favorite ? 'Remove from favorites' : 'Add to favorites';
  return (
    <button
      type="button"
      className={`feed-source-favorite-button${favorite ? ' active' : ''}`}
      aria-label={`${action}: ${tab.label}`}
      aria-pressed={favorite}
      title={`${action}: ${tab.label}`}
      disabled={disabled}
      onClick={() => onToggle(tab.key)}
    >
      <span aria-hidden="true">{favorite ? '★' : '☆'}</span>
    </button>
  );
}

function LocationMatchBadge({ post }) {
  if (!post?.matchedByLocation) return null;
  return (
    <span style={{
      fontSize: '.65rem', fontWeight: 700, color: '#047857', background: '#ECFDF5',
      border: '1px solid #A7F3D0', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap',
    }}>
      {post.locationMatchLabel || 'Near you'}
    </span>
  );
}

function feedPostTime(post) {
  const time = new Date(post?.createdAt || post?.time || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeFeedSort(value) {
  return value === 'popular' ? 'popular' : 'newest';
}

// Mirrors handleFeedRequest's own date-cursor eligibility check
// server-side: Newest sort, plain Feed mode (not Following — that's a live
// per-user query with no cursor of its own), no active search (a cursor
// has no defined meaning against a text-match result set). Kept as one
// function so loadMoreRemote's choice of ?cursor= vs ?page= can't drift
// from what the backend actually honors.
function isCursorEligible(mode, sort, search) {
  if (['following', 'groups', 'countries', 'restaurants', 'bars'].includes(mode)) {
    return normalizeFeedSort(sort) === 'newest';
  }
  return mode === 'feed' && normalizeFeedSort(sort) === 'newest' && !search.trim();
}

function usesMemberEqualizer(mode, search = '') {
  return ['feed', 'following'].includes(mode) && !search.trim();
}

// Home/Following responses already balance the selected sources and topics.
// Preserve that order on load, refresh, pagination, and display; re-sorting by
// timestamp here would undo the server's equalizer whenever dates differ.
function sortPostsForView(list = [], sort = 'newest', preserveEqualizer = false) {
  return preserveEqualizer || normalizeFeedSort(sort) === 'popular' ? list : orderNewestFeedCohorts(list);
}

function mergeFeedPosts(list = [], sort = 'ranked', preserveEqualizer = false) {
  const byId = new Map();
  for (const post of list) {
    if (!post) continue;
    const key = post.id || `${post.source || 'feed'}:${post.sourceUrl || post.title || post.content || ''}:${post.createdAt || ''}`;
    if (!key) continue;
    const previous = byId.get(key);
    if (!previous || feedPostTime(post) >= feedPostTime(previous)) byId.set(key, post);
  }
  return sortPostsForView([...byId.values()], sort, preserveEqualizer);
}

function groupFeedLane(post) {
  return post?.groupId || post?.group?.id || post?.source || 'unknown';
}

function paginateGroupFeed(posts, page, limit) {
  let remaining = posts;
  let selected = [];
  for (let currentPage = 1; currentPage <= page; currentPage++) {
    const laneCounts = new Map();
    const nextRemaining = [];
    selected = [];
    for (const post of remaining) {
      const lane = groupFeedLane(post);
      const count = laneCounts.get(lane) || 0;
      if (selected.length < limit && count < 2) {
        laneCounts.set(lane, count + 1);
        selected.push(post);
      } else {
        nextRemaining.push(post);
      }
    }
    remaining = nextRemaining;
    if (currentPage === page || !selected.length) break;
  }
  return { posts: selected, hasMore: remaining.length > 0 };
}

function equalizeGroupFeed(posts, sort) {
  const ordered = [...posts].sort((left, right) => {
    if (sort === 'popular') {
      const leftEngagement = Number(left.likesCount || 0) + Number(left.commentsCount || 0) * 2;
      const rightEngagement = Number(right.likesCount || 0) + Number(right.commentsCount || 0) * 2;
      return (rightEngagement - leftEngagement) || (feedPostTime(right) - feedPostTime(left));
    }
    return feedPostTime(right) - feedPostTime(left);
  });
  const lanes = new Map();
  for (const post of ordered) {
    const lane = groupFeedLane(post);
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(post);
  }
  const queues = [...lanes.values()];
  const result = [];
  for (let round = 0; result.length < ordered.length; round++) {
    let added = false;
    for (const queue of queues) {
      if (!queue[round]) continue;
      result.push(queue[round]);
      added = true;
    }
    if (!added) break;
  }
  return result;
}

const FOLLOWING_NATIVE_COMPAT_TTL_MS = 30_000;
const followingNativeCompatCache = new Map();
const locationFeedCursorSupport = new Map();
window.addEventListener('ufi-session-cleared', () => followingNativeCompatCache.clear());

function requestedFeedSources(params) {
  return [...new Set([
    params.get('source'),
    ...String(params.get('sources') || '').split(','),
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function capFeedPageBySource(posts, limit, maxPerSource = 2) {
  const selected = [];
  const counts = new Map();
  for (const post of posts) {
    const source = String(post?.source || 'uficonnect').toLowerCase();
    const count = counts.get(source) || 0;
    if (count >= maxPerSource) continue;
    selected.push(post);
    counts.set(source, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

async function getFollowingNativeCompatibility(viewer, bust = false) {
  if (!viewer?.id) return [];
  const cached = followingNativeCompatCache.get(viewer.id);
  if (!bust && cached?.expiresAt > Date.now()) return cached.posts;

  const [postsResponse, followingResponse] = await Promise.all([
    client.get('/posts?limit=100&offset=0'),
    client.get(`/users/${encodeURIComponent(viewer.id)}/following`),
  ]);
  const followedIds = new Set((followingResponse.data?.users || []).map(user => user.id));
  const nativePosts = (postsResponse.data?.posts || []).filter((post) => {
    if ((post.source || 'uficonnect') !== 'uficonnect') return false;
    const isFollowedAuthor = followedIds.has(post.authorId || post.author?.id);
    const postGroupId = post.groupId || post.group?.id;
    return isFollowedAuthor && postGroupId === 'ufi-general';
  });
  const posts = sortPostsForView(nativePosts);
  followingNativeCompatCache.set(viewer.id, {
    posts,
    expiresAt: Date.now() + FOLLOWING_NATIVE_COMPAT_TTL_MS,
  });
  return posts;
}

async function loadFollowingFeedCompatibility(params, responseData, viewer) {
  const sources = requestedFeedSources(params);
  if (sources.length && !sources.includes('uficonnect')) return responseData;

  const limit = Math.max(1, Math.min(250, Number(params.get('limit')) || FEED_PAGE_SIZE));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const queryWords = String(params.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
  const topics = String(params.get('topics') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
  const allNativePosts = await getFollowingNativeCompatibility(viewer, params.get('bust') === '1');
  const matchingNativePosts = allNativePosts.filter((post) => {
    if (topics.length && !topics.includes(String(post.topic || '').toLowerCase())) return false;
    if (!queryWords.length) return true;
    const text = `${post.title || ''} ${post.content || ''} ${post.author?.name || ''} ${post.group?.name || ''} ${post.topic || ''}`.toLowerCase();
    return queryWords.every(word => text.includes(word));
  });
  const onlyUfi = sources.length === 1 && sources[0] === 'uficonnect';
  const nativePageSize = onlyUfi ? limit : 2;
  const nativeOffset = (page - 1) * nativePageSize;
  const nativePage = matchingNativePosts.slice(nativeOffset, nativeOffset + nativePageSize);
  const merged = mergeFeedPosts([
    ...(onlyUfi ? [] : responseData?.posts || []),
    ...nativePage,
  ], 'newest');
  const posts = onlyUfi ? merged.slice(0, limit) : capFeedPageBySource(merged, limit);

  return {
    ...responseData,
    posts,
    page,
    mode: 'following',
    nativeUficonnectIncluded: true,
    hasMore: responseData?.hasMore !== false || nativeOffset + nativePage.length < matchingNativePosts.length,
    totalAvailable: Number(responseData?.totalAvailable || 0) + matchingNativePosts.length,
  };
}

async function loadGroupsFeedCompatibility(params) {
  const limit = Math.max(1, Math.min(250, Number(params.get('limit')) || FEED_PAGE_SIZE));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sort = normalizeFeedSort(params.get('sort'));
  const queryWords = String(params.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
  const topics = String(params.get('topics') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
  const [profileResponse, groupsResponse, connectedResponse] = await Promise.all([
    client.get('/profile'),
    client.get('/groups'),
    client.get(`/office/feed?mode=following&limit=250&sort=${encodeURIComponent(sort)}&passive=1`),
  ]);
  const joinedIds = new Set(profileResponse.data?.joinedGroups || []);
  const joinedGroups = (groupsResponse.data?.groups || []).filter(group => !group.isExternal && !['ufi-general', 'ufi-shop'].includes(group.id) && joinedIds.has(group.id));
  const nativeGroups = joinedGroups.filter(group => !group.isExternal);
  const nativeResults = await Promise.allSettled(nativeGroups.map(group =>
    client.get(`/groups/${encodeURIComponent(group.id)}/posts?limit=100&offset=0`)
  ));
  const nativePosts = nativeResults.flatMap(result => result.status === 'fulfilled' ? result.value.data?.posts || [] : []);
  const connectedPosts = (connectedResponse.data?.posts || []).filter(post =>
    (post.groupId || post.group?.id) !== 'ufi-general' && joinedIds.has(post.groupId || post.group?.id)
  );
  const groupById = new Map(joinedGroups.map(group => [group.id, group]));
  const candidates = mergeFeedPosts([...nativePosts, ...connectedPosts], sort).map(post => {
    const group = groupById.get(post.groupId || post.group?.id);
    return group ? {
      ...post,
      group: { id: group.id, name: group.name, category: group.category, externalUrl: group.externalUrl },
      fromJoinedGroup: true,
    } : null;
  }).filter(Boolean).filter(post => {
    if (topics.length && !topics.includes(String(post.topic || '').toLowerCase())) return false;
    if (!queryWords.length) return true;
    const text = `${post.title || ''} ${post.content || ''} ${post.author?.name || ''} ${post.group?.name || ''} ${post.topic || ''}`.toLowerCase();
    return queryWords.every(word => text.includes(word));
  });
  const balanced = equalizeGroupFeed(candidates, sort);
  const pageResult = paginateGroupFeed(balanced, page, limit);
  return {
    ...pageResult,
    mode: 'groups',
    page,
    totalAvailable: balanced.length,
    joinedGroupCount: joinedGroups.length,
    nativeUficonnectIncluded: true,
    sourceErrors: connectedResponse.data?.sourceErrors || {},
    equalizer: { mode: 'compatibility-community-source', maxPerCommunityPerPage: 2 },
  };
}

async function requestFeedPage(params, viewer) {
  const mode = params.get('mode');
  const requestParams = new URLSearchParams(params);
  // The previous API paginates discovery feeds by page number and applies a
  // two-per-source cap after calculating the offset. Ask it for two at a
  // time so it cannot jump over unseen cards. A cursor-capable API advertises
  // itself on that first compact page; every later request returns to 50.
  if (['countries', 'restaurants', 'bars'].includes(mode) && locationFeedCursorSupport.get(mode) !== true) {
    requestParams.set('limit', '2');
  }
  const { data } = await client.get(`/office/feed?${requestParams.toString()}`);
  if (['countries', 'restaurants', 'bars'].includes(mode)) {
    locationFeedCursorSupport.set(mode, typeof data?.cursor === 'string' && data.cursor.length > 0);
  }
  if (mode === 'groups'
      && (data?.mode !== 'groups' || data?.nativeUficonnectIncluded !== true)) {
    return loadGroupsFeedCompatibility(params);
  }
  if (mode === 'following' && data?.nativeUficonnectIncluded !== true) {
    return loadFollowingFeedCompatibility(params, data, viewer);
  }
  if (mode === 'groups' && params.get('groupScope') !== 'public') {
    const joined = new Set(viewer?.joinedGroups || []);
    return { ...data, posts: (data.posts || []).filter(post =>
      !post.isExternal && (post.source || 'uficonnect') === 'uficonnect'
      && joined.has(post.groupId || post.group?.id)
      && !['ufi-general', 'ufi-shop'].includes(post.groupId || post.group?.id)) };
  }
  return data;
}

// Use the shared feed catalog so the source bar and account tools stay in sync.
const SOURCE_TABS = HOME_FEED_SOURCE_IDS.map(key => ({
  key, label: SOURCE_META[key]?.label || key, icon: SOURCE_META[key]?.icon || 'SRC',
}));

// Following's own quick-filter row — the mirror image of SOURCE_TABS above:
// this is exactly the content SOURCE_TABS deliberately excludes (native
// UFIconnect posts from people you follow, plus whichever connected social
// accounts you've linked), so it gets its own tab vocabulary rather than
// reusing the aggregate Feed's. Covers every platform Connected Accounts
// offers when it exposes a usable following timeline. Instagram and TikTok
// remain available for own-post tools in Command Center, but cannot appear
// here because neither connection supplies an accounts-you-follow timeline.
const FOLLOWING_SOURCE_TABS = [
  { key: 'all', label: 'Following', icon: '' },
  { key: 'uficonnect', label: 'UFIconnect', icon: 'UFI' },
  ...FOLLOWING_FEED_SOURCE_IDS
    .filter(key => key !== 'uficonnect')
    .map(key => ({ key, label: SOURCE_META[key]?.label || key, icon: SOURCE_META[key]?.icon || 'SRC' })),
];
const FOLLOWING_EXCLUDED_SOURCES = new Set(FOLLOWING_EXCLUDED_SOURCE_IDS);
const DEFAULT_FILTERS = { sort: 'newest', sources: [], timeRange: 'all', topics: [] };
const FEED_PAGE_SIZE = 50;
const FEED_AUTO_REFRESH_MS = 2 * 60 * 1000;
const FEED_STATE_KEY = 'ufi_feed_state';

function memberStorageKey(baseKey, userId) {
  return userId ? `${baseKey}:${userId}` : null;
}

function normalizeLocationFilters(value = {}) {
  return {
    country: String(value?.country || '').replace(/[<>]/g, '').trim().slice(0, 80),
    city: String(value?.city || '').replace(/[<>]/g, '').trim().slice(0, 80),
  };
}

function normalizeSourceSelection(value, allowedSourceIds = []) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(source => allowedSourceIds.includes(source)))];
}

function locationScopeLabel(value = {}) {
  return [value?.city, value?.country].filter(Boolean).join(', ');
}

function loadFeedState(userId) {
  try {
    const key = memberStorageKey(FEED_STATE_KEY, userId);
    if (!key) return null;
    const raw = privateSessionStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const requestedMode = s.viewMode === 'local' ? 'countries' : s.viewMode;
    const viewMode = HOME_VIEW_MODES.has(requestedMode) ? requestedMode : 'feed';
    const allowedSourceIds = viewMode === 'following'
      ? FOLLOWING_FEED_SOURCE_IDS
      : viewMode === 'feed' ? HOME_FEED_SOURCE_IDS : [];
    const activeTabs = normalizeSourceSelection(s.activeTabs, allowedSourceIds);
    const filters = { ...DEFAULT_FILTERS, ...(s.filters || {}) };
    filters.sort = 'newest';
    filters.sources = normalizeSourceSelection(filters.sources, allowedSourceIds);
    filters.topics = Array.isArray(filters.topics)
      ? filters.topics.filter(topic => ALL_INTERESTS.includes(topic))
      : [];
    if (activeTabs.length) filters.sources = [];
    return {
      filters,
      activeTabs,
      // Post search now lives on /search. Ignore legacy persisted queries so
      // Home cannot reopen with an invisible search filtering its feed.
      search:     '',
      viewMode,
      location:   normalizeLocationFilters(s.location),
    };
  } catch { return null; }
}

function saveFeedState(userId, filters, activeTabs, _search, viewMode, location) {
  try {
    const key = memberStorageKey(FEED_STATE_KEY, userId);
    if (!key) return;
    const allowedSourceIds = viewMode === 'following'
      ? FOLLOWING_FEED_SOURCE_IDS
      : viewMode === 'feed' ? HOME_FEED_SOURCE_IDS : [];
    const savedTabs = normalizeSourceSelection(activeTabs, allowedSourceIds);
    const savedFilters = {
      ...filters,
      sources: normalizeSourceSelection(filters?.sources, allowedSourceIds),
    };
    const value = JSON.stringify({ filters: savedFilters, activeTabs: savedTabs, search: '', viewMode, location });
    privateSessionStorage.setItem(key, value);

    if (viewMode === 'feed' || viewMode === 'following') {
      const suggestionKey = memberStorageKey(`ufi_feed_suggestions:${viewMode}`, userId);
      const sources = savedFilters.sources.length ? savedFilters.sources : savedTabs;
      privateSessionStorage.setItem(suggestionKey, JSON.stringify({
        sources: Array.isArray(sources) ? sources : [],
        topics: Array.isArray(filters?.topics) ? filters.topics : [],
        updatedAt: Date.now(),
      }));
    }
  } catch {}
}

// Home filters use the same shared-source allowlist as the quick tabs.
// Account-owned networks appear only in Following after connection.
const ALL_FILTER_SOURCES = HOME_FEED_SOURCE_IDS;

// Following's filter-panel options — native UFIconnect posts from people you
// follow, plus every platform Connected Accounts offers (see
// FOLLOWING_SOURCE_TABS above for why this now matches that full list
// instead of just the 4 with a live keyword-search fallback). Deliberately
// excludes everything in ALL_FILTER_SOURCES above — that content
// structurally cannot appear in Following, so offering it as a filter here
// would just be a no-op that always returns nothing.
const FOLLOWING_FILTER_SOURCES = FOLLOWING_FEED_SOURCE_IDS;

const CATEGORY_COLORS = {
  'AI & ML':     { text: '#2563EB', bg: '#EFF6FF' },
  'Engineering': { text: '#7C3AED', bg: '#F3EEFF' },
  'Startups':    { text: '#D97706', bg: '#FFFBEB' },
  'Design':      { text: '#DB2777', bg: '#FDF2F8' },
  'Marketing':   { text: '#059669', bg: '#ECFDF5' },
  'Finance':     { text: '#0284C7', bg: '#F0F9FF' },
  'Remote Work': { text: '#EA580C', bg: '#FFF7ED' },
  'Education':   { text: '#7C3AED', bg: '#F3EEFF' },
  'Social':      { text: '#6B7280', bg: '#F9FAFB' },
};
function catStyle(cat) {
  return CATEGORY_COLORS[cat] || { text: 'var(--primary)', bg: 'var(--primary-light)' };
}

// Long post bodies (up to MAX_CONTENT_LEN=1500 chars server-side) used to
// render in full on the card every time — fine for a short caption, a wall
// of text for a long article excerpt. Collapses anything past a normal
// preview length behind an inline "Read more" instead, expanding in place —
// replaces the old "Read full post ↗" external link entirely (see its own
// former comment: our stored copy was already the complete truncated
// content, so that link only ever pointed at the *original* source, never
// showed anything this card couldn't already show itself).
const POST_TEXT_COLLAPSE_LENGTH = 320;
// Hashtags take the source's brand colour, as they do on the source itself.
function withTags(text, accent) {
  if (!accent) return text;
  return text.split(/(#[\p{L}\p{N}_]+)/u).map((part, index) => (
    index % 2 ? <span key={index} className="post-chrome-tag" style={{ '--source-color': accent }}>{part}</span> : part
  ));
}

function PostText({ text, accent }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const needsCollapse = text.length > POST_TEXT_COLLAPSE_LENGTH;
  const shown = needsCollapse && !expanded ? text.slice(0, POST_TEXT_COLLAPSE_LENGTH).trimEnd() : text;
  return (
    <p className="post-content" style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
      {withTags(shown, accent)}{needsCollapse && !expanded ? '… ' : ''}
      {needsCollapse && (
        <button
          onClick={e => { e.stopPropagation(); e.preventDefault(); setExpanded(x => !x); }}
          style={{ all: 'unset', cursor: 'pointer', color: 'var(--primary)', fontWeight: 700, fontSize: '.82rem', marginLeft: expanded ? 0 : 2 }}
        >
          {expanded ? ' Show less' : 'Read more'}
        </button>
      )}
    </p>
  );
}

function PostCardSkeleton() {
  return (
    <div className="card post-card" style={{ marginBottom: 12, opacity: 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--border)', animation: 'pulse 2s ease-in-out infinite' }} />
        <div style={{ flex: 1, height: 12, borderRadius: 4, background: 'var(--border)', animation: 'pulse 2s ease-in-out infinite' }} />
      </div>
      <div style={{ height: 16, borderRadius: 4, background: 'var(--border)', marginBottom: 10, animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ height: 12, borderRadius: 4, background: 'var(--border)', marginBottom: 20, width: '85%', animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ height: 200, borderRadius: 12, background: 'var(--border)', animation: 'pulse 2s ease-in-out infinite' }} />
    </div>
  );
}


/** Filter panel dropdown */
function FilterPanel({ filters, onChange, sources, onClose, panelRef, includeTopics = true }) {
  const [local, setLocal] = useState({ ...filters });

  useEffect(() => {
    setLocal({ ...filters });
  }, [filters]);

  function toggleSource(s) {
    setLocal(f => {
      const next = f.sources.includes(s) ? f.sources.filter(x => x !== s) : [...f.sources, s];
      return { ...f, sources: next };
    });
  }

  function apply() {
    onChange(local);
    onClose();
  }

  function reset() {
    const cleared = {
      ...DEFAULT_FILTERS,
      topics: includeTopics ? [] : filters.topics,
    };
    setLocal(cleared);
    onChange(cleared);
    onClose();
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute', top: '100%', zIndex: 500, marginTop: 6,
        background: 'var(--surface)', border: '1.5px solid var(--border)',
        borderRadius: 16, padding: '18px 20px', width: 'min(320px, calc(100vw - 24px))',
        maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,.12)',
        right: 'clamp(12px, calc(50vw - 150px), 0px)',
      }}
    >
      {/* Actions — pinned to the top of the panel (was at the bottom, past
          Sort/Time/Sources/Topic) so Reset/Apply filters stay reachable
          without scrolling past ~230 topic chips first. Sticky within the
          panel's own scroll so it stays visible while scrolling further
          down too; negative margins cancel the panel's own padding so the
          bar spans full width and sits flush with the true top edge. */}
      <div style={{
        display: 'flex', gap: 8, position: 'sticky', top: -18,
        marginTop: -18, marginLeft: -20, marginRight: -20, marginBottom: 16,
        padding: '14px 20px 12px', background: 'var(--surface)', zIndex: 1,
        borderBottom: '1.5px solid var(--border)',
      }}>
        <button onClick={reset} className="btn btn-ghost btn-sm" style={{ flex: 1 }}>Reset</button>
        <button onClick={apply} className="btn btn-primary btn-sm" style={{ flex: 2 }}>Apply filters</button>
      </div>

      {/* Time range */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Time</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { value: 'all',   label: 'All' },
            { value: '1h',    label: '1h' },
            { value: '6h',    label: '6h' },
            { value: 'today', label: 'Today' },
            { value: 'week',  label: 'Week' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setLocal(f => ({ ...f, timeRange: value }))}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: '.77rem', fontWeight: 600,
                border: `1.5px solid ${local.timeRange === value ? 'var(--primary)' : 'var(--border)'}`,
                background: local.timeRange === value ? 'var(--primary)' : 'var(--surface)',
                color: local.timeRange === value ? '#fff' : 'var(--text)', cursor: 'pointer',
              }}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* Sources */}
      {sources.length > 0 && <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
          Sources {local.sources.length > 0 && `(${local.sources.length} selected)`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {sources.map(s => {
            const meta = SOURCE_META[s];
            if (!meta) return null;
            const active = local.sources.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleSource(s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 16, fontSize: '.73rem', fontWeight: 600,
                  border: `1.5px solid ${active ? meta.color : 'var(--border)'}`,
                  background: active ? `${meta.color}18` : 'var(--surface)',
                  color: active ? meta.color : 'var(--muted)', cursor: 'pointer',
                }}
              >
                <SourceMark source={s} label={meta.icon} size={13} active={active} />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>}

      {/* Topic — multi-select (a post matches if its topic is ANY of the
          ones picked here), reusing the exact same interest vocabulary
          Onboarding already offers rather than a second list that could
          drift out of sync with it. No bounded scroll box of its own (was
          maxHeight:130/overflowY:auto) — that made this panel two nested
          scroll regions (this box, plus the panel's own outer scroll),
          confirmed live as genuinely hard to use: unclear which region a
          scroll gesture was even going to, and the box itself was so short
          it took many small scrolls to get through ~230 topics. Topic is
          already the last section, so letting it flow as part of the
          panel's single outer scroll instead doesn't block reaching
          anything — Reset/Apply filters are pinned to the top of the
          panel now, not down here. */}
      {includeTopics && <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
          Topic {local.topics.length > 0 && `(${local.topics.length} selected)`}
        </div>
        <TopicChoices
          options={ALL_INTERESTS}
          selectedTopics={local.topics}
          onToggle={topic => setLocal(f => ({
            ...f,
            topics: f.topics.includes(topic) ? f.topics.filter(item => item !== topic) : [...f.topics, topic],
          }))}
        />
      </div>}
    </div>
  );
}

/** Gate shown when user clicks a social tab but hasn't connected that account */
function SocialConnectGate({ platform, onConnect, connecting }) {
  const meta = SOURCE_META[platform] || {};
  const descriptions = {
    twitter:   'See posts, threads, and trending topics from the people you follow on X (Twitter).',
    linkedin:  'Bring your LinkedIn feed into UFIconnect — professional updates, articles, and job posts.',
    instagram: 'View posts and reels from the creators and brands you follow on Instagram.',
    facebook:  'See updates from your Facebook friends and the pages you follow.',
  };
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '60px 24px', textAlign: 'center',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%', marginBottom: 20,
        background: `${meta.color}18`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '2rem',
        border: `2px solid ${meta.color}30`,
      }}>
        <SourceMark source={platform} label={meta.icon} size={30} />
      </div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 10, color: 'var(--text)' }}>
        Connect your {meta.label} account
      </h2>
      <p style={{ fontSize: '.9rem', color: 'var(--muted)', maxWidth: 380, lineHeight: 1.6, marginBottom: 28 }}>
        {descriptions[platform] || `Connect your ${meta.label} account to see your personalised feed here.`}
      </p>
      <button
        onClick={onConnect}
        disabled={connecting}
        style={{
          padding: '12px 32px', borderRadius: 24, fontWeight: 700, fontSize: '.95rem',
          background: meta.color, color: '#fff', border: 'none', cursor: connecting ? 'default' : 'pointer',
          opacity: connecting ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 8,
          transition: 'opacity .15s',
        }}
      >
        {connecting ? <span className="spinner" style={{ borderTopColor: '#fff', width: 16, height: 16 }} /> : <SourceMark source={platform} label={meta.icon} size={13} active />}
        {connecting ? 'Redirecting…' : `Connect ${meta.label}`}
      </button>
      <p style={{ marginTop: 16, fontSize: '.78rem', color: 'var(--muted)' }}>
        You can disconnect at any time from Settings → Connected Accounts
      </p>
    </div>
  );
}

/** YouTube embed card */
// Click-to-play YouTube embed: sits as a poster + play button until clicked
// (or scrolled into view, when autoPlayOnVisible is set), then swaps in the
// real iframe — an <iframe> is all YouTube's embed API exposes, no
// programmatic autoplay-on-scroll without the visible poster stage first.
// Shared by YouTubeCard (dedicated YouTube posts) and PostCard's generic
// video block (any source whose article embeds a YouTube video — see
// parseRSSItems' video detection backend-side) so both get the exact same
// playable behavior instead of one silently trying to <img>-render a
// youtube.com/watch URL and failing.
// YouTubeEmbedBlock plays inline at card size but has no way out to
// ImageLightbox ("max mode") itself — wrapping the whole embed in a button
// like every other media type would nest an interactive iframe inside a
// button and fight it for clicks (see the comment where this is used). This
// sits in its own corner instead, a plain sibling overlay that only opens
// the lightbox — it never touches the iframe's own click-to-play handling.
function MaximizeButton({ onClick }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      aria-label="View fullscreen"
      style={{
        position: 'absolute', top: 10, right: 10, zIndex: 2,
        width: 32, height: 32, borderRadius: '50%',
        background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,.25)', color: '#fff', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    </button>
  );
}

function YouTubeEmbedBlock({ embedId, videoKey, poster, title, maxHeight = 280, minHeight = 0, autoPlayOnVisible = true, forcePause = false, onPlaybackStatus, requirePointer = true }) {
  const preferences = useDataPreferences();
  const automaticPlayback = autoPlayOnVisible && previewPlaybackAllowed(preferences);
  const [manuallyStarted, setManuallyStarted] = useState(false);
  useEffect(() => { setManuallyStarted(false); }, [preferences.dataSaver, preferences.autoplayPreviews, embedId]);
  const [inView, setInView] = useState(false);
  const { playbackAllowed, pointerHandlers } = usePointerPlaybackGate();
  // Whether the real YT.Player has actually been constructed yet — separate
  // from `playing`/`effectivelyPlaying` (see below) because construction
  // happens at most once per embedId and is never redone just because
  // visibility toggled off and back on.
  const [playerReady, setPlayerReady] = useState(false);
  const [playerFailed, setPlayerFailed] = useState(false);
  useEffect(() => { onPlaybackStatus?.(playerFailed); }, [playerFailed, onPlaybackStatus]);
  // Always starts muted regardless of trigger (scroll-into-view or a manual
  // click on the poster) — a passive scroll shouldn't ever blast sound
  // unexpectedly, same convention every other inline-feed autoplay
  // (Twitter, Instagram) follows. The mute button below is what actually
  // lets someone opt in.
  //
  // Shared across every card in the Feed (and the Videos swipe list, and
  // the lightbox) via useGlobalMuted — muting or unmuting any single video
  // mutes/unmutes all the others too, live, not just future ones.
  const [muted, toggleMuted] = useGlobalMuted();
  const containerRef = useRef(null);
  const ytHostRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytLifecycleRef = useRef(0);
  const ytInitializedRef = useRef(false);
  const ytReadyRef = useRef(false);
  const ytReadyTimeoutRef = useRef(null);
  const ytShouldPlayRef = useRef(false);
  // Toggles both ways with real scroll position — was one-directional
  // (isIntersecting=true set playing, nothing ever set it back false), so a
  // video that autoplayed into view kept playing, decoding, and (if
  // unmuted) audible indefinitely after being scrolled past. Mirrors
  // InlineAutoplayVideo's inView pattern for the other video type.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 } // was 0.4 — lower bar so autoplay triggers during the scroll transition on small mobile viewports, not just once scrolling has essentially stopped
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoPlayOnVisible]);

  // forcePause is for when this exact post's media is open in ImageLightbox
  // (maximized) — the lightbox starts its own player for the same video,
  // and this card never actually scrolls out of the viewport when the
  // lightbox opens over it (IntersectionObserver tracks geometric
  // intersection only, not z-index occlusion), so `playing` alone would
  // leave this copy running behind it — two players decoding, and audibly
  // doubled if the user has sound on. Excluded from the solo-playback
  // arbiter too (not just gated after it wins) so it can't hold the "now
  // playing" slot hostage while paused for the lightbox.
  const playbackRequested = manuallyStarted || automaticPlayback;
  const isSolo = useSoloVideoPlayback(videoKey || embedId, playbackRequested && inView && (manuallyStarted || !requirePointer || playbackAllowed) && !forcePause);
  const effectivelyPlaying = playbackRequested && isSolo && !forcePause;
  ytShouldPlayRef.current = effectivelyPlaying;

  // Real IFrame Player API instead of a raw <iframe src="...?mute=1">, which
  // had no programmatic control once mounted at all — every inline video in
  // the Feed autoplayed permanently muted with nothing in our own UI to
  // ever turn sound on (only YouTube's own cross-origin control chrome,
  // inconsistent with — and less reliable than — the mute button every
  // other video surface in this app already has).
  //
  // Constructs the player at most ONCE per embedId, the first time it's
  // supposed to play — never torn down and rebuilt on every later
  // scroll-driven pause/resume (see the play/pause effect below for that
  // instead). YT.Player physically replaces its mount <div> with its own
  // <iframe>, entirely outside React's knowledge; having React itself
  // unmount/remount that div on every visibility change used to race with
  // that replacement and crash the whole Feed ("Failed to execute
  // removeChild: the node to be removed is not a child of this node" —
  // React trying to remove a node YouTube had already swapped out from
  // under it). Confirmed live: never happened before because playing only
  // ever went false→true once and stayed there; started happening the
  // moment scroll-based pause began actually firing repeatedly.
  useEffect(() => {
    const host = ytHostRef.current;
    const lifecycle = ++ytLifecycleRef.current;
    ytInitializedRef.current = false;
    ytReadyRef.current = false;
    ytPlayerRef.current = null;
    setPlayerReady(false);
    setPlayerFailed(false);
    try { host?.replaceChildren(); } catch {}

    return () => {
      if (ytLifecycleRef.current === lifecycle) ytLifecycleRef.current += 1;
      const player = ytPlayerRef.current;
      ytPlayerRef.current = null;
      ytInitializedRef.current = false;
      ytReadyRef.current = false;
      clearTimeout(ytReadyTimeoutRef.current);
      try { player?.destroy(); } catch {}
      try { host?.replaceChildren(); } catch {}
    };
  }, [embedId, preferences.dataSaver, preferences.autoplayPreviews]);

  useEffect(() => {
    if (!effectivelyPlaying || ytInitializedRef.current) return;
    const host = ytHostRef.current;
    if (!host) return;
    const lifecycle = ytLifecycleRef.current;
    const startUnmuted = !muted;
    ytInitializedRef.current = true;

    host.replaceChildren();
    const playerVars = { autoplay: 1, mute: 1, playsinline: 1, controls: 1, rel: 0, origin: window.location.origin };
    const mount = createYouTubePlayerFrame(host, embedId, playerVars, title || 'YouTube video');

    const isCurrent = () => ytLifecycleRef.current === lifecycle;
    clearTimeout(ytReadyTimeoutRef.current);
    ytReadyTimeoutRef.current = setTimeout(() => {
      if (isCurrent() && !ytReadyRef.current) {
        setPlayerReady(false);
        setPlayerFailed(true);
      }
    }, 6000);
    loadYouTubeIframeApi().then((YT) => {
      if (!isCurrent() || !host.isConnected) return;
      const player = new YT.Player(mount, {
        videoId: embedId,
        playerVars,
        events: {
          onReady: (e) => {
            if (!isCurrent()) {
              try { e.target.destroy(); } catch {}
              return;
            }
            ytPlayerRef.current = e.target;
            ytReadyRef.current = true;
            clearTimeout(ytReadyTimeoutRef.current);
            setPlayerReady(true);
            setPlayerFailed(false);
            try {
              const iframe = e.target.getIframe();
              iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            } catch {}
            try {
              if (startUnmuted) e.target.unMute(); else e.target.mute();
              if (ytShouldPlayRef.current) e.target.playVideo(); else e.target.pauseVideo();
            } catch {}
          },
          onError: () => {
            if (!isCurrent()) return;
            clearTimeout(ytReadyTimeoutRef.current);
            ytReadyRef.current = false;
            setPlayerReady(false);
            setPlayerFailed(true);
          },
        },
      });
      ytPlayerRef.current = player;
    }).catch(() => {
      if (!isCurrent()) return;
      clearTimeout(ytReadyTimeoutRef.current);
      ytInitializedRef.current = false;
      ytReadyRef.current = false;
      setPlayerReady(false);
      setPlayerFailed(true);
    });
  }, [effectivelyPlaying, embedId, maxHeight]);

  // Every subsequent visibility change plays/pauses the already-constructed
  // player in place instead of recreating it.
  useEffect(() => {
    if (!playerReady || !ytPlayerRef.current) return;
    try {
      if (effectivelyPlaying) ytPlayerRef.current.playVideo();
      else ytPlayerRef.current.pauseVideo();
    } catch {}
  }, [effectivelyPlaying, playerReady]);

  useEffect(() => {
    if (!playerReady || !ytPlayerRef.current) return;
    try {
      if (muted) ytPlayerRef.current.mute(); else ytPlayerRef.current.unMute();
    } catch {}
  }, [muted, playerReady]);

  const showPlayerHint = !effectivelyPlaying;

  return (
    <div
      ref={containerRef}
      {...pointerHandlers}
      style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#000', cursor: showPlayerHint ? 'pointer' : 'default' }}
    >
      {/* Always in the DOM once rendered, and — critically — always
          display:'block' from the very first render, never toggled by
          showPoster. YouTube's script physically replaces this exact node
          with its own <iframe> the moment the player is constructed (see
          the effect above), copying over whatever inline style the div
          had at that instant. If this div were still display:'none' at
          that point (true before playerReady flips), the *replacement*
          iframe inherits display:'none' too — and since the original mount
          points at a detached node no longer in the document, React's
          later re-render (once playerReady goes true) writes the
          'display: block' update to that orphaned div, not the live
          iframe, permanently freezing the real player invisible. The
          stable host below now remains React-owned while YouTube replaces
          only an imperative child inside it. Keeping
          this constant sidesteps the trap entirely; the poster below
          covers it as a plain absolutely-positioned overlay instead,
          which — being a normal React-owned element nothing external ever
          takes ownership of — is always safe to conditionally render. */}
      <div
        ref={ytHostRef}
        style={{ position: 'relative', width: '100%', aspectRatio: '16/9', display: 'block', maxHeight, minHeight, visibility: playerFailed ? 'hidden' : 'visible' }}
      />
      {playerFailed && effectivelyPlaying && !onPlaybackStatus && (
        <iframe
          src={youTubeEmbedUrl(embedId, { autoplay: 1, mute: userWantsSound() ? 0 : 1 })}
          referrerPolicy="strict-origin-when-cross-origin"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', display: 'block' }}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          title={title || 'YouTube video'}
        />
      )}
      {playerFailed && onPlaybackStatus && (
        <div className="travel-player-error" role="status">
          <span>This stream cannot play here.</span>
          <a href={`https://www.youtube.com/watch?v=${embedId}`} target="_blank" rel="noopener noreferrer">Open on YouTube</a>
        </div>
      )}
      {showPlayerHint && (
        <button type="button" aria-label="Play feed video preview" onClick={() => { setManuallyStarted(true); setInView(true); }} style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#fff', background: 'linear-gradient(135deg, #111827, #020617)',
          border: 0, width: '100%', cursor: 'pointer',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: '.85rem' }}>
            <span style={{
              width: 42, height: 42, borderRadius: '50%', background: '#FF0000',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(0,0,0,.35)', fontSize: '1.15rem',
            }}>▶</span>
            <span>{automaticPlayback ? 'Playing when it hits the sweet spot' : 'Tap to play'}</span>
          </div>
        </button>
      )}
      {playerReady && (
        <button
          onClick={e => { e.stopPropagation(); toggleMuted(); }}
          aria-label={muted ? 'Unmute' : 'Mute'}
          style={{
            // Bottom-left — bottom-right is already the source-label badge
            // in the "article embeds a YouTube video" call site, and
            // top-right is the maximize button in both call sites.
            position: 'absolute', bottom: 10, left: 10, zIndex: 2,
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            border: '1px solid rgba(255,255,255,.25)', color: '#fff', cursor: 'pointer', fontSize: '.9rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        ><SoundIcon muted={muted} size={15} /></button>
      )}
    </div>
  );
}

// Travel has a small, persistent live-camera rail above its discoverable
// stories. Only the current camera is mounted, so switching the rail never
// turns into a row of simultaneously decoding YouTube players on mobile.
function TravelLiveLoop({ feeds = [], onMediaOpen, mediaOpenId, location, locationLabel = '', onLocationSelect, disabled, status, onRetry }) {
  const [activeId, setActiveId] = useState(null);
  const [failedStreamId, setFailedStreamId] = useState(null);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const loopRef = useRef(null);
  const liveFeeds = useMemo(() => (Array.isArray(feeds) ? feeds : [])
    .filter(feed => feed?.id && feed.liveVerified && extractYouTubeId(feed.sourceUrl || feed.mediaUrl))
    .sort((a, b) => `${a.city}, ${a.country}`.localeCompare(`${b.city}, ${b.country}`)), [feeds]);
  const activeIndex = Math.max(0, liveFeeds.findIndex(feed => feed.id === activeId));
  const active = liveFeeds[activeIndex] || null;
  const embedId = extractYouTubeId(active?.sourceUrl || active?.mediaUrl);
  const handlePlaybackStatus = useCallback(failed => setFailedStreamId(failed ? active?.id : null), [active?.id]);

  useEffect(() => {
    if (!locationLabel) return;
    const selectedIndex = liveFeeds.findIndex(feed =>
      status?.selectedCameraId ? feed.id === status.selectedCameraId
        : [feed?.city, feed?.country].filter(Boolean).join(', ') === locationLabel
    );
    if (selectedIndex < 0) return;
    setActiveId(liveFeeds[selectedIndex].id);
  }, [liveFeeds, locationLabel, status?.selectedCameraId]);

  useEffect(() => {
    const element = loopRef.current;
    if (!element || !('IntersectionObserver' in window)) {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.2 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [Boolean(active)]);

  useEffect(() => {
    const handleVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  if (!active) return (
    <section className="travel-live-loop" aria-label="Live travel cameras">
      <div className="travel-live-loop-header"><div className="travel-live-loop-title">Live travel</div></div>
      <div className="travel-camera-empty">
      <span role="status">{status?.camerasChecking ? 'Checking live cameras...' : status?.cameraStatus === 'degraded' || status?.cameraStatus === 'error'
        ? 'Live camera checks are temporarily unavailable.' : 'No verified live cameras are available right now.'}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry} disabled={disabled}
        aria-label="Refresh live cameras" title="Refresh live cameras"><RotateCw size={16} /></button>
      </div>
      <TravelDestinationPicker location={location} disabled={disabled} onSelect={onLocationSelect} />
    </section>
  );

  const selectCamera = async (index) => {
    const selected = liveFeeds[index];
    if (disabled) return;
    if (!selected) return;
    const saved = await onLocationSelect?.(selected);
    if (saved !== false) setActiveId(selected.id);
  };
  const moveCamera = (direction) => {
    const nextIndex = (activeIndex + direction + liveFeeds.length) % liveFeeds.length;
    selectCamera(nextIndex);
  };

  return (
    <section ref={loopRef} className="travel-live-loop" aria-label="Live travel cameras">
      <div className="travel-live-loop-header">
        <div>
          <div className="travel-live-loop-title">Live travel</div>
          <div className="travel-live-loop-subtitle">
            {locationLabel && !status?.localCameraAvailable
              ? `No verified camera in ${locationLabel}. Showing worldwide views.`
              : `${liveFeeds.length} verified city cameras`}
          </div>
        </div>
        <span className="travel-live-loop-status">{failedStreamId === active.id ? 'Playback unavailable' : <><span aria-hidden="true" />Live now</>}</span>
      </div>

      <div className="travel-live-loop-stage">
        {embedId ? (
          <YouTubeEmbedBlock
            key={active.id}
            embedId={embedId}
            videoKey={`travel-live-${active.id}`}
            poster={`https://i.ytimg.com/vi/${embedId}/hqdefault.jpg`}
            title={active.title}
            maxHeight={520}
            minHeight={200}
            forcePause={mediaOpenId === active.id || !inView || !pageVisible}
            onPlaybackStatus={handlePlaybackStatus}
            requirePointer={false}
          />
        ) : (
          <img src={active.mediaUrl} alt={active.title || 'Live travel camera'} className="travel-live-loop-fallback" />
        )}

        <div className="travel-live-loop-overlay">
          <div className="travel-live-loop-copy">
            <div className="travel-live-loop-kicker">
              <SourceMark source="youtube" label="YouTube" size={12} />
              <span>{active.city || active.country || 'Live camera'}</span>
              <LocationMatchBadge post={active} />
            </div>
            <div className="travel-live-loop-camera-title">{active.liveStreamTitle || active.title}</div>
            {active.liveStreamChannel && <p>{active.liveStreamChannel}</p>}
          </div>
          <div className="travel-live-loop-actions">
            {onMediaOpen && <button type="button" className="travel-live-loop-action" onClick={() => onMediaOpen(active)}>Expand video</button>}
            <Link to={`/p/${encodeURIComponent(active.id)}`} className="travel-live-loop-action">Discuss</Link>
            {active.sourceUrl && (
              <a href={active.sourceUrl} target="_blank" rel="noopener noreferrer" className="travel-live-loop-action travel-live-loop-action--primary">
                Watch live
              </a>
            )}
          </div>
        </div>

        {liveFeeds.length > 1 && (
          <div className="travel-live-loop-navigation">
            <button type="button" disabled={disabled} onClick={() => moveCamera(-1)} aria-label="Previous live camera" title="Previous live camera"><ArrowLeft size={16} /></button>
            <span>{activeIndex + 1} / {liveFeeds.length}</span>
            <button type="button" disabled={disabled} onClick={() => moveCamera(1)} aria-label="Next live camera" title="Next live camera"><ArrowRight size={16} /></button>
          </div>
        )}
      </div>

      <TravelDestinationPicker location={location} disabled={disabled} feeds={liveFeeds} activeCameraId={active.id}
        onSelect={async (destination, camera) => {
          const saved = await onLocationSelect?.(destination);
          if (saved !== false && camera) setActiveId(camera.id);
        }} />
    </section>
  );
}

function YouTubeCard({ post, cardRef, onMediaOpen, isMediaOpen, onPostUpdated }) {
  const src = SOURCE_META.youtube;
  const c   = catStyle(post.group?.category);
  const embedId = post.embedId || extractYouTubeId(post.sourceUrl || post.mediaUrl);
  const [imageFailed, setImageFailed] = useState(false);
  const [showComments, setShowComments] = useState(false);
  useEffect(() => setImageFailed(false), [post?.id, post?.mediaUrl]);
  useEffect(() => setShowComments(false), [post?.id]);
  const commentCount = Number.isFinite(post.commentsCount) && post.commentsCount > 0 ? post.commentsCount : null;
  return (
    <div ref={cardRef} className="card post-card" style={{ marginBottom: 12, '--source-color': src.color }}>
      <PostHeader post={post} />
      {(post.group || post.matchedByLocation) && (
        <div className="post-chrome-chips">
          {post.group && <span style={{ fontSize: '.68rem', fontWeight: 600, background: c.bg, color: c.text, padding: '2px 7px', borderRadius: 5 }}>{post.group.name}</span>}
          <LocationMatchBadge post={post} />
        </div>
      )}
      <p style={{ fontWeight: 700, fontSize: '1.08rem', margin: '0 0 10px', lineHeight: 1.35 }}>{post.title}</p>
      {embedId ? (
        <div style={{ marginBottom: 10, position: 'relative' }}>
          <YouTubeEmbedBlock embedId={embedId} videoKey={post.id} poster={post.mediaUrl} title={post.title} maxHeight={280} forcePause={isMediaOpen} />
          {onMediaOpen && <MaximizeButton onClick={() => onMediaOpen(post)} />}
        </div>
      ) : post.mediaUrl && !imageFailed ? (
        <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 10, background: 'var(--border)' }}>
          <img src={post.mediaUrl} alt={post.title} style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 280 }}
            onError={() => setImageFailed(true)} />
        </div>
      ) : null}
      {post.content && <PostText text={post.content} accent={src.color} />}
      <div className="post-chrome-actions">
        <PostLikes post={post} onPostUpdated={onPostUpdated} />
        {originalSourceUrl(post) && <button type="button" className="post-chrome-action" aria-expanded={showComments}
          aria-label={showComments ? 'Hide Comments' : `Show Comments${commentCount ? ` (${commentCount.toLocaleString()})` : ''}`}
          title="Comments" onClick={() => setShowComments(value => !value)}>
          <CommentIcon />{commentCount && <span>{commentCount.toLocaleString()}</span>}
        </button>}
        <SavePostButton post={post} className="post-chrome-action save-item-button" showLabel={false} />
        <SharePostButton post={post} />
        <OpenOnSource post={post} label="Watch on YouTube" />
      </div>
      <ConnectedPostActions post={post} active={showComments} />
    </div>
  );
}

// Unlike YouTubeEmbedBlock, a plain <iframe> here is entirely React-owned —
// Vimeo's player doesn't reach in and replace its mount node the way
// YouTube's IFrame API does (see YouTubeEmbedBlock's own comment for the
// real crash that caused), so there's no risk in just conditionally
// rendering/unmounting the iframe itself on scroll visibility, same as
// InlineAutoplayVideo already does for HLS/direct-file video. Vimeo's embed
// keeps its own native play/pause/volume controls by default (no
// controls=0 the way YouTubeEmbedBlock needs, since that one built a
// custom minimal UI on top via the real IFrame Player API instead), so
// there's no separate mute button needed here either.
function VimeoEmbedBlock({ embedId, videoKey, poster, title, forcePause = false }) {
  const preferences = useDataPreferences();
  const automaticPlayback = previewPlaybackAllowed(preferences);
  const [manuallyStarted, setManuallyStarted] = useState(false);
  useEffect(() => { setManuallyStarted(false); }, [preferences.dataSaver, preferences.autoplayPreviews, embedId]);
  const [inView, setInView] = useState(false);
  const containerRef = useRef(null);
  const { playbackAllowed, pointerHandlers } = usePointerPlaybackGate();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 } // was 0.4 — lower bar so autoplay triggers during the scroll transition on small mobile viewports, not just once scrolling has essentially stopped
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // See useSoloVideoPlayback — only the most-recently-scrolled-to video
  // across the whole Feed (any embed type) actually plays at once.
  const playbackRequested = automaticPlayback || manuallyStarted;
  const playing = useSoloVideoPlayback(videoKey || embedId, playbackRequested && inView && (manuallyStarted || playbackAllowed) && !forcePause) && playbackRequested && !forcePause;

  return (
    <div ref={containerRef} {...pointerHandlers} style={{
      position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#000',
      aspectRatio: '16/9', margin: '0 auto',
    }}>
      {playing ? (
        // No app-level mute button for Vimeo (unlike YouTube's real IFrame
        // Player API, a plain iframe here has no postMessage control layer
        // — Vimeo's own native player chrome, still visible since only
        // title/byline/portrait are suppressed above, is what handles
        // further volume changes once mounted). Best-effort respects the
        // stored preference at mount time instead: if this browser has
        // already earned "unmuted" elsewhere (a real click, see
        // userWantsSound), start Vimeo unmuted too rather than forcing
        // yet another mute cycle the app can't itself unwind.
        <iframe
          src={`https://player.vimeo.com/video/${embedId}?autoplay=1&muted=${userWantsSound() ? 0 : 1}&loop=1&title=0&byline=0&portrait=0`}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          allow="autoplay; fullscreen; picture-in-picture"
          title={title}
        />
      ) : poster ? (
        <img src={poster} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '.85rem' }}>
          Vimeo video
        </div>
      )}
      {!playing && <button type="button" aria-label="Play feed video preview" onClick={() => { setManuallyStarted(true); setInView(true); }}
        style={{ position: 'absolute', inset: 0, border: 0, background: 'rgba(0,0,0,.35)', color: '#fff', width: '100%', cursor: 'pointer' }}>Tap to play</button>}
    </div>
  );
}

// Sources that have an inline comment/review section
const COMMENT_SOURCES = new Set([
  'uficonnect',
  'reddit','hackernews','devto','github','medium','stackoverflow',
  'mastodon','bluesky','lobsters','producthunt','techcrunch','theverge',
  'indiehackers','hashnode','arstechnica','wired','theregister','venturebeat',
  'smashing','phoronix','infoq','mittr','youtube','twitter','linkedin',
  'instagram','facebook','livecamera','restaurants',
]);
// Article sources where comments read as reader reviews/discussion
const ARTICLE_SOURCES = new Set([
  'medium','techcrunch','theverge','arstechnica','wired','theregister',
  'venturebeat','smashing','phoronix','infoq','mittr','hashnode',
]);
// Job-listing sources — sourceUrl is the specific posting, so the card gets
// an explicit "Job" badge + "Apply" CTA instead of blending in as an article.
const JOB_SOURCES = new Set(['indeed', 'remoteok']);
const COMMENTS_LIVE_REFRESH_MS = 15 * 1000;
const COMMENTS_PASSIVE_REFRESH_MS = 30 * 1000;

function commentSectionLabel(source) {
  if (source === 'stackoverflow') return 'Answers';
  if (source === 'github')        return 'Discussion';
  if (['twitter','linkedin','instagram','facebook','bluesky','mastodon'].includes(source)) return 'Replies';
  if (ARTICLE_SOURCES.has(source)) return 'Reader Comments';
  return 'Comments';
}

function commentToFeedComment(comment) {
  return {
    id: comment?.id || `local_${Date.now()}`,
    author: comment?.author?.name || 'Member',
    body: comment?.content || '',
    score: 0,
    created: comment?.createdAt || new Date().toISOString(),
  };
}

function commentIdentity(comment) {
  return comment?.id || `${comment?.author || ''}:${comment?.created || ''}:${comment?.body || ''}`;
}

function mergeCommentLists(primary = [], secondary = []) {
  const seen = new Set();
  const merged = [];
  for (const comment of [...primary, ...secondary]) {
    const key = commentIdentity(comment);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(comment);
  }
  return merged;
}

/** Unified post card */
function commentUrl(post) {
  const u = post.sourceUrl || '';
  if (!u) return null; // No valid URL to link to
  switch (post.source) {
    case 'hackernews':   return u;
    case 'reddit':       return u;
    case 'devto':        return u.includes('#') ? u : `${u}#comments`;
    case 'github':       return u;
    case 'youtube':      return u;
    case 'stackoverflow':return u.includes('#') ? u : `${u}#answers`;
    case 'lobsters':     return u;
    case 'mastodon':     return u;
    case 'bluesky':      return u;
    case 'twitter':      return u;
    case 'linkedin':     return u;
    case 'instagram':    return u;
    case 'facebook':     return u;
    case 'producthunt':  return u;
    case 'indiehackers': return u;
    case 'medium':       return u;
    case 'techcrunch':   return `${u}#comments`;
    case 'theverge':     return `${u}#comments`;
    case 'arstechnica':  return `${u}?comments=1`;
    case 'theregister':  return `${u}#comments`;
    case 'venturebeat':  return `${u}#comments`;
    case 'smashing':     return `${u}#comments`;
    case 'infoq':        return `${u}#community`;
    case 'hashnode':     return u.includes('#') ? u : `${u}#comments`;
    case 'phoronix':     return u;
    case 'mittr':        return u;
    case 'wired':        return u;
    default:             return u;
  }
}

export const PostCard = memo(function PostCard({ post, onMediaOpen, onPostUpdated, isMediaOpen, onBlocked, onRemoved }) {
  const { profile, token, updateProfileLocally } = useAuth();
  const navigate = useNavigate();
  const [blockBusy, setBlockBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const { showToast } = useToast();
  const [reportOpen, setReportOpen] = useState(false);
  const [showComments,    setShowComments]    = useState(false);
  const [comments,        setComments]        = useState(null);
  const [commentsLive,    setCommentsLive]    = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsError,   setCommentsError]   = useState(false);
  const [commentDraft,    setCommentDraft]    = useState('');
  const [commentSending,  setCommentSending]  = useState(false);
  const [commentPostError,setCommentPostError]= useState(false);
  const [imageFailed,     setImageFailed]     = useState(false);
  // Genuine-read engagement (see api/engagement.js) — declared before the
  // early returns below so it runs unconditionally on every render
  // (Rules of Hooks), reporting once this specific card has been ~60%
  // visible for 2s+. post?.id is undefined until the `if (!post...)` guard
  // below passes, which the hook already treats as "nothing to track yet."
  const cardRef = useRef(null);
  useEngagementTracking(cardRef, post?.id);
  // Real time this card's comments panel was left open — feeds the feed's
  // own ranking (see recordEngagementSignal server-side), same as video
  // watch time in VideoFeedView. Set when toggleComments opens the panel,
  // read (and cleared) when it closes.
  const commentsOpenedAtRef = useRef(null);
  useEffect(() => () => {
    if (commentsOpenedAtRef.current) {
      reportEngagementSignal({ postId: post?.id, source: post?.source, topic: post?.topic, commentsViewMs: Date.now() - commentsOpenedAtRef.current });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const commentsRef = useRef(comments);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);
  useEffect(() => setImageFailed(false), [post?.id, post?.mediaUrl]);

  const fetchComments = useCallback(async ({ background = false } = {}) => {
    if (!post?.id) return;
    if (!background) {
      setCommentsLoading(true);
      setCommentsError(false);
    }
    try {
      const currentCount = Array.isArray(commentsRef.current) ? commentsRef.current.length : 0;
      const limit = Math.min(50, Math.max(20, currentCount || 20));
      const { data } = await client.get(`/feed/${encodeURIComponent(post.id)}/comments`, {
        params: { limit },
      });
      // The source could not be reached: say so rather than showing "no comments".
      if (data.unavailable) {
        if (!background) { setCommentsError(true); setComments([]); }
        return;
      }
      const incoming = data.comments || [];
      setComments(prev => background ? mergeCommentLists(incoming, prev || []) : incoming);
      setCommentsLive(!!data.live);
      setCommentsHasMore(!!data.hasMore);
      const nextCount = Number.isFinite(data.commentsCount)
        ? data.commentsCount
        : (Number.isFinite(data.total) ? data.total : null);
      if (nextCount != null && nextCount !== post.commentsCount) {
        onPostUpdated?.({ id: post.id, commentsCount: nextCount });
      }
    } catch {
      if (!background) {
        setCommentsError(true);
        setComments([]);
      }
    } finally {
      if (!background) setCommentsLoading(false);
    }
  }, [post?.id, post?.commentsCount, onPostUpdated]);

  useEffect(() => {
    if (!showComments || !post?.id) return;
    const interval = window.setInterval(() => {
      if (document.hidden || commentsLoading || commentsLoadingMore || commentSending) return;
      fetchComments({ background: true });
    }, commentsLive ? COMMENTS_LIVE_REFRESH_MS : COMMENTS_PASSIVE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [showComments, post?.id, commentsLive, commentsLoading, commentsLoadingMore, commentSending, fetchComments]);

  const sourceCapability = useSourceCapability(post?.isExternal ? post : null);
  if (!post || typeof post !== 'object') return null;

  const c   = catStyle(post.group?.category);
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;

  if (post.source === 'youtube') return <YouTubeCard post={post} cardRef={cardRef} onMediaOpen={onMediaOpen} isMediaOpen={isMediaOpen} onPostUpdated={onPostUpdated} />;

  const isExternal     = post.isExternal;
  const isJob          = JOB_SOURCES.has(post.source);
  // Social posts often reuse their opening words as a title; show that text once.
  const showTitle      = Boolean(post.title) && !String(post.content || '').startsWith(String(post.title).replace(/(?:…|\.\.\.)$/, '').trim());
  const isCommunityPost = !isExternal && ['uficonnect', 'livecamera'].includes(post.source || 'uficonnect');
  const isRestaurantPost = post.source === 'restaurants' && post.ufiInteractive;
  const isUFIconnectInteractive = isCommunityPost || isRestaurantPost;
  const hasVideo       = post.mediaUrl && post.mediaType === 'video';
  const videoPlaylistUrl = hasVideo && post.source === 'bluesky' ? deriveBlueskyPlaylistUrl(post.mediaUrl) : null;
  const videoLinkUrl = post.mediaUrl || post.sourceUrl;
  // Articles from any RSS source can embed a real YouTube video (see
  // parseRSSItems' video detection backend-side — mediaUrl is a plain watch
  // URL in that case, same as a dedicated YouTube post's). Checked before
  // isDirectVideoUrl since a watch URL is never a direct file.
  const videoYouTubeId = hasVideo ? extractYouTubeId(videoLinkUrl) : null;
  // Same idea, for RSS articles embedding a Vimeo player instead (see
  // parseRSSItems' vimeo detection backend-side).
  const videoVimeoId = hasVideo && !videoYouTubeId ? extractVimeoId(videoLinkUrl) : null;
  const videoIsDirectFile = hasVideo && !videoPlaylistUrl && !videoYouTubeId && !videoVimeoId && isDirectVideoUrl(videoLinkUrl, post);
  const videoIsPlayable = hasVideo && (videoPlaylistUrl || videoIsDirectFile || videoYouTubeId || videoVimeoId);
  const commentCount   = post.commentsCount || 0;
  const commUrl        = commentUrl(post);
  const hasComments    = COMMENT_SOURCES.has(post.source) || isUFIconnectInteractive || Boolean(originalSourceUrl(post));
  const sectionLabel   = commentSectionLabel(post.source);
  const isArticle      = ARTICLE_SOURCES.has(post.source);
  const canWriteComment = isUFIconnectInteractive && !!token;

  async function loadMoreComments() {
    if (commentsLoadingMore || !comments) return;
    setCommentsLoadingMore(true);
    try {
      const { data } = await client.get(`/feed/${encodeURIComponent(post.id)}/comments`, {
        params: { offset: comments.length },
      });
      setComments(prev => mergeCommentLists([...(prev || []), ...(data.comments || [])]));
      setCommentsHasMore(!!data.hasMore);
    } catch {
      // Leave existing comments in place — the button just stays clickable to retry.
    } finally {
      setCommentsLoadingMore(false);
    }
  }

  function toggleComments() {
    if (showComments) {
      setShowComments(false);
      if (commentsOpenedAtRef.current) {
        reportEngagementSignal({ postId: post.id, source: post.source, topic: post.topic, commentsViewMs: Date.now() - commentsOpenedAtRef.current });
        commentsOpenedAtRef.current = null;
      }
      return;
    }
    setShowComments(true);
    commentsOpenedAtRef.current = Date.now();
    if (comments !== null && !commentsError) return;
    fetchComments();
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!canWriteComment || commentSending) return;
    const content = commentDraft.trim();
    if (!content) return;

    setCommentSending(true);
    setCommentPostError(false);
    try {
      const interactionPath = isRestaurantPost ? 'restaurants' : 'posts';
      const { data } = await client.post(`/${interactionPath}/${encodeURIComponent(post.id)}/comments`, { content });
      setComments(prev => mergeCommentLists([...(prev || []), commentToFeedComment(data.comment)]));
      setCommentsLive(true);
      setCommentDraft('');
      onPostUpdated?.(data.post || { ...post, commentsCount: data.commentsCount });
    } catch {
      setCommentPostError(true);
    } finally {
      setCommentSending(false);
    }
  }

  // Members are blocked account-wide; external accounts are hidden from this member's feeds.
  const accountKey = isExternal ? feedAccountKey(post) : '';
  const blockTarget = isExternal
    ? (accountKey ? { label: post.sourceLabel || post.author?.name || src.label } : null)
    : (post.author?.id && post.author.id !== profile?.id ? { label: post.author?.name || 'this member' } : null);
  async function blockAuthor() {
    if (!token) { showToast('Sign in to block accounts.', 'info'); return; }
    if (!blockTarget || blockBusy) return;
    const message = isExternal
      ? `Block ${blockTarget.label}? Their ${src.label} posts will no longer appear in your feeds.`
      : `Block ${blockTarget.label}? They won't be able to follow, message, or connect with you, and their posts will be hidden. You can unblock from Settings > Privacy at any time.`;
    if (!window.confirm(message)) return;
    setBlockBusy(true);
    try {
      if (isExternal) {
        const current = Array.isArray(profile?.roleSettings?.blockedFeedAccounts) ? profile.roleSettings.blockedFeedAccounts : [];
        const { data } = await client.patch('/profile', {
          roleSettings: { ...(profile?.roleSettings || {}), blockedFeedAccounts: [...new Set([...current, accountKey])] },
        });
        updateProfileLocally(data.profile || data);
      } else {
        await client.post(`/users/${encodeURIComponent(post.author.id)}/block`);
      }
      onBlocked?.(post);
      showToast(`Blocked ${blockTarget.label}.`, 'success');
    } catch {
      showToast('Could not block this account. Please try again.', 'error');
    } finally {
      setBlockBusy(false);
    }
  }

  const ownPost = !isExternal && !!profile?.id && post.author?.id === profile.id && isCommunityPost;
  async function copyPostLink() {
    const url = isExternal && post.sourceUrl ? post.sourceUrl : `${window.location.origin}/p/${encodeURIComponent(post.id)}`;
    try { await navigator.clipboard.writeText(url); showToast('Link copied.', 'success'); }
    catch { showToast('Could not copy the link. Open the post to share it.', 'error'); }
  }
  async function deletePost() {
    if (deleteBusy || !window.confirm('Delete this post? Its comments are deleted too. This cannot be undone.')) return;
    setDeleteBusy(true);
    try {
      await client.delete(`/posts/${encodeURIComponent(post.id)}`);
      onRemoved?.(post);
      showToast('Post deleted.', 'success');
    } catch (error) {
      showToast(error?.response?.data?.message || 'Could not delete this post. Please try again.', 'error');
      setDeleteBusy(false);
    }
  }
  // UFIconnect posts: copy the post link, open it, report or block its author,
  // and delete your own. External posts: copy the original link, report or block the account.
  const optionItems = [
    { label: isExternal ? 'Copy original link' : 'Copy link to post', onSelect: copyPostLink },
    !isExternal && { label: 'Open post', onSelect: () => navigate(`/p/${encodeURIComponent(post.id)}`) },
    !isExternal && post.author?.id && !ownPost && { label: 'View profile', detail: post.author?.name, onSelect: () => navigate(`/u/${post.author.id}`) },
    !ownPost && { label: 'Report post', onSelect: () => (token ? setReportOpen(true) : showToast('Sign in to report a post.', 'info')) },
    blockTarget && { label: isExternal ? 'Block account' : 'Block member', detail: blockTarget.label, danger: true, busy: blockBusy, ariaLabel: `Block ${blockTarget.label}`, onSelect: blockAuthor },
    ownPost && { label: 'Delete post', danger: true, busy: deleteBusy, onSelect: deletePost },
  ];

  return (
    <div ref={cardRef} className="card post-card" style={{ marginBottom: 12, '--source-color': src.color }}>
      <PostHeader
        post={post}
        member={!isExternal}
        to={!isExternal && post.author?.id ? (post.author.id === profile?.id ? '/profile' : `/u/${post.author.id}`) : undefined}
      />
      {(isJob || post.group || post.fromJoinedGroup || post.matchedByLocation) && (
        <div className="post-chrome-chips">
          {isJob && <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#059669', background: '#ECFDF5', padding: '2px 8px', borderRadius: 5 }}>Job</span>}
          {post.group && <span style={{ fontSize: '.68rem', fontWeight: 700, background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 5 }}>{post.group.name}</span>}
          <LocationMatchBadge post={post} />
          {post.fromJoinedGroup && <span title={isExternal ? 'Following this source in UFIconnect.' : 'You joined this UFIconnect group.'} style={{ fontSize: '.68rem', color: 'var(--muted)' }}>{isExternal ? 'Following source' : 'Joined'}</span>}
        </div>
      )}
      {reportOpen && (
        <ReportModal
          targetType="post"
          targetId={post.id}
          targetLabel="this post"
          onClose={() => setReportOpen(false)}
          onSubmitted={() => showToast('Report submitted — thank you.', 'success')}
        />
      )}

      {showTitle && (
        isExternal && post.sourceUrl ? (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <p style={{ fontWeight: 700, fontSize: '1.08rem', margin: '0 0 6px', lineHeight: 1.35 }}>
              {post.title}<span style={{ marginLeft: 5, fontSize: '.8rem', color: src.color }}>↗</span>
            </p>
          </a>
        ) : (
          <p style={{ fontWeight: 700, fontSize: '1.08rem', margin: '0 0 6px', lineHeight: 1.35 }}>{post.title}</p>
        )
      )}

      <PostText text={post.content} accent={isExternal ? src.color : undefined} />

      {post.mediaUrl && post.mediaType === 'image' && !imageFailed && (
        <button
          onClick={() => onMediaOpen?.(post)}
          style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer', marginTop: 12 }}
        >
          <div style={{ borderRadius: 14, overflow: 'hidden', background: 'var(--border)' }}>
            <img src={post.mediaUrl} alt={post.title || 'Post image'}
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 400 }}
              onError={() => setImageFailed(true)} />
          </div>
        </button>
      )}

      {hasVideo && videoYouTubeId ? (
        // A YouTube embed manages its own click-to-play/iframe swap (see
        // YouTubeEmbedBlock) — not wrapped in the onMediaOpen button below,
        // since that would nest an interactive iframe inside a button and
        // fight it for clicks. The thumbnail comes from YouTube's own CDN
        // (post.mediaUrl is the watch URL itself, not an image) — same
        // i.ytimg.com pattern the dedicated YouTube fetcher and the video
        // feed's resolveVideoSource both already rely on.
        <div style={{ marginTop: 12, position: 'relative' }}>
          <YouTubeEmbedBlock
            embedId={videoYouTubeId}
            videoKey={post.id}
            poster={`https://i.ytimg.com/vi/${videoYouTubeId}/hqdefault.jpg`}
            title={post.title}
            maxHeight={360}
            forcePause={isMediaOpen}
          />
          <span style={{ position: 'absolute', bottom: 10, right: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 4, pointerEvents: 'none' }}>
            <SourceMark source={post.source} label={src.icon} size={12} />
            {src.label}
          </span>
          <MaximizeButton onClick={() => onMediaOpen?.(post)} />
        </div>
      ) : hasVideo && videoVimeoId ? (
        // Same click-to-play/iframe-swap shape as the YouTube branch above,
        // except Vimeo has no public thumbnail CDN pattern to borrow like
        // i.ytimg.com — VimeoEmbedBlock falls back to a plain placeholder
        // instead of a poster frame when not yet playing.
        <div style={{ marginTop: 12, position: 'relative' }}>
          <VimeoEmbedBlock
            embedId={videoVimeoId}
            videoKey={post.id}
            poster={null}
            title={post.title}
            forcePause={isMediaOpen}
          />
          <span style={{ position: 'absolute', bottom: 10, right: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 4, pointerEvents: 'none' }}>
            <SourceMark source={post.source} label={src.icon} size={12} />
            {src.label}
          </span>
          <MaximizeButton onClick={() => onMediaOpen?.(post)} />
        </div>
      ) : hasVideo && videoIsPlayable ? (
        <button onClick={() => onMediaOpen?.(post)} style={{ all: 'unset', display: 'block', width: '100%', marginTop: 12, cursor: 'pointer' }}>
          <div style={{ borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#000' }}>
            {/* Autoplays muted/looping as it scrolls into view (see
                InlineAutoplayVideo); unsupported external media is omitted
                instead of producing a dead card. */}
            <InlineAutoplayVideo post={post}
              kind={videoPlaylistUrl ? 'hls' : 'file'}
              src={videoPlaylistUrl || videoLinkUrl}
              videoKey={post.id}
              poster={videoPlaylistUrl ? post.mediaPoster : undefined}
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 360 }}
              forcePause={isMediaOpen}
            />
            <span style={{ position: 'absolute', bottom: 10, right: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 4 }}>
              <SourceMark source={post.source} label={src.icon} size={12} />
              {src.label}
            </span>
          </div>
        </button>
        ) : null}

      {/* Actions: likes, comments, save, share, the options menu, then the source link. */}
      <div className="post-chrome-actions">
        <PostLikes post={post} onPostUpdated={onPostUpdated} />
        {hasComments && (
          <button
            type="button"
            className="post-chrome-action"
            onClick={toggleComments}
            aria-expanded={showComments}
            aria-label={showComments ? `Hide ${sectionLabel}` : `Show ${sectionLabel}${commentCount > 0 ? ` (${commentCount.toLocaleString()})` : ''}`}
            title={showComments ? `Hide ${sectionLabel}` : sectionLabel}
          >
            <CommentIcon />{commentCount > 0 && <span>{commentCount.toLocaleString()}</span>}
          </button>
        )}
        <SavePostButton post={post} className="post-chrome-action feed-save-post-button" showLabel={false} />
        <SharePostButton post={post} />
        <PostOptionsMenu items={optionItems} />
        <OpenOnSource
          post={post}
          label={`${isJob ? 'Apply' : post.isLiveCamera ? 'Watch live' : hasVideo ? 'Watch' : 'Open'}${post.isLiveCamera ? '' : ` on ${src.label}`}`}
          onClick={event => {
            event.stopPropagation();
            reportEngagementSignal({ postId: post.id, source: post.source, topic: post.topic, linkClick: true });
          }}
        />
      </div>

      {/* Inline comments / replies / answers / reviews */}
      {showComments && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>

          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: '.72rem', fontWeight: 700, color: src.color, textTransform: 'uppercase', letterSpacing: '.5px' }}>
              {sectionLabel}
            </span>
            {!commentsLive && (
              <span style={{ fontSize: '.62rem', color: 'var(--muted)', background: 'var(--border)', padding: '1px 6px', borderRadius: 4 }}>
                top picks
              </span>
            )}
            {commentsLive && (
              <span style={{ fontSize: '.62rem', color: '#059669', background: '#ECFDF5', padding: '1px 6px', borderRadius: 4 }}>
                live
              </span>
            )}
          </div>

          {/* Loading spinner */}
          {commentsLoading && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <span className="spinner spinner-primary" />
            </div>
          )}

          {/* Comment list */}
          {!commentsLoading && comments?.length > 0 && comments.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                background: `${src.color}18`, border: `1.5px solid ${src.color}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.75rem', fontWeight: 700, color: src.color,
              }}>
                {(c.author?.replace(/^(?:u\/|@)/, '') || '?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '.78rem' }}>{c.author}</span>
                  {c.type === 'commit' && <span style={{ fontSize: '.62rem', background: '#1e293b', color: '#94a3b8', borderRadius: 4, padding: '1px 5px' }}>commit</span>}
                  {c.type === 'issue'  && <span style={{ fontSize: '.62rem', background: '#14532d', color: '#86efac', borderRadius: 4, padding: '1px 5px' }}>issue</span>}
                  {c.score > 0 && (
                    <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>▲ {c.score.toLocaleString()}</span>
                  )}
                  <span style={{ fontSize: '.68rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(c.created)}</span>
                </div>
                <p style={{ fontSize: '.83rem', lineHeight: 1.6, margin: 0, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                  {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{c.body}</a> : c.body}
                </p>
              </div>
            </div>
          ))}

          {!commentsLoading && commentsError && (
            <div style={{ fontSize: '.78rem', color: 'var(--danger)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              {post.isExternal ? `Couldn't reach ${src.label} for ${sectionLabel.toLowerCase()} right now.` : "Couldn't load comments."}
              <button onClick={fetchComments} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600, padding: 0 }}>
                Try again
              </button>
            </div>
          )}
          {/* Replying to an external post happens through the member's connected account. */}
          {isExternal && sourceCapability && !sourceCapability.connected && (
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: '0 0 10px' }}>
              <Link to="/connected-accounts?interactions=1">Connect your {sourceCapability.label} account</Link> to like and comment on its posts.
            </p>
          )}
          {!commentsLoading && !commentsError && comments?.length === 0 && (
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: '0 0 10px' }}>No {sectionLabel.toLowerCase()} found.</p>
          )}

          {!commentsLoading && commentsHasMore && (
            <button
              onClick={loadMoreComments}
              disabled={commentsLoadingMore}
              style={{
                display: 'block', margin: '0 0 12px', background: 'none', border: 'none',
                color: src.color, cursor: commentsLoadingMore ? 'default' : 'pointer',
                fontSize: '.78rem', fontWeight: 700, padding: 0,
              }}
            >
              {commentsLoadingMore ? <span className="spinner" style={{ width: 12, height: 12 }} /> : `Load more ${sectionLabel.toLowerCase()}`}
            </button>
          )}

          {isUFIconnectInteractive && !token && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 10 }}>
              <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Sign in to comment.</span>
              <Link to="/login"><button type="button" className="btn btn-primary btn-sm">Sign in</button></Link>
            </div>
          )}

          {/* Read-more link — always shown at bottom */}
          {canWriteComment && (
            <form onSubmit={submitComment} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
              <input
                className="form-input"
                value={commentDraft}
                onChange={e => {
                  setCommentDraft(e.target.value);
                  if (commentPostError) setCommentPostError(false);
                }}
                placeholder="Write a comment..."
                maxLength={1000}
                style={{ flex: 1, fontSize: '.86rem' }}
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={commentSending || !commentDraft.trim()}
                style={{ flexShrink: 0 }}
              >
                {commentSending ? <span className="spinner" /> : 'Send'}
              </button>
            </form>
          )}

          {commentPostError && (
            <div style={{ fontSize: '.76rem', color: 'var(--danger)', marginTop: 8 }}>
              Couldn't post that comment. Try again.
            </div>
          )}

          {commUrl && (
            <a
              href={commUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                textDecoration: 'none', marginTop: comments?.length > 0 ? 12 : 0,
                paddingTop: comments?.length > 0 ? 10 : 0,
                borderTop: comments?.length > 0 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span style={{ fontSize: '.82rem', fontWeight: 700, color: src.color }}>
                <SourceMark source={post.source} label={src.icon} size={12} />
                {isArticle ? 'Read all ' : 'View all '}
                {commentCount > 0 ? `${commentCount.toLocaleString()} ` : ''}
                {sectionLabel.toLowerCase()} on {src.label}
              </span>
              <span style={{ fontSize: '.72rem', color: src.color, background: `${src.color}14`, padding: '2px 8px', borderRadius: 5, fontWeight: 700 }}>↗</span>
            </a>
          )}
        </div>
      )}
      {!isUFIconnectInteractive && <ConnectedPostActions post={post} active={showComments} showFallback={!commUrl} />}
    </div>
  );
}); // PostCard memo

class FeedErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(err) { return { error: err }; }
  componentDidCatch(err, info) {
    console.error('[Feed] render error:', err, info?.componentStack);
    reportClientError({ message: err?.message, stack: err?.stack, componentStack: info?.componentStack });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="empty-state">
          <div className="empty-icon">!</div>
          <div className="empty-title">Some posts couldn't be displayed</div>
          <div className="empty-desc">
            <button className="btn btn-ghost btn-sm" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const FEED_CACHE_KEY       = 'ufi_feed_v1';
const FEED_CACHE_SILENT_MS = 10 * 60 * 1000; // silent bg refresh within 10 min
const FEED_CACHE_SHOW_MS   = 60 * 60 * 1000; // show stale posts up to 1 hr

function readFeedCache(userId) {
  try {
    const key = memberStorageKey(FEED_CACHE_KEY, userId);
    if (!key) return null;
    const raw = privateSessionStorage.getItem(key);
    if (!raw) return null;
    const { posts, ts } = JSON.parse(raw);
    if (!Array.isArray(posts)) return null;
    const age = Date.now() - ts;
    if (age > FEED_CACHE_SHOW_MS) return null;
    return { posts, fresh: age < FEED_CACHE_SILENT_MS };
  } catch { return null; }
}

function writeFeedCache(userId, posts) {
  try {
    const key = memberStorageKey(FEED_CACHE_KEY, userId);
    if (!key) return;
    privateSessionStorage.setItem(key, JSON.stringify({ posts: posts.slice(0, 100), ts: Date.now() }));
  } catch {}
}

// forcedMode locks a dedicated route onto one mode while preserving this
// shared feed engine's cursor pagination, equalizer, seen-state, and media
// behavior. Groups lives inside Home and defaults to the signed-in member's
// joined communities; group detail pages remain separate destinations.
export default function Feed({ forcedMode, groupScope = 'joined' } = {}) {
  const { profile, updateProfileLocally } = useAuth();
  const routeLocation = useLocation();
  const navigate = useNavigate();
  const routeFeedParams = new URLSearchParams(routeLocation.search);
  const routeRequestedFeed = routeFeedParams.get('feed');
  const routeRequestsAllHome = !forcedMode && routeRequestedFeed === 'feed' && routeFeedParams.get('all') === '1';
  const [connecting,    setConnecting]   = useState(false);
  // Set from a single-source-tab response's `locked:true` (see FEED_SOCIAL_TABS
  // server-side) — a gated platform tab clicked without that account connected.
  // null whenever the current view isn't a locked single-gated-source tab.
  const [lockedPlatform, setLockedPlatform] = useState(null);
  const publicGroupsFeed = groupScope === 'public' || routeFeedParams.get('groupScope') === 'public';
  const _saved = routeRequestsAllHome ? null : loadFeedState(profile?.id);
  const routeInitialMode = routeRequestedFeed === 'local' ? 'countries' : routeRequestedFeed;
  const initialViewMode = forcedMode || (HOME_VIEW_MODES.has(routeInitialMode) ? routeInitialMode : _saved?.viewMode || 'feed');
  const _cache = !forcedMode && initialViewMode === 'feed' ? readFeedCache(profile?.id) : null;
  const [posts,         setPosts]        = useState(_cache?.posts || []);
  const [travelLiveFeeds, setTravelLiveFeeds] = useState([]);
  const [travelStatus, setTravelStatus] = useState(null);
  const [travelPaginationError, setTravelPaginationError] = useState('');
  // Following mode's per-source fetch failures (bad scope, API not
  // enabled, expired token) — see getFollowingFeedPosts's own comment
  // server-side. Surfaced in the empty state below instead of a real
  // failure reading identically to "this account just has nothing new."
  const [sourceErrors,  setSourceErrors]  = useState({});
  const activeMemberIdRef = useRef(profile?.id || null);
  const [loading,       setLoading]      = useState(!_cache);
  const [feedError,     setFeedError]    = useState(null);
  const [refreshing,    setRefreshing]   = useState(false);
  const [queuedRefresh, setQueuedRefresh] = useState(null);
  const [loadingMore,   setLoadingMore]  = useState(false);
  const [remotePage,    setRemotePage]   = useState(2);
  const [remoteHasMore, setRemoteHasMoreState] = useState(true);
  const remoteHasMoreRef = useRef(true);
  const setRemoteHasMore = useCallback((value) => {
    const next = typeof value === 'function' ? value(remoteHasMoreRef.current) : value;
    remoteHasMoreRef.current = Boolean(next);
    setRemoteHasMoreState(Boolean(next));
  }, []);
  // A direct Home action must not restore the last saved mode or source
  // filters. It opens the member's full personalized Home mix instead.
  const initialFilters = ['feed', 'following'].includes(initialViewMode)
    ? {
        ...DEFAULT_FILTERS,
        topics: Array.isArray(_saved?.filters?.topics) ? _saved.filters.topics : [],
      }
    : { ...DEFAULT_FILTERS, ...(initialViewMode === 'countries' && _saved?.viewMode !== 'countries' ? {} : _saved?.filters || {}), ...(initialViewMode === 'countries' ? { sources: [] } : {}), sort: 'newest' };
  const [search,        setSearch]       = useState(initialViewMode === 'countries' ? '' : _saved?.search || '');
  const [filterOpen,    setFilterOpen]   = useState(false);
  const [topicFilterOpen, setTopicFilterOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceFavorites, setSourceFavorites] = useState(() => (
    normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites)
  ));
  const [sourceFavoriteDraft, setSourceFavoriteDraft] = useState(() => {
    const initial = normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites);
    return [...initial[initialViewMode === 'following' ? 'following' : 'feed']];
  });
  const [sourceFavoriteSaving, setSourceFavoriteSaving] = useState(false);
  const [sourceFavoriteError, setSourceFavoriteError] = useState('');
  const [mediaLightboxPostId, setMediaLightboxPostId] = useState(null);
  const [filters, setFilters] = useState(initialFilters);
  const [activeTabs,    setActiveTabs]    = useState(initialViewMode === 'countries' ? [] : _saved?.activeTabs || []); // [] = All
  const [viewMode,      setViewMode]      = useState(initialViewMode);
  const [locationFilters, setLocationFilters] = useState(() => normalizeLocationFilters(profile?.roleSettings?.feedLocation));
  const [locationSaving, setLocationSaving] = useState(false);
  const locationSavingRef = useRef(false);
  const [locationMessage, setLocationMessage] = useState('');
  const disabledSourceKey = useMemo(() => (
    Array.isArray(profile?.roleSettings?.disabledSources)
      ? [...new Set(profile.roleSettings.disabledSources.map(source => String(source).trim().toLowerCase()).filter(Boolean))].sort().join(',')
      : ''
  ), [profile?.roleSettings?.disabledSources]);
  const profileSourceFavoritesKey = JSON.stringify(profile?.roleSettings?.feedSourceFavorites || null);
  const requestedHomeToolPanel = useMemo(() => {
    const panel = new URLSearchParams(routeLocation.search).get('panel');
    return ['sources', 'accounts', 'skills', 'files'].includes(panel) ? panel : null;
  }, [routeLocation.search]);

  const filterBtnRef  = useRef(null);
  const panelRef      = useRef(null);
  const topicFilterBtnRef = useRef(null);
  const topicPanelRef = useRef(null);
  const sourceMenuBtnRef = useRef(null);
  const sourceMenuPanelRef = useRef(null);
  const knownIds      = useRef(new Set((_cache?.posts || []).map(p => p.id).filter(Boolean)));
  const markKnownId = useCallback((id) => {
    if (!id || knownIds.current.has(id)) return;
    knownIds.current.add(id);
  }, []);
  const sentinelRef   = useRef(null);
  const prefetchAnchorRef = useRef(null);
  // Synchronous guard for loadMoreRemote — see its own comment. The
  // loadingMore *state* the UI spinner reads isn't visible synchronously
  // (React batches/defers the re-render), so a fast scroll firing the
  // IntersectionObserver's callback several times before that update lands
  // let every one of those calls read the same stale loadingMore:false and
  // all start their own fetch. A ref updates immediately, in the same tick.
  const loadingMoreRef = useRef(false);
  const paginationRequestIdRef = useRef(0);
  const activeTabsRef = useRef(_saved?.activeTabs || []);
  const filtersRef    = useRef(initialFilters);
  const viewModeRef   = useRef(initialViewMode);
  const locationFiltersRef = useRef(normalizeLocationFilters(profile?.roleSettings?.feedLocation));
  const searchRef     = useRef(_saved?.search || '');
  const postsRef      = useRef([]);
  const loadStateRef  = useRef({ loading: false, refreshing: false, loadingMore: false });
  // Feed view changes can overlap an already-running request (for example,
  // Following finishing just after Home is selected). Only the most recently
  // started request is allowed to update the visible feed state.
  const feedRequestIdRef = useRef(0);
  const feedContextRef = useRef(`${profile?.id}:${initialViewMode}:${initialViewMode === 'groups' && publicGroupsFeed}`);
  const allHomeRouteKeyRef = useRef(routeRequestsAllHome ? routeLocation.key : null);
  const liveRefreshTimeoutRef = useRef(null);
  const sourcePreferenceKeyRef = useRef(disabledSourceKey);
  // Sent as ?seed= on every feed request — the backend folds it into this
  // user's rotation offset into the shared pool (see rotateForUser
  // server-side). Regenerated only on an explicit refresh (inside loadFeed,
  // gated on manual===true) and otherwise left alone, so pagination within
  // a sitting keeps slicing the same rotated view consistently — without
  // this, refreshing handed back the exact same rotation of the exact same
  // pool every time, since neither the user nor the still-warm pool changed.
  const refreshSeedRef = useRef(Math.random().toString(36).slice(2));
  // Opaque date-cursor from the backend (see getCursorFeedPage server-side)
  // for newest-sort feed views. Following still pages by number.
  const remoteCursorRef = useRef(null);

  const loadFeed = useCallback(async (manual = false, tabs = [], options = {}) => {
    const {
      silent = false,
      live = manual,
      preserveScroll = silent,
      q,
      filters: requestedFilters,
      mode: requestedMode,
      replace = false,
      promoteIncoming = false,
      // Server-side bust=1 with no ?source forces EVERY source worker (30+)
      // to refetch from its external API right now — that's what a tab
      // click should never trigger for "All"/view-mode tabs, since it's the
      // same burst that took the API down under concurrent load. Defaults
      // to `manual` so existing manual-refresh callers (scroll-to-refresh,
      // the 10-min auto-refresh) keep their current behavior unchanged.
      bust = manual,
    } = options || {};
    // manual is specifically what every explicit user refresh action passes
    // (tab click, Refresh now, scroll-to-refresh) — background silent syncs
    // and filter/search changes call this with manual:false, so gating on
    // it here (rather than threading a separate flag through every one of
    // those call sites) regenerates the seed exactly when the user actually
    // asked for a refresh, and nowhere else.
    if (manual) refreshSeedRef.current = Math.random().toString(36).slice(2);
    const activeFilters = { ...DEFAULT_FILTERS, ...(requestedFilters || filtersRef.current) };
    const activeMode = requestedMode || viewModeRef.current;
    const feedContext = `${profile?.id}:${activeMode}:${activeMode === 'groups' && publicGroupsFeed}`;
    if (feedContextRef.current !== feedContext) {
      feedContextRef.current = feedContext;
      postsRef.current = [];
      knownIds.current = new Set();
      remoteCursorRef.current = null;
      paginationRequestIdRef.current += 1;
      loadingMoreRef.current = false;
      setPosts([]);
      setRemotePage(2);
      setLoadingMore(false);
      setLoading(true);
      setLockedPlatform(null);
      setFeedError(null);
    }
    activeFilters.sort = activeMode === 'groups' && publicGroupsFeed ? 'popular' : 'newest';
    const activeSearch = discoveryQuery(activeMode, activeFilters, typeof q === 'string' ? q : searchRef.current);
    const activeSourceTabs = Array.isArray(tabs) ? tabs : activeTabsRef.current;
    if (EMBEDDED_HOME_MODES.has(activeMode)) {
      // UFI keeps its existing focused API and interaction component, but
      // lives inside Home. Invalidate any older feed request
      // so it cannot overwrite the selected in-place view when it finishes.
      feedRequestIdRef.current += 1;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setLockedPlatform(null);
      setFeedError(null);
      setRemoteHasMore(false);
      return;
    }
    const requestedSources = ['feed', 'following'].includes(activeMode)
      ? (activeFilters.sources?.length ? activeFilters.sources : activeSourceTabs)

      : [];
    const requestId = ++feedRequestIdRef.current;
    const isCurrentRequest = () => requestId === feedRequestIdRef.current;
    if (!silent) {
      if (manual) setRefreshing(true);
      else setLoading(true);
    }
    try {
      const params = new URLSearchParams({
        limit: `${FEED_PAGE_SIZE}`,
        mode: activeMode,
        sort: activeFilters.sort,
        seed: refreshSeedRef.current,
      });
      if (activeFilters.timeRange && activeFilters.timeRange !== 'all') params.set('timeRange', activeFilters.timeRange);
      if (activeFilters.topics?.length) params.set('topics', activeFilters.topics.join(','));
      if (activeSearch) params.set('q', activeSearch);
      if (requestedSources.length === 1) params.set('source', requestedSources[0]);
      else if (requestedSources.length > 1) params.set('sources', requestedSources.join(','));
      if (activeMode === 'groups' && publicGroupsFeed) params.set('groupScope', 'public');
      if (bust) {
        params.set('bust', '1');
      }
      const data = await requestFeedPage(params, profile);
      // A response from the view the member just left must never replace the
      // newer Home/Following/Travel response that is already on screen.
      if (!isCurrentRequest()) return;
      if (data.locked) {
        setFeedError(null);
        // Single gated-source tab, not connected — show the connect wall
        // instead of an empty/broken post list. Clears itself the moment
        // any other view is loaded (tab switch, viewMode switch, etc.) since
        // every other loadFeed call path runs this same branch and would
        // simply not set it again.
        setLockedPlatform(data.source || requestedSources[0] || null);
        setPosts([]);
        setTravelLiveFeeds([]);
        setRemoteHasMore(false);
        return;
      }
      setLockedPlatform(null);
      setFeedError(null);
      const incoming = (data.posts || []).filter(post => (
        activeMode !== 'following' || !FOLLOWING_EXCLUDED_SOURCES.has(String(post?.source || '').toLowerCase())
      ));
      if (activeMode === 'countries' && viewModeRef.current === 'countries') {
        setTravelLiveFeeds(Array.isArray(data.liveFeeds) ? data.liveFeeds : []);
        setTravelStatus(data.travel || null);
        setTravelPaginationError('');
      } else if (viewModeRef.current !== 'countries') {
        setTravelLiveFeeds([]);
      }
      const previous = postsRef.current;
      const shouldMerge = (manual || live) && !replace;
      // previous first, incoming second — mergeFeedPosts' dedup keeps
      // whichever copy of a post it sees *last* on a createdAt tie (its
      // `>=` comparison), and a post's createdAt never changes between
      // fetches, only its counts do. With incoming first (the old order),
      // every periodic refresh's fresh comment/like counts got silently
      // overwritten by the stale copy already on screen the moment
      // `previous` was processed second — confirmed live as the actual
      // reason counts never appeared to update no matter how long a post
      // sat in the feed. This order makes the fresh copy win instead.
      const preserveEqualizer = usesMemberEqualizer(activeMode, activeSearch);
      let nextPosts = shouldMerge
        ? mergeFeedPosts([...previous, ...incoming], activeFilters.sort, preserveEqualizer)
        : mergeFeedPosts(incoming, activeFilters.sort, preserveEqualizer);
      if (shouldMerge && promoteIncoming && incoming.length) {
        // An explicit refresh brings the new balanced cohort to the top.
        // Keep older cards underneath and retain refreshed engagement data.
        const first = mergeFeedPosts(incoming, activeFilters.sort, preserveEqualizer);
        const incomingIds = new Set(first.map(post => post.id));
        nextPosts = [...first, ...nextPosts.filter(post => !incomingIds.has(post.id))];
      }

      if (shouldMerge) {
        const prevIds = new Set(previous.map(p => p.id).filter(Boolean));
        const fresh = nextPosts.filter(p => p?.id && !prevIds.has(p.id)).length;
        if (fresh > 0 && manual && !preserveScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (manual && replace && !preserveScroll && previous.length > FEED_PAGE_SIZE) {
        // A user-initiated refresh with replace:true (tab-click refresh, the
        // Feed/Following toggle) swaps the whole list for a short fresh
        // page-1 view. If the list was previously long and the user was
        // scrolled deep into it, replacing it out from under them leaves the
        // viewport pointed at whitespace past the end of the new, much
        // shorter list — looking exactly like the refresh emptied the feed.
        // Only jumps when the old list was actually long enough for this to
        // matter, so a routine top-of-page refresh doesn't visibly "jump".
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // Only for same-view refreshes (merge, not replace) — a refresh that
      // came back empty shouldn't blank an already-populated list. A real
      // context switch (replace:true — different view mode, different
      // source tab, a filter change) must still be allowed to land on a
      // genuinely empty result; otherwise switching to a view with nothing
      // in it (e.g. Following with zero followed-people posts) silently
      // left the *previous* view's posts on screen instead of showing empty.
      if (manual && !replace && nextPosts.length === 0 && previous.length > 0) {
        return;
      }
      knownIds.current = new Set(nextPosts.map(p => p.id).filter(Boolean));
      postsRef.current = nextPosts;
      setPosts(nextPosts);
      if (activeMode === 'feed' && !activeSearch) writeFeedCache(profile?.id, nextPosts);
      // Only reset pagination state (page counter AND cursor) on a genuine
      // context reset, same condition as the existing remotePage reset —
      // a merge (silent background top-up) must NOT rewind the cursor,
      // since loadMoreRemote may already be paginated well past what this
      // small merge batch's own cursor would imply, and rewinding it would
      // re-fetch (and re-show) content already scrolled past.
      if (!shouldMerge || previous.length === 0 || replace) {
        setRemotePage(2);
        remoteCursorRef.current = data.cursor || null;
      }
      setRemoteHasMore(CONTINUOUS_FEED_MODES.has(activeMode) || data.hasMore !== false);
      setSourceErrors(data.sourceErrors || {});
      if (['countries', 'restaurants', 'bars'].includes(activeMode)) {
        setLocationMessage(data.locationRequired || data.providerError || '');
      }
    } catch (e) {
      if (!isCurrentRequest()) return;
      console.error(e);
      const status = e?.response?.status;
      const message = status === 401
        ? 'Your session could not load the feed. Sign in again to refresh your access.'
        : status
          ? `The feed request failed with HTTP ${status}.`
          : 'The feed request did not complete. Check the API connection and try again.';
      if (activeMode === 'countries' && replace) {
        postsRef.current = [];
        setPosts([]);
        setTravelLiveFeeds([]);
        setTravelStatus(null);
      }
      if (!silent || postsRef.current.length === 0) setFeedError(message);
    }
    finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [profile, publicGroupsFeed]);

  useEffect(() => {
    if (viewMode !== 'countries' || locationSaving || !(travelStatus?.camerasChecking || travelStatus?.storiesUpdating)) return undefined;
    const timer = setInterval(() => {
      if (!document.hidden) loadFeed(false, [], { silent: true, live: true, preserveScroll: true, bust: false });
    }, 20000);
    return () => clearInterval(timer);
  }, [viewMode, locationSaving, travelStatus?.camerasChecking, travelStatus?.storiesUpdating, loadFeed]);

  // Keep postsRef in sync so loadFeed can read current posts without a dep cycle
  useEffect(() => { postsRef.current = posts; }, [posts]);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { locationFiltersRef.current = locationFilters; }, [locationFilters]);
  useEffect(() => { searchRef.current = search; }, [search]);

  // Favorite source shortcuts belong to the member, not the browser. Keep
  // the profile-backed copy authoritative when an account finishes loading
  // or a save from another session refreshes the profile snapshot.
  useEffect(() => {
    const next = normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites);
    setSourceFavorites(next);
    setSourceFavoriteDraft([...next[viewModeRef.current === 'following' ? 'following' : 'feed']]);
    setSourceFavoriteError('');
    setSourceMenuOpen(false);
  }, [profile?.id, profileSourceFavoritesKey]);

  // Source switches are saved per member in roleSettings. Clear any active
  // source filters that were just turned off, then reload from the API so a
  // disabled source cannot linger in the current personal feed.
  useEffect(() => {
    if (!profile?.id || sourcePreferenceKeyRef.current === disabledSourceKey) return;
    sourcePreferenceKeyRef.current = disabledSourceKey;
    if (!['feed', 'following'].includes(viewModeRef.current)) return;
    const disabled = new Set(disabledSourceKey ? disabledSourceKey.split(',') : []);
    const nextTabs = activeTabsRef.current.filter(source => !disabled.has(source));
    const nextFilters = {
      ...filtersRef.current,
      sources: (filtersRef.current.sources || []).filter(source => !disabled.has(source)),
    };
    activeTabsRef.current = nextTabs;
    filtersRef.current = nextFilters;
    setActiveTabs(nextTabs);
    setFilters(nextFilters);
    setRemotePage(2);
    setRemoteHasMore(true);
    loadFeed(false, nextTabs, { filters: nextFilters, replace: true });
  }, [disabledSourceKey, loadFeed, profile?.id]);

  // Persist filter state so the page reopens with the same settings
  useEffect(() => {
    saveFeedState(profile?.id, filters, activeTabs, search, viewMode, locationFilters);
  }, [profile?.id, filters, activeTabs, search, viewMode, locationFilters]);
  useEffect(() => {
    if (!profile?.id || activeMemberIdRef.current === profile.id) return;
    activeMemberIdRef.current = profile.id;
    const saved = loadFeedState(profile.id);
    const nextMode = forcedMode || (HOME_VIEW_MODES.has(routeInitialMode) ? routeInitialMode : saved?.viewMode || 'feed');
    const savedTopics = Array.isArray(saved?.filters?.topics) ? saved.filters.topics : [];
    const nextFilters = ['feed', 'following'].includes(nextMode)
      ? { ...DEFAULT_FILTERS, topics: savedTopics }
      : { ...DEFAULT_FILTERS, ...(nextMode === 'countries' && saved?.viewMode !== 'countries' ? {} : saved?.filters || {}), ...(nextMode === 'countries' ? { sources: [] } : {}), sort: 'newest' };
    const nextTabs = nextMode === 'countries' ? [] : saved?.activeTabs || [];
    const nextSearch = nextMode === 'countries' ? '' : saved?.search || '';
    const nextLocation = normalizeLocationFilters(profile.roleSettings?.feedLocation);
    filtersRef.current = nextFilters;
    activeTabsRef.current = nextTabs;
    searchRef.current = nextSearch;
    viewModeRef.current = nextMode;
    locationFiltersRef.current = nextLocation;
    setFilters(nextFilters);
    setActiveTabs(nextTabs);
    setSearch(nextSearch);
    setViewMode(nextMode);
    setLocationFilters(nextLocation);
    setRemotePage(2);
    setRemoteHasMore(true);
    remoteCursorRef.current = null;
  }, [forcedMode, profile?.id, profile?.roleSettings?.feedLocation, routeInitialMode]);
  useEffect(() => {
    loadStateRef.current = { loading, refreshing, loadingMore };
  }, [loading, refreshing, loadingMore]);

  const profileLocationKey = `${profile?.id || ''}:${profile?.roleSettings?.feedLocation?.country || ''}:${profile?.roleSettings?.feedLocation?.city || ''}`;
  useEffect(() => {
    if (!profile?.id) return;
    const saved = normalizeLocationFilters(profile.roleSettings?.feedLocation);
    const current = locationFiltersRef.current;
    if (saved.country === current.country && saved.city === current.city) return;
    locationFiltersRef.current = saved;
    setLocationFilters(saved);
    loadFeed(false, activeTabsRef.current, { replace: true });
  }, [profileLocationKey, profile?.id, profile?.roleSettings?.feedLocation, loadFeed]);

  // This is now the app's one real "refresh" action — clicking Feed (while
  // already on Feed) re-pulls the current view exactly as filtered, rather
  // than resetting to the unfiltered aggregate. Individual source-tab chips
  // (see toggleTab) just change which filter is active now; they no longer
  // trigger their own refresh — Feed is the single place that does, so
  // there's one clear path responsible for going back to the server for
  // fresh, freshly-sorted data instead of several buttons each doing their
  // own version of it.
  const switchViewMode = useCallback((mode, { resetHome = false } = {}) => {
    const requestedMode = mode === 'local' ? 'countries' : mode;
    const nextMode = HOME_VIEW_MODES.has(requestedMode) ? requestedMode : 'feed';
    const usesSources = ['feed', 'following'].includes(nextMode);
    const allowedSourceIds = nextMode === 'following' ? FOLLOWING_FEED_SOURCE_IDS : HOME_FEED_SOURCE_IDS;
    const nextTabs = resetHome || !usesSources
      ? []
      : normalizeSourceSelection(activeTabsRef.current, allowedSourceIds);
    const currentTopics = Array.isArray(filtersRef.current.topics) ? filtersRef.current.topics : [];
    const nextFilters = usesSources
      ? { ...DEFAULT_FILTERS, topics: currentTopics }
      : nextMode === 'countries' && viewModeRef.current !== 'countries' ? { ...DEFAULT_FILTERS }
      : { ...filtersRef.current, sources: [] };
    const clearSearch = resetHome || (nextMode === 'countries' && viewModeRef.current !== 'countries');
    const nextSearch = clearSearch ? '' : searchRef.current;
    viewModeRef.current = nextMode;
    activeTabsRef.current = nextTabs;
    filtersRef.current = nextFilters;
    if (clearSearch) {
      searchRef.current = '';
      setSearch('');
    }
    setViewMode(nextMode);
    setActiveTabs(nextTabs);
    setFilters(nextFilters);
    setFilterOpen(false);
    setTopicFilterOpen(false);
    setSourceMenuOpen(false);
    setRemotePage(2);
    setRemoteHasMore(true);
    if (nextMode !== 'countries') setTravelLiveFeeds([]);
    // Countries and restaurant feeds are location-first. Clear source controls
    // before fetching so a hidden Home/Following source cannot leak into
    // one of those views.
    loadFeed(true, nextTabs, {
      mode: nextMode,
      filters: nextFilters,
      q: nextSearch,
      // Always a full replace now, whether this is a real context switch
      // (Feed vs Following — obviously different data) or clicking the tab
      // you're already on as a refresh. Refresh used to merge the fresh
      // pull in on top of everything already scrolled-in, which could leave
      // old + new content interleaved indefinitely and didn't read as an
      // actual refresh — a user-initiated refresh should hand back to a
      // clean page-1 view, not a merge.
      replace: true,
      // Feed spans every source — busting here would force all 30+ source
      // workers to refetch externally on every click. Pulls the latest from
      // the server's already-continuously-updated cache instead, which is
      // what "refresh" should mean for an aggregate view.
      bust: false,
    });
  }, [loadFeed]);

  const activateHomeView = useCallback((mode) => {
    if (viewModeRef.current === mode) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      window.dispatchEvent(new Event('ufi:refresh-selected-feed'));
      return;
    }
    switchViewMode(mode);
  }, [switchViewMode]);

  const selectGroupScope = useCallback((scope) => {
    const params = new URLSearchParams(routeLocation.search);
    params.set('feed', 'groups');
    params.delete('all');
    if (scope === 'public') params.set('groupScope', 'public');
    else params.delete('groupScope');
    navigate({ pathname: '/', search: `?${params.toString()}` }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [navigate, routeLocation.search]);

  const setHomeToolPanel = useCallback((panel) => {
    const params = new URLSearchParams(routeLocation.search);
    if (panel) params.set('panel', panel);
    else params.delete('panel');
    const nextSearch = params.toString();
    navigate({ pathname: '/', search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
  }, [navigate, routeLocation.search]);

  useEffect(() => {
    if (forcedMode) return;
    const params = new URLSearchParams(routeLocation.search);
    const requestedParam = params.get('feed');
    const requested = requestedParam === 'local' ? 'countries' : requestedParam;
    const requestsAllHome = requested === 'feed' && params.get('all') === '1';
    if (requestsAllHome) {
      if (allHomeRouteKeyRef.current === routeLocation.key) return;
      allHomeRouteKeyRef.current = routeLocation.key;
      switchViewMode('feed', { resetHome: true });
      return;
    }
    allHomeRouteKeyRef.current = null;
    if (!HOME_VIEW_MODES.has(requested) || requested === viewModeRef.current) return;
    switchViewMode(requested);
  }, [forcedMode, routeLocation.key, routeLocation.search, switchViewMode]);

  const applyFilters = useCallback((nextFilters) => {
    const next = { ...DEFAULT_FILTERS, ...(nextFilters || {}) };
    next.sort = 'newest';
    const allowedSourceIds = viewModeRef.current === 'following'
      ? FOLLOWING_FEED_SOURCE_IDS
      : viewModeRef.current === 'feed' ? HOME_FEED_SOURCE_IDS : [];
    next.sources = normalizeSourceSelection(next.sources, allowedSourceIds);
    if (next.sources.length > 0) {
      activeTabsRef.current = [];
      setActiveTabs([]);
    }
    filtersRef.current = next;
    setFilters(next);
    setRemotePage(2);
    setRemoteHasMore(true);
    loadFeed(false, activeTabsRef.current, {
      filters: next,
      q: searchRef.current,
      replace: true,
    });
  }, [loadFeed]);

  const submitFeedSearch = useCallback((query) => {
    const nextSearch = String(query || '').trim().slice(0, 500);
    searchRef.current = nextSearch;
    setSearch(nextSearch);
    setRemotePage(2);
    setRemoteHasMore(true);
    // Search narrows the current feed without changing its sources, topics,
    // category, location, or the member's equalizer preferences.
    return loadFeed(false, activeTabsRef.current, {
      filters: filtersRef.current,
      q: nextSearch,
      replace: true,
    });
  }, [loadFeed]);

  const clearSourceSelection = useCallback(() => {
    activeTabsRef.current = [];
    setActiveTabs([]);
    applyFilters({ ...filtersRef.current, sources: [] });
  }, [applyFilters]);

  const applyTopicFilters = useCallback((topics) => {
    applyFilters({
      ...filtersRef.current,
      topics: Array.isArray(topics) ? topics : [],
    });
  }, [applyFilters]);

  const openUfiShop = useCallback(() => {
    setFilterOpen(false);
    setTopicFilterOpen(false);
    setSourceMenuOpen(false);
    navigate('/?feed=ufi&channel=shop');
  }, [navigate]);


  const clearFeedControls = useCallback(() => {
    activeTabsRef.current = [];
    filtersRef.current = DEFAULT_FILTERS;
    searchRef.current = '';
    setActiveTabs([]);
    setFilters(DEFAULT_FILTERS);
    setSearch('');
    setRemotePage(2);
    setRemoteHasMore(true);
    loadFeed(false, [], { filters: DEFAULT_FILTERS, q: '', replace: true });
  }, [loadFeed]);

  const applyLocationFilters = useCallback(async (event, selection = null) => {
    event?.preventDefault();
    if (locationSavingRef.current) return;
    locationSavingRef.current = true;
    const next = normalizeLocationFilters(selection || locationFiltersRef.current);
    locationFiltersRef.current = next;
    setLocationFilters(next);
    setLocationSaving(true);
    setLocationMessage('');
    let saveError = '';
    try {
      const { data } = await client.patch('/profile', {
        roleSettings: { ...(profile?.roleSettings || {}), feedLocation: next },
      });
      updateProfileLocally(data.profile || data);
      setLocationMessage(next.country || next.city ? 'Location saved for your feeds.' : 'Location filter cleared.');
    } catch {
      const stored = normalizeLocationFilters(profile?.roleSettings?.feedLocation);
      locationFiltersRef.current = stored;
      setLocationFilters(stored);
      saveError = 'Could not save this location. Your previous feed location is still active.';
    } finally {
      setRemotePage(2);
      setRemoteHasMore(true);
      await loadFeed(true, activeTabsRef.current, { replace: true, preserveScroll: true, bust: false });
      if (saveError) setLocationMessage(saveError);
      locationSavingRef.current = false;
      setLocationSaving(false);
    }
    return !saveError;
  }, [loadFeed, profile?.roleSettings, updateProfileLocally]);

  const clearLocationFilters = useCallback(() => {
    applyLocationFilters(null, { country: '', city: '' });
  }, [applyLocationFilters]);

  const selectTravelLiveLocation = useCallback((camera) => {
    const next = normalizeLocationFilters({ country: camera?.country, city: camera?.city });
    if (!next.country && !next.city) return;
    if (next.city === profile?.roleSettings?.feedLocation?.city && next.country === profile?.roleSettings?.feedLocation?.country) return;
    return applyLocationFilters(null, next);
  }, [applyLocationFilters, profile?.roleSettings?.feedLocation]);

  const toggleTab = useCallback((key) => {
    // Source tabs just change which filter is active now — they no longer
    // double as their own refresh (that's Feed's job now, see
    // switchViewMode). manual:false means no seed reshuffle, no forced
    // live/bust refetch, no "refreshing" UI treatment — this is a filter
    // change, not the user asking to go fetch newer data.
    if (key === 'all') {
      activeTabsRef.current = [];
      setActiveTabs([]);
      // Clears source filtering only; the time range and topics stay active.
      // Has to clear filters.sources too, not just activeTabs: they're two
      // independent ways to pick sources (this chip row vs. the Filter panel
      // checkboxes), and loadFeed prefers filters.sources when both are set
      // (see requestedSources there) — leaving a stale filters.sources
      // selection in place meant clicking "All" silently kept whatever the
      // Filter panel last had checked instead of actually clearing to every
      // source, which read as "All" just not working.
      const clearedFilters = { ...filtersRef.current, sources: [] };
      filtersRef.current = clearedFilters;
      setFilters(clearedFilters);
      loadFeed(false, [], {
        filters: clearedFilters,
        replace: true,
      });
      return;
    }
    const allowedSourceIds = viewModeRef.current === 'following'
      ? FOLLOWING_FEED_SOURCE_IDS
      : HOME_FEED_SOURCE_IDS;
    if (!allowedSourceIds.includes(key)) return;
    const current = activeTabsRef.current.length ? activeTabsRef.current : filtersRef.current.sources || [];
    const next = current.includes(key) ? current.filter(source => source !== key) : [...current, key];
    const sourceClearedFilters = { ...filtersRef.current, sources: [] };
    activeTabsRef.current = next;
    filtersRef.current = sourceClearedFilters;
    setActiveTabs(next);
    setFilters(sourceClearedFilters);
    loadFeed(false, next, {
      filters: sourceClearedFilters,
      replace: true,
    });
  }, [loadFeed]); // eslint-disable-line

  const toggleSourceFavorite = useCallback((key) => {
    const tabs = viewModeRef.current === 'following' ? FOLLOWING_SOURCE_TABS : SOURCE_TABS;
    if (key === 'all' || !tabs.some(tab => tab.key === key)) return;
    setSourceFavoriteError('');
    setSourceFavoriteDraft(current => {
      if (current.includes(key)) return current.filter(source => source !== key);
      return [...current, key];
    });
  }, []);

  const saveSourceFavorites = useCallback(async () => {
    const mode = viewModeRef.current === 'following' ? 'following' : 'feed';
    const tabs = mode === 'following' ? FOLLOWING_SOURCE_TABS : SOURCE_TABS;
    const allowed = new Set(tabs.filter(tab => tab.key !== 'all').map(tab => tab.key));
    const draft = [...new Set(sourceFavoriteDraft.filter(source => allowed.has(source)))];
    if (!profile?.id) return;

    const nextFavorites = { ...sourceFavorites, [mode]: draft };
    setSourceFavoriteSaving(true);
    setSourceFavoriteError('');
    try {
      const { data } = await client.patch('/profile', {
        roleSettings: {
          ...(profile.roleSettings || {}),
          feedSourceFavorites: nextFavorites,
        },
      });
      const persisted = data.profile || data;
      const savedFavorites = normalizeSourceFavorites(
        persisted?.roleSettings?.feedSourceFavorites || nextFavorites
      );
      setSourceFavorites(savedFavorites);
      setSourceFavoriteDraft([...savedFavorites[mode]]);
      updateProfileLocally(persisted);
      setSourceMenuOpen(false);
    } catch {
      setSourceFavoriteError('Favorites could not be saved. Please try again.');
    } finally {
      setSourceFavoriteSaving(false);
    }
  }, [profile, sourceFavoriteDraft, sourceFavorites, updateProfileLocally]);

  const loadMoreRemote = useCallback(async () => {
    // Confirmed live as a real crash: fast scrolling could fire this many
    // times in the window before loadingMore's *state* update actually
    // took effect (see loadingMoreRef's own comment), stacking up dozens of
    // concurrent fetches — each appending up to FEED_PAGE_SIZE posts and
    // triggering its own re-render/reflow, which moved the sentinel and
    // re-triggered the observer again before the flood had a chance to
    // subside. loadingMoreRef is checked and set synchronously, in the same
    // tick, so only the very first call in a burst ever gets past this line.
    if (loadingMoreRef.current || !remoteHasMoreRef.current) return;
    if (viewModeRef.current === 'countries' && (locationSavingRef.current || loadStateRef.current.loading || loadStateRef.current.refreshing)) return;
    const paginationRequestId = ++paginationRequestIdRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const requestIdAtStart = feedRequestIdRef.current;
    try {
      const tabs = activeTabsRef.current;
      const activeFilters = { ...DEFAULT_FILTERS, ...filtersRef.current };
      activeFilters.sort = viewModeRef.current === 'groups' && publicGroupsFeed ? 'popular' : 'newest';
      const requestedSources = ['feed', 'following'].includes(viewModeRef.current)
        ? (activeFilters.sources?.length ? activeFilters.sources : tabs)

        : [];
      const q = discoveryQuery(viewModeRef.current, activeFilters, searchRef.current);
      const cursorEligible = isCursorEligible(viewModeRef.current, activeFilters.sort, q);
      // Home has always used a cursor. Travel/Restaurants opt into it only
      // after page one proves the deployed API supports their new cursor;
      // this keeps scrolling correct during a rolling frontend/API deploy.
      const usesPublicGroupPoolCursor = viewModeRef.current === 'groups'
        && publicGroupsFeed
        && Boolean(remoteCursorRef.current);
      const useCursor = usesPublicGroupPoolCursor || (cursorEligible
        && (viewModeRef.current === 'feed' || Boolean(remoteCursorRef.current)));
      const params = new URLSearchParams({
        limit: `${FEED_PAGE_SIZE}`,
        mode: viewModeRef.current,
        sort: activeFilters.sort,
      });
      if (useCursor) {
        // Date-cursor pagination (see getCursorFeedPage server-side) —
        // genuinely older content per request rather than slicing a bounded
        // pre-built pool, so scrolling keeps surfacing real distinct posts
        // for as long as the server retains history instead of eventually
        // reshuffling and repeating.
        if (remoteCursorRef.current) params.set('cursor', remoteCursorRef.current);
      } else {
        params.set('page', `${remotePage}`);
        // Same seed as the last refresh (see refreshSeedRef) — pagination
        // must keep slicing the same rotated view a refresh landed on,
        // otherwise page 2 wouldn't logically follow from page 1.
        params.set('seed', refreshSeedRef.current);
      }
      if (q) params.set('q', q);
      if (activeFilters.timeRange && activeFilters.timeRange !== 'all') params.set('timeRange', activeFilters.timeRange);
      if (activeFilters.topics?.length) params.set('topics', activeFilters.topics.join(','));
      if (requestedSources.length === 1) params.set('source', requestedSources[0]);
      else if (requestedSources.length > 1) params.set('sources', requestedSources.join(','));
      if (viewModeRef.current === 'groups' && publicGroupsFeed) params.set('groupScope', 'public');
      const data = await requestFeedPage(params, profile);
      if (requestIdAtStart !== feedRequestIdRef.current) return;
      if (viewModeRef.current === 'countries' && Array.isArray(data.liveFeeds)) {
        setTravelLiveFeeds(data.liveFeeds);
        setTravelStatus(data.travel || null);
      }
      // A flat all-time dedup here used to make infinite scroll dead-end
      // (once a user had paged through the whole shared pool once, every
      // later page was "all already seen" and got filtered to nothing) —
      // but no dedup at all made the opposite mistake: the server's
      // snapshot pool gets rebuilt every few minutes, so two page requests
      // straddling a rebuild can hand back overlapping content well before
      // a user has scrolled anywhere near the full pool, which read as
      // "duplicate posts" appearing in quick succession. A bounded rolling
      // window (see FEED_DEDUP_WINDOW) filters near-term repeats from
      // either cause while still admitting a genuine repeat once a user has
      // scrolled far enough that it's fallen out of the window. (Cursor
      // mode shouldn't produce near-term repeats in the first place, but
      // the same dedup is harmless insurance against a straddled request.)
      //
      // Following mode skips this window entirely — it was built for the
      // main feed's periodic snapshot-rebuild straddling, which doesn't
      // apply here (Following is computed fresh per request, not from a
      // rebuilt-every-few-minutes shared snapshot). It also deliberately
      // wraps around and re-serves reshuffled content once a small
      // connected-account pool is exhausted (see the server's own
      // sliceCircular/filterUnseen there, which already does real seen-
      // tracking correctly) — a 600-item client window is often bigger
      // than that whole pool, so every wrapped-around repeat landed inside
      // it and got silently dropped, making the feed look stuck at a
      // fixed, limited amount of content even while the server kept
      // reporting hasMore:true. Confirmed live as exactly that complaint.
      const incoming = (data.posts || []).filter(p => (
        p?.id
        && !knownIds.current.has(p.id)
        && (viewModeRef.current !== 'following' || !FOLLOWING_EXCLUDED_SOURCES.has(String(p.source || '').toLowerCase()))
      ));
      incoming.forEach(p => markKnownId(p.id));
      if (incoming.length > 0) {
        setPosts(prev => sortPostsForView([...prev, ...incoming], activeFilters.sort, usesMemberEqualizer(viewModeRef.current, q)));
      }
      if (useCursor) remoteCursorRef.current = data.cursor || remoteCursorRef.current;
      else setRemotePage(p => p + 1);
      setRemoteHasMore(CONTINUOUS_FEED_MODES.has(viewModeRef.current) || data.hasMore !== false);
    } catch (error) {
      console.error('[feed] position cursor request failed', error);
      if (viewModeRef.current === 'countries' && requestIdAtStart === feedRequestIdRef.current) {
        setTravelPaginationError('More destinations could not load.');
        setRemoteHasMore(false);
      }
    }
    finally {
      if (paginationRequestId === paginationRequestIdRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [profile, publicGroupsFeed, remotePage]);

  const updateFeedPost = useCallback((updatedPost) => {
    if (!updatedPost?.id) return;
    setPosts(prev => prev.map(post =>
      post.id === updatedPost.id ? { ...post, ...updatedPost } : post
    ));
  }, []);

  // Saving a Travel city updates the profile; the selection handler already
  // reloads that feed. Do not also reset its player and cursor here.
  const feedBootstrapDependency = viewMode === 'countries' ? profile?.id : loadFeed;
  // Only Home owns this cache. Group scopes must start with their own response.
  useEffect(() => {
    if (!profile?.id) return;
    const c = !forcedMode && viewModeRef.current === 'feed' ? readFeedCache(profile.id) : null;
    postsRef.current = c?.posts || [];
    knownIds.current = new Set(postsRef.current.map(post => post.id).filter(Boolean));
    remoteCursorRef.current = null;
    paginationRequestIdRef.current += 1;
    loadingMoreRef.current = false;
    setRemotePage(2);
    setLoadingMore(false);
    setPosts(postsRef.current);
    setTravelLiveFeeds([]);
    loadFeed(false, activeTabsRef.current, { silent: !!c?.fresh, live: !!c?.fresh, replace: !c });
    return () => {
      feedRequestIdRef.current += 1;
      paginationRequestIdRef.current += 1;
    };
  }, [forcedMode, feedBootstrapDependency, profile?.id, JSON.stringify(profile?.roleSettings?.feedLanguages || [])]);

  useEffect(() => {
    const refreshQuietly = () => {
      const state = loadStateRef.current;
      if (!['feed', 'groups', 'countries', 'restaurants', 'bars'].includes(viewModeRef.current)) return;
      if (document.hidden || state.loading || state.refreshing || state.loadingMore) return;
      loadFeed(false, activeTabsRef.current, { silent: true, live: true, preserveScroll: true });
    };
    const intervalId = window.setInterval(refreshQuietly, FEED_AUTO_REFRESH_MS);
    const handleVisibility = () => { if (!document.hidden) refreshQuietly(); };
    window.addEventListener('focus', refreshQuietly);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshQuietly);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadFeed]);

  const refreshCurrentFeed = useCallback(() => {
    if (!['feed', 'following', 'groups', 'countries', 'restaurants', 'bars'].includes(viewModeRef.current)) return undefined;
    const state = loadStateRef.current;
    if (state.loading || state.refreshing || state.loadingMore || loadingMoreRef.current) {
      // Coalesce refresh requests until pagination finishes without carrying
      // a member's refresh into a different account, feed, or group scope.
      setQueuedRefresh(`${profile?.id}:${viewModeRef.current}:${viewModeRef.current === 'groups' && publicGroupsFeed}`);
      return undefined;
    }
    if (viewModeRef.current === 'groups' && publicGroupsFeed) {
      window.dispatchEvent(new Event('ufi:refresh-group-directory'));
    }
    return loadFeed(true, activeTabsRef.current, {
      preserveScroll: true,
      promoteIncoming: true,
      bust: activeTabsRef.current.length === 1,
    });
  }, [loadFeed, profile?.id, publicGroupsFeed]);

  useEffect(() => {
    if (!queuedRefresh) return;
    const context = `${profile?.id}:${viewMode}:${viewMode === 'groups' && publicGroupsFeed}`;
    if (queuedRefresh !== context) {
      setQueuedRefresh(null);
      return;
    }
    if (loading || refreshing || loadingMore || loadingMoreRef.current) return;
    setQueuedRefresh(null);
    refreshCurrentFeed();
  }, [queuedRefresh, loading, refreshing, loadingMore, profile?.id, viewMode, publicGroupsFeed, refreshCurrentFeed]);

  const scrollRefresh = useScrollToRefresh(refreshCurrentFeed, {
    enabled: Boolean(profile?.id) && !EMBEDDED_HOME_MODES.has(viewMode),
  });

  useEffect(() => {
    window.addEventListener('ufi:refresh-selected-feed', refreshCurrentFeed);
    return () => window.removeEventListener('ufi:refresh-selected-feed', refreshCurrentFeed);
  }, [refreshCurrentFeed]);

  // SSE: stream new posts from all source workers in real time — with reconnection logic
  useEffect(() => {
    let es = null;
    let cancelled = false;
    let reconnectAttempt = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const BASE_RECONNECT_DELAY = 1000;
    let reconnectTimeoutId;

    async function setupSSE() {
      try {
        const base = await resolveApiBaseUrl();
        if (cancelled) return;
        const token = getAccessToken();
        if (!token) return;
        es = createAuthenticatedStream(`${base}/feed/stream`, token);
        es.onopen = () => {
          reconnectAttempt = 0; // Reset backoff on successful connection
        };

        // SSE wakes a quiet server refresh instead of splicing batches
        // straight into the visible list. That keeps scrolling stable while
        // still letting transferred pipeline posts appear without waiting
        // for the normal two-minute refresh tick.
        es.onmessage = (e) => {
          try {
            const { posts: incoming } = JSON.parse(e.data);
            if (!incoming?.length) return;
            // Native posts belong in Following and joined Groups, while
            // Home remains the external/public-source feed.
            const relevantIncoming = viewModeRef.current === 'feed'
              ? incoming.filter(post => post?.source !== 'uficonnect')
              : incoming;
            if (!relevantIncoming.length) return;
            if (profile?.id && relevantIncoming.some(post => (post?.source || 'uficonnect') === 'uficonnect')) {
              followingNativeCompatCache.delete(profile.id);
            }
            let sawFresh = false;
            relevantIncoming.forEach(p => {
              if (!p?.id) return;
              if (!knownIds.current.has(p.id)) sawFresh = true;
              markKnownId(p.id);
            });
            if (!sawFresh || liveRefreshTimeoutRef.current) return;
            liveRefreshTimeoutRef.current = window.setTimeout(() => {
              liveRefreshTimeoutRef.current = null;
              const state = loadStateRef.current;
              if (!['feed', 'following', 'groups'].includes(viewModeRef.current)) return;
              if (document.hidden || state.loading || state.refreshing || state.loadingMore) return;
              loadFeed(false, activeTabsRef.current, {
                silent: true,
                live: true,
                preserveScroll: true,
                bust: false,
              });
            }, 1200);
          } catch (err) {
            console.error('[SSE] Error parsing message:', err);
          }
        };

        es.onerror = () => {
          if (cancelled) return;
          markApiOriginFailure(base);
          es?.close();
          es = null;
          // Exponential backoff reconnection with max attempts
          if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
            const delay = BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempt);
            reconnectTimeoutId = window.setTimeout(() => {
              reconnectAttempt += 1;
              setupSSE();
            }, delay);
          }
        };
      } catch (err) {
        console.error('[SSE] Setup error:', err);
      }
    }

    setupSSE();

    return () => {
      cancelled = true;
      if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
      if (liveRefreshTimeoutRef.current) {
        clearTimeout(liveRefreshTimeoutRef.current);
        liveRefreshTimeoutRef.current = null;
      }
      if (es) {
        es.close();
        es = null;
      }
    };
  }, [loadFeed, markKnownId, profile?.id]);

  // Time range cutoff helper
  function timeRangeCutoff(range) {
    const now = Date.now();
    if (range === '1h')    return now - 60 * 60 * 1000;
    if (range === '6h')    return now - 6 * 60 * 60 * 1000;
    if (range === 'today') return now - 24 * 60 * 60 * 1000;
    if (range === 'week')  return now - 7 * 24 * 60 * 60 * 1000;
    return 0;
  }

  // Must be declared before the IntersectionObserver useEffect that reads processed.length
  const processed = useMemo(() => {
    let result = [...posts];

    // Source controls are stored on this member's profile, not in shared
    // browser storage, so different accounts and devices keep their own feed.
    const disabled = new Set(Array.isArray(profile?.roleSettings?.disabledSources)
      ? profile.roleSettings.disabledSources
      : []);
    if (disabled.size > 0) result = result.filter(p => !disabled.has(p.source));
    if (viewMode === 'following') {
      result = result.filter(p => !FOLLOWING_EXCLUDED_SOURCES.has(String(p?.source || '').toLowerCase()));
    }

    // Search
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.content || '').toLowerCase().includes(q) ||
        (p.author?.name || '').toLowerCase().includes(q) ||
        (p.topic || '').toLowerCase().includes(q) ||
        (p.sourceLabel || '').toLowerCase().includes(q)
      );
    }

    // Source filter
    if (activeTabs.length > 0) {
      result = result.filter(p => activeTabs.includes(p.source));
    }

    if (filters.sources.length > 0) {
      result = result.filter(p => filters.sources.includes(p.source));
    }

    // Time range
    if (filters.timeRange && filters.timeRange !== 'all') {
      const cutoff = timeRangeCutoff(filters.timeRange);
      result = result.filter(p => feedPostTime(p) >= cutoff);
    }

    return sortPostsForView(result, filters.sort, usesMemberEqualizer(viewMode, search));
  }, [posts, search, filters, activeTabs, viewMode, profile?.roleSettings?.disabledSources]);

  useEffect(() => {
    const hasNarrowFilter = !!search.trim() || filters.sources.length > 0 || filters.timeRange !== 'all';
    if (!hasNarrowFilter || loading || loadingMore || !remoteHasMore) return;
    if (processed.length < 20) loadMoreRemote();
  }, [filters, search, processed.length, loading, loadingMore, remoteHasMore, loadMoreRemote]);

  // Infinite scroll: fetch next remote page when sentinel enters the viewport.
  // The sentinel <div> only renders once loading is false and there's at
  // least one post (see the loading/empty/displayed branches below) — on a
  // fresh page load (no cache, loading starts true) this effect's first run
  // captured sentinelRef.current as null and bailed out before the sentinel
  // ever mounted. Depending only on [loadMoreRemote] meant nothing ever
  // re-ran that capture once loading actually finished, so the observer was
  // silently never attached for the rest of the session — confirmed live
  // via an instrumented IntersectionObserver that no observer with this
  // effect's rootMargin was ever constructed on a fresh session, and
  // scrolling to the true bottom of the page never fired a single
  // follow-up /feed request. Re-running whenever loading finishes or the
  // rendered list's length changes (covers both "sentinel just mounted"
  // and "sentinel's position moved because more content loaded") re-reads
  // the current ref each time instead of relying on a one-time capture.
  const travelPageBusy = viewMode === 'countries' && (loading || refreshing || locationSaving || loadingMore);
  useEffect(() => {
    if (travelPageBusy) return undefined;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMoreRemote(); },
      { rootMargin: '400px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMoreRemote, loading, processed.length, travelPageBusy]);

  // Close any feed-filter popover on an outside click.
  useEffect(() => {
    function handleClick(e) {
      if (
        filterOpen &&
        panelRef.current && !panelRef.current.contains(e.target) &&
        filterBtnRef.current && !filterBtnRef.current.contains(e.target)
      ) setFilterOpen(false);
      if (
        topicFilterOpen &&
        topicPanelRef.current && !topicPanelRef.current.contains(e.target) &&
        topicFilterBtnRef.current && !topicFilterBtnRef.current.contains(e.target)
      ) setTopicFilterOpen(false);
      if (
        sourceMenuOpen &&
        sourceMenuPanelRef.current && !sourceMenuPanelRef.current.contains(e.target) &&
        sourceMenuBtnRef.current && !sourceMenuBtnRef.current.contains(e.target)
      ) setSourceMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filterOpen, sourceMenuOpen, topicFilterOpen]);

  // Compute active source list from actual posts
  const activeSources = useMemo(
    () => [...new Set(posts.map(p => p.source).filter(s => ALL_FILTER_SOURCES.includes(s)))],
    [posts]
  );

  const displayed = processed; // render all locally-held posts — no artificial cap
  // Live cameras have a dedicated carousel in Travel. Keeping them out of
  // the long-form list means its cards stay focused on guides, openings,
  // and current travel stories instead of repeating the same camera feeds.
  // Blocked members and external accounts disappear from every feed immediately.
  const [blockedMembers, setBlockedMembers] = useState(() => new Set());
  const blockedAccountsKey = JSON.stringify(profile?.roleSettings?.blockedFeedAccounts || []);
  const blockedAccounts = useMemo(() => new Set(JSON.parse(blockedAccountsKey)), [blockedAccountsKey]);
  const handleBlocked = useCallback(post => {
    if (!post?.isExternal && post?.author?.id) setBlockedMembers(current => new Set([...current, post.author.id]));
  }, []);
  const [removedPosts, setRemovedPosts] = useState(() => new Set());
  const handleRemoved = useCallback(post => {
    if (post?.id) setRemovedPosts(current => new Set([...current, post.id]));
  }, []);
  const contentPosts = useMemo(
    () => displayed.filter(post => !(viewMode === 'countries' && post?.isLiveCamera)
      && !removedPosts.has(post?.id)
      && !(post?.isExternal && blockedAccounts.has(feedAccountKey(post)))
      && !(!post?.isExternal && blockedMembers.has(post?.author?.id))),
    [displayed, viewMode, blockedAccounts, blockedMembers, removedPosts]
  );
  const requestNextPageAtPosition = useCallback((index) => {
    if (index >= Math.max(0, contentPosts.length - FEED_POSITION_PREFETCH_POSTS)) loadMoreRemote();
  }, [contentPosts.length, loadMoreRemote]);

  const handleFeedPointerPosition = useCallback((event) => {
    const positionedPost = event.target.closest?.('[data-feed-position]');
    if (!positionedPost) return;
    const index = Number(positionedPost.dataset.feedPosition);
    if (Number.isInteger(index)) requestNextPageAtPosition(index);
  }, [requestNextPageAtPosition]);

  // Start the next opaque-cursor request from the reader's actual position,
  // not only after they hit the final pixel of the current page. The bottom
  // sentinel remains as a fallback for keyboard jumps and unusual layouts.
  useEffect(() => {
    const anchor = prefetchAnchorRef.current;
    if (!anchor || !remoteHasMore) return undefined;
    let scrollRoot = anchor.parentElement;
    while (scrollRoot && scrollRoot !== document.body) {
      const overflowY = window.getComputedStyle(scrollRoot).overflowY;
      if (/(auto|scroll)/.test(overflowY) && scrollRoot.scrollHeight > scrollRoot.clientHeight) break;
      scrollRoot = scrollRoot.parentElement;
    }
    const scrollTarget = scrollRoot && scrollRoot !== document.body ? scrollRoot : window;
    let frame = 0;
    const requestIfNear = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = anchor.getBoundingClientRect();
        const viewport = scrollTarget === window
          ? { top: 0, bottom: window.innerHeight }
          : scrollTarget.getBoundingClientRect();
        if (rect.top <= viewport.bottom + 700 && rect.bottom >= viewport.top - 700) loadMoreRemote();
      });
    };
    if (!('IntersectionObserver' in window)) {
      requestIfNear();
      scrollTarget.addEventListener('scroll', requestIfNear, { passive: true });
      return () => {
        window.cancelAnimationFrame(frame);
        scrollTarget.removeEventListener('scroll', requestIfNear);
      };
    }
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMoreRemote(); },
      { root: scrollTarget === window ? null : scrollTarget, rootMargin: '700px 0px' },
    );
    observer.observe(anchor);
    requestIfNear();
    scrollTarget.addEventListener('scroll', requestIfNear, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      scrollTarget.removeEventListener('scroll', requestIfNear);
      observer.disconnect();
    };
  }, [contentPosts.length, loadMoreRemote, remoteHasMore]);
  const hasTravelLiveFeeds = viewMode === 'countries' && travelLiveFeeds.length > 0;
  const hasMore   = remoteHasMore;

  // Every photo- or video-bearing post currently on screen, in the same
  // order shown — what ImageLightbox's next/prev navigation browses across.
  // Photos and videos share one rail (see ImageLightbox) instead of videos
  // opening into a separate single-post modal with no scrolling. Keyed by
  // post id (not index) so a click stays pointed at the right item even if
  // `displayed` changes shape between the click and the next render.
  const mediaPosts = useMemo(() => {
    const candidates = [
      ...(viewMode === 'countries' ? travelLiveFeeds : []),
      ...displayed,
    ];
    const seen = new Set();
    return candidates.filter((post) => {
      if (!post?.mediaUrl || (post.mediaType !== 'image' && post.mediaType !== 'video')) return false;
      const key = post.id || post.mediaUrl;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [displayed, travelLiveFeeds, viewMode]);
  const mediaLightboxIndex = mediaLightboxPostId
    ? mediaPosts.findIndex(p => p.id === mediaLightboxPostId)
    : -1;

  const hasCommandCenterMembership = ['pro', 'business'].includes(profile?.plan);
  const usesSourceControls = ['feed', 'following'].includes(viewMode);
  const showsAdvancedFilters = !usesSourceControls && viewMode !== 'groups';
  const isLocationFeed = ['countries', 'restaurants', 'bars'].includes(viewMode);
  const postContext = isLocationFeed ? discoveryPostContext(viewMode, [...contentPosts, ...travelLiveFeeds]) : null;
  const travelLocationLabel = locationScopeLabel(normalizeLocationFilters(profile?.roleSettings?.feedLocation));
  const activeFilterCount = (usesSourceControls ? filters.sources.length : 0) + (filters.timeRange !== 'all' ? 1 : 0) + filters.topics.length;
  const visibleFilterCount = (filters.timeRange !== 'all' ? 1 : 0) + filters.topics.length;
  const advancedFilterCount = (usesSourceControls ? filters.sources.length : 0)
    + (filters.timeRange !== 'all' ? 1 : 0)
    + (isLocationFeed ? 0 : filters.topics.length);
  const selectedSourceLabel = activeTabs.map(k => SOURCE_META[k]?.label || k).join(', ');
  const currentSourceTabs = viewMode === 'following' ? FOLLOWING_SOURCE_TABS : SOURCE_TABS;
  const selectedSourceKeys = activeTabs.length ? activeTabs : filters.sources;
  const sourceFavoriteMode = viewMode === 'following' ? 'following' : 'feed';
  const currentSourceFavoriteKeys = sourceFavorites[sourceFavoriteMode] || [];
  const favoriteCompactSourceTabs = currentSourceFavoriteKeys
    .map(key => currentSourceTabs.find(tab => tab.key === key))
    .filter(Boolean);
  const favoriteCompactSourceKeys = new Set(favoriteCompactSourceTabs.map(tab => tab.key));
  const compactSourceTabs = [
    ...favoriteCompactSourceTabs,
    ...currentSourceTabs.filter(tab => tab.key !== 'all' && !favoriteCompactSourceKeys.has(tab.key)),
  ];
  const favoriteSourceOrder = new Map(sourceFavoriteDraft.map((key, index) => [key, index]));
  const fullSourceTabs = [
    ...currentSourceTabs
      .filter(tab => tab.key !== 'all')
      .map((tab, index) => ({ tab, index }))
      .sort((a, b) => {
        const aFavorite = favoriteSourceOrder.has(a.tab.key);
        const bFavorite = favoriteSourceOrder.has(b.tab.key);
        if (aFavorite && bFavorite) {
          return favoriteSourceOrder.get(a.tab.key) - favoriteSourceOrder.get(b.tab.key);
        }
        if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;
        return a.index - b.index;
      })
      .map(({ tab }) => tab),
  ];
  const sourceFavoriteDraftChanged = sourceFavoriteDraft.join('|') !== currentSourceFavoriteKeys.join('|');
  const canSaveSourceFavorites = sourceFavoriteDraftChanged
    && !sourceFavoriteSaving;
  const isSourceActive = (key) => key === 'all'
    ? selectedSourceKeys.length === 0
    : selectedSourceKeys.includes(key);

  const discoveryActions = isLocationFeed && <>
    <Link to={"/?feed=" + viewMode + "&compose=1"}
      aria-label={`Post to ${DISCOVERY_CATEGORIES[viewMode].label}`}
      className="btn btn-primary btn-sm feed-toolbar-control feed-toolbar-primary-action ufi-compose-button feed-category-post ufi-post-action">
      Post<span className="feed-category-post-context"> to {DISCOVERY_CATEGORIES[viewMode].label}</span>
    </Link>
    <TopicFilterControl topics={filters.topics} options={ALL_INTERESTS} onChange={applyTopicFilters}
      open={topicFilterOpen} onToggle={(open) => { setFilterOpen(false); setTopicFilterOpen(open); }}
      buttonRef={topicFilterBtnRef} panelRef={topicPanelRef} />
  </>;

  return (
    <Layout wide={!forcedMode} discoveryPost={postContext} feedSearch={EMBEDDED_HOME_MODES.has(viewMode) ? undefined : {
      query: search,
      onSubmit: submitFeedSearch,
      label: 'Search this feed',
    }}>
      <Helmet>
        <title>{viewMode === 'groups' && publicGroupsFeed ? 'Public Group Posts | UFIconnect' : forcedMode ? 'You | UFIconnect' : 'UFIconnect | Social Network & Job Discovery'}</title>
        <meta name="description" content="Your personalized UFIconnect social feed brings posts, people, communities, videos, and job discovery into one useful scroll." />
        <meta name="keywords" content="professional news, tech news, career news, news feed, industry news, Reddit news, Hacker News, news updates, professional updates, tech updates, career updates, community news, LinkedIn news, Twitter news, Facebook news, networking news, connect news" />
        {viewMode === 'groups' && publicGroupsFeed
          ? <link rel="canonical" href="https://uficonnect.org/?feed=groups&amp;groupScope=public" />
          : !forcedMode && <link rel="canonical" href="https://uficonnect.org/feed" />}
      </Helmet>
      <div className={`home-feed-layout${forcedMode ? ' home-feed-layout--single' : ''}`}>
      <div className="home-feed-content">
      {(scrollRefresh.pulling || scrollRefresh.refreshing) && (
        <div className="scroll-refresh-status" role="status" aria-live="polite">
          {scrollRefresh.refreshing
            ? <span className="spinner spinner-primary" />
            : <span className="scroll-refresh-progress" style={{ '--scroll-refresh-progress': scrollRefresh.progress }} />}
          <span>{scrollRefresh.refreshing ? 'Refreshing feed' : scrollRefresh.progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      )}
      {viewMode === 'ufi' ? (
        <UfiFeedContent embedded initialShop={routeFeedParams.get('channel') === 'shop'} />
      ) : (
      <>
      {/* Specialized feeds keep location and filter controls together. */}
      {showsAdvancedFilters && <section className={`feed-specialized-toolbar${isLocationFeed ? ' feed-specialized-toolbar--location' : ''}`}>
        {isLocationFeed && (
          <div className="feed-location-heading">
            <strong>{viewMode === 'countries' ? 'Travel location' : viewMode === 'bars' ? 'Bars and clubs location' : 'Restaurant location'}</strong>
            <span>{travelLocationLabel || 'Worldwide'}</span>
          </div>
        )}

        <div className="feed-specialized-actions">
          {!isLocationFeed && <div className="feed-specialized-filter">
            <button
              ref={filterBtnRef}
              className="feed-toolbar-control"
              aria-label="Open filter panel"
              aria-expanded={filterOpen}
              onClick={() => {
                setTopicFilterOpen(false);
                setFilterOpen(open => !open);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '9px 14px', borderRadius: 22, border: `1.5px solid ${filterOpen || advancedFilterCount > 0 ? 'var(--primary)' : 'var(--border)'}`,
                background: advancedFilterCount > 0 ? 'var(--primary)' : 'var(--surface)',
                color: advancedFilterCount > 0 ? '#fff' : 'var(--text)',
                cursor: 'pointer', fontWeight: 600, fontSize: '.875rem', whiteSpace: 'nowrap',
              }}
            >
              Filter{advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ''} {filterOpen ? 'Hide' : 'Show'}
            </button>

            {filterOpen && (
              <FilterPanel
                filters={filters}
                onChange={applyFilters}
                sources={viewMode === 'following' ? FOLLOWING_FILTER_SOURCES : viewMode === 'feed' ? ALL_FILTER_SOURCES : []}
                onClose={() => setFilterOpen(false)}
                panelRef={panelRef}
                includeTopics={!isLocationFeed}
              />
            )}
          </div>}
        </div>

        {isLocationFeed && (
          <>
            <form className="feed-location-form" onSubmit={applyLocationFilters}>
              <label className="feed-location-field">
                <span>Country</span>
                <input
                  type="search"
                  className="form-input"
                  aria-label={`${viewMode === 'countries' ? 'Travel' : viewMode === 'bars' ? 'Bars and clubs' : 'Restaurant'} country`}
                  disabled={locationSaving}
                  autoComplete="country-name"
                  placeholder="Search country"
                  value={locationFilters.country}
                  maxLength={80}
                  onChange={(event) => {
                    const next = { ...locationFiltersRef.current, country: event.target.value };
                    locationFiltersRef.current = next;
                    setLocationFilters(next);
                  }}
                />
              </label>
              <label className="feed-location-field">
                <span>City</span>
                <input
                  type="search"
                  className="form-input"
                  aria-label={`${viewMode === 'countries' ? 'Travel' : viewMode === 'bars' ? 'Bars and clubs' : 'Restaurant'} city`}
                  disabled={locationSaving}
                  autoComplete="address-level2"
                  placeholder="Search city"
                  value={locationFilters.city}
                  maxLength={80}
                  onChange={(event) => {
                    const next = { ...locationFiltersRef.current, city: event.target.value };
                    locationFiltersRef.current = next;
                    setLocationFilters(next);
                  }}
                />
              </label>
              <div className="feed-location-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={locationSaving}>
                  {locationSaving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Search'}
                </button>
                {(locationFilters.country || locationFilters.city) && (
                  <button type="button" className="btn btn-ghost btn-sm ufi-clear-control" onClick={clearLocationFilters} disabled={locationSaving}>
                    Clear
                  </button>
                )}
              </div>
            </form>
            {['restaurants', 'bars'].includes(viewMode) && <DiscoveryCategoryBar mode={viewMode} filters={filters} onChange={applyFilters} actions={discoveryActions} />}
            {locationMessage && <div className="feed-location-message" role="status">{locationMessage}</div>}
          </>
        )}
      </section>}

      {/* Source tabs — Feed and Following each filter over their own
          vocabulary (SOURCE_TABS vs FOLLOWING_SOURCE_TABS), since neither
          list of sources can appear in the other view. */}
      {usesSourceControls && (
        <div className="feed-source-filter-row feed-unified-control-bar">
          <div className="feed-source-picker">
            <div className="feed-source-tabs feed-source-tabs--compact" role="group" aria-label={`${viewMode === 'following' ? 'Following' : 'Home'} sources`}>
              <button type="button" className="btn btn-ghost btn-sm ufi-clear-control"
                aria-label="Clear sources" disabled={selectedSourceKeys.length === 0}
                onClick={clearSourceSelection}>Clear</button>
              {compactSourceTabs.map(tab => (
                <FeedSourceOption
                  key={tab.key}
                  tab={tab}
                  active={isSourceActive(tab.key)}
                  compact
                  favorite={currentSourceFavoriteKeys.includes(tab.key)}
                  onSelect={() => tab.key === 'all' ? clearSourceSelection() : toggleTab(tab.key)}
                />
              ))}
            </div>
            <button
              ref={sourceMenuBtnRef}
              type="button"
              className={`feed-source-menu-button${sourceMenuOpen ? ' active' : ''}`}
              aria-label="View all feed sources"
              aria-expanded={sourceMenuOpen}
              aria-controls="feed-source-menu"
              onClick={() => {
                setTopicFilterOpen(false);
                setFilterOpen(false);
                setSourceMenuOpen(open => {
                  const nextOpen = !open;
                  if (nextOpen) {
                    setSourceFavoriteDraft([...currentSourceFavoriteKeys]);
                    setSourceFavoriteError('');
                  }
                  return nextOpen;
                });
              }}
            >
              <MenuIcon size={22} />
            </button>
            {sourceMenuOpen && (
              <div ref={sourceMenuPanelRef} id="feed-source-menu" className="feed-source-menu" role="group" aria-label="Feed sources and favorites">
                <div className="feed-source-menu-header">
                  <strong>Favorites</strong>
                  <span>{sourceFavoriteDraft.length} selected</span>
                </div>
                {fullSourceTabs.map(tab => {
                  const favorite = sourceFavoriteDraft.includes(tab.key);
                  const aggregate = tab.key === 'all';
                  return (
                    <div key={tab.key} className={`feed-source-menu-item${aggregate ? ' aggregate' : ''}`}>
                      <FeedSourceOption
                        tab={tab}
                        active={isSourceActive(tab.key)}
                        onSelect={() => {
                          if (tab.key === 'all') clearSourceSelection(); else toggleTab(tab.key);
                          if (tab.key === 'all') setSourceMenuOpen(false);
                        }}
                      />
                      {!aggregate && (
                        <SourceFavoriteButton
                          tab={tab}
                          favorite={favorite}
                          disabled={sourceFavoriteSaving}
                          onToggle={toggleSourceFavorite}
                        />
                      )}
                    </div>
                  );
                })}
                <div className="feed-source-menu-footer">
                  {sourceFavoriteError && <span role="alert">{sourceFavoriteError}</span>}
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={sourceFavoriteSaving || sourceFavoriteDraft.length === 0}
                    onClick={() => {
                      setSourceFavoriteDraft([]);
                      setSourceFavoriteError('');
                    }}
                  >
                    Clear favorites
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!canSaveSourceFavorites}
                    onClick={saveSourceFavorites}
                  >
                    {sourceFavoriteSaving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save favorites'}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button type="button" className="feed-toolbar-control feed-topic-filter-trigger home-shop-button" onClick={openUfiShop}>
            Shop
          </button>
          <TopicFilterControl
            topics={filters.topics}
            options={ALL_INTERESTS}
            onChange={applyTopicFilters}
            open={topicFilterOpen}
            onToggle={(open) => {
              setFilterOpen(false);
              setTopicFilterOpen(open);
            }}
            buttonRef={topicFilterBtnRef}
            panelRef={topicPanelRef}
          />
        </div>
      )}

      {viewMode === 'groups' && (
        <div className="feed-source-filter-row feed-group-filter-row feed-group-unified-bar">
          <div className="feed-group-primary-actions">
          <div className="group-feed-scope-tabs" role="tablist" aria-label="Group feeds">
            <button type="button" role="tab" aria-selected={!publicGroupsFeed} className={!publicGroupsFeed ? 'active' : ''} onClick={() => selectGroupScope('joined')}>
              Your groups
            </button>
            <button type="button" role="tab" aria-selected={publicGroupsFeed} className={publicGroupsFeed ? 'active' : ''} onClick={() => selectGroupScope('public')}>
              Public posts
            </button>
          </div>
          <Link to="/search?tab=groups&create=1" className="btn btn-primary btn-sm feed-toolbar-control feed-toolbar-primary-action group-create-button">
            Create a group
          </Link>
          <Link to="/groups/post" className="btn btn-ghost btn-sm feed-toolbar-control group-post-button ufi-post-action">Post to your group</Link>
          </div>
          <TopicFilterControl
            topics={filters.topics}
            options={ALL_INTERESTS}
            onChange={applyTopicFilters}
            open={topicFilterOpen}
            onToggle={(open) => {
              setFilterOpen(false);
              setTopicFilterOpen(open);
            }}
            buttonRef={topicFilterBtnRef}
            panelRef={topicPanelRef}
          />
        </div>
      )}

      {viewMode === 'countries' && <>
        <TravelLiveLoop
          feeds={travelLiveFeeds}
          onMediaOpen={post => setMediaLightboxPostId(post.id)}
          mediaOpenId={mediaLightboxPostId}
          location={locationFilters}
          locationLabel={travelLocationLabel}
          onLocationSelect={selectTravelLiveLocation}
          disabled={locationSaving || refreshing}
          status={travelStatus}
          onRetry={() => loadFeed(true, activeTabsRef.current, { replace: true, preserveScroll: true, bust: false })}
        />
        <DiscoveryCategoryBar mode={viewMode} filters={filters} onChange={applyFilters} actions={discoveryActions} />
      </>}

      {isLocationFeed && <UfiFeedContent embedded composeOnly categoryLabel={DISCOVERY_CATEGORIES[viewMode].label} />}

      {visibleFilterCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 12, fontSize: '.78rem' }}>
          {filters.timeRange !== 'all' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 9px', borderRadius: 12,
              background: 'var(--card)', color: 'var(--text)', fontWeight: 600,
              border: '1px solid var(--border)',
            }}>
              {filters.timeRange === '1h' ? 'Past hour' : filters.timeRange === '6h' ? 'Past 6h' : filters.timeRange === 'today' ? 'Past 24h' : filters.timeRange === 'week' ? 'Past week' : filters.timeRange}
              <button onClick={() => applyFilters({ ...filtersRef.current, timeRange: 'all' })} style={{
                marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontWeight: 700, fontSize: '.75rem', padding: 0, lineHeight: 1,
              }}>×</button>
            </span>
          )}

          {filters.topics.map(topic => (
            <span key={topic} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 9px', borderRadius: 12,
              background: 'var(--card)', color: 'var(--text)', fontWeight: 600,
              border: '1px solid var(--border)',
            }}>
              Topic: {topic}
              <button onClick={() => applyFilters({ ...filtersRef.current, topics: filtersRef.current.topics.filter(t => t !== topic) })} style={{
                marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontWeight: 700, fontSize: '.75rem', padding: 0, lineHeight: 1,
              }}>×</button>
            </span>
          ))}

          <button
            type="button"
            className="ufi-clear-control"
            onClick={clearFeedControls}
          >
            Clear all
          </button>
        </div>
      )}

      {viewMode === 'following' && !loading && <FollowingConnectionNotice errors={sourceErrors} />}

      {lockedPlatform ? (
        <SocialConnectGate
          platform={lockedPlatform}
          connecting={connecting}
          onConnect={async () => {
            setConnecting(true);
            try {
              const { data } = await client.get(`/auth/social/${lockedPlatform}/start`);
              if (data?.url) { window.location.href = data.url; return; }
            } catch {}
            setConnecting(false);
          }}
        />
      ) : loading ? (
        <div>
          <div style={{
            padding: '20px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}>
            <span className="spinner spinner-primary" style={{ width: 14, height: 14 }} />
          </div>
          <PostCardSkeleton />
          <PostCardSkeleton />
          <PostCardSkeleton />
        </div>
      ) : feedError && contentPosts.length === 0 && !hasTravelLiveFeeds ? (
        <div className="empty-state">
          <div className="empty-icon">!</div>
          <div className="empty-title">Couldn't load posts</div>
          <div className="empty-desc">
            <p style={{ marginBottom: 12 }}>{feedError}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => loadFeed(true, activeTabsRef.current, { replace: true, bust: activeTabsRef.current.length === 1 })}>Try again</button>
              <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
            </div>
          </div>
        </div>
      ) : contentPosts.length === 0 && !hasTravelLiveFeeds ? (
        <div className="empty-state">
          <div className="empty-icon">
            {activeTabs.length === 1
              ? <SourceMark source={activeTabs[0]} label={SOURCE_META[activeTabs[0]]?.icon} size={24} />
              : (search ? 'Search' : viewMode === 'following' ? 'Following' : viewMode === 'groups' ? 'Groups' : viewMode === 'countries' ? 'Travel' : viewMode === 'restaurants' ? 'Restaurants' : viewMode === 'bars' ? 'Bars and clubs' : 'Home')}
          </div>
          <div className="empty-title">
            {search ? `No posts match "${search}"` : viewMode === 'following' ? 'No posts from people you follow yet' : viewMode === 'groups' ? 'No group posts yet' : viewMode === 'countries' ? 'No travel discoveries are available yet' : viewMode === 'bars' ? 'No bar discoveries are available yet' : viewMode === 'restaurants' ? 'No restaurant openings are available yet' : activeTabs.length > 0 ? `No ${selectedSourceLabel} posts yet` : 'Home is empty'}
          </div>
          <div className="empty-desc">
            {search ? (
              <>
                <p style={{ marginBottom: 8 }}>Try a different search term or clear your filters.</p>
                <button className="btn btn-ghost btn-sm ufi-clear-control" onClick={() => submitFeedSearch('')}>Clear search</button>
              </>
            ) : activeFilterCount > 0 ? (
              <>
                <p style={{ marginBottom: 8 }}>No posts match your current filters.</p>
                <button className="btn btn-ghost btn-sm" onClick={() => applyFilters(DEFAULT_FILTERS)}>
                  Reset filters
                </button>
              </>
            ) : activeTabs.length === 1 && sourceErrors[activeTabs[0]] ? (
              <>
                <p style={{ marginBottom: 4, color: 'var(--danger, #DC2626)' }}>
                  Couldn't load {selectedSourceLabel}: {sourceErrors[activeTabs[0]]}
                </p>
                <p style={{ marginBottom: 12, fontSize: '.85rem', color: 'var(--muted)' }}>
                  This is a real error, not just "nothing new yet" — reconnecting the account under Connected Accounts is usually the fix.
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Link to="/connected-accounts" className="btn btn-primary btn-sm">Connected accounts</Link>
                  <button className="btn btn-ghost btn-sm" onClick={() => loadFeed(true, activeTabsRef.current, { replace: true, bust: true })}>Try again</button>
                </div>
              </>
            ) : activeTabs.length > 0 ? (
              <>
                <p style={{ marginBottom: 12 }}>No posts from {selectedSourceLabel} yet. Check back soon or try the wider mix while this source makes coffee.</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => toggleTab('all')}>Explore all sources</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => loadFeed(true, activeTabsRef.current, { replace: true, bust: activeTabsRef.current.length === 1 })}>Refresh now</button>
                </div>
              </>
            ) : viewMode === 'groups' ? (
              <>
                <p style={{ marginBottom: 12 }}>
                  {publicGroupsFeed
                    ? 'No unseen public group posts are available right now.'
                    : 'Your joined groups do not have unseen posts yet.'}
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {publicGroupsFeed
                    ? <Link to="/search?tab=groups&create=1" className="btn btn-ghost btn-sm">Create a group</Link>
                    : <Link to="/connected-accounts" className="btn btn-ghost btn-sm">Connected accounts</Link>}
                </div>
              </>
            ) : ['countries', 'restaurants', 'bars'].includes(viewMode) ? (
              <>
                <p style={{ marginBottom: 12 }}>
                  {locationMessage || (viewMode === 'bars' ? 'Explore bars, clubs, and local pubs. Choose a city or country above to narrow your discoveries.' : viewMode === 'restaurants'
                    ? 'This feed searches for recent restaurant openings worldwide. Add a country or city above to bring matching reports closer to the top.'
                    : travelLocationLabel
                      ? `Travel is showing live views, guides, and current stories for ${travelLocationLabel}, then a wider worldwide scroll.`
                      : 'Travel combines live public cameras, destination guides, and fresh travel ideas. Add a country or city to see matching places first.')}
                </p>
                <button className="btn btn-ghost btn-sm" onClick={() => loadFeed(true, activeTabsRef.current, { replace: true, bust: false })}>Refresh now</button>
              </>
            ) : viewMode === 'following' ? (
              <>
                <p style={{ marginBottom: 12 }}>Follow people on UFIconnect to see their posts here.</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Link to="/search" className="btn btn-primary btn-sm">Find people</Link>
                  {/* forcedMode (the /you route) is Following as its own
                      dedicated page — switching viewMode in place here would
                      leave the URL saying /you while showing Feed content,
                      so this navigates to the real Feed page instead. */}
                  {forcedMode ? (
                    <Link to="/" className="btn btn-ghost btn-sm">Back to Home</Link>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => switchViewMode('feed')}>Back to Home</button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p style={{ marginBottom: 12 }}>Home is ready. Connect accounts when you want the scroll to feel more like yours.</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Link to="/connected-accounts" className="btn btn-primary btn-sm">Connect accounts</Link>
                  <Link to="/search?tab=groups" className="btn btn-ghost btn-sm">Join communities</Link>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          {viewMode === 'countries' && contentPosts.length > 0 && (
            <div className="travel-content-heading">
              <span>{travelLocationLabel ? `Travel picks: ${travelLocationLabel} and worldwide` : 'Travel picks'}</span>
            </div>
          )}

          {contentPosts.length > 0 && (
            <FeedErrorBoundary>
            <div
              data-feed-has-more={remoteHasMore ? 'true' : 'false'}
              data-feed-ref-has-more={remoteHasMoreRef.current ? 'true' : 'false'}
              data-feed-loading-more={loadingMore ? 'true' : 'false'}
              data-feed-cursor-ready={remoteCursorRef.current ? 'true' : 'false'}
              onPointerMove={handleFeedPointerPosition}
              onMouseOver={handleFeedPointerPosition}
            >
              {contentPosts.map((post, idx) => {
                const isPrefetchAnchor = idx === Math.max(0, contentPosts.length - FEED_POSITION_PREFETCH_POSTS);
                const isInPrefetchRange = idx >= Math.max(0, contentPosts.length - FEED_POSITION_PREFETCH_POSTS);
                return (
                  <div
                    key={`${post.id || `temp-${post.createdAt}`}-${idx}`}
                    ref={isPrefetchAnchor ? prefetchAnchorRef : null}
                    data-feed-position={idx}
                    onPointerEnter={isInPrefetchRange ? loadMoreRemote : undefined}
                    onFocusCapture={isInPrefetchRange ? loadMoreRemote : undefined}
                  >
                    <PostCard
                      post={post}
                      onMediaOpen={p => setMediaLightboxPostId(p.id)}
                      onPostUpdated={updateFeedPost}
                      onBlocked={handleBlocked}
                      onRemoved={handleRemoved}
                      isMediaOpen={post.id != null && post.id === mediaLightboxPostId}
                    />
                  </div>
                );
              })}
            </div>
            </FeedErrorBoundary>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {viewMode === 'countries' && travelPaginationError && (
            <div className="travel-camera-empty" role="status">
              <span>{travelPaginationError}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                setTravelPaginationError('');
                setRemoteHasMore(true);
                loadMoreRemote();
              }}><RotateCw size={14} aria-hidden="true" />Retry more destinations</button>
            </div>
          )}

          {loadingMore && (
            <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
        </>
      )}

      {/* Padding to prevent sticky banner from covering content */}
      {!profile && <div style={{ height: 70 }} />}

      {/* Guest sign-in sticky bottom banner */}
      {!profile && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
          background: 'linear-gradient(90deg, #1E40AF, #4F46E5)',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: '14px 20px',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.18)',
        }}>
          <span style={{ fontSize: '.9rem', fontWeight: 500 }}>
            Sign in to personalise your feed, save posts, and join communities
          </span>
          <Link
            to="/login"
            style={{
              background: '#fff', color: '#2563EB', fontWeight: 700,
              padding: '7px 18px', borderRadius: 20, fontSize: '.85rem',
              textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            Sign In
          </Link>
        </div>
      )}

      {mediaLightboxIndex !== -1 && (
        <ImageLightbox
          items={mediaPosts.map(p => ({ url: p.mediaUrl, type: p.mediaType, post: p }))}
          startIndex={mediaLightboxIndex}
          onClose={() => setMediaLightboxPostId(null)}
          onNearEnd={loadMoreRemote}
        />
      )}
      </>
      )}
      </div>
      {!forcedMode && (
        <aside className="home-feed-right-tabs" aria-label="Home feed controls">
          <div className="home-feed-view-tabs">
            {[
              { key: 'ufi', label: 'UFI' },
              { key: 'following', label: 'Following' },
            ].map(({ key, label }) => (
              <button key={key} type="button" className={`home-feed-rail-tab${viewMode === key ? ' active' : ''}`} onClick={() => activateHomeView(key)}>{label}</button>
            ))}
            <button type="button" className={`home-feed-rail-tab${viewMode === 'groups' && !publicGroupsFeed ? ' active' : ''}`} onClick={() => selectGroupScope('joined')}>Your groups</button>
            {[
              { key: 'countries', label: 'Travel', Icon: Plane },
              { key: 'restaurants', label: 'Restaurants', Icon: Utensils },
              { key: 'bars', label: 'Bars and clubs', Icon: Martini },
            ].map(({ key, label, Icon }) => (
              <button key={key} type="button" className={`home-feed-rail-tab home-feed-rail-tab--icon${viewMode === key ? ' active' : ''}`} onClick={() => activateHomeView(key)}><Icon size={16} strokeWidth={2.2} aria-hidden="true" />{label}</button>
            ))}
            <Link to="/music" className="home-feed-rail-tab">Music</Link>
            <Link to="/vault" className="home-feed-rail-tab">Your Vault</Link>
          </div>
          <div className="home-feed-rail-bottom">
            <Link to="/groups" className="home-feed-rail-tab">Discover groups</Link>
            <HomeFeedTools
              showSources
              sourceIds={viewMode === 'following' ? FOLLOWING_FILTER_SOURCES : ALL_FILTER_SOURCES}
              favoriteMode={viewMode === 'following' ? 'following' : 'feed'}
              activePanel={requestedHomeToolPanel}
              onActivePanelChange={setHomeToolPanel}
            />
            <Link to="/command-center" className="home-feed-rail-tab home-feed-command-center-link">
              <span>
                <span className="home-feed-command-center-title">Command Center</span>
                <span className="home-feed-command-center-summary">
                  {hasCommandCenterMembership
                    ? 'Tools and automation'
                    : `Tools and automation - Pro $${COMMAND_CENTER_PRO_TIER?.price}/mo`}
                </span>
              </span>
            </Link>
          </div>
        </aside>
      )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </Layout>
  );
}
