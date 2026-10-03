import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import CategoryCity from '../components/SourceCity';
import CityAppGuide from '../components/CityAppGuide';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import { SOURCE_META } from '../components/sourceMeta';
import { CITY_SOURCE_PRESETS, CITY_SOURCE_IDS, CITY_ALL_TOPICS, houseTopics } from '../local/citySources';
import client from '../api/client';
import { topicCount } from '../local/cityTopicTargets.mjs';
import { useAuth } from '../contexts/AuthContext';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { CITY_CATEGORIES, useLocalWorkspace, safeLink } from '../local/localWorkspace';
import '../components/local-workspaces.css';
import '../components/maps-workspace.css';

const DEFAULT_CITY = { enabled: CITY_CATEGORIES.map(category => category.id), sourceSelections: {}, topicSelections: {} };
const PAGE_SIZE = 20;
const postKey = post => String(post.source || 'uficonnect') + ':' + String(post.id);
const sourceLabel = source => SOURCE_META[source]?.label || source;
const snapshot = (post, category) => ({
  key: postKey(post), id: String(post.id), source: String(post.source || 'uficonnect'),
  title: String(post.title || post.content || 'Community post').slice(0, 220),
  content: String(post.content || '').slice(0, 1800),
  topics: (Array.isArray(post.topics) ? post.topics : [post.topic]).filter(topic => typeof topic === 'string').slice(0, 30),
  sourceUrl: safeLink(post.sourceUrl), category,
});
const settingsFor = value => ({
  enabled: Array.isArray(value.enabled) ? value.enabled.filter(id => CITY_CATEGORIES.some(category => category.id === id)) : DEFAULT_CITY.enabled,
  sourceSelections: value.sourceSelections && typeof value.sourceSelections === 'object' && !Array.isArray(value.sourceSelections) ? value.sourceSelections : {},
  topicSelections: value.topicSelections && typeof value.topicSelections === 'object' && !Array.isArray(value.topicSelections) ? value.topicSelections : {},
});
const sourcesFor = (settings, category) => Array.isArray(settings.sourceSelections[category])
  ? [...new Set(settings.sourceSelections[category].filter(source => CITY_SOURCE_IDS.includes(source)))]
  : CITY_SOURCE_PRESETS[category] || ['uficonnect'];

export default function Maps() {
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
  const [loadedPosts, setPosts] = useState([]);
  const [loadedScope, setLoadedScope] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [moreAvailable, setHasMore] = useState(false);
  const [fetching, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sample, setSample] = useState(false);
  const [topicSearch, setTopicSearch] = useState('');
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
  const appliedTopicKey = active + ':' + (currentSource || 'city');
  const appliedTopics = Array.isArray(topicSelections[appliedTopicKey]) ? topicSelections[appliedTopicKey] : [];
  const requestedSources = currentSource ? [currentSource] : sources;
  const sourceKey = requestedSources.join(',');
  const requestedTopics = appliedTopics.join(',');
  // Hide results from the previous selection immediately, including during debounce.
  // Only a completed request for this exact scope may supply posts or pagination.
  const feedScope = JSON.stringify([profile.id, active, sourceKey, requestedTopics, query.trim(), enabled.includes(active)]);
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
  const pages = Math.max(1, Math.ceil(currentPosts.length / PAGE_SIZE));
  const visible = currentPosts.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE);
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
    setPage(1);
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
    if (reset) { paging.current = { page: 1, cursor: '' }; setPosts([]); setPage(1); }
    setLoading(true); setError('');
    try {
      const params = { mode: category.mode || 'feed', sources: sourceKey, q: query.trim(), limit: 40, sort: 'newest', page: paging.current.page };
      if (requestedTopics) params.topics = requestedTopics;
      if (paging.current.cursor) params.cursor = paging.current.cursor;
      const { data } = await client.get('/office/feed', { params, signal: controller.signal });
      if (id !== sequence.current) return 0;
      const incoming = Array.isArray(data.posts) ? data.posts.filter(post => post?.id != null && requestedSources.includes(String(post.source || 'uficonnect').toLowerCase())).map(post => snapshot(post, active)) : [];
      setLoadedScope(feedScope);
      setPosts(current => {
        const seen = new Set(reset ? [] : current.map(post => post.key));
        return [...(reset ? [] : current), ...incoming.filter(post => { if (seen.has(post.key)) return false; seen.add(post.key); return true; })].slice(0, 500);
      });
      paging.current = { page: paging.current.page + 1, cursor: data.cursor || '' };
      setHasMore(data.hasMore === true && (reset ? incoming.length : posts.length + incoming.length) < 500);
      setSample(data.sampleContent === true);
      return incoming.length;
    } catch (failure) {
      if (id === sequence.current && !controller.signal.aborted) setError('This category could not load. Retry to keep exploring.');
      return 0;
    } finally { if (id === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    if (!enabled.includes(active) || !sourceKey) { setPosts([]); setHasMore(false); setPage(1); setError(''); return; }
    const timer = setTimeout(() => load(true), 200);
    return () => { clearTimeout(timer); sequence.current++; request.current?.abort(); setLoading(false); };
  }, [profile.id, active, query, enabled.includes(active), sourceKey, requestedTopics]);
  useScrollToRefresh(() => load(true), { enabled: enabled.includes(active) && Boolean(sourceKey) && !loading });
  function chooseCategory(id) { setActive(id); setActiveSource(''); setQuery(''); setPage(1); }
  function openHouse(source) { setActiveSource(source); setQuery(''); setPage(1); setRevealPanel('topics'); if (mobileTools) setMobileToolsOpen(true); }
  useEffect(() => {
    if (!revealPanel) return;
    const target = revealPanel === 'topics' ? houseHeading.current : revealPanel === 'guide' ? guideHeading.current : heading.current;
    if (target) {
      target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      target.focus({ preventScroll: true });
      setRevealPanel('');
    }
  }, [revealPanel, active, currentSource, enabled.includes(active), mobileTools]);
  function showBuilding(id) { setActiveBuilding(id); setRevealPanel('guide'); if (mobileTools) setMobileToolsOpen(true); }
  function exploreBuilding() {
    if (!editing.enabled.includes(active)) {
      setNotice('Enable ' + category.label + ' in Customize your app to choose its topics.');
      return;
    }
    setPage(1);
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
  function sourceButton(source) {
    return <button key={source} type="button" className={'search-filter-chip city-source-chip' + (draftSources.includes(source) ? ' active' : '')} aria-pressed={draftSources.includes(source)} onClick={() => toggleSource(source)}>
      <span className="city-source-mark">{hasBrandIcon(source) ? <BrandIcon platform={source} size={17} /> : String(SOURCE_META[source]?.icon || source).slice(0, 3)}</span>{sourceLabel(source)}
    </button>;
  }
  function toggleCategory(id) {
    const next = editing.enabled.includes(id) ? editing.enabled.filter(item => item !== id) : [...editing.enabled, id];
    editCity({ enabled: next });
  }
  const houseSummaries = Object.fromEntries(sources.map(source => [source, (Array.isArray(topicSelections[active + ':' + source]) ? topicSelections[active + ':' + source] : []).map(topic => ({ topic, loaded: topicCount(posts, topic, active, source) }))]));
  async function nextPage() {
    if (page < pages) setPage(page + 1);
    else if (hasMore && await load()) setPage(page + 1);
    heading.current?.focus();
  }
  const cityControls = <aside className="map-customization-rail" aria-label="Customize your city">
      <CityAppGuide selected={activeBuilding} onSelect={setActiveBuilding} onAction={exploreBuilding} headingRef={guideHeading} />
      <details className="card city-customize"><summary>Customize your app</summary>
        <p>Choose your cities, source houses, and topics. Use Apply changes to update your map and save these settings for your account in this browser.</p>
        <div className="local-chip-row">{CITY_CATEGORIES.map(item => <label key={item.id} className="local-check-chip"><input type="checkbox" checked={editing.enabled.includes(item.id)} onChange={() => toggleCategory(item.id)} />{item.label}</label>)}</div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => editCity({ enabled: DEFAULT_CITY.enabled })}>Restore all categories</button>
      </details>
      {editing.enabled.includes(active) && <section className="card city-source-picker" aria-labelledby="city-sources-heading">
        <div className="local-workspace-heading"><div><h2 id="city-sources-heading">Sources</h2><p>Each source gets a house in {category.label}. Open its house to choose the topics inside.</p></div>
          <button type="button" className="ufi-clear-control" disabled={!draftSources.length} onClick={() => setSources([])}>Clear</button>
        </div>
        <div className="local-chip-row" role="group" aria-label={category.label + ' sources'}>{primarySources.map(sourceButton)}</div>
        {otherSources.length > 0 && <details className="city-more-sources"><summary>More sources ({otherSources.length})</summary><div className="local-chip-row">{otherSources.map(sourceButton)}</div></details>}
      </section>}
      {editing.enabled.includes(active) && <section id="city-source-house" className="card city-house-topics" aria-labelledby="house-topics-heading">
        <div className="local-workspace-heading"><div><span className="local-eyebrow">{draftSource ? 'INSIDE THE HOUSE' : 'CITY TOPICS'}</span><h2 ref={houseHeading} tabIndex={-1} id="house-topics-heading">{draftSource ? sourceLabel(draftSource) : category.label} · Topics</h2></div>
          {draftSource && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveSource('')}>Back to city topics</button>}
        </div>
        <p className="local-muted">{draftSource ? 'Filter this source house by topic.' : 'Filter the sources in this city by topic.'} Apply changes when you are ready.</p>
        <div className="map-selected-topics" aria-label="Selected topics">
          <div className="local-workspace-heading"><h3>Selected topics ({topics.length})</h3><button type="button" className="ufi-clear-control" disabled={!topics.length} onClick={() => editCity({ topicSelections: { ...editing.topicSelections, [topicKey]: [] } })}>Clear topics</button></div>
          {!topics.length && <p className="local-muted">Any topic. Add topics below to narrow the source posts.</p>}
          {topics.map(topic => <div key={topic} className="map-topic-row">
            <div><strong>{topic}</strong></div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleTopic(topic)}>Remove</button>
          </div>)}
        </div>
        <details className="map-more-topics" open={!topics.length || undefined}><summary>Add more topics</summary><label className="local-field">Find a topic<input type="search" value={topicSearch} onChange={event => setTopicSearch(event.target.value)} placeholder="Search topics across categories" /></label><div className="local-chip-row" role="group" aria-label="Available house topics">
          {availableTopics.filter(topic => !topics.includes(topic) && topic.toLowerCase().includes(topicSearch.toLowerCase())).map(topic => <button type="button" key={topic} className="search-filter-chip" onClick={() => toggleTopic(topic)}>+ {topic}</button>)}
        </div></details>

      </section>}
        </aside>;
  const applyActions = <>
    <button type="button" className="btn btn-primary btn-sm" disabled={!hasChanges} onClick={applyChanges}>Apply changes</button>
    {hasChanges && <button type="button" className="btn btn-ghost btn-sm" onClick={discardChanges}>Discard changes</button>}
  </>;
  const mapActions = <div className="map-feed-actions" role="group" aria-label="Map actions">
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
  } : undefined} feedSearch={{ query, label: 'Search city posts', onSubmit: value => { setQuery(value); setPage(1); } }}>
    <Helmet><title>Maps · Your city | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <div className="local-workspace city-workspace">
      <header className="local-workspace-heading"><div><span className="local-eyebrow">YOUR WORLD, CONNECTED</span><h1>Maps</h1><p>Choose a city, open its source houses, and explore posts about the topics you enjoy.</p></div></header>
      <div className="map-explorer-layout">
        <div className="map-explorer-main">
      <CategoryCity cities={allCities} onCivicSelect={showBuilding} houseSummaries={houseSummaries} actions={mapActions} enabled={enabled} active={active} onSelect={chooseCategory} counts={counts} sources={enabled.includes(active) ? sources : []} activeSource={currentSource} onSourceSelect={openHouse} />
        </div>
        {!mobileTools && cityControls}
      </div>
      <div className="local-workspace-heading"><h2 ref={heading} tabIndex={-1}>{currentSource ? sourceLabel(currentSource) + ' posts' : category.label + ' · Source posts'}</h2></div>
      {sample && <p className="local-muted">Sample posts for local review. The public website is unchanged.</p>}
      {(error || city.error) && <p className="local-error" role="alert">{error || city.error}{error && <button type="button" disabled={loading} onClick={() => load(true)}>Retry</button>}</p>}
      <div className="city-post-grid" aria-busy={loading}>{enabled.includes(active) && visible.map(post => <article className="card city-post" key={post.key}>
        <span className="local-eyebrow">{sourceLabel(post.source)}</span>
        <h3>{post.title}</h3><p>{post.content}</p>{safeLink(post.sourceUrl) && <a href={safeLink(post.sourceUrl)} target="_blank" rel="noopener noreferrer">Open post</a>}
      </article>)}</div>
      {loading && <p role="status">Loading posts…</p>}
      {!loading && (!currentPosts.length || !enabled.includes(active)) && <p className="card">{!enabled.includes(active) ? 'Enable this city in Customize your app, then apply changes.' : !sourceKey ? 'Choose a source in the map menu, then apply changes to explore its posts.' : 'No posts match these sources and topics yet. Try another house or update your topics.'}</p>}
      <nav className="local-pagination" aria-label="City post pages"><button type="button" className="btn btn-ghost btn-sm" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {Math.min(page, pages)}</span><button type="button" className="btn btn-ghost btn-sm" disabled={loading || (page >= pages && !hasMore)} onClick={nextPage}>Next</button></nav>
    </div>
    {mobileTools && mobileToolsOpen && createPortal(<div className="map-mobile-menu-backdrop" onClick={event => { if (event.target === event.currentTarget) setMobileToolsOpen(false); }}>
      <section id="map-mobile-menu" ref={mobileMenu} className="map-mobile-menu" role="dialog" aria-modal="true" aria-labelledby="map-mobile-menu-title">
        <header className="map-mobile-menu-heading"><h2 id="map-mobile-menu-title">Map menu</h2><button type="button" className="btn btn-ghost btn-sm" aria-label="Close map menu" onClick={() => setMobileToolsOpen(false)}>Close</button></header>
        <div className="map-mobile-menu-content">{cityControls}</div>
        <footer className="map-mobile-menu-actions">{applyActions}<span className="map-apply-status" role="status">{hasChanges ? 'Unapplied changes' : notice}</span>{city.error && <p className="local-error" role="alert">{city.error}</p>}</footer>
      </section>
    </div>, document.body)}
  </Layout>;
}
