import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import CategoryCity from '../components/SourceCity';
import CityAppGuide from '../components/CityAppGuide';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import { PostCard } from './Feed';
import ImageLightbox from '../components/ImageLightbox';
import TravelGuideDialog from '../components/TravelGuideDialog';
import useTabMetrics from '../analytics/useTabMetrics';
import { SOURCE_META } from '../components/sourceMeta';
import { CITY_SOURCE_PRESETS, CITY_SOURCE_IDS, CITY_ALL_TOPICS, houseTopics } from '../local/citySources';
import client from '../api/client';
import { appendMapPosts, mapSourceTopicScope, mapTopicCounts, mapPostTarget, mapWildcardTarget } from '../../../shared/map-feed-topics.mjs';
import { useAuth } from '../contexts/AuthContext';
import { feedLocationKey } from '../utils/feedLocation.mjs';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { CITY_CATEGORIES, useLocalWorkspace, safeLink } from '../local/localWorkspace';
import { CITY_LANDMARKS } from '../local/cityEngineering.mjs';
import '../components/local-workspaces.css';
import '../components/maps-workspace.css';

const DEFAULT_CITY = { enabled: CITY_CATEGORIES.map(category => category.id), sourceSelections: {}, topicSelections: {}, topicTargets: {} };
const PAGE_SIZE = 20;
const postKey = post => String(post.source || 'uficonnect') + ':' + String(post.id);
const sourceLabel = source => SOURCE_META[source]?.label || source;
const snapshot = (post, category) => ({
  ...post,
  key: postKey(post), id: String(post.id), source: String(post.source || 'uficonnect'),
  title: String(post.title || post.content || 'Community post').slice(0, 220),
  topics: (Array.isArray(post.topics) ? post.topics : [post.topic]).filter(topic => typeof topic === 'string').slice(0, 30),
  sourceUrl: safeLink(post.sourceUrl), category,
});
const settingsFor = value => ({
  enabled: Array.isArray(value.enabled) ? value.enabled.filter(id => CITY_CATEGORIES.some(category => category.id === id)) : DEFAULT_CITY.enabled,
  sourceSelections: value.sourceSelections && typeof value.sourceSelections === 'object' && !Array.isArray(value.sourceSelections) ? value.sourceSelections : {},
  topicSelections: value.topicSelections && typeof value.topicSelections === 'object' && !Array.isArray(value.topicSelections) ? value.topicSelections : {},
  topicTargets: value.topicTargets && typeof value.topicTargets === 'object' && !Array.isArray(value.topicTargets) ? value.topicTargets : {},
});
const sourcesFor = (settings, category) => Array.isArray(settings.sourceSelections[category])
  ? [...new Set(settings.sourceSelections[category].filter(source => CITY_SOURCE_IDS.includes(source)))]
  : CITY_SOURCE_PRESETS[category] || ['uficonnect'];

export default function Maps() {
  const navigate = useNavigate(), [routeParams] = useSearchParams();
  const requestedLandmark = CITY_LANDMARKS.find(item => item.id === routeParams.get('landmark'))?.id || '';
  const { profile } = useAuth();
  const city = useLocalWorkspace(profile.id, 'city', DEFAULT_CITY);
  const applied = settingsFor(city.value);
  const { enabled, topicSelections } = applied;
  const [draft, setDraft] = useState(null);
  useEffect(() => { setDraft(null); }, [profile.id]);
  const editing = draft?.accountId === profile.id ? draft.settings : applied;
  const hasChanges = JSON.stringify(editing) !== JSON.stringify(applied);
  const [active, setActive] = useState(enabled[0] || 'community');
  const [activeSource, setActiveSource] = useState('');
  useTabMetrics('maps_category', active);
  useTabMetrics('maps_source', activeSource || 'all');
  const [loadedPosts, setPosts] = useState([]);
  const [loadedScope, setLoadedScope] = useState('');
  const [locationContext, setLocationContext] = useState(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [moreAvailable, setHasMore] = useState(false);
  const [fetching, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sample, setSample] = useState(false);
  const [topicSearch, setTopicSearch] = useState('');
  const [toolsPage, setToolsPage] = useState('sources');
  const [desktopToolsOpen, setDesktopToolsOpen] = useState(false);
  const [sourcePage, setSourcePage] = useState(1);
  const [topicPage, setTopicPage] = useState(1);
  const [selectedPage, setSelectedPage] = useState(1);
  const [mediaPostId, setMediaPostId] = useState(null);
  const [guideDestination, setGuideDestination] = useState(null);
  const [activeBuilding, setActiveBuilding] = useState('feed');
  const [revealPanel, setRevealPanel] = useState('');
  const [mobileTools, setMobileTools] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const update = () => { setMobileTools(media.matches); if (!media.matches) setMobileToolsOpen(false); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const paging = useRef({ page: 1, cursor: '' });
  const results = useRef({ scope: '', posts: [] });
  const request = useRef(null);
  const sequence = useRef(0);
  const heading = useRef(null);
  const houseHeading = useRef(null);
  const guideHeading = useRef(null);
  const mobileMenu = useRef(null);
  const mobileMenuButton = useRef(null);
  useEffect(() => {
    if (!mobileTools || !mobileToolsOpen) return undefined;
    const drawer = mobileMenu.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const initialFocus = revealPanel === 'topics' ? houseHeading.current : revealPanel === 'guide' ? guideHeading.current : drawer?.querySelector('button');
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => initialFocus?.focus({ preventScroll: true }));
    function handleKeys(event) {
      if (event.key === 'Escape') { event.preventDefault(); setMobileToolsOpen(false); return; }
      if (event.key !== 'Tab' || !drawer) return;
      const items = [...drawer.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')]
        .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden]'));
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', handleKeys);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeys);
      const returnTarget = mobileMenuButton.current || (previousFocus instanceof HTMLElement && previousFocus !== document.body && previousFocus.isConnected ? previousFocus : null);
      returnTarget?.focus({ preventScroll: true });
    };
  }, [mobileTools, mobileToolsOpen]); // Focus the requested panel only when the drawer opens.
  const category = CITY_CATEGORIES.find(item => item.id === active) || CITY_CATEGORIES[0];
  const sources = sourcesFor(applied, active);
  const currentSource = sources.includes(activeSource) ? activeSource : '';
  const allCities = CITY_CATEGORIES.map(item => ({ ...item, sources: sourcesFor(applied, item.id) }));
  const draftSources = sourcesFor(editing, active);
  const draftSource = draftSources.includes(activeSource) ? activeSource : '';
  const topicKey = active + ':' + (draftSource || 'city');
  const availableTopics = [...new Set([...houseTopics(active, draftSource), ...CITY_ALL_TOPICS])];
  const topics = Array.isArray(editing.topicSelections[topicKey])
    ? editing.topicSelections[topicKey].filter(topic => availableTopics.includes(topic)) : [];
  const requestedSources = currentSource ? [currentSource] : sources;
  const sourceKey = requestedSources.join(',');
  const requestedTopics = JSON.stringify([applied.topicSelections, applied.topicTargets]);
  // Hide results from the previous selection immediately, including during debounce.
  // Only a completed request for this exact scope may supply posts or pagination.
  const locationKey = feedLocationKey(profile.roleSettings, category.mode || 'feed');
  const feedScope = JSON.stringify([profile.id, active, sourceKey, requestedTopics, query.trim(), enabled.includes(active), locationKey]);
  const scopeRef = useRef(feedScope);
  scopeRef.current = feedScope;
  const hasCurrentResults = loadedScope === feedScope;
  const posts = hasCurrentResults ? loadedPosts : [];
  const hasMore = hasCurrentResults && moreAvailable;
  const loading = fetching || (enabled.includes(active) && Boolean(sourceKey) && !hasCurrentResults && !error);
  const primarySources = [...new Set([...(CITY_SOURCE_PRESETS[active] || []), ...draftSources])];
  const otherSources = CITY_SOURCE_IDS.filter(source => !primarySources.includes(source));
  const counts = useMemo(() => posts.reduce((result, post) => {
    if (post.category === active) result[post.source] = (result[post.source] || 0) + 1;
    return result;
  }, {}), [posts, active]);
  const currentPosts = posts;
  const visible = currentPosts.slice(0, visibleCount);
  const countTopic = useMemo(() => mapTopicCounts(posts, active), [posts, active]);
  const sourceChoices = [...primarySources, ...otherSources];
  const sourcePages = Math.max(1, Math.ceil(sourceChoices.length / 12));
  const availableChoices = availableTopics.filter(topic => !topics.includes(topic) && topic.toLowerCase().includes(topicSearch.trim().toLowerCase()));
  const topicPages = Math.max(1, Math.ceil(availableChoices.length / 12));
  const selectedPages = Math.max(1, Math.ceil(topics.length / 6));
  const mediaPosts = visible.filter(post => post.mediaUrl && ['image', 'video'].includes(post.mediaType));
  const mediaIndex = mediaPosts.findIndex(post => post.id === mediaPostId);
  function editCity(changes) {
    setDraft({ accountId: profile.id, settings: { ...editing, ...changes } });
    setNotice('');
  }
  function applyChanges() {
    if (!hasChanges || !city.save({ ...city.value, ...editing, updatedAt: new Date().toISOString() })) return;
    if (!editing.enabled.includes(active)) {
      setActive(editing.enabled[0] || 'community');
      setActiveSource('');
    } else if (!draftSources.includes(activeSource)) setActiveSource('');
    setDraft(null);
    setError('');
    setVisibleCount(PAGE_SIZE);
    setNotice('Map changes applied.');
  }
  function discardChanges() {
    setDraft(null);
    setNotice('Unapplied map changes discarded.');
  }
  async function load(reset = false) {
    if (!reset && loading) return 0;
    if (!sourceKey || !enabled.includes(active)) return 0;
    const id = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const previous = !reset && results.current.scope === feedScope ? results.current.posts : [];
    if (reset) { paging.current = { page: 1, cursor: '' }; results.current = { scope: feedScope, posts: [] }; setPosts([]); setVisibleCount(PAGE_SIZE); }
    const mapTopics = mapSourceTopicScope(applied, active, requestedSources, previous);
    const constrained = Object.values(mapTopics).some(value => value !== null);
    const remaining = constrained ? 40 : mapPostTarget(applied.topicTargets[active + ':city']?.['*']) - previous.length;
    if (remaining <= 0 || !Object.values(mapTopics).some(value => value === null || value.length)) { setHasMore(false); setLoadedScope(feedScope); return 0; }
    setLoading(true); setError('');
    try {
      const params = { mode: category.mode || 'feed', sources: sourceKey, q: query.trim(), limit: Math.min(40, remaining), sort: 'newest', page: paging.current.page, surface: 'maps', passive: '1', mapTopics: JSON.stringify(mapTopics) };
      if (paging.current.cursor) params.cursor = paging.current.cursor;
      const { data } = await client.get('/office/feed', { params, signal: controller.signal });
      if (id !== sequence.current || feedScope !== scopeRef.current) return 0;
      setLocationContext(data.locationContext || null);
      const incoming = Array.isArray(data.posts) ? data.posts.filter(post => post?.id != null && requestedSources.includes(String(post.source || 'uficonnect').toLowerCase())).map(post => snapshot(post, active)) : [];
      setLoadedScope(feedScope);
      const merged = appendMapPosts(previous, incoming, applied, active, requestedSources);
      results.current = { scope: feedScope, posts: merged };
      setPosts(merged);
      paging.current = { page: paging.current.page + 1, cursor: data.cursor || '' };
      const nextTopics = mapSourceTopicScope(applied, active, requestedSources, merged);
      setHasMore(data.hasMore === true && (constrained || merged.length < mapPostTarget(applied.topicTargets[active + ':city']?.['*'])) && Object.values(nextTopics).some(value => value === null || value.length));
      setSample(data.sampleContent === true);
      return merged.length - previous.length;
    } catch (failure) {
      if (id === sequence.current && !controller.signal.aborted) setError('This category could not load. Retry to keep exploring.');
      return 0;
    } finally { if (id === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    setLocationContext(null);
    setMediaPostId(null); setGuideDestination(null);
    if (!enabled.includes(active) || !sourceKey) { setPosts([]); setHasMore(false); setVisibleCount(PAGE_SIZE); setError(''); return; }
    const timer = setTimeout(() => load(true), 200);
    return () => { clearTimeout(timer); sequence.current++; request.current?.abort(); setLoading(false); };
  }, [profile.id, active, query, enabled.includes(active), sourceKey, requestedTopics, locationKey]);
  useScrollToRefresh(() => load(true), { enabled: enabled.includes(active) && Boolean(sourceKey) && !loading });
  function chooseCategory(id) { setActive(id); setActiveSource(''); setQuery(''); setVisibleCount(PAGE_SIZE); setSourcePage(1); setTopicPage(1); setSelectedPage(1); }
  function openHouse(source) { setActiveSource(source); setQuery(''); setVisibleCount(PAGE_SIZE); setToolsPage('topics'); setTopicPage(1); setSelectedPage(1); setRevealPanel('topics'); if (mobileTools) setMobileToolsOpen(true); else setDesktopToolsOpen(true); }
  useEffect(() => {
    if (!revealPanel) return;
    const target = revealPanel === 'topics' ? houseHeading.current : revealPanel === 'guide' ? guideHeading.current : heading.current;
    if (target) {
      target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      target.focus({ preventScroll: true });
      setRevealPanel('');
    }
  }, [revealPanel, active, currentSource, enabled.includes(active), mobileTools]);
  function showBuilding(id) {
    const landmark = CITY_LANDMARKS.find(item => item.id === id);
    if (landmark) { navigate(landmark.to); return; }
    setActiveBuilding(id); setToolsPage('guide'); setRevealPanel('guide'); if (mobileTools) setMobileToolsOpen(true); else setDesktopToolsOpen(true);
  }
  function exploreBuilding() {
    if (!editing.enabled.includes(active)) {
      setNotice('Enable ' + category.label + ' in Customize your app to choose its topics.');
      return;
    }
    setToolsPage('topics');
    setRevealPanel('topics');
  }
  function setSources(next) {
    editCity({ sourceSelections: { ...editing.sourceSelections, [active]: next } });
  }
  function toggleSource(source) {
    setSources(draftSources.includes(source) ? draftSources.filter(item => item !== source) : [...draftSources, source]);
  }
  function toggleTopic(topic) {
    const next = topics.includes(topic) ? topics.filter(item => item !== topic) : [...topics, topic];
    editCity({ topicSelections: { ...editing.topicSelections, [topicKey]: next } });
  }
  function setTopicTarget(topic, value) {
    editCity({ topicTargets: { ...editing.topicTargets, [topicKey]: { ...editing.topicTargets[topicKey], [topic]: mapPostTarget(value) } } });
  }
  function sourceButton(source) {
    return <button key={source} type="button" className={'search-filter-chip city-source-chip' + (draftSources.includes(source) ? ' active' : '')} aria-pressed={draftSources.includes(source)} onClick={() => toggleSource(source)}>
      <span className="city-source-mark">{hasBrandIcon(source) ? <BrandIcon platform={source} size={17} /> : String(SOURCE_META[source]?.icon || source).slice(0, 3)}</span>{sourceLabel(source)}
    </button>;
  }
  function toggleCategory(id) {
    const next = editing.enabled.includes(id) ? editing.enabled.filter(item => item !== id) : [...editing.enabled, id];
    editCity({ enabled: next });
  }
  const houseSummaries = Object.fromEntries(sources.map(source => [source, (Array.isArray(topicSelections[active + ':' + source]) ? topicSelections[active + ':' + source] : []).map(topic => ({ topic, loaded: countTopic(topic, source), target: mapPostTarget(applied.topicTargets[active + ':' + source]?.[topic]) }))]));
  async function loadMore() {
    if (loading || request.current && fetching) return;
    if (visibleCount >= posts.length && hasMore) await load();
    setVisibleCount(value => value + PAGE_SIZE);
  }
  function menuPagination(label, current, total, change) {
    return total > 1 && <nav className="map-options-pagination" aria-label={label}><button type="button" className="btn btn-ghost btn-sm" disabled={current <= 1} onClick={() => change(current - 1)}>Previous</button><span role="status">{current} / {total}</span><button type="button" className="btn btn-ghost btn-sm" disabled={current >= total} onClick={() => change(current + 1)}>Next</button></nav>;
  }
  const cityControls = <aside className="map-customization-rail" aria-label="Customize your city">
      <nav className="map-menu-pages" aria-label="Map settings pages">{[['guide', 'Guide'], ['cities', 'Cities'], ['sources', 'Sources'], ['topics', 'Topics']].map(([id, label]) => <button type="button" key={id} aria-pressed={toolsPage === id} onClick={() => setToolsPage(id)}>{label}</button>)}</nav>
      {toolsPage === 'guide' && <CityAppGuide selected={activeBuilding} onSelect={setActiveBuilding} onAction={exploreBuilding} headingRef={guideHeading} />}
      {toolsPage === 'cities' && <section className="card city-customize"><h2>Customize your app</h2>
        <p>Choose your cities, source houses, and topics. Use Apply changes to update your map and save these settings for your account in this browser.</p>
        <div className="local-chip-row">{CITY_CATEGORIES.map(item => <label key={item.id} className="local-check-chip"><input type="checkbox" checked={editing.enabled.includes(item.id)} onChange={() => toggleCategory(item.id)} />{item.label}</label>)}</div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => editCity({ enabled: DEFAULT_CITY.enabled })}>Restore all categories</button>
      </section>}
      {toolsPage === 'sources' && editing.enabled.includes(active) && <section className="card city-source-picker" aria-labelledby="city-sources-heading">
        <div className="local-workspace-heading"><div><h2 id="city-sources-heading">Sources</h2><p>Each source gets a house in {category.label}. Open its house to choose the topics inside.</p></div>
          <button type="button" className="ufi-clear-control" disabled={!draftSources.length} onClick={() => setSources([])}>Clear</button>
        </div>
        <div className="local-chip-row" role="group" aria-label={category.label + ' sources'}>{sourceChoices.slice((Math.min(sourcePage, sourcePages) - 1) * 12, Math.min(sourcePage, sourcePages) * 12).map(sourceButton)}</div>
        {menuPagination('Source option pages', Math.min(sourcePage, sourcePages), sourcePages, setSourcePage)}
      </section>}
      {toolsPage === 'topics' && editing.enabled.includes(active) && <section id="city-source-house" className="card city-house-topics" aria-labelledby="house-topics-heading">
        <div className="local-workspace-heading"><div><span className="local-eyebrow">{draftSource ? 'INSIDE THE HOUSE' : 'CITY TOPICS'}</span><h2 ref={houseHeading} tabIndex={-1} id="house-topics-heading">{draftSource ? sourceLabel(draftSource) : category.label} · Topics</h2></div>
          {draftSource && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveSource('')}>Back to city topics</button>}
        </div>
        <p className="local-muted">{draftSource ? 'Filter this source house by topic.' : 'Filter the sources in this city by topic.'} Apply changes when you are ready.</p>
        <div className="map-selected-topics" aria-label="Selected topics">
          <div className="local-workspace-heading"><h3>Selected topics ({topics.length})</h3><button type="button" className="ufi-clear-control" disabled={!topics.length} onClick={() => editCity({ topicSelections: { ...editing.topicSelections, [topicKey]: [] } })}>Clear topics</button></div>
          {!topics.length && <p className="local-muted">Any topic. Add topics below to narrow the source posts.</p>}
          {!topics.length && <label className="map-topic-slider">Posts to load <output>{mapWildcardTarget(editing, active, draftSource || 'city')}</output><input type="range" aria-label="Posts to load" min="20" max="500" step="1" value={mapWildcardTarget(editing, active, draftSource || 'city')} onChange={event => setTopicTarget('*', event.target.value)} /><span>20–500 posts</span></label>}
          {topics.slice((Math.min(selectedPage, selectedPages) - 1) * 6, Math.min(selectedPage, selectedPages) * 6).map(topic => <div key={topic} className="map-topic-row">
            <div><strong>{topic}</strong><span>{countTopic(topic, draftSource || 'city')} posts loaded</span></div>
            <label className="map-topic-slider">Post count <output>{mapPostTarget(editing.topicTargets[topicKey]?.[topic])}</output><input type="range" aria-label={topic + ' post count'} min="20" max="500" step="1" value={mapPostTarget(editing.topicTargets[topicKey]?.[topic])} onChange={event => setTopicTarget(topic, event.target.value)} /><span>20–500 per topic</span></label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleTopic(topic)}>Remove</button>
          </div>)}
          {menuPagination('Selected topic pages', Math.min(selectedPage, selectedPages), selectedPages, setSelectedPage)}
        </div>
        <details className="map-more-topics" open={!topics.length || undefined}><summary>Add more topics</summary><label className="local-field">Find a topic<input type="search" value={topicSearch} onChange={event => { setTopicSearch(event.target.value); setTopicPage(1); }} placeholder="Search topics across categories" /></label><div className="local-chip-row" role="group" aria-label="Available house topics">
          {availableChoices.slice((Math.min(topicPage, topicPages) - 1) * 12, Math.min(topicPage, topicPages) * 12).map(topic => <button type="button" key={topic} className="search-filter-chip" onClick={() => toggleTopic(topic)}>+ {topic}</button>)}
          {menuPagination('Available topic pages', Math.min(topicPage, topicPages), topicPages, setTopicPage)}
        </div></details>

      </section>}
        </aside>;
  const applyActions = <>
    <button type="button" className="btn btn-primary btn-sm" disabled={!hasChanges} onClick={applyChanges}>Apply changes</button>
    {hasChanges && <button type="button" className="btn btn-ghost btn-sm" onClick={discardChanges}>Discard changes</button>}
  </>;
  const mapActions = <div className="map-feed-actions" role="group" aria-label="Map actions">
    {!mobileTools && <button type="button" className="btn btn-ghost btn-sm" aria-label={desktopToolsOpen ? 'Close map menu' : 'Open map menu'} aria-expanded={desktopToolsOpen} aria-controls="map-desktop-settings" onClick={() => setDesktopToolsOpen(value => !value)}><span aria-hidden="true">☰</span> Map menu</button>}
    {applyActions}
    {enabled.includes(active) && sourceKey
      ? <Link className="btn btn-ghost btn-sm" to={'/?feed=' + (category.mode || 'feed') + '&sources=' + encodeURIComponent(sourceKey)}>Source feed</Link>
      : <button type="button" className="btn btn-ghost btn-sm" disabled>Source feed</button>}
    <button type="button" className="btn btn-ghost btn-sm" disabled={loading || !enabled.includes(active) || !sourceKey} onClick={() => load(true)}>Refresh</button>
    <span className="map-apply-status" role="status">{hasChanges ? 'Unapplied changes' : notice}</span>
  </div>;
  return <Layout wide mobileRightMenu={mobileTools ? {
    label: 'map menu', controls: 'map-mobile-menu', triggerRef: mobileMenuButton,
    open: mobileToolsOpen, onOpenChange: setMobileToolsOpen,
  } : undefined} feedSearch={{ query, label: 'Search city posts', onSubmit: value => { setQuery(value); setVisibleCount(PAGE_SIZE); } }}>
    <Helmet><title>Map · Your city | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <div className="local-workspace city-workspace">
      <header className="local-workspace-heading map-workspace-heading"><div><span className="local-eyebrow">YOUR WORLD, CONNECTED</span><h1>Map</h1><p>Choose a city, open its source houses, and explore posts about the topics you enjoy.</p></div></header>
      {['countries', 'restaurants', 'bars'].includes(category.mode)
        ? <p className="muted">{category.label} destination: {[locationContext?.city, locationContext?.countryName || locationContext?.country].filter(Boolean).join(', ') || 'Automatic area'}. <Link to={category.route}>Change this destination</Link></p>
        : null}
      <div className={'map-explorer-layout' + (!desktopToolsOpen ? ' map-explorer-layout--full' : '')}>
        <div className="map-explorer-main">
      <CategoryCity cities={allCities} requestedLandmark={requestedLandmark} onCivicSelect={showBuilding} houseSummaries={houseSummaries} actions={mapActions} enabled={enabled} active={active} onSelect={chooseCategory} counts={counts} sources={enabled.includes(active) ? sources : []} activeSource={currentSource} onSourceSelect={openHouse} />
        </div>
        {!mobileTools && desktopToolsOpen && <div id="map-desktop-settings">{cityControls}</div>}
      </div>
      <div className="local-workspace-heading"><h2 ref={heading} tabIndex={-1}>{currentSource ? sourceLabel(currentSource) + ' posts' : category.label + ' · Source posts'}</h2><span role="status">{posts.length} posts loaded{visible.length < posts.length ? ' · ' + visible.length + ' shown' : ''}</span></div>
      {sample && <p className="local-muted">Sample posts for local review. The public website is unchanged.</p>}
      {(error || city.error) && <p className="local-error" role="alert">{error || city.error}{error && <button type="button" disabled={loading} onClick={() => load(true)}>Retry</button>}</p>}
      <div className="city-post-grid map-post-feed" aria-label="Map post feed" aria-busy={loading}>{enabled.includes(active) && visible.map(post => <PostCard key={post.key} post={post} onMediaOpen={item => setMediaPostId(item.id)} isMediaOpen={post.id === mediaPostId} onGuideOpen={setGuideDestination} onPostUpdated={updated => { const next = results.current.posts.map(item => item.id === updated.id ? { ...item, ...updated } : item); results.current.posts = next; setPosts(next); }} onRemoved={removed => { const next = results.current.posts.filter(item => item.id !== removed.id); results.current.posts = next; setPosts(next); }} />)}</div>
      {loading && <p role="status">Loading posts…</p>}
      {!loading && (!currentPosts.length || !enabled.includes(active)) && <p className="card">{!enabled.includes(active) ? 'Enable this city in Customize your app, then apply changes.' : !sourceKey ? 'Choose a source in the map menu, then apply changes to explore its posts.' : 'No posts match these sources and topics yet. Try another house or update your topics.'}</p>}
      {(visible.length < posts.length || hasMore) && <div className="local-pagination"><button type="button" className="btn btn-ghost" disabled={loading} onClick={loadMore}>Load more posts</button></div>}
      {!loading && posts.length > 0 && !hasMore && <p className="local-muted" role="status">{Object.values(mapSourceTopicScope(applied, active, requestedSources, posts)).some(value => value === null || value.length) ? 'All available matching posts are loaded.' : 'Configured post counts reached. Increase your post count or change topics to explore more.'}</p>}
    </div>
    {mediaIndex >= 0 && <ImageLightbox items={mediaPosts.map(post => ({ url: post.mediaUrl, type: post.mediaType, post }))} startIndex={mediaIndex} onClose={() => setMediaPostId(null)} onNearEnd={loadMore} />}
    {guideDestination && <TravelGuideDialog destination={guideDestination} onClose={() => setGuideDestination(null)} />}
    {mobileTools && mobileToolsOpen && createPortal(<div className="map-mobile-menu-backdrop" onClick={event => { if (event.target === event.currentTarget) setMobileToolsOpen(false); }}>
      <section id="map-mobile-menu" ref={mobileMenu} className="map-mobile-menu" role="dialog" aria-modal="true" aria-labelledby="map-mobile-menu-title">
        <header className="map-mobile-menu-heading"><h2 id="map-mobile-menu-title">Map menu</h2><button type="button" className="btn btn-ghost btn-sm" aria-label="Close map menu" onClick={() => setMobileToolsOpen(false)}>Close</button></header>
        <div className="map-mobile-menu-content">{cityControls}</div>
        <footer className="map-mobile-menu-actions">{applyActions}<span className="map-apply-status" role="status">{hasChanges ? 'Unapplied changes' : notice}</span>{city.error && <p className="local-error" role="alert">{city.error}</p>}</footer>
      </section>
    </div>, document.body)}
  </Layout>;
}
