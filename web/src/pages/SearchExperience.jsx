import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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

const SEARCH_TABS = [
  { key: 'posts', label: 'Posts' },
  { key: 'following', label: 'Following Posts' },
  { key: 'people', label: 'People' },
  { key: 'groups', label: 'Groups' },
];
const POST_TABS = new Set(['posts', 'following']);
const POST_PAGE_SIZE = 30;

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

function mergePosts(current, incoming) {
  const merged = [];
  const seen = new Set();
  for (const post of [...current, ...incoming]) {
    const key = post?.id || `${post?.source || ''}:${post?.sourceUrl || post?.title || ''}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(post);
  }
  return merged;
}

function emptyPostState() {
  return { items: [], loading: false, loadingMore: false, error: '', page: 1, hasMore: false, total: null };
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

const CATEGORY_ICONS = {
  'AI & Machine Learning': 'AI', 'Web Development': 'WD', 'Mobile Dev': 'MD',
  'DevOps & Cloud': 'DC', 'Cybersecurity': 'CY', 'Open Source': 'OS',
  'Data Science': 'DS', 'Product & Design': 'PD', 'Startup & Founders': 'SF',
  'Finance & Investing': 'FI', 'Marketing & Growth': 'MG', 'Career & Jobs': 'CJ',
  'Community': 'CM', 'Science & Research': 'SR', 'Gaming': 'GM',
  'Blockchain & Web3': 'W3', 'Healthcare': 'HC', 'Education': 'ED',
};

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

export default function SearchExperience() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(initialSearchTab);
  const [queries, setQueries] = useState({ posts: '', following: '', people: '', groups: '' });
  const [roleFilter, setRoleFilter] = useState('All');
  const [sortBy, setSortBy] = useState('relevance');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [registeredCount, setRegisteredCount] = useState(null);
  const [countSource, setCountSource] = useState(null);
  const [allGroups, setAllGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [joinedGroups, setJoinedGroups] = useState(new Set());
  const [joining, setJoining] = useState(null);
  const [postStates, setPostStates] = useState({ posts: emptyPostState(), following: emptyPostState() });
  const [postSources, setPostSources] = useState({ posts: [], following: [] });
  const [postTopics, setPostTopics] = useState({ posts: [], following: [] });
  const [historyFound, setHistoryFound] = useState({ posts: false, following: false });
  const [suggestionsReady, setSuggestionsReady] = useState(false);
  const peopleRequestRef = useRef(0);
  const groupRequestRef = useRef(0);
  const postRequestRef = useRef({ posts: 0, following: 0 });
  const hydratedProfileRef = useRef(null);
  const joinedGroupsLoadedRef = useRef(false);
  const query = queries[activeTab] || '';

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

  const searchPeople = useCallback(async (value, role) => {
    const requestId = ++peopleRequestRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (value) params.set('q', value);
      if (role && role !== 'All') params.set('role', role);
      const { data } = await client.get(`/users/search?${params}`);
      if (requestId !== peopleRequestRef.current) return;
      setResults(data.users || []);
      setRegisteredCount(data.registeredCount != null && Number.isFinite(Number(data.registeredCount))
        ? Number(data.registeredCount)
        : null);
      setCountSource(data.countSource || null);
    } catch {
      if (requestId !== peopleRequestRef.current) return;
      setResults([]);
      setRegisteredCount(null);
      setCountSource(null);
    } finally {
      if (requestId === peopleRequestRef.current) setLoading(false);
    }
  }, []);

  const loadPostResults = useCallback(async ({ tab, value, sources, topics, page = 1, append = false }) => {
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
        sort: 'ranked',
        passive: '1',
      });
      if (value.trim()) params.set('q', value.trim());
      if (topics.length) params.set('topics', topics.join(','));
      if (sources.length === 1) params.set('source', sources[0]);
      else if (sources.length > 1) params.set('sources', sources.join(','));
      const { data } = await client.get(`/office/feed?${params}`);
      if (requestId !== postRequestRef.current[tab]) return;
      const incoming = Array.isArray(data.posts) ? data.posts : [];
      setPostStates((current) => ({
        ...current,
        [tab]: {
          items: append ? mergePosts(current[tab].items, incoming) : incoming,
          loading: false,
          loadingMore: false,
          error: '',
          page,
          hasMore: data.hasMore !== false && incoming.length > 0,
          total: data.totalAvailable != null && Number.isFinite(Number(data.totalAvailable))
            ? Number(data.totalAvailable)
            : null,
        },
      }));
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
    const timer = window.setTimeout(() => searchPeople(queries.people.trim(), roleFilter), 280);
    return () => window.clearTimeout(timer);
  }, [activeTab, queries.people, roleFilter, searchPeople]);

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
    if (activeTab !== 'groups' || !profile?.id || joinedGroupsLoadedRef.current) return;
    joinedGroupsLoadedRef.current = true;
    client.get('/profile')
      .then(({ data }) => setJoinedGroups(new Set(data.joinedGroups || [])))
      .catch(() => { joinedGroupsLoadedRef.current = false; });
  }, [activeTab, profile?.id]);

  useEffect(() => {
    if (activeTab !== 'groups') return undefined;
    const requestId = ++groupRequestRef.current;
    const timer = window.setTimeout(async () => {
      setGroupsLoading(true);
      try {
        const params = new URLSearchParams();
        if (queries.groups.trim()) params.set('q', queries.groups.trim());
        const { data } = await client.get(`/groups?${params}`);
        if (requestId !== groupRequestRef.current) return;
        setAllGroups((data.groups || []).filter((group) => group.isExternal !== true));
      } catch {
        if (requestId === groupRequestRef.current) setAllGroups([]);
      } finally {
        if (requestId === groupRequestRef.current) setGroupsLoading(false);
      }
    }, queries.groups.trim() ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, queries.groups]);

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

  async function toggleJoin(groupId, event) {
    event.stopPropagation();
    setJoining(groupId);
    try {
      if (!joinedGroups.has(groupId)) {
        await client.post(`/groups/${groupId}/join`);
        setJoinedGroups((current) => new Set([...current, groupId]));
      }
    } catch {}
    finally { setJoining(null); }
  }

  const sortedResults = useMemo(() => [...results].sort((a, b) => (
    sortBy === 'followers' ? (b.followersCount || 0) - (a.followersCount || 0) : 0
  )), [results, sortBy]);
  const filteredGroups = allGroups;
  const activePostState = POST_TABS.has(activeTab) ? postStates[activeTab] : null;
  const activeLoading = activePostState?.loading || (activeTab === 'people' && loading) || (activeTab === 'groups' && groupsLoading);
  const hasQuery = query.trim().length > 0;

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
        <title>Search Posts, People & Groups | UFIconnect</title>
        <meta name="description" content="Search your personalized feeds, professionals, and UFIconnect groups." />
        <link rel="canonical" href="https://uficonnect.org/search" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://uficonnect.org/search" />
        <meta property="og:title" content="Search Posts, People & Groups | UFIconnect" />
        <meta property="og:description" content="Search your personalized feeds, professionals, and UFIconnect groups." />
        <meta property="og:image" content="https://uficonnect.org/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>

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
                  : 'Search UFIconnect groups by name or topic...'}
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

            {activePostState.hasMore && activePostState.items.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost search-load-more"
                disabled={activePostState.loadingMore}
                onClick={() => loadPostResults({
                  tab: activeTab,
                  value: query,
                  sources: postSources[activeTab],
                  topics: postTopics[activeTab],
                  page: activePostState.page + 1,
                  append: true,
                })}
              >{activePostState.loadingMore ? 'Loading...' : 'Load more posts'}</button>
            )}
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

            {!loading && registeredCount !== null && (
              <div className="search-result-summary">
                {registeredCount.toLocaleString()} registered member{registeredCount === 1 ? '' : 's'}
                {` | ${sortedResults.length} ${hasQuery ? 'result' : 'available to connect'}${sortedResults.length === 1 ? '' : 's'}`}
                {countSource === 'memory' ? ' | count reconnecting' : ''}
              </div>
            )}
            {!loading && registeredCount === null && countSource === 'unavailable' && (
              <div className="search-result-summary">Registered-member count is temporarily unavailable.</div>
            )}
            {!loading && !hasQuery && sortedResults.length > 0 && <div className="search-result-summary">Suggested for you</div>}

            {!loading && sortedResults.length === 0 && (
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
            {!groupsLoading && <div className="search-result-summary">{filteredGroups.length} UFIconnect group{filteredGroups.length === 1 ? '' : 's'}{hasQuery ? ` matching "${query}"` : ''}</div>}
            {!groupsLoading && filteredGroups.length === 0 && (
              <div className="card search-empty-state"><strong>No groups found</strong><p>Try a different keyword or browse without a filter.</p></div>
            )}
            <div className="search-group-results">
              {filteredGroups.map((group) => {
                const icon = CATEGORY_ICONS[group.category] || 'GR';
                const isJoined = joinedGroups.has(group.id);
                return (
                  <article key={group.id} className="card search-group-card" onClick={() => navigate(`/groups/${group.id}`)}>
                    <span className="search-group-mark">{icon}</span>
                    <div className="search-group-body">
                      <strong>{group.name}</strong>
                      <span>{[group.category, typeof group.members === 'number' ? `${group.members.toLocaleString()} members` : ''].filter(Boolean).join(' | ')}</span>
                      {group.description && <p>{group.description}</p>}
                    </div>
                    {isJoined ? <span className="search-joined-label">Joined</span> : (
                      <button className="btn btn-primary btn-sm" disabled={joining === group.id} onClick={(event) => toggleJoin(group.id, event)}>
                        {joining === group.id ? 'Joining...' : 'Join'}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
