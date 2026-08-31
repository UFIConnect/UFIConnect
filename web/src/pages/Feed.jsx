import { useState, useEffect, useCallback, useRef, useMemo, Component, memo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';
import { extractYouTubeId, extractVimeoId, isDirectVideoUrl, deriveBlueskyPlaylistUrl, loadYouTubeIframeApi, InlineAutoplayVideo, userWantsSound, useGlobalMuted, useSoloVideoPlayback, SoundIcon } from '../components/videoMedia';
import { SOURCE_META, CONNECTED_SOCIAL_PLATFORMS } from '../components/sourceMeta';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import HomeFeedTools from '../components/HomeFeedTools';
import ImageLightbox from '../components/ImageLightbox';
import { useEngagementTracking } from '../hooks/useEngagementTracking';
import { reportEngagementSignal } from '../api/engagement';
import { reportClientError } from '../api/errorReporting';
import { ALL_INTERESTS } from './Onboarding';
import ReportModal from '../components/ReportModal';
import { useToast } from '../contexts/ToastContext';

// Utility: debounce function for search input
function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

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

function SourceMark({ source, label, size = 15, active = false }) {
  const meta = SOURCE_META[source] || {};
  if (hasBrandIcon(source)) {
    return (
      <span style={{
        width: size + 8, height: size + 8, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: '#fff', border: active ? 'none' : '1px solid var(--border)', flexShrink: 0,
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
      background: active ? 'rgba(255,255,255,.22)' : `${meta.color || 'var(--primary)'}18`,
      color: active ? '#fff' : (meta.color || 'var(--primary)'),
      fontSize: Math.max(8, size - 7), fontWeight: 800, lineHeight: 1, flexShrink: 0,
    }}>
      {String(text).slice(0, 3).toUpperCase()}
    </span>
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
  return ['ranked', 'newest', 'popular', 'balanced', 'bylink'].includes(value) ? value : 'ranked';
}

// Mirrors handleFeedRequest's own date-cursor eligibility check
// server-side: Newest sort, plain Feed mode (not Following — that's a live
// per-user query with no cursor of its own), no active search (a cursor
// has no defined meaning against a text-match result set). Kept as one
// function so loadMoreRemote's choice of ?cursor= vs ?page= can't drift
// from what the backend actually honors.
function isCursorEligible(mode, sort, search) {
  return mode === 'feed' && normalizeFeedSort(sort) === 'newest' && !search.trim();
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url || ''; }
}

function sortByLink(posts = []) {
  return [...posts].sort((a, b) => {
    const da = extractDomain(a.sourceUrl || '');
    const db = extractDomain(b.sourceUrl || '');
    return da.localeCompare(db) || feedPostTime(b) - feedPostTime(a);
  });
}

// The backend already sorts every mode except "By Domain" (bylink is a
// pure client-side grouping with no server equivalent) — ranked/newest/
// popular/balanced all arrive pre-sorted and, for balanced/ranked/newest,
// pre-diversified across sources. Re-sorting any of those client-side on
// top of an already-correct response undid that work on every single
// event that touched the post list — a manual refresh, a live merge, or
// just scrolling to load the next page — which is exactly what made a
// carefully interleaved feed look like it kept reshuffling itself. Only
// bylink still needs a real client-side sort; everything else trusts
// what the server already sent, unchanged.
function sortPostsForView(list = [], sort = 'ranked') {
  return normalizeFeedSort(sort) === 'bylink' ? sortByLink(list) : list;
}

function mergeFeedPosts(list = [], sort = 'ranked') {
  const byId = new Map();
  for (const post of list) {
    if (!post) continue;
    const key = post.id || `${post.source || 'feed'}:${post.sourceUrl || post.title || post.content || ''}:${post.createdAt || ''}`;
    if (!key) continue;
    const previous = byId.get(key);
    if (!previous || feedPostTime(post) >= feedPostTime(previous)) byId.set(key, post);
  }
  return sortPostsForView([...byId.values()], sort);
}

// Twitter/LinkedIn/Instagram/Facebook are back as single-source tabs —
// clicking one still routes through the backend's FEED_SOCIAL_TABS gate
// (a completely separate query path from the aggregate true mix, see
// getBalancedFeedPosts's exclusion of these sources), showing either the
// SocialConnectGate wall or that platform's connected content. They were
// pulled from here once under the mistaken idea that removing the *true
// mix* leak also meant removing the tabs entirely — it didn't; only the
// aggregate/Following mixing needed to change, not this single-source path.
// Kept as an explicit, hand-ordered list (most-recognizable platforms first)
// rather than deriving straight from ALL_FILTER_SOURCES — this is the row
// users scan first and scroll through on every visit, so display order
// matters here in a way it doesn't for the secondary Filters panel, which
// just needs to contain everything.  Every key still must exist in both
// ALL_FILTER_SOURCES and SOURCE_META so it also works from that panel.
const SOURCE_TABS = [
  { key: 'all' },
  { key: 'reddit' }, { key: 'github' }, { key: 'youtube' }, { key: 'hackernews' },
  { key: 'linkedin' }, { key: 'twitter' }, { key: 'instagram' }, { key: 'facebook' },
  { key: 'indeed' }, { key: 'remoteok' }, { key: 'remotive' }, { key: 'muse' }, { key: 'usajobs' },
  { key: 'bluesky' }, { key: 'devto' }, { key: 'stackoverflow' },
  { key: 'gitlab' }, { key: 'medium' }, { key: 'hashnode' }, { key: 'lobsters' },
  { key: 'arxiv' }, { key: 'producthunt' }, { key: 'indiehackers' }, { key: 'yc' },
  { key: 'crunchbase' }, { key: 'techcrunch' }, { key: 'theverge' }, { key: 'arstechnica' },
  { key: 'wired' }, { key: 'theregister' }, { key: 'venturebeat' }, { key: 'infoq' },
  { key: 'mittr' }, { key: 'phoronix' }, { key: 'smashing' }, { key: 'behance' },
  { key: 'designweb' }, { key: 'mastodon' },
].map(({ key }) => key === 'all'
  ? { key: 'all', label: 'All', icon: 'All' }
  : { key, label: SOURCE_META[key]?.label || key, icon: SOURCE_META[key]?.icon || 'SRC' });

// Following's own quick-filter row — the mirror image of SOURCE_TABS above:
// this is exactly the content SOURCE_TABS deliberately excludes (native
// UFIconnect posts from people you follow, plus whichever connected social
// accounts you've linked), so it gets its own tab vocabulary rather than
// reusing the aggregate Feed's. Covers every platform Connected Accounts
// offers (CONNECTED_SOCIAL_PLATFORMS), not just the 4 with a live
// keyword-search fallback today — this used to be hand-limited to
// LinkedIn/Twitter/Instagram/Facebook, so a user who'd connected e.g.
// GitHub or Reddit had no way to even select it here.
const FOLLOWING_SOURCE_TABS = [
  { key: 'all', label: 'All', icon: '' },
  { key: 'uficonnect', label: 'UFIconnect', icon: 'UFI' },
  ...CONNECTED_SOCIAL_PLATFORMS.map(key => ({ key, label: SOURCE_META[key]?.label || key, icon: SOURCE_META[key]?.icon || 'SRC' })),
];

const DEFAULT_FILTERS = { sort: 'newest', sources: [], timeRange: 'all', topics: [] };
const FEED_PAGE_SIZE = 50;
const FEED_AUTO_REFRESH_MS = 2 * 60 * 1000;
// Rolling dedup window for pagination — comfortably larger than the
// backend's main-feed snapshot pool (300 posts) so a normal scroll session
// never sees a near-term repeat, but bounded (not all-time) so pagination
// doesn't dead-end once a user has genuinely scrolled past everything the
// server has. See loadMoreRemote's markKnownId for why an unbounded set
// caused real, frequent duplicates: the snapshot pool gets rebuilt every
// few minutes, so two page requests straddling a rebuild can slice
// overlapping content even before the pool has been fully scrolled once.
const FEED_DEDUP_WINDOW = 600;

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

function loadFeedState(userId) {
  try {
    const key = memberStorageKey(FEED_STATE_KEY, userId);
    if (!key) return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const activeTabs = Array.isArray(s.activeTabs) ? s.activeTabs : [];
    const filters = { ...DEFAULT_FILTERS, ...(s.filters || {}) };
    if (activeTabs.length) filters.sources = [];
    return {
      filters,
      activeTabs,
      search:     typeof s.search === 'string' ? s.search : '',
      viewMode:   ['following', 'local', 'restaurants'].includes(s.viewMode) ? s.viewMode : 'feed',
      location:   normalizeLocationFilters(s.location),
    };
  } catch { return null; }
}

function saveFeedState(userId, filters, activeTabs, search, viewMode, location) {
  try {
    const key = memberStorageKey(FEED_STATE_KEY, userId);
    if (!key) return;
    sessionStorage.setItem(key, JSON.stringify({ filters, activeTabs, search, viewMode, location }));
  } catch {}
}

// Twitter/LinkedIn/Instagram/Facebook are included here too (multi-select
// filter panel) — selecting one alongside other sources just contributes
// whatever's in that platform's worker cache (empty until connected/an
// app-level token exists, same as any other source that's temporarily
// thin), no lock wall in that combined view. The single-source lock wall
// (SocialConnectGate) only applies via the SOURCE_TABS single-tab click
// path above, not this multi-select one.
const ALL_FILTER_SOURCES = [
  'reddit', 'github', 'youtube', 'hackernews',
  'linkedin', 'twitter', 'instagram', 'facebook',
  'indeed', 'remoteok', 'remotive', 'muse', 'usajobs',
  'bluesky', 'gitlab', 'devto', 'medium', 'stackoverflow', 'lobsters', 'arxiv',
  'producthunt', 'techcrunch', 'theverge', 'indiehackers', 'hashnode',
  'arstechnica', 'wired', 'theregister', 'venturebeat', 'smashing', 'phoronix', 'infoq', 'mittr',
  'yc', 'crunchbase', 'behance', 'designweb', 'mastodon',
];

// Following's filter-panel options — native UFIconnect posts from people you
// follow, plus every platform Connected Accounts offers (see
// FOLLOWING_SOURCE_TABS above for why this now matches that full list
// instead of just the 4 with a live keyword-search fallback). Deliberately
// excludes everything in ALL_FILTER_SOURCES above — that content
// structurally cannot appear in Following, so offering it as a filter here
// would just be a no-op that always returns nothing.
const FOLLOWING_FILTER_SOURCES = ['uficonnect', ...CONNECTED_SOCIAL_PLATFORMS];

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
function PostText({ text }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const needsCollapse = text.length > POST_TEXT_COLLAPSE_LENGTH;
  const shown = needsCollapse && !expanded ? text.slice(0, POST_TEXT_COLLAPSE_LENGTH).trimEnd() : text;
  return (
    <p className="post-content" style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
      {shown}{needsCollapse && !expanded ? '… ' : ''}
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
function FilterPanel({ filters, onChange, sources, onClose, panelRef }) {
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
    const cleared = { ...DEFAULT_FILTERS };
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

      {/* Sort */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Sort</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { value: 'ranked',   label: 'Ranked' },
            { value: 'newest',   label: 'Newest' },
            { value: 'popular',  label: 'Popular' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'bylink',   label: 'By Domain' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setLocal(f => ({ ...f, sort: value }))}
              style={{
                flex: '1 1 46%', padding: '7px 0', borderRadius: 8, fontSize: '.8rem', fontWeight: 600,
                border: `1.5px solid ${local.sort === value ? 'var(--primary)' : 'var(--border)'}`,
                background: local.sort === value ? 'var(--primary)' : 'var(--surface)',
                color: local.sort === value ? '#fff' : 'var(--text)', cursor: 'pointer',
              }}
            >{label}</button>
          ))}
        </div>
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
      <div style={{ marginBottom: 18 }}>
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
      </div>

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
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
          Topic {local.topics.length > 0 && `(${local.topics.length} selected)`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {ALL_INTERESTS.map(topic => {
            const active = local.topics.includes(topic);
            return (
              <button
                key={topic}
                onClick={() => setLocal(f => ({ ...f, topics: f.topics.includes(topic) ? f.topics.filter(t => t !== topic) : [...f.topics, topic] }))}
                style={{
                  padding: '4px 10px', borderRadius: 16, fontSize: '.73rem', fontWeight: 600,
                  border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                  background: active ? 'var(--primary)' : 'var(--surface)',
                  color: active ? '#fff' : 'var(--muted)', cursor: 'pointer',
                }}
              >
                {topic}
              </button>
            );
          })}
        </div>
      </div>
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

function YouTubeEmbedBlock({ embedId, videoKey, poster, title, maxHeight = 280, autoPlayOnVisible = true, forcePause = false }) {
  const [inView, setInView] = useState(false);
  // Whether the real YT.Player has actually been constructed yet — separate
  // from `playing`/`effectivelyPlaying` (see below) because construction
  // happens at most once per embedId and is never redone just because
  // visibility toggled off and back on.
  const [playerReady, setPlayerReady] = useState(false);
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
  const ytMountRef = useRef(null);
  const ytPlayerRef = useRef(null);
  // Toggles both ways with real scroll position — was one-directional
  // (isIntersecting=true set playing, nothing ever set it back false), so a
  // video that autoplayed into view kept playing, decoding, and (if
  // unmuted) audible indefinitely after being scrolled past. Mirrors
  // InlineAutoplayVideo's inView pattern for the other video type.
  useEffect(() => {
    if (!autoPlayOnVisible) return;
    const el = containerRef.current;
    if (!el) return;
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
  const isSolo = useSoloVideoPlayback(videoKey || embedId, inView && !forcePause);
  const effectivelyPlaying = isSolo && !forcePause;

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
    if (!effectivelyPlaying || ytPlayerRef.current) return;
    let cancelled = false;
    const startUnmuted = !muted;
    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !ytMountRef.current || ytPlayerRef.current) return;
      const player = new YT.Player(ytMountRef.current, {
        videoId: embedId,
        // origin: without it, the IFrame Player API's postMessage bridge
        // back to this page can silently fail ("Unable to post message to
        // https://www.youtube.com...") — confirmed live on mobile WebKit,
        // same fix applied to VideoFeedView/ImageLightbox's own players.
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, controls: 0, modestbranding: 1, rel: 0, origin: window.location.origin },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            ytPlayerRef.current = e.target;
            try { e.target.getIframe().style.pointerEvents = 'none'; } catch {}
            if (startUnmuted) e.target.unMute();
            setPlayerReady(true);
          },
        },
      });
    });
    return () => { cancelled = true; };
  }, [effectivelyPlaying, embedId]);

  // The only real teardown — this exact video changing, or the card
  // leaving the DOM entirely (e.g. scrolled out of the feed's own render
  // window, not just out of the viewport).
  useEffect(() => {
    return () => {
      try { ytPlayerRef.current?.destroy(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [embedId]);

  // Every subsequent visibility change plays/pauses the already-constructed
  // player in place instead of recreating it.
  useEffect(() => {
    if (!ytPlayerRef.current) return;
    try {
      if (effectivelyPlaying) ytPlayerRef.current.playVideo();
      else ytPlayerRef.current.pauseVideo();
    } catch {}
  }, [effectivelyPlaying]);

  useEffect(() => {
    if (!ytPlayerRef.current) return;
    if (muted) ytPlayerRef.current.mute(); else ytPlayerRef.current.unMute();
  }, [muted]);

  const showPlayerHint = !playerReady && !effectivelyPlaying;

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#000', cursor: showPlayerHint ? 'pointer' : 'default' }}
      onClick={showPlayerHint ? () => setInView(true) : undefined}
    >
      {/* Always in the DOM once rendered, and — critically — always
          display:'block' from the very first render, never toggled by
          showPoster. YouTube's script physically replaces this exact node
          with its own <iframe> the moment the player is constructed (see
          the effect above), copying over whatever inline style the div
          had at that instant. If this div were still display:'none' at
          that point (true before playerReady flips), the *replacement*
          iframe inherits display:'none' too — and since ytMountRef now
          points at a detached node no longer in the document, React's
          later re-render (once playerReady goes true) writes the
          'display: block' update to that orphaned div, not the live
          iframe, permanently freezing the real player invisible. Keeping
          this constant sidesteps the trap entirely; the poster below
          covers it as a plain absolutely-positioned overlay instead,
          which — being a normal React-owned element nothing external ever
          takes ownership of — is always safe to conditionally render. */}
      {/* pointerEvents: 'none' — controls: 0 above means there's no native
          YouTube chrome to click inside this iframe anyway (mute/maximize
          are the separate custom buttons below, unaffected since they're
          siblings, not descendants, of this div), so nothing is lost by
          letting scroll/touch pass through to the feed underneath instead
          of the iframe's own document swallowing it — same fix
          VideoFeedView and ImageLightbox's own YouTube mounts already use. */}
      <div ref={ytMountRef} style={{ width: '100%', aspectRatio: '16/9', display: 'block', maxHeight, pointerEvents: 'none' }} />
      {showPlayerHint && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#fff', background: 'linear-gradient(135deg, #111827, #020617)',
          pointerEvents: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: '.85rem' }}>
            <span style={{
              width: 42, height: 42, borderRadius: '50%', background: '#FF0000',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(0,0,0,.35)', fontSize: '1.15rem',
            }}>▶</span>
            <span>{autoPlayOnVisible ? 'Playing when it hits the sweet spot' : 'Tap to play'}</span>
          </div>
        </div>
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

function YouTubeCard({ post, cardRef, onMediaOpen, isMediaOpen }) {
  const src = SOURCE_META.youtube;
  const c   = catStyle(post.group?.category);
  const embedId = post.embedId || extractYouTubeId(post.sourceUrl || post.mediaUrl);
  return (
    <div ref={cardRef} className="card post-card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <SourceMark source="youtube" label={src.icon} size={14} />
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: src.color }}>YouTube</span>
        {post.group && <span style={{ fontSize: '.68rem', fontWeight: 600, background: c.bg, color: c.text, padding: '2px 7px', borderRadius: 5 }}>{post.group.name}</span>}
        {post.topic && <span style={{ fontSize: '.65rem', color: 'var(--muted)', background: 'var(--border)', padding: '2px 6px', borderRadius: 4 }}>{post.topic}</span>}
        <LocationMatchBadge post={post} />
        <Link to={`/p/${encodeURIComponent(post.id)}`} style={{ marginLeft: 'auto', fontSize: '.7rem', color: 'var(--muted)', textDecoration: 'none' }}>
          {timeAgo(post.createdAt)}
        </Link>
      </div>
      <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 10px', lineHeight: 1.4 }}>{post.title}</p>
      {embedId ? (
        <div style={{ marginBottom: 10, position: 'relative' }}>
          <YouTubeEmbedBlock embedId={embedId} videoKey={post.id} poster={post.mediaUrl} title={post.title} maxHeight={280} forcePause={isMediaOpen} />
          {onMediaOpen && <MaximizeButton onClick={() => onMediaOpen(post)} />}
        </div>
      ) : post.mediaUrl ? (
        <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 10, background: 'var(--border)' }}>
          <img src={post.mediaUrl} alt={post.title} style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 280 }}
            onError={e => {
              e.currentTarget.style.display = 'none';
              const fallback = e.currentTarget.parentElement.querySelector('[data-youtube-img-fallback]');
              if (fallback) fallback.style.display = 'flex';
            }} />
          <div data-youtube-img-fallback style={{
            display: 'none', alignItems: 'center', justifyContent: 'center',
            height: 200, color: 'var(--muted)', fontSize: '.85rem',
          }}>
            Image unavailable
          </div>
        </div>
      ) : null}
      {post.content && <PostText text={post.content} />}
      {post.sourceUrl && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: src.color }}>
            <SourceMark source="youtube" label={src.icon} size={11} />
            <span style={{ fontSize: '.7rem', color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.sourceUrl}</span>
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: src.color, background: `${src.color}14`, padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>Watch</span>
          </a>
        </div>
      )}
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
  const [inView, setInView] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 } // was 0.4 — lower bar so autoplay triggers during the scroll transition on small mobile viewports, not just once scrolling has essentially stopped
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // See useSoloVideoPlayback — only the most-recently-scrolled-to video
  // across the whole Feed (any embed type) actually plays at once.
  const playing = useSoloVideoPlayback(videoKey || embedId, inView && !forcePause) && !forcePause;

  return (
    <div ref={containerRef} style={{
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
  'instagram','facebook',
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

const PostCard = memo(function PostCard({ post, onMediaOpen, onPostUpdated, isMediaOpen }) {
  const { profile, token } = useAuth();
  const { showToast } = useToast();
  const [moreOpen,   setMoreOpen]   = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const moreBtnRef  = useRef(null);
  const moreMenuRef = useRef(null);
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

  // Close the "more options" menu on an outside click (same pattern as
  // PublicProfile's). Listener is only attached while open — PostCard is
  // repeated for every post on screen, so a permanently-mounted document
  // listener per card would add up.
  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e) {
      if (
        moreMenuRef.current && !moreMenuRef.current.contains(e.target) &&
        moreBtnRef.current && !moreBtnRef.current.contains(e.target)
      ) setMoreOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);

  if (!post || typeof post !== 'object') return null;

  const c   = catStyle(post.group?.category);
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;

  if (post.source === 'youtube') return <YouTubeCard post={post} cardRef={cardRef} onMediaOpen={onMediaOpen} isMediaOpen={isMediaOpen} />;

  const isExternal     = post.isExternal;
  const isJob          = JOB_SOURCES.has(post.source);
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
  const videoIsDirectFile = hasVideo && !videoPlaylistUrl && !videoYouTubeId && !videoVimeoId && isDirectVideoUrl(videoLinkUrl);
  const videoIsPlayable = hasVideo && (videoPlaylistUrl || videoIsDirectFile || videoYouTubeId || videoVimeoId);
  const commentCount   = post.commentsCount || 0;
  const commUrl        = commentUrl(post);
  const hasComments    = COMMENT_SOURCES.has(post.source);
  const sectionLabel   = commentSectionLabel(post.source);
  const isArticle      = ARTICLE_SOURCES.has(post.source);
  const canWriteComment = !post.isExternal && (post.source || 'uficonnect') === 'uficonnect' && !!token;

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
      const { data } = await client.post(`/posts/${encodeURIComponent(post.id)}/comments`, { content });
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

  return (
    <div ref={cardRef} className="card post-card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <SourceMark source={post.source} label={src.icon} size={13} />
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: src.color }}>{post.sourceLabel || src.label}</span>
        {isJob && <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#059669', background: '#ECFDF5', padding: '2px 8px', borderRadius: 5 }}>Job</span>}
        {post.group && <span style={{ fontSize: '.68rem', fontWeight: 700, background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 5 }}>{post.group.name}</span>}
        {post.topic && <span style={{ fontSize: '.65rem', color: 'var(--muted)', background: 'var(--border)', padding: '2px 6px', borderRadius: 4 }}>{post.topic}</span>}
        <LocationMatchBadge post={post} />
        {post.fromJoinedGroup && <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>· your group</span>}
        <Link to={`/p/${encodeURIComponent(post.id)}`} style={{ marginLeft: 'auto', fontSize: '.7rem', color: 'var(--muted)', textDecoration: 'none' }}>
          {timeAgo(post.createdAt)}
        </Link>
        <div style={{ position: 'relative' }}>
          <button
            ref={moreBtnRef}
            onClick={() => setMoreOpen(o => !o)}
            aria-label="More options"
            aria-expanded={moreOpen}
            style={{ all: 'unset', cursor: 'pointer', padding: '2px 4px', fontSize: '.9rem', fontWeight: 700, color: 'var(--muted)', lineHeight: 1 }}
          >
            •••
          </button>
          {moreOpen && (
            <div
              ref={moreMenuRef}
              role="menu"
              style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20,
                minWidth: 160, background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden',
                textAlign: 'left',
              }}
            >
              <button
                role="menuitem"
                onClick={() => { setMoreOpen(false); token ? setReportOpen(true) : showToast('Sign in to report a post.', 'info'); }}
                style={{
                  all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '9px 12px', fontSize: '.82rem', fontWeight: 600,
                  color: 'var(--text)', cursor: 'pointer',
                }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--hover, rgba(0,0,0,.04))'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
              >
                Report post
              </button>
            </div>
          )}
        </div>
      </div>
      {reportOpen && (
        <ReportModal
          targetType="post"
          targetId={post.id}
          targetLabel="this post"
          onClose={() => setReportOpen(false)}
          onSubmitted={() => showToast('Report submitted — thank you.', 'success')}
        />
      )}

      {!isExternal && post.author?.id && (
        <Link
          to={post.author.id === profile?.id ? '/profile' : `/u/${post.author.id}`}
          className="post-header"
          style={{ marginBottom: 8, textDecoration: 'none', color: 'inherit' }}
        >
          <div className="avatar avatar-md">{initials(post.author?.name)}</div>
          <div className="post-meta">
            <div className="post-author">{post.author?.name || 'Member'}</div>
            <div className="post-source">{post.author?.title}{post.author?.organization ? ` · ${post.author.organization}` : ''}</div>
          </div>
        </Link>
      )}
      {isExternal && post.author?.name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <SourceMark source={post.source} label={src.icon} size={17} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '.82rem' }}>{post.author.name}</div>
            <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>{src.label}</div>
          </div>
        </div>
      )}

      {post.title && (
        isExternal && post.sourceUrl ? (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 6px', lineHeight: 1.4 }}>
              {post.title}<span style={{ marginLeft: 5, fontSize: '.75rem', color: src.color, opacity: 0.8 }}>↗</span>
            </p>
          </a>
        ) : (
          <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 6px', lineHeight: 1.4 }}>{post.title}</p>
        )
      )}

      <PostText text={post.content} />

      {post.mediaUrl && post.mediaType === 'image' && (
        <button
          onClick={() => onMediaOpen?.(post)}
          style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer', marginTop: 12 }}
        >
          <div style={{ borderRadius: 14, overflow: 'hidden', background: 'var(--border)' }}>
            <img src={post.mediaUrl} alt={post.title || 'Post image'}
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 400 }}
              onError={e => {
                e.currentTarget.style.display = 'none';
                const placeholder = e.currentTarget.parentElement.querySelector('[data-img-placeholder]');
                if (placeholder) placeholder.style.display = 'flex';
              }} />
            <div data-img-placeholder style={{
              display: 'none', alignItems: 'center', justifyContent: 'center',
              height: 200, color: 'var(--muted)', fontSize: '.85rem', fontWeight: 500,
            }}>
              Image unavailable
            </div>
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
      ) : hasVideo && (
        <button onClick={() => onMediaOpen?.(post)} style={{ all: 'unset', display: 'block', width: '100%', marginTop: 12, cursor: 'pointer' }}>
          <div style={{ borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#000' }}>
            {videoIsPlayable ? (
              // Autoplays muted/looping as it scrolls into view (see
              // InlineAutoplayVideo) instead of sitting as a static frame
              // with a "tap to play" badge — the click-to-maximize behavior
              // is unchanged, same as photos: the button wrapping this
              // still opens ImageLightbox for sound, seeking, and next/prev.
              <InlineAutoplayVideo
                kind={videoPlaylistUrl ? 'hls' : 'file'}
                src={videoPlaylistUrl || videoLinkUrl}
                videoKey={post.id}
                poster={videoPlaylistUrl ? post.mediaPoster : undefined}
                style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 360 }}
                forcePause={isMediaOpen}
              />
            ) : (
              <>
                <img src={post.mediaUrl} alt="Video"
                  style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 360, opacity: 0.82 }}
                  onError={e => {
                    e.currentTarget.style.display = 'none';
                    const fallback = e.currentTarget.parentElement.querySelector('[data-video-fallback]');
                    if (fallback) fallback.style.display = 'flex';
                  }} />
                <div data-video-fallback style={{
                  display: 'none', position: 'absolute', inset: 0,
                  alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.5)', color: 'var(--muted)', fontSize: '.85rem',
                }}>
                  Video unavailable
                </div>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 60, height: 60, borderRadius: '50%', background: `${src.color}e0`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,.45)' }}>
                    <span style={{ color: '#fff', fontSize: '1.5rem', marginLeft: 3 }}>▶</span>
                  </div>
                </div>
              </>
            )}
            <span style={{ position: 'absolute', bottom: 10, right: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 4 }}>
              <SourceMark source={post.source} label={src.icon} size={12} />
              {src.label}
            </span>
          </div>
        </button>
      )}

      {/* Stats + actions bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        {post.likesCount > 0 && (
          // GitHub/GitLab post likesCount is actually the repo/project's
          // star count (backend/index.js resolveVideoSource-adjacent
          // fetchers repurpose stargazers_count/star_count there, since
          // neither platform has a real per-post "like") — a heart implies
          // someone liked *this post*, which never happened. Star icon for
          // just those two keeps the real number (still a genuine, useful
          // signal) without misrepresenting what it means.
          <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
            {post.likesCount.toLocaleString()} likes
          </span>
        )}
        {hasComments && (
          <button
            onClick={toggleComments}
            style={{ all: 'unset', cursor: 'pointer', fontSize: '.75rem', color: showComments ? src.color : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: showComments ? 700 : 400 }}
          >
            {commentCount > 0 ? `${commentCount.toLocaleString()} ` : ''}{showComments ? `Hide ${sectionLabel}` : sectionLabel}
          </button>
        )}
        {post.sourceUrl && (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => {
              e.stopPropagation();
              reportEngagementSignal({ postId: post.id, source: post.source, topic: post.topic, linkClick: true });
            }}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}>
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: src.color, background: `${src.color}14`, padding: '3px 8px', borderRadius: 5 }}>
              {isJob ? 'Apply' : hasVideo ? 'Watch' : 'Open'} on {src.label} ↗
            </span>
          </a>
        )}
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
              Couldn't load comments.
              <button onClick={fetchComments} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600, padding: 0 }}>
                Try again
              </button>
            </div>
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

          {!isExternal && !token && (post.source || 'uficonnect') === 'uficonnect' && (
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
    const raw = localStorage.getItem(key);
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
    localStorage.setItem(key, JSON.stringify({ posts: posts.slice(0, 100), ts: Date.now() }));
  } catch {}
}

// forcedMode: set by the /you route (see App.jsx) to lock this page into
// Following mode — the "You" nav tab's full equalizer feed of the member's
// connected-platform activity. Reuses every bit of Following mode's
// existing machinery (cursor pagination, equalizer, infinite scroll) rather
// than a second feed engine; the toggle pill below is just hidden so /you
// can't be switched away from it mid-visit.
export default function Feed({ forcedMode } = {}) {
  const { profile, updateProfileLocally } = useAuth();
  const routeLocation = useLocation();
  const [connectedSocial, setConnectedSocial] = useState(null); // null = not yet fetched
  const [socialBannerDismissed, setSocialBannerDismissed] = useState(false);
  const [connecting,    setConnecting]   = useState(false);
  // Set from a single-source-tab response's `locked:true` (see FEED_SOCIAL_TABS
  // server-side) — a gated platform tab clicked without that account connected.
  // null whenever the current view isn't a locked single-gated-source tab.
  const [lockedPlatform, setLockedPlatform] = useState(null);
  const _cache = readFeedCache(profile?.id);
  const [posts,         setPosts]        = useState(_cache?.posts || []);
  // Following mode's per-source fetch failures (bad scope, API not
  // enabled, expired token) — see getFollowingFeedPosts's own comment
  // server-side. Surfaced in the empty state below instead of a real
  // failure reading identically to "this account just has nothing new."
  const [sourceErrors,  setSourceErrors]  = useState({});
  const activeMemberIdRef = useRef(profile?.id || null);
  const [loading,       setLoading]      = useState(!_cache);
  const [feedError,     setFeedError]    = useState(null);
  const [refreshing,    setRefreshing]   = useState(false);
  const [loadingMore,   setLoadingMore]  = useState(false);
  const [remotePage,    setRemotePage]   = useState(2);
  const [remoteHasMore, setRemoteHasMore]= useState(true);
  const _saved = loadFeedState(profile?.id);
  const [search,        setSearch]       = useState(_saved?.search || '');
  const [searchInput,   setSearchInput]  = useState(_saved?.search || '');
  const [filterOpen,    setFilterOpen]   = useState(false);
  const [mediaLightboxPostId, setMediaLightboxPostId] = useState(null);
  const [lastRefresh,   setLastRefresh]  = useState(null);
  const [filters, setFilters] = useState(_saved?.filters || DEFAULT_FILTERS);
  const [liveActive,    setLiveActive]    = useState(false);
  const [activeTabs,    setActiveTabs]    = useState(_saved?.activeTabs || []); // [] = All
  const [viewMode,      setViewMode]      = useState(forcedMode || _saved?.viewMode || 'feed');
  const [locationFilters, setLocationFilters] = useState(() => normalizeLocationFilters(_saved?.location));
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');

  const filterBtnRef  = useRef(null);
  const panelRef      = useRef(null);
  const knownIds      = useRef(new Set((_cache?.posts || []).map(p => p.id).filter(Boolean)));
  // Insertion-order companion to knownIds so it can be trimmed like a FIFO
  // — a plain Set has no cheap "oldest entry" eviction of its own, but
  // JS Sets do iterate in insertion order, so pairing it with an array of
  // the same insertions (mirrors the backend's seenPostIds/seenPostIdQueue
  // pattern) is enough to bound it without a full data structure.
  const knownIdsQueue = useRef([...knownIds.current]);
  const markKnownId = useCallback((id) => {
    if (!id || knownIds.current.has(id)) return;
    knownIds.current.add(id);
    knownIdsQueue.current.push(id);
    if (knownIdsQueue.current.length > FEED_DEDUP_WINDOW) {
      const oldest = knownIdsQueue.current.shift();
      knownIds.current.delete(oldest);
    }
  }, []);
  const sentinelRef   = useRef(null);
  // Synchronous guard for loadMoreRemote — see its own comment. The
  // loadingMore *state* the UI spinner reads isn't visible synchronously
  // (React batches/defers the re-render), so a fast scroll firing the
  // IntersectionObserver's callback several times before that update lands
  // let every one of those calls read the same stale loadingMore:false and
  // all start their own fetch. A ref updates immediately, in the same tick.
  const loadingMoreRef = useRef(false);
  const activeTabsRef = useRef(_saved?.activeTabs || []);
  const filtersRef    = useRef(_saved?.filters || DEFAULT_FILTERS);
  const viewModeRef   = useRef(forcedMode || _saved?.viewMode || 'feed');
  const locationFiltersRef = useRef(normalizeLocationFilters(_saved?.location));
  const searchRef     = useRef(_saved?.search || '');
  const postsRef      = useRef([]);
  const loadStateRef  = useRef({ loading: false, refreshing: false, loadingMore: false });
  const liveRefreshTimeoutRef = useRef(null);
  // Sent as ?seed= on every feed request — the backend folds it into this
  // user's rotation offset into the shared pool (see rotateForUser
  // server-side). Regenerated only on an explicit refresh (inside loadFeed,
  // gated on manual===true) and otherwise left alone, so pagination within
  // a sitting keeps slicing the same rotated view consistently — without
  // this, refreshing handed back the exact same rotation of the exact same
  // pool every time, since neither the user nor the still-warm pool changed.
  const refreshSeedRef = useRef(Math.random().toString(36).slice(2));
  // Opaque date-cursor from the backend (see getCursorFeedPage server-side)
  // for the newest-sort feed/filtered views — null means "start from now."
  // Only meaningful when isCursorEligible() below is true; ignored
  // otherwise (Ranked/Popular/Balanced sort and Following mode still page
  // by number, since neither has a natural date-cursor semantic — see
  // handleFeedRequest's own eligibility check, which this mirrors).
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
    activeFilters.sort = normalizeFeedSort(activeFilters.sort);
    const activeMode = requestedMode || viewModeRef.current;
    const activeSearch = typeof q === 'string' ? q.trim() : searchRef.current.trim();
    const activeSourceTabs = Array.isArray(tabs) ? tabs : activeTabsRef.current;
    const requestedSources = ['feed', 'following'].includes(activeMode)
      ? (activeFilters.sources?.length ? activeFilters.sources : activeSourceTabs)
      : [];
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
      if (['local', 'restaurants'].includes(activeMode)) {
        if (locationFiltersRef.current.country) params.set('country', locationFiltersRef.current.country);
        if (locationFiltersRef.current.city) params.set('city', locationFiltersRef.current.city);
      }
      if (bust) {
        params.set('bust', '1');
      }
      const url = `/office/feed?${params.toString()}`;
      const { data } = await client.get(url);
      if (data.locked) {
        setFeedError(null);
        // Single gated-source tab, not connected — show the connect wall
        // instead of an empty/broken post list. Clears itself the moment
        // any other view is loaded (tab switch, viewMode switch, etc.) since
        // every other loadFeed call path runs this same branch and would
        // simply not set it again.
        setLockedPlatform(data.source || requestedSources[0] || null);
        setPosts([]);
        setRemoteHasMore(false);
        setLastRefresh(new Date());
        return;
      }
      setLockedPlatform(null);
      setFeedError(null);
      const incoming = data.posts || [];
      const previous = postsRef.current;
      // "Updated Xm ago" used to always show however long ago the browser
      // last fetched, even when the feed is served from the server's
      // 10-minute stable-sort snapshot — the label could claim "just now"
      // while the actual content was sorted up to 10 minutes earlier.
      // snapshotAt is only present when the response came from that cache;
      // a freshly-computed response has no staleness to report, so "now" is
      // accurate for that case.
      const refreshTimestamp = data.snapshotAt || Date.now();
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
      const nextPosts = shouldMerge
        ? mergeFeedPosts([...previous, ...incoming], activeFilters.sort)
        : mergeFeedPosts(incoming, activeFilters.sort);

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
        setLastRefresh(new Date(refreshTimestamp));
        return;
      }
      knownIdsQueue.current = nextPosts.map(p => p.id).filter(Boolean);
      knownIds.current = new Set(knownIdsQueue.current);
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
      setRemoteHasMore(data.hasMore !== false);
      setLastRefresh(new Date(refreshTimestamp));
      setSourceErrors(data.sourceErrors || {});
      if (['local', 'restaurants'].includes(activeMode)) {
        setLocationMessage(data.locationRequired || data.providerError || '');
      }
    } catch (e) {
      console.error(e);
      const status = e?.response?.status;
      const message = status === 401
        ? 'Your session could not load the feed. Sign in again to refresh your access.'
        : status
          ? `The feed request failed with HTTP ${status}.`
          : 'The feed request did not complete. Check the API connection and try again.';
      if (!silent || postsRef.current.length === 0) setFeedError(message);
    }
    finally { setLoading(false); setRefreshing(false); }
  }, [profile?.id]);

  // Keep postsRef in sync so loadFeed can read current posts without a dep cycle
  useEffect(() => { postsRef.current = posts; }, [posts]);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { locationFiltersRef.current = locationFilters; }, [locationFilters]);
  useEffect(() => { searchRef.current = search; }, [search]);

  // Persist filter state so the page reopens with the same settings
  useEffect(() => {
    saveFeedState(profile?.id, filters, activeTabs, search, viewMode, locationFilters);
  }, [profile?.id, filters, activeTabs, search, viewMode, locationFilters]);
  useEffect(() => {
    if (!profile?.id || activeMemberIdRef.current === profile.id) return;
    activeMemberIdRef.current = profile.id;
    const saved = loadFeedState(profile.id);
    const nextFilters = saved?.filters || DEFAULT_FILTERS;
    const nextTabs = saved?.activeTabs || [];
    const nextSearch = saved?.search || '';
    const nextMode = saved?.viewMode || 'feed';
    const nextLocation = saved?.location || normalizeLocationFilters(profile.roleSettings?.feedLocation);
    filtersRef.current = nextFilters;
    activeTabsRef.current = nextTabs;
    searchRef.current = nextSearch;
    viewModeRef.current = nextMode;
    locationFiltersRef.current = nextLocation;
    setFilters(nextFilters);
    setActiveTabs(nextTabs);
    setSearch(nextSearch);
    setSearchInput(nextSearch);
    setViewMode(nextMode);
    setLocationFilters(nextLocation);
    setRemotePage(2);
    setRemoteHasMore(true);
    remoteCursorRef.current = null;
  }, [profile?.id, profile?.roleSettings?.feedLocation]);
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
  const switchViewMode = useCallback((mode) => {
    const nextMode = ['following', 'local', 'restaurants'].includes(mode) ? mode : 'feed';
    const usesSources = ['feed', 'following'].includes(nextMode);
    const nextTabs = usesSources ? activeTabsRef.current : [];
    const nextFilters = usesSources
      ? filtersRef.current
      : { ...filtersRef.current, sources: [] };
    viewModeRef.current = nextMode;
    activeTabsRef.current = nextTabs;
    filtersRef.current = nextFilters;
    setViewMode(nextMode);
    setActiveTabs(nextTabs);
    setFilters(nextFilters);
    setRemotePage(2);
    setRemoteHasMore(true);
    // Local and restaurant feeds are location-first. Clear source controls
    // before fetching so a hidden Home/Following source cannot leak into
    // one of those views.
    loadFeed(true, nextTabs, {
      mode: nextMode,
      filters: nextFilters,
      q: searchRef.current,
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

  useEffect(() => {
    if (forcedMode) return;
    const requested = new URLSearchParams(routeLocation.search).get('feed');
    if (!['local', 'restaurants', 'following', 'feed'].includes(requested) || requested === viewModeRef.current) return;
    switchViewMode(requested);
  }, [forcedMode, routeLocation.search, switchViewMode]);

  const applyFilters = useCallback((nextFilters) => {
    const next = { ...DEFAULT_FILTERS, ...(nextFilters || {}) };
    next.sort = normalizeFeedSort(next.sort);
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


  const clearFeedControls = useCallback(() => {
    activeTabsRef.current = [];
    filtersRef.current = DEFAULT_FILTERS;
    searchRef.current = '';
    setActiveTabs([]);
    setFilters(DEFAULT_FILTERS);
    setSearch('');
    setSearchInput('');
    setRemotePage(2);
    setRemoteHasMore(true);
    loadFeed(false, [], { filters: DEFAULT_FILTERS, q: '', replace: true });
  }, [loadFeed]);

  const applyLocationFilters = useCallback(async (event) => {
    event?.preventDefault();
    const next = normalizeLocationFilters(locationFiltersRef.current);
    locationFiltersRef.current = next;
    setLocationFilters(next);
    setLocationSaving(true);
    setLocationMessage('');
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
      setLocationMessage('Could not save this location. Your previous feed location is still active.');
    } finally {
      setLocationSaving(false);
      setRemotePage(2);
      setRemoteHasMore(true);
      loadFeed(false, activeTabsRef.current, { replace: true });
    }
  }, [loadFeed, profile?.roleSettings, updateProfileLocally]);

  // Debounced search handler
  const debouncedSearch = useMemo(
    () => debounce((query) => {
      searchRef.current = query.trim();
      setSearch(query.trim());
      setRemotePage(2);
      setRemoteHasMore(true);
      loadFeed(false, activeTabsRef.current, { q: query.trim(), replace: true });
    }, 400),
    [loadFeed]
  );

  const toggleTab = useCallback((key) => {
    searchRef.current = '';
    setSearch('');
    setSearchInput('');
    // Source tabs just change which filter is active now — they no longer
    // double as their own refresh (that's Feed's job now, see
    // switchViewMode). manual:false means no seed reshuffle, no forced
    // live/bust refetch, no "refreshing" UI treatment — this is a filter
    // change, not the user asking to go fetch newer data.
    if (key === 'all') {
      activeTabsRef.current = [];
      setActiveTabs([]);
      // Clears source filtering only — sort/timeRange stay whatever's set in
      // the Sort filter (Ranked by default, Balanced still available there).
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
    const prev = activeTabsRef.current;
    const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
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

  const loadMoreRemote = useCallback(async () => {
    // Confirmed live as a real crash: fast scrolling could fire this many
    // times in the window before loadingMore's *state* update actually
    // took effect (see loadingMoreRef's own comment), stacking up dozens of
    // concurrent fetches — each appending up to FEED_PAGE_SIZE posts and
    // triggering its own re-render/reflow, which moved the sentinel and
    // re-triggered the observer again before the flood had a chance to
    // subside. loadingMoreRef is checked and set synchronously, in the same
    // tick, so only the very first call in a burst ever gets past this line.
    if (loadingMoreRef.current || !remoteHasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const tabs = activeTabsRef.current;
      const activeFilters = { ...DEFAULT_FILTERS, ...filtersRef.current };
      activeFilters.sort = normalizeFeedSort(activeFilters.sort);
      const requestedSources = ['feed', 'following'].includes(viewModeRef.current)
        ? (activeFilters.sources?.length ? activeFilters.sources : tabs)
        : [];
      const q = searchRef.current.trim();
      const useCursor = isCursorEligible(viewModeRef.current, activeFilters.sort, q);
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
      if (requestedSources.length === 1) params.set('source', requestedSources[0]);
      else if (requestedSources.length > 1) params.set('sources', requestedSources.join(','));
      if (['local', 'restaurants'].includes(viewModeRef.current)) {
        if (locationFiltersRef.current.country) params.set('country', locationFiltersRef.current.country);
        if (locationFiltersRef.current.city) params.set('city', locationFiltersRef.current.city);
      }
      const { data } = await client.get(`/office/feed?${params.toString()}`);
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
      const incoming = viewModeRef.current === 'following'
        ? (data.posts || []).filter(p => p?.id)
        : (data.posts || []).filter(p => p?.id && !knownIds.current.has(p.id));
      incoming.forEach(p => markKnownId(p.id));
      if (incoming.length > 0) {
        setPosts(prev => sortPostsForView([...prev, ...incoming], activeFilters.sort));
      }
      if (useCursor) remoteCursorRef.current = data.cursor || remoteCursorRef.current;
      else setRemotePage(p => p + 1);
      setRemoteHasMore(data.hasMore !== false);
    } catch {}
    finally { loadingMoreRef.current = false; setLoadingMore(false); }
  }, [remoteHasMore, remotePage]);

  const updateFeedPost = useCallback((updatedPost) => {
    if (!updatedPost?.id) return;
    setPosts(prev => prev.map(post =>
      post.id === updatedPost.id ? { ...post, ...updatedPost } : post
    ));
  }, []);

  // Load initial feed — if cache is fresh, show it instantly and stream new posts on top silently
  useEffect(() => {
    if (!profile?.id) return;
    const c = readFeedCache(profile.id);
    setPosts(c?.posts || []);
    loadFeed(false, activeTabsRef.current, { silent: !!c?.fresh, live: !!c?.fresh });
  }, [loadFeed, profile?.id]);

  useEffect(() => {
    const refreshQuietly = () => {
      const state = loadStateRef.current;
      if (!['feed', 'local', 'restaurants'].includes(viewModeRef.current)) return;
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

  // Scroll-to-refresh: scrolling back up to the very top acts as pull-to-refresh
  useEffect(() => {
    let lastScrollY = window.scrollY;
    let lastPullAt = 0;
    const PULL_COOLDOWN_MS = 8000;
    const handleScroll = () => {
      const y = window.scrollY;
      const pulledToTop = y <= 0 && lastScrollY > 40;
      lastScrollY = y;
      if (!pulledToTop || !['feed', 'local', 'restaurants'].includes(viewModeRef.current)) return;
      const state = loadStateRef.current;
      if (state.loading || state.refreshing || state.loadingMore) return;
      if (Date.now() - lastPullAt < PULL_COOLDOWN_MS) return;
      lastPullAt = Date.now();
      // bust:false unless exactly one source is active — same reasoning as
      // the tab-click refreshes: this shouldn't be able to trigger the
      // all-30+-sources burst on every scroll-to-top, even with a cooldown.
      loadFeed(true, activeTabsRef.current, {
        preserveScroll: true,
        bust: activeTabsRef.current.length === 1,
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loadFeed]);

  // Fetch social connection status for personalisation banners
  useEffect(() => {
    if (!profile) { setConnectedSocial({}); return; }
    client.get('/profile/social').then(({ data }) => setConnectedSocial(data.connected || {})).catch(() => setConnectedSocial({}));
  }, [profile]);


  // SSE: stream new posts from all source workers in real time — with reconnection logic
  useEffect(() => {
    let es = null;
    let reconnectAttempt = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const BASE_RECONNECT_DELAY = 1000;
    let reconnectTimeoutId;

    function setupSSE() {
      try {
        const base = import.meta.env.VITE_API_URL || '/api';
        const token = localStorage.getItem('pc_token') || '';
        es = new EventSource(`${base}/feed/stream?token=${encodeURIComponent(token)}`);
        setLiveActive(false);

        es.onopen = () => {
          setLiveActive(true);
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
            // Native posts are exclusive to Following, so Home does not
            // reflow every time a member publishes one.
            const relevantIncoming = viewModeRef.current === 'feed'
              ? incoming.filter(post => post?.source !== 'uficonnect')
              : incoming;
            if (!relevantIncoming.length) return;
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
              if (viewModeRef.current !== 'feed') return;
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
          setLiveActive(false);
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
        setLiveActive(false);
      }
    }

    setupSSE();

    return () => {
      if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
      if (liveRefreshTimeoutRef.current) {
        clearTimeout(liveRefreshTimeoutRef.current);
        liveRefreshTimeoutRef.current = null;
      }
      if (es) {
        es.close();
        es = null;
      }
      setLiveActive(false);
    };
  }, [loadFeed, markKnownId]);

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

    return sortPostsForView(result, filters.sort);
  }, [posts, search, filters, activeTabs, profile?.roleSettings?.disabledSources]);

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
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMoreRemote(); },
      { rootMargin: '400px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMoreRemote, loading, processed.length]);

  // Close filter panel and source picker on outside click
  useEffect(() => {
    function handleClick(e) {
      if (
        filterOpen &&
        panelRef.current && !panelRef.current.contains(e.target) &&
        filterBtnRef.current && !filterBtnRef.current.contains(e.target)
      ) setFilterOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filterOpen]);

  // Compute active source list from actual posts
  const activeSources = useMemo(
    () => [...new Set(posts.map(p => p.source).filter(s => ALL_FILTER_SOURCES.includes(s)))],
    [posts]
  );

  const displayed = processed; // render all locally-held posts — no artificial cap
  const hasMore   = remoteHasMore;

  // Every photo- or video-bearing post currently on screen, in the same
  // order shown — what ImageLightbox's next/prev navigation browses across.
  // Photos and videos share one rail (see ImageLightbox) instead of videos
  // opening into a separate single-post modal with no scrolling. Keyed by
  // post id (not index) so a click stays pointed at the right item even if
  // `displayed` changes shape between the click and the next render.
  const mediaPosts = useMemo(
    () => displayed.filter(p => p?.mediaUrl && (p.mediaType === 'image' || p.mediaType === 'video')),
    [displayed]
  );
  const mediaLightboxIndex = mediaLightboxPostId
    ? mediaPosts.findIndex(p => p.id === mediaLightboxPostId)
    : -1;

  const firstName = profile?.name?.split(' ')[0] || '';
  const usesSourceControls = ['feed', 'following'].includes(viewMode);
  const activeFilterCount = (usesSourceControls ? filters.sources.length : 0) + (filters.sort !== 'newest' ? 1 : 0) + (filters.timeRange !== 'all' ? 1 : 0) + filters.topics.length;
  const selectedSourceLabel = activeTabs.map(k => SOURCE_META[k]?.label || k).join(', ');

  return (
    <Layout wide={!forcedMode}>
      <Helmet>
        <title>{forcedMode ? 'You | UFIconnect' : 'Home | UFIconnect'}</title>
        <meta name="description" content="Your live UFIconnect home: posts, videos, jobs, communities, and connected-account updates balanced into one useful scroll." />
        <meta name="keywords" content="professional news, tech news, career news, news feed, industry news, Reddit news, Hacker News, news updates, professional updates, tech updates, career updates, community news, LinkedIn news, Twitter news, Facebook news, networking news, connect news" />
        {!forcedMode && <link rel="canonical" href="https://uficonnect.org/feed" />}
      </Helmet>
      <div className={`home-feed-layout${forcedMode ? ' home-feed-layout--single' : ''}`}>
      {!forcedMode && (
        <aside className="home-feed-left-tabs" aria-label="Home feed controls">
          <div className="home-feed-view-tabs">
            {[
              { key: 'feed', label: 'Home' },
              { key: 'following', label: 'Following' },
              { key: 'local', label: 'Local' },
              { key: 'restaurants', label: 'Restaurants' },
            ].map(({ key, label }) => (
              <button key={key} type="button" className={`home-feed-rail-tab${viewMode === key ? ' active' : ''}`} onClick={() => switchViewMode(key)}>{label}</button>
            ))}
            <Link to="/command-center" className="home-feed-rail-tab">Command Center</Link>
          </div>
          <HomeFeedTools showSources={usesSourceControls} />
        </aside>
      )}
      <div className="home-feed-content">
      <div className="page-header">
        <h1 className="page-title">
          {forcedMode ? 'You' : (firstName ? `Welcome back, ${firstName}` : 'Home')}
          <span style={{
            marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: '.65rem', fontWeight: 700, padding: '3px 9px', borderRadius: 20,
            background: liveActive ? '#DCFCE7' : '#F1F5F9',
            color: liveActive ? '#15803D' : '#94A3B8',
            verticalAlign: 'middle',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: liveActive ? '#22C55E' : '#CBD5E1', display: 'inline-block', animation: liveActive ? 'pulse 2s ease-in-out infinite' : 'none' }} />
            {liveActive ? 'LIVE' : 'connecting...'}
          </span>
        </h1>
        <p className="page-subtitle">
          {viewMode === 'local'
            ? 'Fresh local coverage, ranked by live activity so the city has something new to say.'
            : viewMode === 'restaurants'
              ? 'Recently updated local restaurant listings, ready for the important work of deciding where to eat.'
              : 'Good to see you. Posts, videos, job listings, and the occasional tiny plot twist stay mixed into one live scroll.'}
        </p>
      </div>

      {/* Toolbar: search + filter + refresh */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', position: 'relative', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', gap: 6 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: '.75rem', fontWeight: 800, opacity: 0.55, pointerEvents: 'none' }}>Q</span>
            <input
              className="form-input"
              placeholder="Search posts…"
              value={searchInput}
              onChange={e => {
                setSearchInput(e.target.value);
                debouncedSearch(e.target.value);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const nextQ = searchInput.trim();
                  searchRef.current = nextQ;
                  setSearch(nextQ);
                  setRemotePage(2);
                  setRemoteHasMore(true);
                  loadFeed(false, activeTabsRef.current, { q: nextQ, replace: true });
                }
              }}
              style={{ paddingLeft: 36, borderRadius: 22, padding: '9px 14px 9px 36px', fontSize: '.875rem' }}
            />
            {searchInput && (
              <button type="button" aria-label="Clear search" onClick={() => {
                searchRef.current = '';
                setSearchInput('');
                setSearch('');
                loadFeed(false, activeTabsRef.current, { q: '', replace: true });
              }}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>×</button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              const nextQ = searchInput.trim();
              searchRef.current = nextQ;
              setSearch(nextQ);
              loadFeed(false, activeTabsRef.current, { q: nextQ, replace: true });
            }}
            style={{
              padding: '9px 16px', borderRadius: 22, border: '1.5px solid var(--border)',
              background: searchInput.trim() ? 'var(--primary)' : 'var(--surface)',
              color: searchInput.trim() ? '#fff' : 'var(--muted)',
              fontWeight: 600, fontSize: '.875rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'background .15s, color .15s',
            }}
          >
            Search
          </button>
        </div>

        {/* Filter button */}
        <div style={{ position: 'relative' }}>
          <button
            ref={filterBtnRef}
            aria-label="Open filter panel"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 14px', borderRadius: 22, border: `1.5px solid ${filterOpen || activeFilterCount > 0 ? 'var(--primary)' : 'var(--border)'}`,
              background: activeFilterCount > 0 ? 'var(--primary)' : 'var(--surface)',
              color: activeFilterCount > 0 ? '#fff' : 'var(--text)',
              cursor: 'pointer', fontWeight: 600, fontSize: '.875rem', whiteSpace: 'nowrap',
            }}
          >
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} {filterOpen ? 'Hide' : 'Show'}
          </button>

          {filterOpen && (
            <FilterPanel
              filters={filters}
              onChange={applyFilters}
              sources={viewMode === 'following' ? FOLLOWING_FILTER_SOURCES : viewMode === 'feed' ? ALL_FILTER_SOURCES : []}
              onClose={() => setFilterOpen(false)}
              panelRef={panelRef}
            />
          )}
        </div>

      </div>

      {['local', 'restaurants'].includes(viewMode) && (
        <form onSubmit={applyLocationFilters} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--muted)' }}>Location</span>
          <input
            className="form-input"
            aria-label="Country filter"
            placeholder="Country"
            value={locationFilters.country}
            maxLength={80}
            onChange={(event) => {
              const next = { ...locationFiltersRef.current, country: event.target.value };
              locationFiltersRef.current = next;
              setLocationFilters(next);
            }}
            style={{ width: 150, minWidth: 120, padding: '7px 11px', fontSize: '.8rem', borderRadius: 18 }}
          />
          <input
            className="form-input"
            aria-label="City filter"
            placeholder="City"
            value={locationFilters.city}
            maxLength={80}
            onChange={(event) => {
              const next = { ...locationFiltersRef.current, city: event.target.value };
              locationFiltersRef.current = next;
              setLocationFilters(next);
            }}
            style={{ width: 150, minWidth: 120, padding: '7px 11px', fontSize: '.8rem', borderRadius: 18 }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={locationSaving}>
            {locationSaving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Apply'}
          </button>
          {(locationFilters.country || locationFilters.city) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
              const next = { country: '', city: '' };
              locationFiltersRef.current = next;
              setLocationFilters(next);
            }}>
              Clear
            </button>
          )}
          {locationMessage && <span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{locationMessage}</span>}
        </form>
      )}

      {/* Source tabs — Feed and Following each filter over their own
          vocabulary (SOURCE_TABS vs FOLLOWING_SOURCE_TABS), since neither
          list of sources can appear in the other view. */}
      {usesSourceControls && (<div style={{
        display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14,
        paddingBottom: 4, scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none',
      }}>
        {(viewMode === 'following' ? FOLLOWING_SOURCE_TABS : SOURCE_TABS).map(tab => {
          const meta  = SOURCE_META[tab.key];
          const color = meta?.color || 'var(--primary)';
          const active = tab.key === 'all' ? activeTabs.length === 0 : activeTabs.includes(tab.key);
          const activeColor = tab.key === 'all' ? 'var(--primary)' : color;
          return (
            <button
              key={tab.key}
              onClick={() => toggleTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                padding: '6px 13px', borderRadius: 20, whiteSpace: 'nowrap',
                border: `1.5px solid ${active ? activeColor : 'var(--border)'}`,
                background: active ? activeColor : 'var(--surface)',
                color: active ? '#fff' : 'var(--text)',
                fontWeight: active ? 700 : 500, fontSize: '.8rem', cursor: 'pointer',
              }}
            >
              {tab.key !== 'all' && <SourceMark source={tab.key} label={tab.icon} size={13} active={active} />}
              {tab.label}
            </button>
          );
        })}
      </div>)}

      {((usesSourceControls && activeTabs.length > 0) || activeFilterCount > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 12, fontSize: '.78rem' }}>
          <span style={{ color: 'var(--muted)', fontWeight: 500, marginRight: 2 }}>Showing:</span>

          {usesSourceControls && (activeTabs.length > 0 ? activeTabs.map(key => {
            const meta = SOURCE_META[key] || {};
            const color = meta.color || 'var(--primary)';
            return (
              <span key={key} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 9px', borderRadius: 12,
                background: `${color}18`, color, fontWeight: 600,
                border: `1px solid ${color}44`,
              }}>
                <SourceMark source={key} label={meta.icon} size={12} />
                {meta.label || key}
                <button onClick={() => toggleTab(key)} style={{
                  marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer',
                  color, fontWeight: 700, fontSize: '.75rem', padding: 0, lineHeight: 1,
                }}>×</button>
              </span>
            );
          }) : (
            <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>All sources</span>
          ))}

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

          {filters.sort !== 'newest' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 9px', borderRadius: 12,
              background: 'var(--card)', color: 'var(--text)', fontWeight: 600,
              border: '1px solid var(--border)',
            }}>
              Sort: {filters.sort}
              <button onClick={() => applyFilters({ ...filtersRef.current, sort: 'newest' })} style={{
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

          {usesSourceControls && filters.sources.length > 0 && filters.sources.map(key => {
            const meta = SOURCE_META[key] || {};
            return (
              <span key={key} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 9px', borderRadius: 12,
                background: 'var(--card)', color: 'var(--text)', fontWeight: 600,
                border: '1px solid var(--border)',
              }}>
                {meta.label || key}
                <button onClick={() => applyFilters({ ...filtersRef.current, sources: filtersRef.current.sources.filter(s => s !== key) })} style={{
                  marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted)', fontWeight: 700, fontSize: '.75rem', padding: 0, lineHeight: 1,
                }}>×</button>
              </span>
            );
          })}

          <button
            onClick={clearFeedControls}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '.75rem', fontWeight: 600, padding: '2px 4px', textDecoration: 'underline' }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Social connect prompt — logged-in users with no social accounts connected */}
      {profile && connectedSocial !== null && !socialBannerDismissed && !Object.values(connectedSocial).some(Boolean) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
          padding: '12px 16px', borderRadius: 12,
          background: 'linear-gradient(135deg, #FFF7ED 0%, #FEF3C7 100%)',
          border: '1.5px solid #FED7AA',
          fontSize: '.85rem', fontWeight: 500, color: '#92400E',
          boxShadow: '0 2px 8px rgba(234, 88, 12, 0.1)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Personalize your feed</div>
            <div style={{ fontSize: '.78rem', opacity: 0.9 }}>Connect accounts to add more of your world to the feed.</div>
          </div>
          <Link to="/connected-accounts" style={{
            background: '#EA580C', color: '#fff', fontWeight: 700, fontSize: '.8rem',
            padding: '7px 14px', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            display: 'inline-block',
            transition: 'background 0.2s'
          }}>
            Connect now
          </Link>
          <button
            onClick={() => setSocialBannerDismissed(true)}
            style={{
              marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#92400E',
              fontSize: '1.1rem', opacity: 0.6, padding: '0 4px', flexShrink: 0,
              transition: 'opacity 0.2s'
            }}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      {/* Last refresh time */}
      {lastRefresh && (
        <div style={{
          fontSize: '.78rem', color: 'var(--muted)', marginBottom: 16,
          padding: '8px 12px', borderRadius: 8, background: 'var(--card)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          border: '1px solid var(--border)'
        }}>
          <div>
            {activeTabs.length > 0 && (
              <span style={{ fontWeight: 600, color: SOURCE_META[activeTabs[0]]?.color || 'var(--primary)', marginRight: 8 }}>
                {activeTabs.map(k => SOURCE_META[k]?.label || k).join(', ')}
              </span>
            )}
            <span style={{ fontWeight: 500 }}>Updated {timeAgo(lastRefresh.toISOString())}</span>
            {posts.length > 0 && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {posts.length.toLocaleString()} post{posts.length !== 1 ? 's' : ''}</span>}
            {search && <span style={{ marginLeft: 8, opacity: 0.7 }}>· searching "{search}"</span>}
            {refreshing && <span style={{ marginLeft: 8, opacity: 0.7 }}>· refreshing…</span>}
          </div>
        </div>
      )}

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
            marginBottom: 16,
            color: 'var(--primary)',
            fontSize: '.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span className="spinner spinner-primary" style={{ width: 14, height: 14 }} />
            {viewMode === 'local'
              ? 'Loading local activity...'
              : viewMode === 'restaurants'
                ? 'Loading nearby restaurants...'
                : activeTabs.length > 0 ? `Loading ${selectedSourceLabel} posts...` : 'Loading Home... warming up the scroll.'}
          </div>
          <PostCardSkeleton />
          <PostCardSkeleton />
          <PostCardSkeleton />
        </div>
      ) : feedError && displayed.length === 0 ? (
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
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            {activeTabs.length === 1
              ? <SourceMark source={activeTabs[0]} label={SOURCE_META[activeTabs[0]]?.icon} size={24} />
              : (search ? 'Search' : viewMode === 'following' ? 'Following' : viewMode === 'local' ? 'Local' : viewMode === 'restaurants' ? 'Restaurants' : 'Home')}
          </div>
          <div className="empty-title">
            {search ? `No posts match "${search}"` : viewMode === 'following' ? 'No posts from people you follow yet' : viewMode === 'local' ? 'No local activity yet' : viewMode === 'restaurants' ? 'No nearby restaurants yet' : activeTabs.length > 0 ? `No ${selectedSourceLabel} posts yet` : 'Home is empty'}
          </div>
          <div className="empty-desc">
            {search ? (
              <>
                <p style={{ marginBottom: 8 }}>Try a different search term or clear your filters.</p>
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  searchRef.current = '';
                  setSearch('');
                  setSearchInput('');
                  setRemotePage(2);
                  setRemoteHasMore(true);
                  loadFeed(false, activeTabsRef.current, { q: '', replace: true });
                }}>Clear search</button>
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
            ) : (viewMode === 'local' || viewMode === 'restaurants') ? (
              <>
                <p style={{ marginBottom: 12 }}>
                  {locationMessage || (viewMode === 'restaurants'
                    ? 'Add your city above to see recently updated nearby restaurant listings.'
                    : 'Add a country or city above to tune this live local stream.')}
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
                  <Link to="/groups" className="btn btn-ghost btn-sm">Join communities</Link>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <FeedErrorBoundary>
          <div>
            {displayed.map((post, idx) => (
              <PostCard
                key={`${post.id || `temp-${post.createdAt}`}-${idx}`}
                post={post}
                onMediaOpen={p => setMediaLightboxPostId(p.id)}
                onPostUpdated={updateFeedPost}
                isMediaOpen={post.id != null && post.id === mediaLightboxPostId}
              />
            ))}
          </div>
          </FeedErrorBoundary>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {loadingMore && (
            <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
          {!hasMore && displayed.length > 0 && (
            <div style={{
              textAlign: 'center', color: 'var(--muted)', fontSize: '.8rem', marginBottom: 24,
              padding: '12px 16px', borderRadius: 8, background: 'var(--card)',
              border: '1px dashed var(--border)'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>You are caught up</div>
              Showing {displayed.length.toLocaleString()} post{displayed.length !== 1 ? 's' : ''}. Pull to refresh for new content.
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
      </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </Layout>
  );
}
