import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
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

function initialSearchTab() {
  if (typeof window === 'undefined') return 'posts';
  const requested = new URLSearchParams(window.location.search).get('tab');
  if (requested === 'communities') return 'groups';
  return SEARCH_TABS.some((tab) => tab.key === requested) ? requested : 'posts';
}

function readJsonStorage(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function previousFeedSignals(userId, mode) {
  if (!userId || typeof window === 'undefined') return { sources: [], topics: [], found: false };

  const dedicated = readJsonStorage(localStorage, `ufi_feed_suggestions:${mode}:${userId}`);
  if (dedicated) {
    return {
      sources: Array.isArray(dedicated.sources) ? dedicated.sources : [],
      topics: Array.isArray(dedicated.topics) ? dedicated.topics : [],
      found: true,
    };
  }

  const key = `ufi_feed_state:${userId}`;
  const saved = readJsonStorage(sessionStorage, key) || readJsonStorage(localStorage, key);
  if (!saved || saved.viewMode !== mode) return { sources: [], topics: [], found: false };
  return {
    sources: Array.isArray(saved.filters?.sources) && saved.filters.sources.length
      ? saved.filters.sources
      : (Array.isArray(saved.activeTabs) ? saved.activeTabs : []),
    topics: Array.isArray(saved.filters?.topics) ? saved.filters.topics : [],
    found: true,
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

function initialSearchQuery() {
  if (typeof window === 'undefined') return '';
  return String(new URLSearchParams(window.location.search).get('q') || '').trim().slice(0, 200);
}

function mergeById(current, incoming) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => item?.id && !seen.has(item.id))];
}

function emptyPostState() {
  return {
    items: [], loading: false, loadingMore: false, error: '',
    page: 1, cursor: '', hasMore: false, total: null,
  };
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

export default function SearchExperience({ initialTab = null } = {}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [routeSeed] = useState(() => ({
    tab: SEARCH_TABS.some((tab) => tab.key === initialTab) ? initialTab : initialSearchTab(),
    query: initialSearchQuery(),
  }));
  const [activeTab, setActiveTab] = useState(routeSeed.tab);
  const [queries, setQueries] = useState(() => ({
    posts: '', following: '', people: '', groups: '', jobs: '',
    [routeSeed.tab]: routeSeed.query,
  }));
  const [roleFilter, setRoleFilter] = useState('All');
  const [sortBy, setSortBy] = useState('relevance');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [peopleLoadingMore, setPeopleLoadingMore] = useState(false);
  const [peopleHasMore, setPeopleHasMore] = useState(false);
  const [peopleTotal, setPeopleTotal] = useState(0);
  const [peopleError, setPeopleError] = useState('');
  const [registeredCount, setRegisteredCount] = useState(null);
  const [countSource, setCountSource] = useState(null);
  const [allGroups, setAllGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsLoadingMore, setGroupsLoadingMore] = useState(false);
  const [groupsHasMore, setGroupsHasMore] = useState(false);
  const [groupsTotal, setGroupsTotal] = useState(0);
  const [groupsError, setGroupsError] = useState('');
  const [groupCategories, setGroupCategories] = useState([]);
  const [groupCategory, setGroupCategory] = useState('all');
  const [showCreateGroup, setShowCreateGroup] = useState(() => (
    new URLSearchParams(window.location.search).get('create') === '1'
  ));
  const [postStates, setPostStates] = useState({ posts: emptyPostState(), following: emptyPostState() });
  const [postSources, setPostSources] = useState({ posts: [], following: [] });
  const [postTopics, setPostTopics] = useState({ posts: [], following: [] });
  const [historyFound, setHistoryFound] = useState({ posts: false, following: false });
  const [suggestionsReady, setSuggestionsReady] = useState(false);
  const peopleRequestRef = useRef(0);
  const groupRequestRef = useRef(0);
  const postRequestRef = useRef({ posts: 0, following: 0 });
  const peopleLoadingMoreRef = useRef(false);
  const groupsLoadingMoreRef = useRef(false);
  const searchSentinelRef = useRef(null);
  const hydratedProfileRef = useRef(null);
  const query = queries[activeTab] || '';

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedTab = params.get('tab');
    const nextTab = requestedTab === 'communities' ? 'groups' : requestedTab;
    if (SEARCH_TABS.some((tab) => tab.key === nextTab)) setActiveTab(nextTab);
    if (params.has('q')) {
      const nextQuery = String(params.get('q') || '').trim().slice(0, 200);
      const targetTab = SEARCH_TABS.some((tab) => tab.key === nextTab) ? nextTab : activeTab;
      setQueries(current => ({ ...current, [targetTab]: nextQuery }));
    }
  }, [activeTab, location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setShowCreateGroup(activeTab === 'groups' && params.get('create') === '1');
  }, [activeTab, location.search]);

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
    const posts = previousFeedSignals(profile.id, 'feed');
    const following = previousFeedSignals(profile.id, 'following');
    setPostSources({
      posts: posts.sources.filter((source) => HOME_FEED_SOURCE_IDS.includes(source) && !disabledSources.has(source)),
      following: following.sources.filter((source) => FOLLOWING_FEED_SOURCE_IDS.includes(source) && !disabledSources.has(source)),
    });
    setPostTopics({ posts: posts.topics, following: following.topics });
    setHistoryFound({ posts: posts.found, following: following.found });
    setSuggestionsReady(true);
  }, [disabledSources, profile?.id]);

  const searchPeople = useCallback(async (value, role, order, { offset = 0, append = false } = {}) => {
    if (append && peopleLoadingMoreRef.current) return;
    const requestId = ++peopleRequestRef.current;
    if (append) {
      peopleLoadingMoreRef.current = true;
      setPeopleLoadingMore(true);
    } else {
      peopleLoadingMoreRef.current = false;
      setPeopleLoadingMore(false);
      setLoading(true);
      setResults([]);
    }
    setPeopleError('');
    try {
      const params = new URLSearchParams();
      if (value) params.set('q', value);
      if (role && role !== 'All') params.set('role', role);
      params.set('sort', order === 'followers' ? 'followers' : 'relevance');
      params.set('limit', String(DIRECTORY_PAGE_SIZE));
      params.set('offset', String(offset));
      const { data } = await client.get(`/users/search?${params}`);
      if (requestId !== peopleRequestRef.current) return;
      const incoming = data.users || [];
      setResults((current) => append ? mergeById(current, incoming) : incoming);
      setPeopleTotal(Number.isFinite(Number(data.totalCount)) ? Number(data.totalCount) : incoming.length);
      setPeopleHasMore(data.hasMore === true);
      setRegisteredCount(data.registeredCount != null && Number.isFinite(Number(data.registeredCount))
        ? Number(data.registeredCount)
        : null);
      setCountSource(data.countSource || null);
    } catch {
      if (requestId !== peopleRequestRef.current) return;
      if (!append) {
        setResults([]);
        setPeopleTotal(0);
      }
      setPeopleHasMore(false);
      setPeopleError('People could not be loaded right now. Please try again.');
      if (!append) {
        setRegisteredCount(null);
        setCountSource(null);
      }
    } finally {
      if (requestId === peopleRequestRef.current) {
        setLoading(false);
        setPeopleLoadingMore(false);
        peopleLoadingMoreRef.current = false;
      }
    }
  }, []);

  const loadPostResults = useCallback(async ({ tab, value, sources, topics, page = 1, cursor = '', append = false }) => {
    const requestId = ++postRequestRef.current[tab];
    setPostStates((current) => ({
      ...current,
      [tab]: { ...current[tab], loading: !append, loadingMore: append, error: '' },
    }));
    try {
      const params = new URLSearchParams({
        mode: tab === 'following' ? 'following' : 'feed',
        limit: String(POST_PAGE_SIZE),
        page: String(page),
        sort: 'newest',
        passive: '1',
      });
      if (append && cursor) params.set('cursor', cursor);
      if (value.trim()) params.set('q', value.trim());
      if (topics.length) params.set('topics', topics.join(','));
      if (sources.length === 1) params.set('source', sources[0]);
      else if (sources.length > 1) params.set('sources', sources.join(','));
      const { data } = await client.get(`/feed?${params}`);
      if (requestId !== postRequestRef.current[tab]) return;
      const incoming = Array.isArray(data.posts) ? data.posts : [];
      setPostStates((current) => {
        const items = mergePosts(append ? current[tab].items : [], incoming);
        const added = append ? items.length - current[tab].items.length : items.length;
        const nextCursor = typeof data.cursor === 'string' ? data.cursor : '';
        const cursorAdvanced = Boolean(nextCursor && nextCursor !== cursor);
        return {
          ...current,
          [tab]: {
            items,
            loading: false,
            loadingMore: false,
            error: '',
            page,
            cursor: nextCursor,
            hasMore: data.hasMore === true
              && (incoming.length > 0 ? (!append || added > 0 || cursorAdvanced) : cursorAdvanced),
            total: data.totalAvailable != null && Number.isFinite(Number(data.totalAvailable))
              ? Number(data.totalAvailable)
              : null,
          },
        };
      });
    } catch {
      if (requestId !== postRequestRef.current[tab]) return;
      setPostStates((current) => ({
        ...current,
        [tab]: {
          ...current[tab], loading: false, loadingMore: false,
          error: 'Posts could not be loaded right now. Please try again.',
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'people') return undefined;
    const timer = window.setTimeout(() => searchPeople(queries.people.trim(), roleFilter, sortBy), 280);
    return () => window.clearTimeout(timer);
  }, [activeTab, queries.people, roleFilter, searchPeople, sortBy]);

  const activeSourceKey = POST_TABS.has(activeTab) ? postSources[activeTab].join(',') : '';
  const activeTopicKey = POST_TABS.has(activeTab) ? postTopics[activeTab].join(',') : '';
  useEffect(() => {
    if (!suggestionsReady || !POST_TABS.has(activeTab)) return undefined;
    const timer = window.setTimeout(() => {
      loadPostResults({
        tab: activeTab,
        value: queries[activeTab],
        sources: postSources[activeTab],
        topics: postTopics[activeTab],
      });
    }, queries[activeTab].trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, activeSourceKey, activeTopicKey, loadPostResults, queries, suggestionsReady]);

  useEffect(() => {
    if (activeTab !== 'groups' || groupCategories.length) return;
    client.get('/groups/categories')
      .then(({ data }) => setGroupCategories(data.categories || []))
      .catch(() => {});
  }, [activeTab, groupCategories.length]);

  const loadGroups = useCallback(async (value, { offset = 0, append = false } = {}) => {
    if (append && groupsLoadingMoreRef.current) return;
    const requestId = ++groupRequestRef.current;
    if (append) {
      groupsLoadingMoreRef.current = true;
      setGroupsLoadingMore(true);
    } else {
      groupsLoadingMoreRef.current = false;
      setGroupsLoadingMore(false);
      setGroupsLoading(true);
      setAllGroups([]);
    }
    setGroupsError('');
    try {
      const params = new URLSearchParams({
        limit: String(DIRECTORY_PAGE_SIZE),
        offset: String(offset),
        scope: 'public',
      });
      if (value) params.set('q', value);
      if (groupCategory !== 'all') params.set('category', groupCategory);
      const { data } = await client.get(`/groups?${params}`);
      if (requestId !== groupRequestRef.current) return;
      const incoming = data.groups || [];
      setAllGroups((current) => append ? mergeById(current, incoming) : incoming);
      setGroupsTotal(Number.isFinite(Number(data.totalCount)) ? Number(data.totalCount) : incoming.length);
      setGroupsHasMore(data.hasMore === true);
    } catch {
      if (requestId !== groupRequestRef.current) return;
      if (!append) {
        setAllGroups([]);
        setGroupsTotal(0);
      }
      setGroupsHasMore(false);
      setGroupsError('Groups could not be loaded right now. Please try again.');
    } finally {
      if (requestId === groupRequestRef.current) {
        setGroupsLoading(false);
        setGroupsLoadingMore(false);
        groupsLoadingMoreRef.current = false;
      }
    }
  }, [groupCategory]);

  const closeCreateGroup = useCallback(() => {
    setShowCreateGroup(false);
    const params = new URLSearchParams(location.search);
    params.delete('create');
    const nextSearch = params.toString();
    navigate({ pathname: '/search', search: nextSearch ? `?${nextSearch}` : '?tab=groups' }, { replace: true });
  }, [location.search, navigate]);

  const createGroup = useCallback(async (group) => {
    const { data } = await client.post('/groups', group);
    if (!data?.group) throw new Error('Group creation did not return a group.');
    setAllGroups((current) => mergeById([data.group], current));
    setGroupsTotal((current) => current + 1);
    setShowCreateGroup(false);
    navigate(`/groups/${data.group.id}`);
  }, [navigate]);

  useEffect(() => {
    if (activeTab !== 'groups') return undefined;
    const timer = window.setTimeout(() => loadGroups(queries.groups.trim()), queries.groups.trim() ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadGroups, queries.groups]);

  function selectTab(tab) {
    setActiveTab(tab);
    navigate({ pathname: '/search', search: `?tab=${tab}` }, { replace: true });
  }

  function handleQueryChange(event) {
    const value = event.target.value;
    setQueries((current) => ({ ...current, [activeTab]: value }));
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
      setResults((current) => current.map((item) => item.id === user.id
        ? { ...item, isFollowing: nowFollowing, followersCount: data.followersCount ?? item.followersCount }
        : item));
    } catch {}
  }

  const sortedResults = useMemo(() => [...results].sort((a, b) => (
    sortBy === 'followers' ? (b.followersCount || 0) - (a.followersCount || 0) : 0
  )), [results, sortBy]);
  const filteredGroups = allGroups;
  const activePostState = POST_TABS.has(activeTab) ? postStates[activeTab] : null;
  const activeLoading = activePostState?.loading || (activeTab === 'people' && loading) || (activeTab === 'groups' && groupsLoading);
  const activeLoadingMore = activePostState?.loadingMore
    || (activeTab === 'people' && peopleLoadingMore)
    || (activeTab === 'groups' && groupsLoadingMore);
  const activeHasMore = POST_TABS.has(activeTab)
    ? activePostState?.hasMore
    : activeTab === 'people'
      ? peopleHasMore
      : activeTab === 'groups' && groupsHasMore;
  const hasQuery = query.trim().length > 0;

  const loadMoreSearchResults = useCallback(() => {
    if (activeLoading || activeLoadingMore || !activeHasMore) return;
    if (POST_TABS.has(activeTab)) {
      loadPostResults({
        tab: activeTab,
        value: queries[activeTab],
        sources: postSources[activeTab],
        topics: postTopics[activeTab],
        page: postStates[activeTab].page + 1,
        cursor: postStates[activeTab].cursor,
        append: true,
      });
      return;
    }
    if (activeTab === 'people') {
      searchPeople(queries.people.trim(), roleFilter, sortBy, {
        offset: results.length,
        append: true,
      });
      return;
    }
    if (activeTab === 'groups') {
      loadGroups(queries.groups.trim(), { offset: allGroups.length, append: true });
    }
  }, [
    activeHasMore, activeLoading, activeLoadingMore, activeTab, allGroups.length,
    loadGroups, loadPostResults, postSources, postStates, postTopics, queries,
    results.length, roleFilter, searchPeople, sortBy,
  ]);

  useEffect(() => {
    const sentinel = searchSentinelRef.current;
    if (!sentinel || !activeHasMore || activeLoading || activeLoadingMore || activeTab === 'jobs') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMoreSearchResults(); },
      { rootMargin: '500px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeHasMore, activeLoading, activeLoadingMore, activeTab, loadMoreSearchResults]);

  const refreshActiveSearch = useCallback(() => {
    if (POST_TABS.has(activeTab)) {
      return loadPostResults({
        tab: activeTab,
        value: queries[activeTab],
        sources: postSources[activeTab],
        topics: postTopics[activeTab],
      });
    }
    if (activeTab === 'people') return searchPeople(queries.people.trim(), roleFilter, sortBy);
    if (activeTab === 'groups') return loadGroups(queries.groups.trim());
    return undefined;
  }, [activeTab, loadGroups, loadPostResults, postSources, postTopics, queries, roleFilter, searchPeople, sortBy]);

  useScrollToRefresh(refreshActiveSearch, {
    enabled: activeTab !== 'jobs' && !activeLoading && !activeLoadingMore,
  });

  function updatePost(tab, updatedPost) {
    setPostStates((current) => ({
      ...current,
      [tab]: {
        ...current[tab],
        items: current[tab].items.map((post) => post.id === updatedPost.id ? { ...post, ...updatedPost } : post),
      },
    }));
  }

  return (
    <Layout>
      <Helmet>
        <title>Search Posts, People, Groups & Jobs | UFIconnect</title>
        <meta name="description" content="Search personalized posts, professionals, groups, and live job listings." />
        <link rel="canonical" href="https://uficonnect.org/search" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://uficonnect.org/search" />
        <meta property="og:title" content="Search Posts, People, Groups & Jobs | UFIconnect" />
        <meta property="og:description" content="Search personalized posts, professionals, groups, and live job listings." />
        <meta property="og:image" content="https://uficonnect.org/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>

      {showCreateGroup && (
        <CreateGroupModal
          categories={groupCategories.length ? groupCategories : ['Community']}
          onClose={closeCreateGroup}
          onCreate={createGroup}
        />
      )}

      <div className="search-page-shell">
        <div className="page-header"><h1 className="page-title">Search</h1></div>

        <div className="search-tab-strip" role="tablist" aria-label="Search sections">
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

        <div className="search-query-wrap">
          <span className="search-query-icon" aria-hidden="true">Q</span>
          <input
            className="form-input search-query-input"
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
          {activeLoading && <span className="search-query-spinner"><span className="spinner" /></span>}
          {query && !activeLoading && (
            <button type="button" className="search-query-clear" aria-label="Clear search" onClick={clearSearch}>x</button>
          )}
        </div>

        {POST_TABS.has(activeTab) && (
          <>
            <PostFilters
              sources={availableSources[activeTab]}
              selectedSources={postSources[activeTab]}
              selectedTopics={postTopics[activeTab]}
              onSourcesChange={(sources) => setPostSources((current) => ({ ...current, [activeTab]: sources }))}
              onTopicsChange={(topics) => setPostTopics((current) => ({ ...current, [activeTab]: topics }))}
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
                  onClick={() => loadPostResults({
                    tab: activeTab,
                    value: query,
                    sources: postSources[activeTab],
                    topics: postTopics[activeTab],
                  })}
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
                    >{meta && <span>{meta.icon}</span>}{role}</button>
                  );
                })}
              </div>
              <select className="search-sort-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort people">
                <option value="relevance">Relevance</option>
                <option value="followers">Most followers</option>
              </select>
            </div>

            {!loading && peopleError && (
              <div className="card search-empty-state">
                <strong>People search is unavailable</strong>
                <p>{peopleError}</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => searchPeople(queries.people.trim(), roleFilter, sortBy)}>Try again</button>
              </div>
            )}
            {!loading && !peopleError && registeredCount !== null && (
              <div className="search-result-summary">
                {registeredCount.toLocaleString()} registered member{registeredCount === 1 ? '' : 's'}
                {` | ${peopleTotal.toLocaleString()} ${hasQuery ? 'result' : 'available to connect'}${peopleTotal === 1 ? '' : 's'}`}
                {countSource === 'memory' ? ' | count reconnecting' : ''}
              </div>
            )}
            {!loading && !peopleError && registeredCount === null && countSource === 'unavailable' && (
              <div className="search-result-summary">Registered-member count is temporarily unavailable.</div>
            )}
            {!loading && !peopleError && !hasQuery && sortedResults.length > 0 && <div className="search-result-summary">Suggested for you</div>}

            {!loading && !peopleError && sortedResults.length === 0 && (
              <div className="card search-empty-state"><strong>No people found</strong><p>Try a different name, skill, or role.</p></div>
            )}

            <div className="search-people-results">
              {sortedResults.map((user) => {
                const roleMeta = ROLE_META[user.role];
                return (
                  <article key={user.id} className="card search-person-card" onClick={() => navigate(user.isSelf ? '/profile' : `/u/${user.id}`)}>
                    <div className="search-person-avatar-wrap">
                      <div className="avatar avatar-md" style={{ border: roleMeta ? `2px solid ${roleMeta.color}` : undefined }}>{initials(user.name)}</div>
                      {roleMeta && <span className="search-person-role-mark" style={{ color: roleMeta.color, background: roleMeta.bg }}>{roleMeta.icon}</span>}
                    </div>
                    <div className="search-person-body">
                      <div className="search-person-topline">
                        <div className="search-person-name-wrap">
                          <strong>{user.name}</strong>
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
                      <div className="search-person-meta">
                        {user.role && roleMeta && <span style={{ color: roleMeta.color, background: roleMeta.bg }}>{roleMeta.icon} {user.role}</span>}
                        <span>{user.followersCount || 0} follower{user.followersCount === 1 ? '' : 's'}</span>
                        {!user.isSelf && user.sharedInterests?.length > 0 && <span>{user.sharedInterests.length} shared interest{user.sharedInterests.length === 1 ? '' : 's'}</span>}
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
                <button
                  type="button"
                  className="btn btn-primary btn-sm feed-toolbar-control feed-toolbar-primary-action group-create-button"
                  onClick={() => setShowCreateGroup(true)}
                >
                  Create a group
                </button>
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
                <button type="button" className="btn btn-primary btn-sm" onClick={() => loadGroups(queries.groups.trim())}>Try again</button>
              </div>
            )}
            {!groupsLoading && !groupsError && <div className="search-result-summary">{groupsTotal.toLocaleString()} public group{groupsTotal === 1 ? '' : 's'}{hasQuery ? ` matching "${query}"` : ''}</div>}
            {!groupsLoading && !groupsError && filteredGroups.length === 0 && (
              <div className="card search-empty-state"><strong>No groups found</strong><p>Try a different keyword or browse without a filter.</p></div>
            )}
            {filteredGroups.length > 0 && (
              <div className="group-directory-list group-live-list search-group-browser">
                  <div className="group-directory-list-heading">
                    <strong>Live group list</strong>
                    <span>{groupsTotal.toLocaleString()}</span>
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
                    {groupsHasMore && (
                      <div ref={searchSentinelRef} className="search-results-sentinel" aria-hidden="true">
                        {groupsLoadingMore && <span className="spinner spinner-primary" />}
                      </div>
                    )}
                  </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'jobs' && <Opportunities embedded searchQuery={queries.jobs} />}

        {activeTab !== 'jobs' && activeTab !== 'groups' && activeHasMore && (
          <div ref={searchSentinelRef} className="search-results-sentinel" aria-hidden="true">
            {activeLoadingMore && <span className="spinner spinner-primary" />}
          </div>
        )}
      </div>
    </Layout>
  );
}
