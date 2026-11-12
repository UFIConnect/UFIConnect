import { homeFeedViewKey, normalizeHomeFeedSelection } from '../../../shared/home-feed-settings.mjs';
import useTabMetrics from '../analytics/useTabMetrics';
import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Search as SearchIcon, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import {
  SOURCE_META,
  HOME_FEED_SOURCE_IDS,
  FOLLOWING_FEED_SOURCE_IDS,
} from '../components/sourceMeta';
import client from '../api/client';
import { ALL_INTERESTS } from './Onboarding';
import { PostCard } from './Feed';
import Opportunities from './Opportunities';
import { CreateGroupModal, GroupDirectoryTab } from './Groups';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import usePagedResults from '../hooks/usePagedResults';
import ResultsPagination from '../components/ResultsPagination';

const SEARCH_TABS = [
  { key: 'posts', label: 'Posts' },
  { key: 'following', label: 'Following Posts' },
  { key: 'people', label: 'People' },
  { key: 'groups', label: 'Groups' },
  { key: 'jobs', label: 'Jobs' },
];
const POST_TABS = new Set(['posts', 'following']);
const POST_PAGE_SIZE = 30;
const DIRECTORY_PAGE_SIZE = 24;

function initials(name = '') {
  return name.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase();
}

function initialSearchTab(search) {
  const requested = new URLSearchParams(search).get('tab');
  if (requested === 'communities') return 'groups';
  return SEARCH_TABS.some((tab) => tab.key === requested) ? requested : 'posts';
}

function previousFeedSignals(profile, mode) {
  const saved = profile?.roleSettings?.[homeFeedViewKey(mode)];
  const selection = normalizeHomeFeedSelection(mode, saved);
  return {
    sources: selection.sources.length ? selection.sources : selection.activeTabs,
    topics: selection.topics.filter(topic => ALL_INTERESTS.includes(topic)),
    found: Boolean(saved),
  };
}

function searchPostTimestamp(post) {
  const value = post?.createdAt || post?.time || post?.posted;
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergePosts(current, incoming) {
  const merged = [];
  const seen = new Set();
  for (const post of [...current, ...incoming]) {
    const key = post?.id || `${post?.source || ''}:${post?.sourceUrl || post?.title || ''}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(post);
  }
  return merged.sort((a, b) => {
    return searchPostTimestamp(b) - searchPostTimestamp(a)
      || String(b?.id || '').localeCompare(String(a?.id || ''));
  });
}

function initialSearchQuery(search) {
  return String(new URLSearchParams(search).get('q') || '').trim().slice(0, 200);
}

function mergeById(current, incoming) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => item?.id && !seen.has(item.id))];
}

const ROLE_META = {
  'Engineer / Developer':   { icon: 'ED', color: '#2563EB', bg: '#EFF6FF' },
  'Designer / Creative':    { icon: 'DC', color: '#7C3AED', bg: '#F3EEFF' },
  'Product Manager':        { icon: 'PM', color: '#0284C7', bg: '#F0F9FF' },
  'Marketer / Growth':      { icon: 'MG', color: '#059669', bg: '#ECFDF5' },
  'Founder / Entrepreneur': { icon: 'FE', color: '#D97706', bg: '#FFFBEB' },
  'Investor / VC':          { icon: 'VC', color: '#DB2777', bg: '#FDF2F8' },
  'Data / Analytics':       { icon: 'DA', color: '#EA580C', bg: '#FFF7ED' },
  'Student / Learner':      { icon: 'SL', color: '#7C3AED', bg: '#F3EEFF' },
  'Sales / Business Dev':   { icon: 'BD', color: '#2563EB', bg: '#EFF6FF' },
  'Operations / Finance':   { icon: 'OF', color: '#059669', bg: '#ECFDF5' },
  'Content Creator':        { icon: 'CC', color: '#D97706', bg: '#FFFBEB' },
  'Community Manager':      { icon: 'CM', color: '#0284C7', bg: '#F0F9FF' },
  'Researcher / Academic':  { icon: 'RA', color: '#7C3AED', bg: '#F3EEFF' },
  'HR / People Ops':        { icon: 'HR', color: '#DB2777', bg: '#FDF2F8' },
};

const ROLE_FILTERS = [
  'All', 'Engineer / Developer', 'Designer / Creative', 'Product Manager',
  'Founder / Entrepreneur', 'Marketer / Growth', 'Data / Analytics',
  'Content Creator', 'Student / Learner', 'Investor / VC',
  'Operations / Finance', 'Community Manager', 'Researcher / Academic',
];

function SourceChip({ source, active, onClick }) {
  const meta = SOURCE_META[source] || { label: source, color: 'var(--primary)', icon: 'SRC' };
  return (
    <button
      type="button"
      className={`search-filter-chip${active ? ' active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      style={active ? { '--chip-color': meta.color } : undefined}
    >
      {hasBrandIcon(source) ? (
        <span className="search-source-mark"><BrandIcon platform={source} size={14} /></span>
      ) : (
        <span className="search-source-mark search-source-mark--text">{meta.icon}</span>
      )}
      {meta.label}
    </button>
  );
}

function PostFilters({ sources, selectedSources, selectedTopics, onSourcesChange, onTopicsChange }) {
  function toggleSource(source) {
    onSourcesChange(selectedSources.includes(source)
      ? selectedSources.filter((item) => item !== source)
      : [...selectedSources, source]);
  }

  function toggleTopic(topic) {
    onTopicsChange(selectedTopics.includes(topic)
      ? selectedTopics.filter((item) => item !== topic)
      : [...selectedTopics, topic]);
  }

  return (
    <div className="search-post-filters">
      <div className="search-filter-line">
        <span className="search-filter-label">Sources</span>
        <div className="search-filter-rail" role="group" aria-label="Filter posts by source">
          <button
            type="button"
            className={`search-filter-chip${selectedSources.length === 0 ? ' active' : ''}`}
            aria-pressed={selectedSources.length === 0}
            onClick={() => onSourcesChange([])}
          >All sources</button>
          {sources.map((source) => (
            <SourceChip
              key={source}
              source={source}
              active={selectedSources.includes(source)}
              onClick={() => toggleSource(source)}
            />
          ))}
        </div>
      </div>

      <div className="search-filter-line">
        <span className="search-filter-label">Topics</span>
        <div className="search-filter-rail" role="group" aria-label="Filter posts by topic">
          <button
            type="button"
            className={`search-filter-chip${selectedTopics.length === 0 ? ' active' : ''}`}
            aria-pressed={selectedTopics.length === 0}
            onClick={() => onTopicsChange([])}
          >All topics</button>
          {ALL_INTERESTS.map((topic) => (
            <button
              type="button"
              key={topic}
              className={`search-filter-chip${selectedTopics.includes(topic) ? ' active' : ''}`}
              aria-pressed={selectedTopics.includes(topic)}
              onClick={() => toggleTopic(topic)}
            >{topic}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SearchExperience({ initialTab = null, initialQuery = null, embedded = false, onQueryChange } = {}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [routeSeed] = useState(() => ({
    tab: SEARCH_TABS.some((tab) => tab.key === initialTab) ? initialTab : initialSearchTab(location.search),
    query: initialQuery === null ? initialSearchQuery(location.search) : String(initialQuery).slice(0, 200),
  }));
  const [activeTab, setActiveTab] = useState(routeSeed.tab);
  useTabMetrics('search', activeTab);
  const [queries, setQueries] = useState(() => ({
    posts: '', following: '', people: '', groups: '', jobs: '',
    [routeSeed.tab]: routeSeed.query,
  }));
  const [roleFilter, setRoleFilter] = useState('All');
  const [sortBy, setSortBy] = useState('interests');
  const [groupCategories, setGroupCategories] = useState([]);
  const [groupCategory, setGroupCategory] = useState('all');
  const [showCreateGroup, setShowCreateGroup] = useState(() => (
    !embedded && new URLSearchParams(location.search).get('create') === '1'
  ));
  const [postSources, setPostSources] = useState({ posts: [], following: [] });
  const [postTopics, setPostTopics] = useState({ posts: [], following: [] });
  const [historyFound, setHistoryFound] = useState({ posts: false, following: false });
  const [suggestionsReady, setSuggestionsReady] = useState(false);
  const resultsStartRef = useRef(null);
  const hydratedProfileRef = useRef(null);
  const query = queries[activeTab] || '';

  useEffect(() => { onQueryChange?.(query); }, [query, onQueryChange]);

  useEffect(() => {
    if (embedded) return;
    const params = new URLSearchParams(location.search);
    const requestedTab = params.get('tab');
    const nextTab = requestedTab === 'communities' ? 'groups' : requestedTab;
    if (SEARCH_TABS.some((tab) => tab.key === nextTab)) setActiveTab(nextTab);
    if (params.has('q')) {
      const nextQuery = String(params.get('q') || '').trim().slice(0, 200);
      const targetTab = SEARCH_TABS.some((tab) => tab.key === nextTab) ? nextTab : activeTab;
      setQueries(current => ({ ...current, [targetTab]: nextQuery }));
    }
  }, [activeTab, embedded, location.search]);

  useEffect(() => {
    if (embedded) return;
    const params = new URLSearchParams(location.search);
    setShowCreateGroup(activeTab === 'groups' && params.get('create') === '1');
  }, [activeTab, embedded, location.search]);

  const disabledSources = useMemo(() => new Set(
    Array.isArray(profile?.roleSettings?.disabledSources)
      ? profile.roleSettings.disabledSources.map((source) => String(source).trim().toLowerCase())
      : []
  ), [profile?.roleSettings?.disabledSources]);
  const availableSources = useMemo(() => ({
    posts: HOME_FEED_SOURCE_IDS.filter((source) => !disabledSources.has(source)),
    following: FOLLOWING_FEED_SOURCE_IDS.filter((source) => !disabledSources.has(source)),
  }), [disabledSources]);

  useEffect(() => {
    if (!profile?.id || hydratedProfileRef.current === profile.id) return;
    hydratedProfileRef.current = profile.id;
    const posts = previousFeedSignals(profile, 'feed');
    const following = previousFeedSignals(profile, 'following');
    const explicitPosts = routeSeed.tab === 'posts' && routeSeed.query;
    const explicitFollowing = routeSeed.tab === 'following' && routeSeed.query;
    setPostSources({
      posts: explicitPosts ? [] : posts.sources.filter((source) => HOME_FEED_SOURCE_IDS.includes(source) && !disabledSources.has(source)),
      following: explicitFollowing ? [] : following.sources.filter((source) => FOLLOWING_FEED_SOURCE_IDS.includes(source) && !disabledSources.has(source)),
    });
    setPostTopics({ posts: explicitPosts ? [] : posts.topics, following: explicitFollowing ? [] : following.topics });
    setHistoryFound({ posts: !explicitPosts && posts.found, following: !explicitFollowing && following.found });
    setSuggestionsReady(true);
  }, [disabledSources, profile?.id]);

  const peoplePage = usePagedResults({
    enabled: activeTab === 'people', queryKey: JSON.stringify([profile?.id, queries.people, roleFilter, sortBy]), delay: 280,
    errorMessage: 'People could not be loaded right now. Please try again.',
    loadPage: async ({ page, signal }) => {
      const params = new URLSearchParams({ limit: String(DIRECTORY_PAGE_SIZE), offset: String((page - 1) * DIRECTORY_PAGE_SIZE), sort: ['followers', 'interests'].includes(sortBy) ? sortBy : 'relevance' });
      if (queries.people.trim()) params.set('q', queries.people.trim());
      if (roleFilter !== 'All') params.set('role', roleFilter);
      const { data } = await client.get('/users/search?' + params, { signal });
      return { items: data.users, hasNext: data.hasMore, total: data.totalCount, data };
    },
  });
  const groupsPage = usePagedResults({
    enabled: activeTab === 'groups', queryKey: JSON.stringify([profile?.id, queries.groups, groupCategory]), delay: queries.groups.trim() ? 280 : 0,
    errorMessage: 'Groups could not be loaded right now. Please try again.',
    loadPage: async ({ page, signal }) => {
      const params = new URLSearchParams({ limit: String(DIRECTORY_PAGE_SIZE), offset: String((page - 1) * DIRECTORY_PAGE_SIZE), scope: 'public' });
      if (queries.groups.trim()) params.set('q', queries.groups.trim());
      if (groupCategory !== 'all') params.set('category', groupCategory);
      const { data } = await client.get('/groups?' + params, { signal });
      return { items: data.groups, hasNext: data.hasMore, total: data.totalCount, data };
    },
  });
  const postPageOptions = tab => ({
    enabled: suggestionsReady && activeTab === tab,
    queryKey: JSON.stringify([profile?.id, queries[tab], postSources[tab], postTopics[tab]]), delay: queries[tab].trim() ? 300 : 0,
    errorMessage: 'Posts could not be loaded right now. Please try again.',
    loadPage: async ({ page, cursor, signal }) => {
      const params = new URLSearchParams({ mode: tab === 'following' ? 'following' : 'feed', limit: String(POST_PAGE_SIZE), page: String(page), sort: 'newest', passive: '1' });
      if (cursor) params.set('cursor', cursor);
      if (queries[tab].trim()) params.set('q', queries[tab].trim());
      if (postTopics[tab].length) params.set('topics', postTopics[tab].join(','));
      if (postSources[tab].length === 1) params.set('source', postSources[tab][0]);
      else if (postSources[tab].length > 1) params.set('sources', postSources[tab].join(','));
      const { data } = await client.get('/feed?' + params, { signal });
      const items = mergePosts([], Array.isArray(data.posts) ? data.posts : []);
      const nextCursor = typeof data.cursor === 'string' ? data.cursor : '';
      return { items, hasNext: data.hasMore === true && (items.length > 0 || Boolean(nextCursor && nextCursor !== cursor)), nextCursor, total: data.totalAvailable };
    },
  });
  const postsPage = usePagedResults(postPageOptions('posts'));
  const followingPage = usePagedResults(postPageOptions('following'));
  const postStates = { posts: { ...postsPage, loading: postsPage.loading && !postsPage.items.length }, following: { ...followingPage, loading: followingPage.loading && !followingPage.items.length } };
  const results = peoplePage.items, loading = peoplePage.loading && !results.length, peopleTotal = peoplePage.total, peopleError = peoplePage.error;
  const registeredCount = peoplePage.data?.registeredCount ?? null, countSource = peoplePage.data?.countSource ?? null;
  const allGroups = groupsPage.items, groupsLoading = groupsPage.loading && !allGroups.length, groupsTotal = groupsPage.total, groupsError = groupsPage.error;
  useEffect(() => {
    if (activeTab !== 'groups' || groupCategories.length) return;
    const controller = new AbortController();
    client.get('/groups/categories', { signal: controller.signal }).then(({ data }) => setGroupCategories(data.categories || [])).catch(() => {});
    return () => controller.abort();
  }, [activeTab, groupCategories.length]);

  const closeCreateGroup = useCallback(() => {
    if (embedded) { setShowCreateGroup(false); return; }
    const params = new URLSearchParams(location.search);
    // Let the URL-driven effect close a linked dialog after navigation commits.
    // Otherwise a quick menu tap can be undone by the pending route change.
    if (params.get('create') !== '1') {
      setShowCreateGroup(false);
      return;
    }
    params.delete('create');
    const nextSearch = params.toString();
    navigate({ pathname: '/search', search: nextSearch ? `?${nextSearch}` : '?tab=groups' }, { replace: true });
  }, [embedded, location.search, navigate]);

  const createGroup = useCallback(async (group) => {
    const { data } = await client.post('/groups', group);
    if (!data?.group) throw new Error('Group creation did not return a group.');
    groupsPage.updateItems((current) => mergeById([data.group], current));
    setShowCreateGroup(false);
    navigate(`/groups/${data.group.id}`);
  }, [navigate]);

  function selectTab(tab) {
    setActiveTab(tab);
    if (embedded) setQueries(current => ({ ...current, [tab]: current[tab] || query }));
    else navigate({ pathname: '/search', search: `?${new URLSearchParams({ tab, q: queries[tab] || '' })}` }, { replace: true });
  }

  function handleQueryChange(event) {
    setSearchQuery(event.target.value);
  }

  function setSearchQuery(value) {
    if (value.trim() && POST_TABS.has(activeTab) && historyFound[activeTab]) {
      setPostSources(current => ({ ...current, [activeTab]: [] }));
      setPostTopics(current => ({ ...current, [activeTab]: [] }));
      setHistoryFound(current => ({ ...current, [activeTab]: false }));
    }
    setQueries((current) => ({ ...current, [activeTab]: value }));
  }

  function submitHeaderSearch(value) {
    const nextQuery = String(value || '').trim().slice(0, 200);
    setSearchQuery(nextQuery);
    const params = new URLSearchParams(location.search);
    params.set('tab', activeTab);
    params.set('q', nextQuery);
    navigate({ pathname: '/search', search: `?${params}`, hash: location.hash }, { replace: true });
  }

  function clearSearch() {
    setQueries((current) => ({ ...current, [activeTab]: '' }));
  }

  async function toggleFollow(user, event) {
    event.stopPropagation();
    const nowFollowing = !user.isFollowing;
    try {
      const { data } = nowFollowing
        ? await client.post(`/users/${user.id}/follow`)
        : await client.delete(`/users/${user.id}/follow`);
      peoplePage.updateItems((current) => current.map((item) => item.id === user.id
        ? { ...item, isFollowing: nowFollowing, followersCount: data.followersCount ?? item.followersCount }
        : item));
    } catch {}
  }

  const sortedResults = useMemo(() => [...results].sort((a, b) => (
    sortBy === 'followers' ? (b.followersCount || 0) - (a.followersCount || 0) : 0
  )), [results, sortBy]);
  const filteredGroups = allGroups;
  const activePostState = POST_TABS.has(activeTab) ? postStates[activeTab] : null;
  const activePage = activeTab === 'people' ? peoplePage : activeTab === 'groups' ? groupsPage : activeTab === 'following' ? followingPage : postsPage;
  const hasQuery = query.trim().length > 0;
  const refreshActiveSearch = useCallback(() => activePage.refresh(), [activePage.refresh]);
  const scrollRefresh = useScrollToRefresh(refreshActiveSearch, { enabled: !embedded && activeTab !== 'jobs' && activePage.page === 1 && !activePage.loading });
  async function changeResultsPage(page) {
    if (await activePage.goToPage(page)) requestAnimationFrame(() => resultsStartRef.current?.scrollIntoView({ block: 'start' }));
  }

  function updatePost(tab, updatedPost) {
    (tab === 'following' ? followingPage : postsPage).updateItems(current => current.map(post => post.id === updatedPost.id ? { ...post, ...updatedPost } : post));
  }

  const SearchWrapper = embedded ? Fragment : Layout;
  const hasHeaderSearch = !embedded && profile?.plan !== 'business';
  return (
    <SearchWrapper {...(hasHeaderSearch ? { feedSearch: {
      query, label: `Search ${activeTab === 'following' ? 'following posts' : activeTab}`, onSubmit: submitHeaderSearch,
    } } : {})}>
      {!embedded && <Helmet>
        <title>Search Posts, People, Groups & Jobs | UFIconnect</title>
        <meta name="description" content="Search personalized posts, professionals, groups, and live job listings." />
        <link rel="canonical" href="https://uficonnect.org/search" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://uficonnect.org/search" />
        <meta property="og:title" content="Search Posts, People, Groups & Jobs | UFIconnect" />
        <meta property="og:description" content="Search personalized posts, professionals, groups, and live job listings." />
        <meta property="og:image" content="https://uficonnect.org/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>}

      {showCreateGroup && (
        <CreateGroupModal
          categories={groupCategories.length ? groupCategories : ['Community']}
          onClose={closeCreateGroup}
          onCreate={createGroup}
        />
      )}

      <div className={`search-page-shell${embedded ? '' : ' search-page-shell--full'}`}>
        {!embedded && <div className="page-header"><h1 className="page-title">{activeTab === 'people' ? 'People' : 'Search'}</h1></div>}

        <div ref={resultsStartRef} className="search-tab-strip" role="tablist" aria-label="Search sections">
          {SEARCH_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`search-tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => selectTab(tab.key)}
            >{tab.label}</button>
          ))}
        </div>

        {!hasHeaderSearch && <div className="search-query-wrap">
          <SearchIcon className="search-query-icon" size={19} aria-hidden="true" />
          <input
            className="form-input search-query-input"
            type="search"
            aria-label={`Search ${activeTab === 'following' ? 'following posts' : activeTab}`}
            placeholder={activeTab === 'posts'
              ? 'Search posts...'
              : activeTab === 'following'
                ? 'Search following posts...'
                : activeTab === 'people'
                  ? 'Search by name, role, skill, or interest...'
                  : activeTab === 'groups'
                    ? 'Search public groups by name, source, or topic...'
                    : 'Search jobs by title, company, skill, or location...'}
            value={query}
            onChange={handleQueryChange}
            autoFocus
          />
          {activePage.loading && <span className="search-query-spinner"><span className="spinner" /></span>}
          {query && !activePage.loading && (
            <button type="button" className="search-query-clear" aria-label="Clear search" onClick={clearSearch}><X size={17} /></button>
          )}
        </div>}

        {POST_TABS.has(activeTab) && (
          <>
            <PostFilters
              sources={availableSources[activeTab]}
              selectedSources={postSources[activeTab]}
              selectedTopics={postTopics[activeTab]}
              onSourcesChange={(sources) => {
                setPostSources((current) => ({ ...current, [activeTab]: sources }));
                setHistoryFound(current => ({ ...current, [activeTab]: false }));
              }}
              onTopicsChange={(topics) => {
                setPostTopics((current) => ({ ...current, [activeTab]: topics }));
                setHistoryFound(current => ({ ...current, [activeTab]: false }));
              }}
            />

            {!activePostState.loading && !activePostState.error && activePostState.items.length > 0 && (
              <div className="search-result-summary">
                {hasQuery
                  ? `${activePostState.items.length} matching post${activePostState.items.length === 1 ? '' : 's'}`
                  : historyFound[activeTab] ? 'Suggestions based on your previous feed session' : 'Suggested for you'}
              </div>
            )}

            {activePostState.loading && (
              <div className="search-loading-list">
                <div className="card search-result-skeleton" />
                <div className="card search-result-skeleton" />
              </div>
            )}

            {!activePostState.loading && activePostState.error && (
              <div className="card search-empty-state">
                <strong>Search is taking a breather</strong>
                <p>{activePostState.error}</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={activePage.retry}
                >Try again</button>
              </div>
            )}

            {!activePostState.loading && !activePostState.error && activePostState.items.length === 0 && (
              <div className="card search-empty-state">
                <strong>{hasQuery ? 'No matching posts' : activeTab === 'following' ? 'No following posts yet' : 'No suggestions yet'}</strong>
                <p>{hasQuery ? 'Try a broader phrase or clear one of the filters.' : 'Adjust the source or topic filters to widen this feed.'}</p>
              </div>
            )}

            <div className="search-post-results">
              {activePostState.items.map((post) => (
                <PostCard
                  key={post.id || `${post.source}:${post.sourceUrl}`}
                  post={post}
                  isMediaOpen={false}
                  onMediaOpen={(item) => {
                    const url = item?.sourceUrl || item?.mediaUrl;
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                  onPostUpdated={(updatedPost) => updatePost(activeTab, updatedPost)}
                />
              ))}
            </div>

          </>
        )}

        {activeTab === 'people' && (
          <>
            <section className="card" aria-label="Discover people with shared interests" style={{ marginBottom: 16 }}>
              <p style={{ margin: '0 0 12px', color: 'var(--muted)' }}>Meet people who share your interests, then find a group or start one together.</p>
              {!profile?.preferences?.interests?.length && <p>Add interests to your profile to get more relevant suggestions.</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Link to="/search?tab=groups" className="btn btn-ghost btn-sm">Find groups</Link>
                <Link to="/search?tab=groups&create=1" className="btn btn-ghost btn-sm">Create a group</Link>
                <Link to="/profile?tab=about" className="btn btn-ghost btn-sm">Your interests</Link>
              </div>
            </section>

            <div className="search-people-controls">
              <div className="search-filter-rail search-people-filter" role="group" aria-label="Filter people by role">
                {ROLE_FILTERS.map((role) => {
                  const meta = ROLE_META[role];
                  return (
                    <button
                      key={role}
                      type="button"
                      className={`search-filter-chip${roleFilter === role ? ' active' : ''}`}
                      aria-pressed={roleFilter === role}
                      onClick={() => setRoleFilter(role)}
                      style={roleFilter === role && meta ? { '--chip-color': meta.color } : undefined}
                    >{role}</button>
                  );
                })}
              </div>
              <select className="search-sort-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort people">
                <option value="interests">Shared interests</option>
                <option value="relevance">Relevance</option>
                <option value="followers">Most followers</option>
              </select>
            </div>

            {!loading && peopleError && (
              <div className="card search-empty-state">
                <strong>People search is unavailable</strong>
                <p>{peopleError}</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={peoplePage.retry}>Try again</button>
              </div>
            )}
            {!loading && !peopleError && registeredCount !== null && (
              <div className="search-result-summary">
                {registeredCount.toLocaleString()} registered member{registeredCount === 1 ? '' : 's'}
                {` | ${(peopleTotal ?? results.length).toLocaleString()} ${hasQuery ? 'result' : 'available to connect'}${peopleTotal === 1 ? '' : 's'}`}
                {countSource === 'memory' ? ' | count reconnecting' : ''}
              </div>
            )}
            {!loading && !peopleError && registeredCount === null && countSource === 'unavailable' && (
              <div className="search-result-summary">Registered-member count is temporarily unavailable.</div>
            )}
            {!loading && !peopleError && !hasQuery && sortedResults.length > 0 && <div className="search-result-summary">{sortBy === 'interests' ? 'People with the most shared interests appear first.' : 'Suggested for you'}</div>}

            {!loading && !peopleError && sortedResults.length === 0 && (
              <div className="card search-empty-state"><strong>No people found</strong><p>Try a different name, skill, or role.</p></div>
            )}

            <div className="search-people-results">
              {sortedResults.map((user) => {
                const roleMeta = ROLE_META[user.role];
                return (
                  <article key={user.id} className="card search-person-card" onClick={() => navigate(user.isSelf ? '/profile' : `/u/${user.id}`)}>
                    <div className="search-person-avatar-wrap">
                      <div className="avatar avatar-md search-result-avatar">{initials(user.name)}{user.avatarUrl && <img src={user.avatarUrl} alt="" onError={event => { event.currentTarget.hidden = true; }} />}</div>
                    </div>
                    <div className="search-person-body">
                      <div className="search-person-topline">
                        <div className="search-person-name-wrap">
                          <Link className="search-profile-link" to={user.isSelf ? '/profile' : `/u/${user.id}`} onClick={event => event.stopPropagation()}>{user.name}</Link>
                          {user.isSelf && <span className="tag tag-primary">You</span>}
                          {user.title && <span>{user.title}{user.organization ? ` | ${user.organization}` : ''}</span>}
                        </div>
                        {user.isSelf ? (
                          <button className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); navigate('/profile'); }}>Edit profile</button>
                        ) : (
                          <div className="search-person-actions" onClick={(event) => event.stopPropagation()}>
                            <button className={user.isFollowing ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'} onClick={(event) => toggleFollow(user, event)}>
                              {user.isFollowing ? 'Following' : 'Follow'}
                            </button>
                            <Link to={`/messages/${user.id}`} className="btn btn-ghost btn-sm">Message</Link>
                          </div>
                        )}
                      </div>
                      {user.bio && <p className="search-person-bio">{user.bio}</p>}
                      {user.skills?.length > 0 && (
                        <div className="search-person-skills">
                          {user.skills.slice(0, 5).map((skill) => <span key={skill} className="tag tag-primary">{skill}</span>)}
                        </div>
                      )}
                      {!user.isSelf && user.sharedInterests?.length > 0 && <div className="search-person-skills" aria-label="Shared interests">
                        {user.sharedInterests.map(interest => <Link key={interest} className="tag tag-secondary"
                          to={'/search?tab=groups&q=' + encodeURIComponent(interest)}
                          title={'Find groups about ' + interest}>
                          {profile?.preferences?.interests?.find(value => value.trim().toLowerCase() === interest.toLowerCase()) || interest}
                        </Link>)}
                      </div>}

                      <div className="search-person-meta">
                        {user.role && roleMeta && <span style={{ color: roleMeta.color, background: roleMeta.bg }}>{user.role}</span>}
                        <span>{user.followersCount || 0} follower{user.followersCount === 1 ? '' : 's'}</span>
                        {!user.isSelf && user.sharedInterests?.length > 0 && <span>{(user.sharedInterestCount ?? user.sharedInterests.length)} shared interest{(user.sharedInterestCount ?? user.sharedInterests.length) === 1 ? '' : 's'}</span>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        {activeTab === 'groups' && (
          <>
            <div className="search-post-filters search-group-filters">
              <div className="search-group-actions">
                <Link className="btn btn-ghost btn-sm feed-toolbar-control" to="/groups/post">Post to your group</Link>
              </div>
              <div className="search-filter-line">
                <span className="search-filter-label">Group category</span>
                <div className="search-filter-rail" role="group" aria-label="Filter groups by category">
                  {['all', ...groupCategories].map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={`search-filter-chip${groupCategory === category ? ' active' : ''}`}
                      aria-pressed={groupCategory === category}
                      onClick={() => setGroupCategory(category)}
                    >{category === 'all' ? 'All groups' : category}</button>
                  ))}
                </div>
              </div>
            </div>
            {!groupsLoading && groupsError && (
              <div className="card search-empty-state">
                <strong>Group search is unavailable</strong>
                <p>{groupsError}</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={groupsPage.retry}>Try again</button>
              </div>
            )}
            {!groupsLoading && !groupsError && <div className="search-result-summary">{(groupsTotal ?? allGroups.length).toLocaleString()} public group{groupsTotal === 1 ? '' : 's'}{hasQuery ? ` matching "${query}"` : ''}</div>}
            {!groupsLoading && !groupsError && filteredGroups.length === 0 && (
              <div className="card search-empty-state"><strong>No groups found</strong><p>Try a different keyword or browse without a filter.</p></div>
            )}
            {filteredGroups.length > 0 && (
              <div className="group-directory-list group-live-list search-group-browser">
                  <div className="group-directory-list-heading">
                    <strong>Live group list</strong>
                    <span>{(groupsTotal ?? allGroups.length).toLocaleString()}</span>
                  </div>
                  <div className="group-directory-tabs" role="group" aria-label="Live groups">
                    {filteredGroups.map((group, index) => (
                      <GroupDirectoryTab
                        key={group.id}
                        group={group}
                        index={index}
                        onSelect={() => navigate(`/groups/${group.id}`)}
                      />
                    ))}
                  </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'jobs' && <Opportunities embedded paginated searchQuery={queries.jobs} />}
        {activeTab !== 'jobs' && <ResultsPagination page={activePage.page} hasNext={activePage.hasNext} loading={activePage.loading}
          onPageChange={changeResultsPage} ariaLabel="Search results pages"
          totalPages={!POST_TABS.has(activeTab) && activePage.total !== null ? Math.max(1, Math.ceil(activePage.total / DIRECTORY_PAGE_SIZE)) : undefined} />}
      </div>
    </SearchWrapper>
  );
}
